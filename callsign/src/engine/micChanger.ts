// 마이크 → 실시간 음향 효과 → (모니터 출력) / (녹음).
// AI 합성이 아니라 소리를 그 자리에서 가공하는 효과다. 마이크 소리는 기기 밖으로 나가지 않는다.
import { createLiveChain } from '../core/audio/index.ts';
import type { LiveVoiceChain, PcmAudio, VoiceFx } from '../core/types.ts';
import { getAudioContext } from './audioContext.ts';

export type MicState = 'idle' | 'starting' | 'running';

export type MicErrorKind = 'denied' | 'no-device' | 'busy' | 'unsupported' | 'unknown';

/** 마이크를 열지 못한 이유. message 는 사용자에게 그대로 보여 줄 수 있는 문장이다 */
export class MicError extends Error {
  readonly kind: MicErrorKind;
  constructor(kind: MicErrorKind, message: string) {
    super(message);
    this.name = 'MicError';
    this.kind = kind;
  }
}

/** 브라우저가 던진 오류를 사용자에게 보여 줄 말로 바꾼다 */
export function toMicError(err: unknown): MicError {
  if (err instanceof MicError) return err;
  const name = err instanceof Error || (typeof DOMException !== 'undefined' && err instanceof DOMException) ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new MicError('denied', '마이크 사용이 허용되지 않았어요. 주소창 옆 사이트 설정에서 마이크를 허용한 뒤 다시 눌러 주세요.');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new MicError('no-device', '연결된 마이크를 찾지 못했어요. 마이크나 헤드셋이 꽂혀 있는지 확인해 주세요.');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new MicError('busy', '마이크를 열지 못했어요. 다른 프로그램이 마이크를 쓰고 있다면 닫고 다시 시도해 주세요.');
    default:
      return new MicError('unknown', '마이크를 시작하지 못했어요. 잠시 뒤에 다시 시도해 주세요.');
  }
}

/** 이 환경에서 마이크를 요청할 수 있는지(권한 여부와는 별개) */
export function micSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    (typeof window === 'undefined' || window.isSecureContext !== false)
  );
}

// ───────────────────────── 녹음 탭 ─────────────────────────
// MediaRecorder 는 압축 파일을 내놓아서, 효과가 걸린 소리를 PCM 그대로 모으려고 워크릿을 쓴다.

const CAPTURE_NAME = 'callsign-capture';
const CAPTURE_SOURCE = `
class CallsignCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.alive = true;
    this.buf = new Float32Array(4096);
    this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.on = true; this.n = 0; }
      else if (e.data === 'stop') { this.on = false; this.flush(); this.port.postMessage('done'); }
      else if (e.data === 'close') { this.on = false; this.alive = false; }
    };
  }
  flush() {
    if (this.n > 0) { this.port.postMessage(this.buf.slice(0, this.n)); this.n = 0; }
  }
  process(inputs) {
    if (!this.on) return this.alive;
    const ch = inputs[0] && inputs[0][0];
    const len = ch ? ch.length : 128;
    if (this.n + len > this.buf.length) this.flush();
    if (ch) this.buf.set(ch, this.n); else this.buf.fill(0, this.n, this.n + len);
    this.n += len;
    return true;
  }
}
registerProcessor('${CAPTURE_NAME}', CallsignCapture);
`;

interface CaptureTap {
  readonly node: AudioNode;
  start(): void;
  stop(): Promise<Float32Array>;
  dispose(): void;
}

const captureModules = new WeakMap<BaseAudioContext, Promise<void>>();

function joinChunks(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function createWorkletTap(ctx: AudioContext): Promise<CaptureTap> {
  let loading = captureModules.get(ctx);
  if (!loading) {
    const url = URL.createObjectURL(new Blob([CAPTURE_SOURCE], { type: 'text/javascript' }));
    loading = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    captureModules.set(ctx, loading);
  }
  await loading;
  const node = new AudioWorkletNode(ctx, CAPTURE_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: 'explicit',
  });
  let chunks: Float32Array[] = [];
  let recording = false;
  let onDone: (() => void) | null = null;
  node.port.onmessage = (e: MessageEvent<Float32Array | string>) => {
    if (e.data === 'done') {
      if (onDone) onDone();
      onDone = null;
    } else if (e.data instanceof Float32Array) {
      chunks.push(e.data);
    }
  };
  return {
    node,
    start(): void {
      chunks = [];
      recording = true;
      node.port.postMessage('start');
    },
    stop(): Promise<Float32Array> {
      if (!recording) return Promise.resolve(new Float32Array(0));
      recording = false;
      return new Promise<Float32Array>((resolve) => {
        const finish = (): void => {
          clearTimeout(timer);
          onDone = null;
          const out = joinChunks(chunks);
          chunks = [];
          resolve(out);
        };
        // 컨텍스트가 멈춰 있으면 답이 오지 않을 수 있다. 그때는 모인 데까지만 돌려준다
        const timer = setTimeout(finish, 800);
        onDone = finish;
        node.port.postMessage('stop');
      });
    },
    dispose(): void {
      // 처리기를 끝내야 노드가 메모리에서 내려간다
      node.port.postMessage('close');
      node.port.onmessage = null;
      try {
        node.disconnect();
      } catch {
        // 이미 끊겼다
      }
    },
  };
}

/** 워크릿을 못 쓰는 환경용(오래된 웹뷰 등) */
function createScriptTap(ctx: AudioContext): CaptureTap {
  const node = ctx.createScriptProcessor(4096, 1, 1);
  let chunks: Float32Array[] = [];
  let recording = false;
  node.onaudioprocess = (e: AudioProcessingEvent) => {
    if (recording) chunks.push(e.inputBuffer.getChannelData(0).slice());
  };
  return {
    node,
    start(): void {
      chunks = [];
      recording = true;
    },
    stop(): Promise<Float32Array> {
      recording = false;
      const out = joinChunks(chunks);
      chunks = [];
      return Promise.resolve(out);
    },
    dispose(): void {
      node.onaudioprocess = null;
      try {
        node.disconnect();
      } catch {
        // 이미 끊겼다
      }
    },
  };
}

async function createCaptureTap(ctx: AudioContext): Promise<CaptureTap> {
  if (ctx.audioWorklet) {
    try {
      return await createWorkletTap(ctx);
    } catch {
      captureModules.delete(ctx);
    }
  }
  return createScriptTap(ctx);
}

// ───────────────────────── MicChanger ─────────────────────────

export type MicLevelListener = (rms: number, peak: number) => void;

export interface MicStartOptions {
  /** 바뀐 내 목소리를 스피커로 들을지. 기본 꺼짐(스피커로 들으면 하울링이 생길 수 있다) */
  monitor?: boolean;
}

interface Session {
  ctx: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  chain: LiveVoiceChain;
  monitorGain: GainNode;
  capture: CaptureTap;
  levelTimer: ReturnType<typeof setInterval>;
}

export class MicChanger {
  private current: MicState = 'idle';
  private session: Session | null = null;
  private startToken = 0;
  private monitorOn = false;
  private isRecording = false;
  private readonly levelListeners = new Set<MicLevelListener>();
  private readonly stateListeners = new Set<(state: MicState) => void>();

  get state(): MicState {
    return this.current;
  }

  get recording(): boolean {
    return this.isRecording;
  }

  get monitoring(): boolean {
    return this.monitorOn;
  }

  /** 마이크에 들어간 소리가 스피커로 나오기까지 걸리는 시간(초)의 추정치. 꺼져 있으면 0 */
  get latencySec(): number {
    const s = this.session;
    if (!s) return 0;
    const outputLatency = typeof s.ctx.outputLatency === 'number' ? s.ctx.outputLatency : 0;
    return s.chain.latencySec + (s.ctx.baseLatency || 0) + outputLatency;
  }

  /** 녹음 결과의 샘플레이트. 꺼져 있으면 0 */
  get sampleRate(): number {
    return this.session ? this.session.ctx.sampleRate : 0;
  }

  /**
   * 마이크를 켜고 효과를 건다. 버튼 핸들러에서 불러야 한다(브라우저가 사용자 입력을 요구한다).
   * 실패하면 MicError 를 던진다. 이미 켜져 있으면 효과와 모니터 설정만 바꾼다.
   */
  async start(fx: VoiceFx, opts: MicStartOptions = {}): Promise<void> {
    if (opts.monitor !== undefined) this.monitorOn = opts.monitor;
    if (this.current !== 'idle') {
      this.setFx(fx);
      this.setMonitor(this.monitorOn);
      return;
    }
    if (!micSupported()) {
      throw new MicError('unsupported', '이 환경에서는 마이크를 쓸 수 없어요. 대신 소리 파일을 불러와서 바꿔 보세요.');
    }
    const token = ++this.startToken;
    this.setState('starting');

    let stream: MediaStream | null = null;
    let chain: LiveVoiceChain | null = null;
    let capture: CaptureTap | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // 울림 제거와 잡음 억제는 켜고, 자동 음량 조절은 끈다(효과의 강약이 흔들리지 않게)
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        video: false,
      });
      const ctx = getAudioContext();
      if (ctx.state !== 'running') await ctx.resume();
      chain = await createLiveChain(ctx, fx);
      capture = await createCaptureTap(ctx);
      if (token !== this.startToken) {
        // 준비하는 사이에 stop() 이 불렸다
        for (const t of stream.getTracks()) t.stop();
        chain.dispose();
        capture.dispose();
        return;
      }

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const monitorGain = ctx.createGain();
      monitorGain.gain.value = this.monitorOn ? 1 : 0;
      source.connect(analyser);
      analyser.connect(chain.input);
      chain.output.connect(monitorGain);
      monitorGain.connect(ctx.destination);
      // 녹음 탭은 소리를 내지 않지만, 출력에 이어 둬야 그래프가 계속 돈다
      chain.output.connect(capture.node);
      capture.node.connect(ctx.destination);

      const scope = new Float32Array(analyser.fftSize);
      const levelTimer = setInterval(() => {
        if (this.levelListeners.size === 0) return;
        analyser.getFloatTimeDomainData(scope);
        let sum = 0;
        let pk = 0;
        for (let i = 0; i < scope.length; i++) {
          const v = scope[i];
          sum += v * v;
          const av = v < 0 ? -v : v;
          if (av > pk) pk = av;
        }
        const level = Math.sqrt(sum / scope.length);
        for (const cb of this.levelListeners) cb(level, pk);
      }, 50);

      for (const track of stream.getAudioTracks()) {
        // 마이크가 뽑히면 스스로 정리한다
        track.addEventListener('ended', () => {
          if (this.session && this.session.stream === stream) this.stop();
        });
      }

      this.session = { ctx, stream, source, analyser, chain, monitorGain, capture, levelTimer };
      this.setState('running');
    } catch (err) {
      if (stream) for (const t of stream.getTracks()) t.stop();
      if (chain) chain.dispose();
      if (capture) capture.dispose();
      if (token === this.startToken) this.setState('idle');
      throw toMicError(err);
    }
  }

  /** 마이크를 끈다. 녹음 중이었다면 그 녹음은 버려진다(먼저 stopRecording 을 부를 것) */
  stop(): void {
    this.startToken++;
    const s = this.session;
    this.session = null;
    this.isRecording = false;
    if (s) {
      clearInterval(s.levelTimer);
      for (const t of s.stream.getTracks()) t.stop();
      for (const n of [s.source, s.analyser, s.monitorGain]) {
        try {
          n.disconnect();
        } catch {
          // 이미 끊겼다
        }
      }
      s.chain.dispose();
      s.capture.dispose();
      for (const cb of this.levelListeners) cb(0, 0);
    }
    this.setState('idle');
  }

  /** 효과 값을 바꾼다. 켜져 있지 않으면 아무 일도 없다 */
  setFx(fx: VoiceFx): void {
    if (this.session) this.session.chain.update(fx);
  }

  /** 바뀐 내 목소리를 스피커로 들을지 */
  setMonitor(on: boolean): void {
    this.monitorOn = on;
    const s = this.session;
    if (s) s.monitorGain.gain.setTargetAtTime(on ? 1 : 0, s.ctx.currentTime, 0.02);
  }

  /** 입력 음량을 1초에 20번쯤 알려 준다(효과 걸기 전의 마이크 소리, 0..1). 해제 함수를 돌려준다 */
  onLevel(cb: MicLevelListener): () => void {
    this.levelListeners.add(cb);
    return () => {
      this.levelListeners.delete(cb);
    };
  }

  /** 상태가 바뀔 때마다 불린다. 해제 함수를 돌려준다 */
  onState(cb: (state: MicState) => void): () => void {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  /** 효과가 걸린 소리를 모으기 시작한다. 마이크가 켜져 있어야 한다 */
  startRecording(): void {
    const s = this.session;
    if (!s) throw new MicError('unknown', '마이크를 먼저 켜 주세요.');
    if (this.isRecording) return;
    this.isRecording = true;
    s.capture.start();
  }

  /** 녹음을 끝내고 모은 소리를 돌려준다. 녹음 중이 아니었으면 빈 소리 */
  async stopRecording(): Promise<PcmAudio> {
    const s = this.session;
    if (!s || !this.isRecording) return { samples: new Float32Array(0), sampleRate: s ? s.ctx.sampleRate : 44100 };
    this.isRecording = false;
    const samples = await s.capture.stop();
    return { samples, sampleRate: s.ctx.sampleRate };
  }

  private setState(next: MicState): void {
    if (this.current === next) return;
    this.current = next;
    for (const cb of this.stateListeners) cb(next);
  }
}
