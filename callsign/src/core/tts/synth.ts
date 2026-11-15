// 합성 파이프라인: 글 → 토큰 → 길이 예측 → 텍스트 인코딩 → 잡음에서 잠재 벡터를 스텝마다 다듬기 → 보코더.
//
// 흐름은 Supertonic 참조 구현(supertone-inc/supertonic 의 web/helper.js, MIT)의 TextToSpeech._infer / call 을 옮긴 것이다.
// 참조와 다른 점:
//  - 잠재 벡터를 중첩 배열로 풀었다 감지 않고 Float32Array 그대로 다룬다. 스텝 출력 텐서를 다음 스텝 입력으로 바로 쓴다.
//  - 모델이 모르는 글자(-1)는 넣지 않는다.
//  - 난수에 시드를 줄 수 있다(같은 입력 → 같은 음성). 시드가 없으면 crypto 난수로 매번 다른 테이크.
//  - 문장 단위로 묶어 합성하고, 조각 사이에는 끝 문장부호에 맞는 쉼을 넣는다.
//  - AbortSignal 로 스텝 사이에 멈출 수 있다.

import { LANGS } from '../types.ts';
import type { PcmAudio, TtsProgress, TtsRequest } from '../types.ts';
import type { OrtLike, OrtTensorLike, TtsAssets } from './ort.ts';
import { planChunks, preprocessText, tokenize } from './text.ts';
import { blendStyle } from './voices.ts';

export const SPEED_MIN = 0.8;
export const SPEED_MAX = 1.4;
export const STEPS_MIN = 4;
export const STEPS_MAX = 16;
export const DEFAULT_STEPS = 8;
/** 한 번에 받는 글 길이 한도(글자). 화면은 300자로 더 짧게 막는다 */
export const MAX_TEXT_LENGTH = 5000;
/** 조각 하나가 이보다 길게 예측되면 모델이 길을 잃은 것으로 본다(초) */
const MAX_CHUNK_SECONDS = 90;
/** 조각을 이어 붙일 때 이음매에 주는 페이드(초) */
const JOIN_FADE_SEC = 0.005;

export interface SynthesizeOptions {
  /** 조각이 시작될 때(step 0)와 스텝이 끝날 때마다 불린다. `step` 은 끝난 스텝 수 */
  onProgress?: (p: TtsProgress) => void;
  signal?: AbortSignal;
}

export interface Synthesizer {
  readonly sampleRate: number;
  /** 결과는 모델 출력 그대로(후처리 전). 동시에 부르면 부른 순서대로 하나씩 처리한다 */
  synthesize(req: TtsRequest, opts?: SynthesizeOptions): Promise<PcmAudio>;
}

/** 합성할 글이 없거나 요청 값이 잘못됐을 때 */
export class TtsInputError extends Error {
  override name = 'TtsInputError';
}

/** 취소됐을 때 던지는 오류. `name` 이 'AbortError' 다 */
export function createAbortError(): Error {
  const err = new Error('음성 만들기를 취소했어요.');
  err.name = 'AbortError';
  return err;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

// ── 난수 ──────────────────────────────────────────────────────────────────

/** 0 이상 2^32 미만 정수를 내는 시드 난수(sfc32). 같은 시드와 흐름 번호면 언제나 같은 수열 */
export function createRng(seed: number, stream = 0): () => number {
  let a = 0x9e3779b9 ^ (seed >>> 0);
  let b = 0x243f6a88 ^ Math.imul(stream + 1, 0x85ebca6b);
  let c = 0xb7e15162 ^ (Math.floor(seed / 4294967296) >>> 0);
  let d = 1;
  const next = (): number => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  // 초기 상태의 치우침을 털어낸다
  for (let i = 0; i < 16; i++) next();
  return next;
}

/** 시드가 없을 때 쓸 무작위 시드 */
export function randomSeed(): number {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    return c.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/** 표준정규분포 난수로 채운다(Box–Muller, 한 번에 두 값) */
export function fillGaussian(out: Float32Array, rng: () => number): void {
  const n = out.length;
  for (let i = 0; i < n; i += 2) {
    // u1 은 (0, 1], u2 는 [0, 1)
    const u1 = (rng() + 1) / 4294967296;
    const u2 = rng() / 4294967296;
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    out[i] = r * Math.cos(theta);
    if (i + 1 < n) out[i + 1] = r * Math.sin(theta);
  }
}

// ── 이어 붙이기 ───────────────────────────────────────────────────────────

/** 소리가 있다고 보는 문턱(-60dBFS). 숨소리·한숨 같은 여린 소리는 넘고, 모델이 채워 넣는 무음(-70dBFS 아래)은 못 넘는다 */
const AUDIBLE_RMS = 0.001;
const EDGE_FRAME_SEC = 0.01;
/** 이음매에서 소리 앞뒤로 남겨 두는 여유. 첫소리의 시작과 끝소리의 여운을 자르지 않기 위해서다 */
const KEEP_HEAD_SEC = 0.02;
const KEEP_TAIL_SEC = 0.04;

/**
 * 소리가 나는 구간 [start, end) 을 샘플 위치로 돌려준다. 전부 무음이면 null.
 * 모델은 조각마다 앞뒤에 0.4~0.7초씩 무음을 붙여 내놓는다. 조각을 그대로 이으면 쉼이 1초를 넘는다.
 */
export function findAudibleRange(samples: Float32Array, sampleRate: number): { start: number; end: number } | null {
  const frame = Math.max(1, Math.round(EDGE_FRAME_SEC * sampleRate));
  const threshold = AUDIBLE_RMS * AUDIBLE_RMS * frame;
  const energyAt = (from: number): number => {
    const to = Math.min(samples.length, from + frame);
    let e = 0;
    for (let i = from; i < to; i++) e += samples[i] * samples[i];
    return e;
  };
  let start = -1;
  for (let from = 0; from < samples.length; from += frame) {
    if (energyAt(from) > threshold) {
      start = from;
      break;
    }
  }
  if (start < 0) return null;
  let end = samples.length;
  for (let from = Math.floor((samples.length - 1) / frame) * frame; from >= start; from -= frame) {
    if (energyAt(from) > threshold) {
      end = Math.min(samples.length, from + frame);
      break;
    }
  }
  return { start, end };
}

/**
 * 조각들을 쉼을 두고 잇는다. `pausesSec[i]` 는 i 번째 조각의 소리가 끝나고 다음 조각의 소리가 시작될 때까지의 간격.
 * 조각이 하나면 손대지 않고 그대로 돌려준다. 여럿이면 이음매 쪽 무음을 걷어 내고(맨 앞과 맨 뒤 무음은 그대로 둔다),
 * 이음매 양쪽에 짧은 페이드를 준다(딸깍 소리 방지).
 */
export function joinChunks(parts: Float32Array[], pausesSec: number[], sampleRate: number): Float32Array {
  if (parts.length === 0) return new Float32Array(0);
  if (parts.length === 1) return parts[0];
  const last = parts.length - 1;
  const keepHead = Math.round(KEEP_HEAD_SEC * sampleRate);
  const keepTail = Math.round(KEEP_TAIL_SEC * sampleRate);
  const fade = Math.max(1, Math.round(JOIN_FADE_SEC * sampleRate));

  const pieces = parts.map((part, i) => {
    const range = findAudibleRange(part, sampleRate) ?? { start: 0, end: part.length };
    const start = i === 0 ? 0 : Math.max(0, range.start - keepHead);
    const end = i === last ? part.length : Math.min(part.length, range.end + keepTail);
    return part.subarray(start, Math.max(start, end));
  });
  // 남겨 둔 여유도 조용한 구간이므로 쉼 길이에서 뺀다
  const gaps = pieces.map((_, i) =>
    i < last ? Math.max(0, Math.round((pausesSec[i] ?? 0) * sampleRate) - keepHead - keepTail) : 0,
  );

  const total = pieces.reduce((acc, p) => acc + p.length, 0) + gaps.reduce((acc, g) => acc + g, 0);
  const out = new Float32Array(total);
  let offset = 0;
  pieces.forEach((piece, i) => {
    out.set(piece, offset);
    const n = Math.min(fade, piece.length >> 1);
    if (i > 0) {
      for (let k = 0; k < n; k++) out[offset + k] *= k / n;
    }
    if (i < last) {
      const end = offset + piece.length;
      for (let k = 0; k < n; k++) out[end - 1 - k] *= k / n;
    }
    offset += piece.length + gaps[i];
  });
  return out;
}

// ── 파이프라인 ────────────────────────────────────────────────────────────

interface NormalizedRequest {
  text: string;
  lang: TtsRequest['lang'];
  blend: TtsRequest['blend'];
  speed: number;
  steps: number;
  seed: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function normalizeRequest(req: TtsRequest): NormalizedRequest {
  if (typeof req.text !== 'string' || req.text.trim().length === 0) {
    throw new TtsInputError('읽을 글을 적어 주세요.');
  }
  if (req.text.length > MAX_TEXT_LENGTH) {
    throw new TtsInputError(`글이 너무 길어요. ${MAX_TEXT_LENGTH}자 안으로 줄여 주세요.`);
  }
  if (!LANGS.includes(req.lang)) {
    throw new TtsInputError(`지원하지 않는 언어 코드예요: ${String(req.lang)}`);
  }
  const speed = Number.isFinite(req.speed) ? clamp(req.speed, SPEED_MIN, SPEED_MAX) : 1;
  const steps = Number.isFinite(req.steps) ? clamp(Math.round(req.steps), STEPS_MIN, STEPS_MAX) : DEFAULT_STEPS;
  const seed = typeof req.seed === 'number' && Number.isFinite(req.seed) ? Math.abs(Math.trunc(req.seed)) : randomSeed();
  return { text: req.text, lang: req.lang, blend: req.blend, speed, steps, seed };
}

function float32Output(out: Readonly<Record<string, OrtTensorLike>>, name: string): Float32Array {
  const data = out[name]?.data;
  if (!(data instanceof Float32Array)) {
    throw new Error(`음성 모델이 예상과 다른 값을 내놓았어요(${name}).`);
  }
  return data;
}

/** 다른 메시지(취소 요청 등)가 처리될 틈을 준다 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 런타임에 묶이지 않는 합성기를 만든다.
 * `ort` 는 텐서 생성자만 있으면 되고, 세션은 `assets` 로 받는다(buildTtsAssets 참고).
 */
export function createSynthesizer(ort: OrtLike, assets: TtsAssets): Synthesizer {
  const { sessions, config, indexer, voices } = assets;
  const { sampleRate, latentHop, latentChannels } = config;
  const f32 = (data: Float32Array, dims: readonly number[]): OrtTensorLike => new ort.Tensor('float32', data, dims);

  async function synthesizeChunk(
    ids: number[],
    style: { ttl: OrtTensorLike; dp: OrtTensorLike },
    req: NormalizedRequest,
    chunkIndex: number,
    chunkCount: number,
    opts: SynthesizeOptions,
  ): Promise<Float32Array> {
    const throwIfAborted = (): void => {
      if (opts.signal?.aborted) throw createAbortError();
    };
    const report = (step: number): void => {
      opts.onProgress?.({ chunkIndex, chunkCount, step, steps: req.steps });
    };

    const tokenCount = ids.length;
    const idData = new BigInt64Array(tokenCount);
    for (let i = 0; i < tokenCount; i++) idData[i] = BigInt(ids[i]);
    const textIds = new ort.Tensor('int64', idData, [1, tokenCount]);
    const textMask = f32(new Float32Array(tokenCount).fill(1), [1, 1, tokenCount]);

    throwIfAborted();
    report(0);

    const dpOut = await sessions.durationPredictor.run({ text_ids: textIds, style_dp: style.dp, text_mask: textMask });
    const predicted = float32Output(dpOut, 'duration')[0];
    const duration = predicted / req.speed;
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_CHUNK_SECONDS) {
      throw new Error('말 길이를 가늠하지 못했어요. 문장을 조금 바꿔서 다시 해 보세요.');
    }

    throwIfAborted();
    const teOut = await sessions.textEncoder.run({ text_ids: textIds, style_ttl: style.ttl, text_mask: textMask });
    const textEmb = teOut.text_emb;

    const wavLength = Math.max(1, Math.floor(duration * sampleRate));
    const latentLength = Math.floor((wavLength + latentHop - 1) / latentHop);
    const latentDims = [1, latentChannels, latentLength];

    const noise = new Float32Array(latentChannels * latentLength);
    fillGaussian(noise, createRng(req.seed, chunkIndex));
    let latent: OrtTensorLike = f32(noise, latentDims);
    const latentMask = f32(new Float32Array(latentLength).fill(1), [1, 1, latentLength]);
    const totalStep = f32(Float32Array.of(req.steps), [1]);

    for (let step = 0; step < req.steps; step++) {
      // 취소 요청이 도착할 틈을 준 뒤 확인한다
      if (opts.signal) await yieldToEventLoop();
      throwIfAborted();
      const out = await sessions.vectorEstimator.run({
        noisy_latent: latent,
        text_emb: textEmb,
        style_ttl: style.ttl,
        latent_mask: latentMask,
        text_mask: textMask,
        current_step: f32(Float32Array.of(step), [1]),
        total_step: totalStep,
      });
      // 출력 텐서를 복사 없이 다음 스텝 입력으로 쓴다
      float32Output(out, 'denoised_latent');
      latent = out.denoised_latent;
      report(step + 1);
    }

    if (opts.signal) await yieldToEventLoop();
    throwIfAborted();
    const vocOut = await sessions.vocoder.run({ latent });
    const wav = float32Output(vocOut, 'wav_tts');
    // 보코더는 잠재 칸 단위로 내놓는다. 예측한 길이까지만 쓴다(복사해서 가진다)
    const samples = wav.slice(0, Math.min(wavLength, wav.length));
    for (let i = 0; i < samples.length; i++) {
      if (!Number.isFinite(samples[i])) {
        throw new Error('음성을 만드는 중에 계산이 어긋났어요. 다시 해 보세요.');
      }
    }
    return samples;
  }

  async function run(request: TtsRequest, opts: SynthesizeOptions): Promise<PcmAudio> {
    if (opts.signal?.aborted) throw createAbortError();
    const req = normalizeRequest(request);

    const planned = planChunks(req.text, req.lang);
    const jobs: Array<{ ids: number[]; pauseSec: number }> = [];
    for (const chunk of planned) {
      // 모델이 아는 글자가 하나도 없는 조각은 빈 문자열이 되어 건너뛴다
      const prepared = preprocessText(chunk.text, req.lang, indexer);
      if (prepared.length > 0) jobs.push({ ids: tokenize(prepared, indexer), pauseSec: chunk.pauseSec });
    }
    if (jobs.length === 0) {
      throw new TtsInputError('소리 내어 읽을 수 있는 글자가 없어요.');
    }

    const blended = blendStyle(voices, req.blend);
    const style = {
      ttl: f32(blended.ttl, blended.ttlDims),
      dp: f32(blended.dp, blended.dpDims),
    };

    const parts: Float32Array[] = [];
    for (let i = 0; i < jobs.length; i++) {
      parts.push(await synthesizeChunk(jobs[i].ids, style, req, i, jobs.length, opts));
    }
    const samples = joinChunks(
      parts,
      jobs.map((j) => j.pauseSec),
      sampleRate,
    );
    return { samples, sampleRate };
  }

  // 세션은 한 번에 하나의 run 만 받는다. 요청을 줄 세운다
  let tail: Promise<unknown> = Promise.resolve();
  return {
    sampleRate,
    synthesize(req, opts = {}) {
      const result = tail.then(() => run(req, opts));
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
