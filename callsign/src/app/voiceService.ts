// 화면이 쓰는 음성 창구. 대사 재생, 글 → 음성, 엔진 불러오기, 재생 표시를 한곳에서 맡는다.
//
// - 한 번에 하나만 소리를 낸다. 새 재생을 요청하면 이전 것(준비 중인 것 포함)은 멈춘다.
// - 대사는 미리 만들어 둔 클립이 있으면 그것을, 없으면 불러온 엔진으로 만들어 튼다.
// - 클립과 합성 결과는 '효과 전 원음'이고, 요원 효과(와 무전 토글)는 그 위에 입힌다.
import { clampFx, decodeAudio, finishSpeech, isNeutralFx, renderVoice } from '../core/audio/index.ts';
import { lineTake } from '../core/agents/index.ts';
import { clipRequest } from '../core/clips.ts';
import { randomSeed } from '../core/tts/index.ts';
import type { AgentDef, AgentLine, Lang, PcmAudio, TtsProgress, TtsRequest, VoiceFx } from '../core/types.ts';
import { resumeAudio } from '../engine/audioContext.ts';
import { currentPlayback, play, stopAll } from '../engine/player.ts';
import type { Playback, PlaybackEndReason } from '../engine/player.ts';
import { getTtsEngine } from '../engine/ttsClient.ts';
import { clipKeyOf, findClip } from './roster.ts';
import { useAppStore } from './store.ts';
import type { SpokenResult } from './types.ts';

// ── 오류 ─────────────────────────────────────────────────────

export type VoiceErrorCode =
  /** 클립이 없고 엔진도 아직 불러오지 않았다 */
  | 'engine-needed'
  /** 엔진을 불러오지 못했다 */
  | 'engine-failed'
  /** 말할 글이 비었다 */
  | 'empty-text'
  /** 글에 문제가 있다(너무 길다 등) */
  | 'bad-input'
  /** 합성이나 효과 처리에 실패했다 */
  | 'failed'
  /** 사용자가 취소했다 */
  | 'aborted'
  /** 다른 재생 요청이 들어와서 이 요청은 버려졌다 */
  | 'superseded';

/** 음성 서비스가 던지는 오류. message 는 그대로 화면에 보여 줘도 되는 한국어 문장 */
export class VoiceError extends Error {
  override name = 'VoiceError';
  readonly code: VoiceErrorCode;
  constructor(code: VoiceErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.code = code;
  }
}

/** 클립이 없는 대사를 틀려는데 AI 음성 엔진을 아직 불러오지 않았을 때 */
export class EngineNeededError extends VoiceError {
  override name = 'EngineNeededError';
  constructor(message = '이 대사는 AI 음성 엔진을 불러와야 들을 수 있어요.') {
    super('engine-needed', message);
  }
}

/** 사용자에게 알릴 필요가 없는 오류인지(취소했거나, 다른 재생에 밀렸거나) */
export function isQuietError(err: unknown): boolean {
  if (err instanceof VoiceError) return err.code === 'aborted' || err.code === 'superseded';
  return err instanceof Error && err.name === 'AbortError';
}

/** 화면에 보여 줄 말. 알릴 필요가 없는 오류면 null */
export function voiceErrorMessage(err: unknown): string | null {
  if (isQuietError(err)) return null;
  if (err instanceof VoiceError) return err.message;
  return '소리를 준비하지 못했어요. 잠시 뒤에 다시 해 주세요.';
}

function toVoiceError(err: unknown): VoiceError {
  if (err instanceof VoiceError) return err;
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : '';
  if (name === 'AbortError') return new VoiceError('aborted', '만들기를 취소했어요.');
  if (name === 'TtsNotReadyError') return new EngineNeededError();
  if (name === 'TtsInputError') return new VoiceError('bad-input', message || '이 글로는 음성을 만들 수 없어요.');
  return new VoiceError('failed', '음성을 만들지 못했어요. 잠시 뒤에 다시 해 주세요.', err);
}

// ── 효과 ─────────────────────────────────────────────────────

/** 무전 토글을 켰을 때의 무전 효과 세기 */
export const RADIO_ON_AMOUNT = 0.8;

/** 요원의 효과에 무전 토글을 반영한 값. 실제로 소리에 입히는 효과는 항상 이것이다 */
export function effectiveFx(agent: AgentDef, opts: { radio?: boolean } = {}): VoiceFx {
  const fx = clampFx(agent.voice.fx);
  if (opts.radio) fx.radio = Math.max(fx.radio, RADIO_ON_AMOUNT);
  return fx;
}

function fxSignature(fx: VoiceFx): string {
  return Object.keys(fx)
    .sort()
    .map((k) => `${k}=${fx[k as keyof VoiceFx]}`)
    .join(',');
}

// ── 엔진 ─────────────────────────────────────────────────────

const engine = getTtsEngine();
let lastProgressAt = 0;

function mirrorEngine(): void {
  const status = engine.status;
  const errorMessage = status === 'error' ? engine.error?.message || 'AI 음성 엔진을 불러오지 못했어요.' : null;
  const store = useAppStore.getState();
  // 불러오는 중이 아니면 진행 표시는 지운다
  store.setEngine(status === 'loading' ? { status, errorMessage } : { status, errorMessage, progress: null });
}

engine.subscribe(mirrorEngine);
mirrorEngine();

/** 엔진이 바로 쓸 수 있는 상태인지 */
export function isEngineReady(): boolean {
  return engine.status === 'ready';
}

/**
 * AI 음성 엔진을 불러온다(모델 약 145MB 를 받는다). 사용자가 버튼을 눌렀을 때만 부를 것.
 * 진행 상황은 스토어의 `engine` 에 반영된다. 이미 준비됐으면 바로 끝난다.
 * 실패하면 code 'engine-failed' 인 VoiceError.
 */
export async function loadEngine(): Promise<void> {
  try {
    await engine.load((p) => {
      // 받는 동안 진행 알림이 아주 잦다. 화면은 1초에 열 번쯤만 다시 그린다
      const now = Date.now();
      const done = p.loadedBytes >= p.totalBytes;
      const prev = useAppStore.getState().engine.progress;
      if (!done && prev && prev.phase === p.phase && now - lastProgressAt < 100) return;
      lastProgressAt = now;
      if (engine.status === 'loading') useAppStore.getState().setEngine({ progress: p });
    });
  } catch (err) {
    if (err instanceof VoiceError) throw err;
    const message = err instanceof Error && err.message ? err.message : 'AI 음성 엔진을 불러오지 못했어요.';
    throw new VoiceError('engine-failed', message, err);
  }
}

// ── 재생 ─────────────────────────────────────────────────────

/** 대사 재생의 표시용 id */
export function linePlayId(agentId: string, lineId: string): string {
  return `line:${agentId}/${lineId}`;
}

/** 스튜디오 결과 재생의 표시용 id */
export function resultPlayId(resultId: string): string {
  return `result:${resultId}`;
}

/** 요청 순번. 새 요청이 들어오면 올라가고, 예전 요청은 자기 순번이 아니면 물러난다 */
let ticket = 0;
/** 준비 중인 대사 재생의 취소 손잡이. 새 요청이 들어오면 앞의 준비 작업을 그만두게 한다 */
let preparing: AbortController | null = null;

/** 새 재생 요청을 시작한다: 준비 중이던 것을 그만두게 하고 새 순번을 받는다 */
function nextTicket(): number {
  preparing?.abort();
  preparing = null;
  return ++ticket;
}
/** Space 로 다시 틀 수 있게 마지막으로 튼 소리를 기억한다 */
let lastPlayed: { id: string; audio: PcmAudio } | null = null;

export interface PlayAudioOptions {
  onEnded?: (reason: PlaybackEndReason) => void;
  /** 이 위치(초)부터 */
  offsetSec?: number;
}

function startPlayback(myTicket: number, id: string, audio: PcmAudio, opts: PlayAudioOptions): Playback {
  let playback: Playback;
  try {
    playback = play(audio, {
      offsetSec: opts.offsetSec,
      onEnded: (reason) => {
        if (ticket === myTicket) useAppStore.getState().setPlayback(null);
        opts.onEnded?.(reason);
      },
    });
  } catch (err) {
    if (ticket === myTicket) useAppStore.getState().setPlayback(null);
    throw new VoiceError('failed', '이 환경에서는 소리를 낼 수 없어요.', err);
  }
  lastPlayed = { id, audio };
  useAppStore.getState().setPlayback({ id, phase: 'playing' });
  return playback;
}

/**
 * 소리를 튼다. 틀고 있던 것은 멈춘다. `id` 는 화면이 "지금 이걸 트는 중"을 알아보는 표시다
 * (`usePlayPhase(id)` 로 읽는다).
 */
export function playAudio(id: string, audio: PcmAudio, opts: PlayAudioOptions = {}): Playback {
  const myTicket = nextTicket();
  void resumeAudio();
  return startPlayback(myTicket, id, audio, opts);
}

/** 지금 나는 소리(와 준비 중인 재생)를 멈춘다 */
export function stopPlayback(): void {
  nextTicket();
  stopAll();
  useAppStore.getState().setPlayback(null);
}

/** `id` 를 재생 중이면 지금 위치(초), 아니면 null. WaveformView 의 position 에 넘긴다 */
export function playbackPosition(id: string): number | null {
  const state = useAppStore.getState().playback;
  if (!state || state.id !== id || state.phase !== 'playing') return null;
  return currentPlayback()?.positionSec() ?? null;
}

/**
 * Space 단축키의 기본 동작: 소리가 나고 있으면 멈추고, 아니면 마지막으로 튼 소리를 다시 튼다.
 * 한 일이 있으면 true.
 */
export function toggleLastPlayback(): boolean {
  if (useAppStore.getState().playback) {
    stopPlayback();
    return true;
  }
  if (!lastPlayed) return false;
  playAudio(lastPlayed.id, lastPlayed.audio);
  return true;
}

// ── 대사 ─────────────────────────────────────────────────────

/** 작은 LRU. 대사 원음과 효과 입힌 결과를 잠깐 들고 있어 다시 누르면 바로 나온다 */
class AudioCache {
  private readonly map = new Map<string, PcmAudio>();
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  get(key: string): PcmAudio | undefined {
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit;
  }
  set(key: string, audio: PcmAudio): void {
    this.map.delete(key);
    this.map.set(key, audio);
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}

const dryCache = new AudioCache(24);
const wetCache = new AudioCache(24);
/** 진행 중인 원음 작업. 같은 원음을 동시에 두 번 받거나 만들지 않게 함께 기다린다 */
interface DryJob {
  promise: Promise<PcmAudio>;
  controller: AbortController;
  /** 이 결과를 기다리는 요청 수. 0 이 되면 작업을 그만둔다 */
  waiters: number;
}
const dryPending = new Map<string, DryJob>();

async function fetchClip(url: string, signal: AbortSignal): Promise<PcmAudio> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`클립을 받지 못했어요 (${res.status})`);
  return decodeAudio(await res.arrayBuffer());
}

/**
 * 대사의 원음(효과 전). 클립 → 엔진 합성 순으로 구한다.
 * `signal` 로 "나는 그만 기다린다"를 알리면, 더 기다리는 요청이 없을 때 작업 자체를 멈춘다.
 */
function lineDry(agent: AgentDef, line: AgentLine, signal?: AbortSignal): Promise<PcmAudio> {
  const key = `${agent.id}/${line.id}@${clipKeyOf(agent.voice, line)}`;
  const cached = dryCache.get(key);
  if (cached) return Promise.resolve(cached);

  let job = dryPending.get(key);
  if (!job) {
    const controller = new AbortController();
    const promise = (async (): Promise<PcmAudio> => {
      const clip = await findClip(agent, line);
      if (clip) {
        try {
          return await fetchClip(clip.url, controller.signal);
        } catch (err) {
          if (controller.signal.aborted) throw err;
          // 클립을 못 읽으면 엔진으로 만들어 본다
        }
      }
      if (engine.status !== 'ready') throw new EngineNeededError();
      // 클립을 만들 때와 같은 요청(같은 시드)이라, 언제 만들어도 같은 연기가 나온다
      const request = clipRequest(agent.voice, line, lineTake(agent.id, line.id));
      return finishSpeech(await engine.synthesize(request, { signal: controller.signal }));
    })();
    const created: DryJob = { promise, controller, waiters: 0 };
    job = created;
    dryPending.set(key, created);
    promise
      .then(
        (dry) => dryCache.set(key, dry),
        () => undefined,
      )
      .finally(() => {
        if (dryPending.get(key) === created) dryPending.delete(key);
      });
  }

  const joined = job;
  joined.waiters++;
  if (signal) {
    const leave = (): void => {
      joined.waiters--;
      if (joined.waiters <= 0) joined.controller.abort();
    };
    if (signal.aborted) leave();
    else {
      signal.addEventListener('abort', leave, { once: true });
      const detach = (): void => signal.removeEventListener('abort', leave);
      joined.promise.then(detach, detach);
    }
  }
  return joined.promise;
}

export interface LineOptions {
  /** 무전 효과를 입힐지. 기본 false */
  radio?: boolean;
  /** 취소 신호. 기다리는 곳이 더 없으면 받아 오거나 만드는 일도 멈춘다 */
  signal?: AbortSignal;
}

/**
 * 대사 음성을 재생 없이 구한다(요원 효과와 무전 토글까지 입힌 결과). 저장·공유에 쓴다.
 * 클립도 없고 엔진도 준비되지 않았으면 EngineNeededError.
 */
export async function renderLine(agent: AgentDef, line: AgentLine, opts: LineOptions = {}): Promise<PcmAudio> {
  try {
    const fx = effectiveFx(agent, opts);
    const key = `${agent.id}/${line.id}@${clipKeyOf(agent.voice, line)}|${fxSignature(fx)}`;
    const cached = wetCache.get(key);
    if (cached) return cached;
    const dry = await lineDry(agent, line, opts.signal);
    const wet = isNeutralFx(fx) ? dry : await renderVoice(dry, fx);
    wetCache.set(key, wet);
    return wet;
  } catch (err) {
    throw toVoiceError(err);
  }
}

/** 이 대사를 지금 바로(엔진 없이) 들을 수 있는지. 클립이 있고 목소리 설정과 맞으면 true */
export async function hasClip(agent: AgentDef, line: AgentLine): Promise<boolean> {
  return (await findClip(agent, line)) !== null;
}

export interface SpeakLineOptions extends LineOptions, PlayAudioOptions {}

/**
 * 요원의 대사를 튼다. 재생이 시작되면 Playback 을 돌려준다.
 * - 클립도 없고 엔진도 준비되지 않았으면 EngineNeededError
 * - 준비하는 사이 다른 재생 요청이 들어오면 code 'superseded' 인 VoiceError (알릴 필요 없음)
 */
export async function speakLine(agent: AgentDef, line: AgentLine, opts: SpeakLineOptions = {}): Promise<Playback> {
  const myTicket = nextTicket();
  const superseded = (): VoiceError => new VoiceError('superseded', '다른 소리를 트느라 이 재생은 건너뛰었어요.');
  // 다음 요청이 들어오면(또는 부른 쪽이 취소하면) 이 준비 작업을 그만둔다
  const abort = new AbortController();
  preparing = abort;
  if (opts.signal?.aborted) abort.abort();
  else opts.signal?.addEventListener('abort', () => abort.abort(), { once: true });

  const id = linePlayId(agent.id, line.id);
  stopAll();
  useAppStore.getState().setPlayback({ id, phase: 'preparing' });
  void resumeAudio();
  let audio: PcmAudio;
  try {
    audio = await renderLine(agent, line, { radio: opts.radio, signal: abort.signal });
  } catch (err) {
    if (ticket !== myTicket) throw superseded();
    useAppStore.getState().setPlayback(null);
    throw toVoiceError(err);
  } finally {
    if (preparing === abort) preparing = null;
  }
  if (ticket !== myTicket) throw superseded();
  return startPlayback(myTicket, id, audio, opts);
}

// ── 글 → 음성 ────────────────────────────────────────────────

/** 품질 단계별 디노이징 스텝 */
export const QUALITY_STEPS = { fast: 5, standard: 8, careful: 12 } as const;
export type Quality = keyof typeof QUALITY_STEPS;
export const DEFAULT_STEPS: number = QUALITY_STEPS.standard;

/** 스튜디오에서 한 번에 말할 수 있는 글자 수 */
export const STUDIO_MAX_CHARS = 300;
/** 말 빠르기의 허용 범위(모델 기준 배율) */
const SPEED_RANGE = { min: 0.8, max: 1.4 } as const;

/** 글자 종류를 보고 언어를 어림한다: 한글이 있으면 ko, 가나가 있으면 ja, 로마자만 있으면 en */
export function guessLang(text: string): Lang {
  let hangul = 0;
  let kana = 0;
  let han = 0;
  let latin = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if ((c >= 0xac00 && c <= 0xd7a3) || (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f)) hangul++;
    else if (c >= 0x3040 && c <= 0x30ff) kana++;
    else if (c >= 0x4e00 && c <= 0x9fff) han++;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f)) latin++;
  }
  if (hangul > 0) return 'ko';
  if (kana > 0 || han > 0) return 'ja';
  if (latin > 0) return 'en';
  return 'ko';
}

export interface SpeakTextOptions {
  /** 언어. 'auto'(기본)면 글자 종류로 어림한다 */
  lang?: Lang | 'auto';
  /** 요원 기본 빠르기에 곱하는 배율. 기본 1 */
  rate?: number;
  /** 디노이징 스텝 4~16. 기본 8. QUALITY_STEPS 참고 */
  steps?: number;
  /** 무전 효과. 기본 false */
  radio?: boolean;
  /** 주면 같은 테이크를 다시 만든다. 없으면 매번 새 테이크 */
  seed?: number;
  /** 취소 신호 */
  signal?: AbortSignal;
  /** 합성 진행 상황(문장 덩어리·스텝) */
  onProgress?: (p: TtsProgress) => void;
  /** 다 만들면 바로 튼다. 기본 false */
  autoplay?: boolean;
  /** 최근 기록에 남긴다. 기본 true */
  record?: boolean;
}

let resultSeq = 0;

/**
 * 글을 요원 목소리로 만든다: 합성 → 무음 정리·음량 맞춤 → 요원 효과.
 * 엔진이 준비되지 않았으면 EngineNeededError, 취소하면 code 'aborted' 인 VoiceError.
 */
export async function speakText(agent: AgentDef, text: string, opts: SpeakTextOptions = {}): Promise<SpokenResult> {
  const clean = text.trim();
  if (!clean) throw new VoiceError('empty-text', '말할 내용을 적어 주세요.');
  if (engine.status !== 'ready') throw new EngineNeededError('먼저 AI 음성 엔진을 불러와 주세요.');

  const lang = !opts.lang || opts.lang === 'auto' ? guessLang(clean) : opts.lang;
  const rate = Number.isFinite(opts.rate) ? (opts.rate as number) : 1;
  const steps = Number.isFinite(opts.steps) ? Math.round(opts.steps as number) : DEFAULT_STEPS;
  const seed = typeof opts.seed === 'number' && Number.isFinite(opts.seed) ? opts.seed >>> 0 : randomSeed();
  const radio = opts.radio === true;
  const request: TtsRequest = {
    text: clean,
    lang,
    blend: agent.voice.blend,
    speed: Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, agent.voice.speed * rate)),
    steps,
    seed,
  };

  const startedAt = performance.now();
  let audio: PcmAudio;
  try {
    const raw = await engine.synthesize(request, { onProgress: opts.onProgress, signal: opts.signal });
    const dry = finishSpeech(raw);
    const fx = effectiveFx(agent, { radio });
    audio = isNeutralFx(fx) ? dry : await renderVoice(dry, fx);
    if (opts.signal?.aborted) throw new VoiceError('aborted', '만들기를 취소했어요.');
  } catch (err) {
    throw toVoiceError(err);
  }

  const result: SpokenResult = {
    id: `r${Date.now().toString(36)}-${++resultSeq}`,
    agentId: agent.id,
    agentCallsign: agent.callsign,
    agentColor: agent.color,
    text: clean,
    lang,
    rate,
    steps,
    radio,
    seed,
    audio,
    durationSec: audio.samples.length / audio.sampleRate,
    elapsedMs: Math.round(performance.now() - startedAt),
    createdAt: Date.now(),
  };
  if (opts.record !== false) useAppStore.getState().addHistory(result);
  if (opts.autoplay) playAudio(resultPlayId(result.id), result.audio);
  return result;
}
