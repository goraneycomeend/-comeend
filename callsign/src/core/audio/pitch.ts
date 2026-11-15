// 피치·포먼트 이동. signalsmith-stretch(WASM) 를 쓴다.
// 둘 다 0 이면 이 파일의 어떤 처리도 거치지 않는다(호출하는 쪽에서 needsPitch 로 가른다).
//
// 라이브러리는 AudioWorklet 용으로 나온 단일 파일이다. 여기서는 그 원문을 두 가지로 쓴다.
//  - 실시간(마이크): 원문을 그대로 AudioWorklet 모듈로 올리고 노드에 소리를 연결한다.
//  - 오프라인(파일·합성 결과): 같은 원문의 처리기(processor) 클래스를 오디오 스레드 밖에서 직접 돌린다.
//    OfflineAudioContext 안에서도 워크릿은 잘 돌지만, 렌더할 때마다 새 컨텍스트 + 새 워크릿이 필요하고
//    Chromium 은 그런 컨텍스트가 한 페이지에서 125개쯤 쌓이면 다음 워크릿을 올리다 멈춘다(재현 확인).
//    직접 돌리면 그 한계가 없고, WASM 인스턴스 하나를 계속 돌려쓴다. 계산 내용은 워크릿과 같은 코드다.
import type { PcmAudio, VoiceFx } from '../types.ts';
import { FX_EPS } from './fxSchema.ts';

/** 피치나 포먼트를 건드려야 하는지 */
export function needsPitch(fx: Pick<VoiceFx, 'pitch' | 'formant'>): boolean {
  return Math.abs(fx.pitch) >= FX_EPS || Math.abs(fx.formant) >= FX_EPS;
}

/**
 * 피치·포먼트를 옮기면 음량이 조금 줄어든다. 그만큼 되살리는 양(dB).
 * 실제 음성으로 재 보니 줄어드는 양은 '포먼트 − 피치'(성도를 배음에 대해 얼마나 옮겼는지)를 따랐다.
 */
export function pitchMakeupDb(pitch: number, formant: number): number {
  const d = formant - pitch;
  return d < 0 ? Math.min(4, 0.37 * -d) : Math.min(1.5, 0.12 * d);
}

const dbToGain = (db: number): number => Math.pow(10, db / 20);

interface StretchSchedule {
  /** 이 변경이 적용될 출력 시각(초) */
  output?: number;
  active?: boolean;
  /** 버퍼 모드에서 입력 위치(초) */
  input?: number;
  rate?: number;
  semitones?: number;
  tonalityHz?: number;
  formantSemitones?: number;
  formantCompensation?: boolean;
  /** 포먼트 분석에 쓰는 대략의 기본 주파수. 0 이면 스스로 추정 */
  formantBaseHz?: number;
}

export interface StretchConfig {
  /** 분석 블록 길이(ms). 기본 120 */
  blockMs?: number;
  /** 블록 간격(ms). 기본 30 */
  intervalMs?: number;
}

/** 음질 튜닝·실험용 선택 값. 평소에는 주지 않는다 */
export interface PitchTuning {
  config?: StretchConfig;
  tonalityHz?: number;
  formantCompensation?: boolean;
}

const PROCESSOR_NAME = 'signalsmith-stretch';
const NODE_OPTIONS = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] };

/**
 * 실시간(마이크)용 설정. 기본값(120ms 블록)보다 블록을 줄여 지연을 낮춘다.
 * 더 줄이면 낮은 목소리에서 떨림이 들린다.
 */
const LIVE_CONFIG: Required<StretchConfig> = { blockMs: 80, intervalMs: 20 };

/** 오프라인용 설정. 라이브러리 기본 프리셋과 같은 값 */
const OFFLINE_CONFIG: Required<StretchConfig> = { blockMs: 120, intervalMs: 30 };

function scheduleFor(pitch: number, formant: number, baseHz: number, tuning: PitchTuning): StretchSchedule {
  return {
    active: true,
    semitones: pitch,
    formantSemitones: formant,
    // 피치를 옮겨도 성도 크기(포먼트)는 제자리에 둔다. 체구는 formant 로만 바꾼다
    formantCompensation: tuning.formantCompensation ?? true,
    formantBaseHz: baseHz,
    tonalityHz: tuning.tonalityHz ?? 8000,
  };
}

let sourcePromise: Promise<string> | null = null;

/** 라이브러리 원문(문자열). 번들러가 줄여 쓰지 않은 그대로라서 워크릿 안에서도 그대로 돈다 */
function loadStretchSource(): Promise<string> {
  sourcePromise ??= import('signalsmith-stretch?raw').then((m) => m.default);
  return sourcePromise;
}

// ───────────────────────── 오프라인: 처리기를 직접 돌린다 ─────────────────────────

/** 워크릿 전역(AudioWorkletProcessor, registerProcessor, sampleRate, currentTime)을 모듈 안의 이름으로 대신 세워 준다 */
const DIRECT_PRELUDE = `
let sampleRate = 44100, currentTime = 0;
let __csProcessor = null;
class AudioWorkletProcessor {
  constructor() {
    const self = this;
    this.__csOnPost = null;
    this.port = { onmessage: null, postMessage(message) { if (self.__csOnPost) self.__csOnPost(message); } };
  }
}
function registerProcessor(name, ctor) { __csProcessor = ctor; }
`;
const DIRECT_POSTLUDE = `
export const __csRuntime = {
  get Processor() { return __csProcessor; },
  setClock(rate, time) { sampleRate = rate; currentTime = time; },
};
`;

type PortMessage = [number | string, unknown];

interface DirectProcessor {
  __csOnPost: ((message: PortMessage) => void) | null;
  port: { onmessage: ((event: { data: unknown[] }) => void) | null };
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, never>): boolean;
}

interface DirectRuntime {
  readonly Processor: (new (options: typeof NODE_OPTIONS) => DirectProcessor) | null;
  setClock(sampleRate: number, currentTime: number): void;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

let directRuntime: Promise<DirectRuntime> | null = null;

function loadDirectRuntime(): Promise<DirectRuntime> {
  directRuntime ??= (async () => {
    const code = DIRECT_PRELUDE + (await loadStretchSource()) + DIRECT_POSTLUDE;
    let mod: { __csRuntime: DirectRuntime };
    if (typeof document !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      try {
        mod = await import(/* @vite-ignore */ url);
      } finally {
        URL.revokeObjectURL(url);
      }
    } else {
      // blob 주소를 모듈로 못 읽는 환경(Node 등)
      mod = await import(/* @vite-ignore */ `data:text/javascript;base64,${toBase64(code)}`);
    }
    if (!mod.__csRuntime.Processor) throw new Error('목소리 높낮이 처리기를 불러오지 못했어요.');
    return mod.__csRuntime;
  })();
  directRuntime.catch(() => {
    directRuntime = null; // 다음 호출에서 다시 시도
  });
  return directRuntime;
}

interface DirectEngine {
  runtime: DirectRuntime;
  processor: DirectProcessor;
  call(method: string, ...args: unknown[]): unknown;
}

/** 샘플레이트별로 하나씩 만들어 두고 돌려쓴다(WASM 인스턴스를 매번 새로 만들지 않게) */
const directEngines = new Map<number, DirectEngine>();

async function getDirectEngine(sampleRate: number): Promise<DirectEngine> {
  const cached = directEngines.get(sampleRate);
  if (cached) return cached;
  const runtime = await loadDirectRuntime();
  const Processor = runtime.Processor;
  if (!Processor) throw new Error('목소리 높낮이 처리기를 불러오지 못했어요.');
  runtime.setClock(sampleRate, 0);
  const processor = new Processor(NODE_OPTIONS);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('목소리 높낮이 처리기가 준비되지 않았어요.')), 15000);
    processor.__csOnPost = (message) => {
      if (message[0] === 'ready') {
        clearTimeout(timer);
        resolve();
      }
    };
  });
  const engine: DirectEngine = {
    runtime,
    processor,
    call(method: string, ...args: unknown[]): unknown {
      let result: unknown;
      processor.__csOnPost = (message) => {
        if (message[0] === 0) result = message[1];
      };
      const handler = processor.port.onmessage;
      if (handler) handler({ data: [0, method, ...args] });
      processor.__csOnPost = null;
      return result;
    },
  };
  if (directEngines.size >= 3) {
    const oldest = directEngines.keys().next().value;
    if (oldest !== undefined) directEngines.delete(oldest);
  }
  directEngines.set(sampleRate, engine);
  return engine;
}

/** 긴 소리를 처리하는 동안 화면이 굳지 않게 잠깐 양보한다 */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// 처리기는 시계(sampleRate, currentTime)를 모듈 변수로 공유하므로 한 번에 한 작업만 돌린다
let directQueue: Promise<unknown> = Promise.resolve();

export interface ShiftPitchOptions {
  /** 입력 목소리의 대략적인 기본 주파수(Hz). 주면 포먼트 분석이 안정된다. 모르면 0 */
  baseHz?: number;
  tuning?: PitchTuning;
}

/**
 * 피치(반음)와 포먼트(반음)를 옮긴 새 음성을 돌려준다. 길이와 시작 시점은 입력과 같다.
 * 오디오 컨텍스트 없이 돈다(브라우저 메인 스레드·Worker, 번들러를 거친 Node).
 */
export function shiftPitch(input: PcmAudio, pitch: number, formant: number, opts: ShiftPitchOptions = {}): Promise<PcmAudio> {
  const job = async (): Promise<PcmAudio> => {
    const { sampleRate } = input;
    const n = input.samples.length;
    const out = new Float32Array(n);
    if (n === 0) return { samples: out, sampleRate };

    const engine = await getDirectEngine(sampleRate);
    const { runtime, processor } = engine;
    const tuning = opts.tuning ?? {};

    // 이전 작업의 흔적을 지우고 처음부터.
    // 블록 길이를 직접 줘야 처리기가 내부 상태까지 비운다(기본 프리셋으로 두면 앞 작업의 상태가 남아 결과가 달라진다)
    runtime.setClock(sampleRate, 0);
    engine.call('dropBuffers');
    engine.call('configure', {
      blockMs: tuning.config?.blockMs || OFFLINE_CONFIG.blockMs,
      intervalMs: tuning.config?.intervalMs || OFFLINE_CONFIG.intervalMs,
    });
    engine.call('addBuffers', [input.samples.slice()]);
    // 버퍼 모드에서는 처리기가 자기 지연을 스스로 당겨서, 출력이 입력과 같은 시각에 시작한다
    engine.call('schedule', { ...scheduleFor(pitch, formant, opts.baseHz ?? 0, tuning), input: 0, output: 0, rate: 1 });

    const quantum = 128;
    const block = new Float32Array(quantum);
    const outputs = [[block]];
    const inputs: Float32Array[][] = [[]];
    const gain = dbToGain(pitchMakeupDb(pitch, formant));
    let sliceStart = now();
    for (let pos = 0; pos < n; pos += quantum) {
      runtime.setClock(sampleRate, pos / sampleRate);
      processor.process(inputs, outputs, {});
      const count = Math.min(quantum, n - pos);
      for (let i = 0; i < count; i++) out[pos + i] = block[i] * gain;
      if ((pos / quantum) % 32 === 31 && now() - sliceStart > 12) {
        await yieldToUi();
        sliceStart = now();
      }
    }
    engine.call('dropBuffers');
    return { samples: out, sampleRate };
  };
  const run = directQueue.then(job, job);
  directQueue = run.catch(() => {});
  return run;
}

// ───────────────────────── 실시간: AudioWorklet 노드 ─────────────────────────

const workletModules = new WeakMap<BaseAudioContext, Promise<void>>();

function ensureWorkletModule(ctx: BaseAudioContext): Promise<void> {
  let loading = workletModules.get(ctx);
  if (!loading) {
    loading = (async () => {
      const source = await loadStretchSource();
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    workletModules.set(ctx, loading);
    loading.catch(() => workletModules.delete(ctx));
  }
  return loading;
}

interface StretchWorklet {
  node: AudioWorkletNode;
  call(method: string, ...args: unknown[]): Promise<unknown>;
}

async function createStretchWorklet(ctx: BaseAudioContext): Promise<StretchWorklet> {
  if (!ctx.audioWorklet) {
    throw new Error('이 브라우저에서는 목소리 높낮이를 바꿀 수 없어요. (AudioWorklet 미지원)');
  }
  await ensureWorkletModule(ctx);
  const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
    ...NODE_OPTIONS,
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  // 처리기와는 [번호, 메서드, ...인자] → [번호, 결과] 메시지로 이야기한다
  const pending = new Map<number, (value: unknown) => void>();
  let nextId = 1;
  let onReady: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    onReady = resolve;
  });
  node.port.onmessage = (event: MessageEvent<PortMessage>) => {
    const [id, value] = event.data;
    if (id === 'ready') {
      if (onReady) onReady();
      onReady = null;
    } else if (typeof id === 'number') {
      const resolve = pending.get(id);
      if (resolve) {
        pending.delete(id);
        resolve(value);
      }
    }
  };
  await ready;
  return {
    node,
    call(method: string, ...args: unknown[]): Promise<unknown> {
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        node.port.postMessage([id, method, ...args]);
      });
    },
  };
}

export interface LivePitch {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** 입력→출력 지연(초) */
  readonly latencySec: number;
  set(pitch: number, formant: number): void;
  /** 다 썼을 때. 노드는 같은 컨텍스트의 다음 사용을 위해 보관된다 */
  release(): void;
}

interface CachedLive {
  worklet: StretchWorklet;
  latencySec: number;
  busy: boolean;
}

// 워크릿 노드는 한 번 만들면 컨텍스트가 닫힐 때까지 메모리를 쥐고 있다.
// 마이크를 켰다 껐다 할 때마다 새로 만들면 쌓이므로 컨텍스트마다 만든 것을 돌려쓴다.
const liveCache = new WeakMap<BaseAudioContext, CachedLive[]>();

/** 실시간 입력용. input 에 소리를 연결하면 지연(latencySec) 뒤에 바뀐 소리가 output 으로 나온다 */
export async function createLivePitch(ctx: BaseAudioContext, pitch: number, formant: number): Promise<LivePitch> {
  let pool = liveCache.get(ctx);
  if (!pool) {
    pool = [];
    liveCache.set(ctx, pool);
  }
  let entry = pool.find((e) => !e.busy);
  if (entry) {
    entry.busy = true;
  } else {
    const worklet = await createStretchWorklet(ctx);
    await worklet.call('configure', LIVE_CONFIG);
    const latency = await worklet.call('latency');
    entry = { worklet, latencySec: typeof latency === 'number' ? latency : LIVE_CONFIG.blockMs / 1000, busy: true };
    pool.push(entry);
  }
  const owned = entry;
  const { worklet, latencySec } = owned;
  const makeup = ctx.createGain();
  makeup.gain.value = dbToGain(pitchMakeupDb(pitch, formant));
  worklet.node.connect(makeup);

  const schedule = (p: number, f: number): Promise<unknown> => worklet.call('schedule', scheduleFor(p, f, 0, {}));
  await schedule(pitch, formant);

  return {
    input: worklet.node,
    output: makeup,
    latencySec,
    set(p: number, f: number): void {
      void schedule(p, f);
      makeup.gain.setTargetAtTime(dbToGain(pitchMakeupDb(p, f)), ctx.currentTime, 0.03);
    },
    release(): void {
      if (!owned.busy) return;
      for (const n of [worklet.node, makeup]) {
        try {
          n.disconnect();
        } catch {
          // 이미 끊긴 노드
        }
      }
      void worklet.call('schedule', { active: false });
      owned.busy = false;
    },
  };
}
