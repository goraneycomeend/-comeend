// AI 음성 엔진의 화면 쪽 창구. Worker(tts.worker.ts)를 띄우고 TtsEngine 계약에 맞춰 감싼다.
//
// - 모델은 load() 를 부를 때만 받는다. synthesize() 가 알아서 받아 오지는 않는다(145MB 를 몰래 받지 않는다).
// - 합성 요청은 Worker 안에서 부른 순서대로 하나씩 처리된다.

import type {
  ModelLoadProgress,
  PcmAudio,
  TtsEngine,
  TtsEngineStatus,
  TtsProgress,
  TtsRequest,
} from '../core/types.ts';
import type { TtsWorkerInfo, TtsWorkerRequest, TtsWorkerResponse } from './tts.worker.ts';

export interface TtsEngineConfig {
  /** manifest.json 이 있는 폴더 주소. 기본은 `<앱 위치>/models/` */
  modelsUrl?: string;
  /** onnxruntime wasm 파일 폴더 주소. 기본은 `<앱 위치>/ort/` */
  ortUrl?: string;
  /** wasm 스레드 수 상한(기본 4). 교차 출처 격리가 아닌 곳에서는 무조건 1 로 돈다 */
  maxThreads?: number;
  /** 여러 스레드로 런타임을 띄울 때 기다리는 한도(ms, 기본 15000). 넘으면 단일 스레드로 다시 시도한다 */
  threadInitTimeoutMs?: number;
  /** onnxruntime 세션 옵션 덮어쓰기(튜닝·실험용) */
  sessionOptions?: Record<string, unknown>;
}

export interface TtsSynthStats {
  /** 만들어진 음성 길이(초) */
  audioSec: number;
  /** 합성에 걸린 시간(ms). 줄 서서 기다린 시간은 뺀 값 */
  synthMs: number;
  /** 실시간 배수 = 걸린 시간 / 음성 길이. 1 보다 작으면 말하는 속도보다 빨리 만든다 */
  rtf: number;
  steps: number;
}

export interface TtsEngineInfo extends TtsWorkerInfo {
  /** 가장 최근 합성의 속도 기록 */
  lastSynth: TtsSynthStats | null;
}

/** 엔진을 불러오기 전에 합성을 요청했을 때 */
export class TtsNotReadyError extends Error {
  override name = 'TtsNotReadyError';
  constructor(message = 'AI 음성 엔진을 먼저 불러와 주세요.') {
    super(message);
  }
}

function abortError(message = '음성 만들기를 취소했어요.'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

interface PendingSynth {
  resolve: (audio: PcmAudio) => void;
  reject: (err: Error) => void;
  onProgress?: (p: TtsProgress) => void;
  steps: number;
  detach: () => void;
}

interface PendingLoad {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: Error) => void;
}

const DEFAULT_MAX_THREADS = 4;
const DEFAULT_THREAD_INIT_TIMEOUT_MS = 15_000;

class WorkerTtsEngine implements TtsEngine {
  private currentStatus: TtsEngineStatus = 'idle';
  private currentError: Error | null = null;
  private readonly listeners = new Set<(status: TtsEngineStatus) => void>();
  private readonly progressListeners = new Set<(p: ModelLoadProgress) => void>();
  private lastProgress: ModelLoadProgress | null = null;
  private worker: Worker | null = null;
  private pendingLoad: PendingLoad | null = null;
  private readonly pending = new Map<number, PendingSynth>();
  private nextId = 1;
  private workerInfo: TtsEngineInfo | null = null;
  /** 여러 스레드 시도가 실패해 단일 스레드로 다시 불러오는 중인지 */
  private retriedSingleThread = false;
  config: TtsEngineConfig = {};

  get status(): TtsEngineStatus {
    return this.currentStatus;
  }

  get error(): Error | null {
    return this.currentError;
  }

  get info(): TtsEngineInfo | null {
    return this.workerInfo;
  }

  subscribe(listener: (status: TtsEngineStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  load(onProgress?: (p: ModelLoadProgress) => void): Promise<void> {
    if (this.currentStatus === 'ready') return Promise.resolve();
    if (onProgress) {
      this.progressListeners.add(onProgress);
      // 이미 받는 중이면 지금까지의 진행 상황부터 알려 준다
      if (this.lastProgress) onProgress(this.lastProgress);
    }
    if (this.pendingLoad) return this.pendingLoad.promise;

    let resolve!: () => void;
    let reject!: (err: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.pendingLoad = { promise, resolve, reject };
    this.currentError = null;
    this.lastProgress = null;
    this.setStatus('loading');

    this.retriedSingleThread = false;
    this.startWorker(this.config.maxThreads ?? DEFAULT_MAX_THREADS);
    return promise;
  }

  async synthesize(
    req: TtsRequest,
    opts: { onProgress?: (p: TtsProgress) => void; signal?: AbortSignal } = {},
  ): Promise<PcmAudio> {
    if (opts.signal?.aborted) throw abortError();
    if (this.currentStatus === 'loading' && this.pendingLoad) {
      await this.pendingLoad.promise;
      if (opts.signal?.aborted) throw abortError();
    }
    if (this.currentStatus !== 'ready' || !this.worker) {
      throw new TtsNotReadyError(
        this.currentStatus === 'error' ? 'AI 음성 엔진을 불러오지 못했어요. 다시 불러와 주세요.' : undefined,
      );
    }

    const id = this.nextId++;
    // 전송할 수 있는 값만 골라 담는다(상태 저장소의 객체가 그대로 넘어와도 안전하게)
    const request: TtsRequest = {
      text: String(req.text),
      lang: req.lang,
      blend: { ...req.blend },
      speed: Number(req.speed),
      steps: Number(req.steps),
      ...(typeof req.seed === 'number' ? { seed: req.seed } : {}),
    };

    return new Promise<PcmAudio>((resolve, reject) => {
      const onAbort = (): void => {
        // 화면은 바로 풀어 주고, Worker 는 다음 스텝 경계에서 멈춘다
        if (!this.pending.delete(id)) return;
        opts.signal?.removeEventListener('abort', onAbort);
        this.send({ type: 'abort', id });
        reject(abortError());
      };
      opts.signal?.addEventListener('abort', onAbort);
      this.pending.set(id, {
        resolve,
        reject,
        onProgress: opts.onProgress,
        steps: request.steps,
        detach: () => opts.signal?.removeEventListener('abort', onAbort),
      });
      this.send({ type: 'synthesize', id, request });
    });
  }

  dispose(): void {
    this.teardown(abortError('음성 엔진을 닫았어요.'));
    this.currentError = null;
    this.workerInfo = null;
    this.setStatus('idle');
  }

  /** Worker 를 새로 띄우고 모델을 불러오라고 시킨다 */
  private startWorker(maxThreads: number): void {
    try {
      const appBase = new URL('.', document.baseURI).href;
      const worker = new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<TtsWorkerResponse>) => {
        // 이미 갈아 치운 Worker 가 뒤늦게 보낸 것은 버린다
        if (this.worker === worker) this.handleMessage(event.data);
      };
      worker.onerror = (event: ErrorEvent) => {
        if (this.worker !== worker) return;
        event.preventDefault?.();
        this.fail(new Error(event.message ? `음성 엔진이 멈췄어요. (${event.message})` : '음성 엔진이 멈췄어요.'));
      };
      worker.onmessageerror = () => {
        if (this.worker === worker) this.fail(new Error('음성 엔진과 주고받은 내용을 읽지 못했어요.'));
      };
      this.send({
        type: 'load',
        modelsUrl: new URL(this.config.modelsUrl ?? 'models/', appBase).href,
        ortUrl: new URL(this.config.ortUrl ?? 'ort/', appBase).href,
        maxThreads,
        threadInitTimeoutMs: this.config.threadInitTimeoutMs ?? DEFAULT_THREAD_INIT_TIMEOUT_MS,
        ...(this.config.sessionOptions ? { sessionOptions: this.config.sessionOptions } : {}),
      });
    } catch (err) {
      const detail = err instanceof Error ? ` (${err.message})` : '';
      this.fail(new Error(`이 환경에서는 음성 엔진을 시작할 수 없어요.${detail}`));
    }
  }

  private send(message: TtsWorkerRequest): void {
    this.worker?.postMessage(message);
  }

  private setStatus(status: TtsEngineStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    for (const listener of [...this.listeners]) {
      try {
        listener(status);
      } catch {
        // 구독자 하나의 오류가 엔진을 멈추게 하지 않는다
      }
    }
  }

  /** Worker 를 끄고 기다리던 요청을 전부 `reason` 으로 끝낸다 */
  private teardown(reason: Error): void {
    this.worker?.terminate();
    this.worker = null;
    this.progressListeners.clear();
    this.lastProgress = null;
    const load = this.pendingLoad;
    this.pendingLoad = null;
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const p of waiting) {
      p.detach();
      p.reject(reason);
    }
    if (load) {
      // load() 를 기다리지 않고 버린 호출이 있어도 '처리 안 된 거부' 경고가 뜨지 않게 한다
      load.promise.catch(() => undefined);
      load.reject(reason);
    }
  }

  private fail(err: Error): void {
    this.currentError = err;
    this.teardown(err);
    this.setStatus('error');
  }

  private handleMessage(msg: TtsWorkerResponse): void {
    switch (msg.type) {
      case 'load-progress': {
        this.lastProgress = msg.progress;
        for (const listener of [...this.progressListeners]) listener(msg.progress);
        break;
      }
      case 'loaded': {
        this.workerInfo = { ...msg.info, lastSynth: null };
        const load = this.pendingLoad;
        this.pendingLoad = null;
        this.progressListeners.clear();
        this.lastProgress = null;
        this.setStatus('ready');
        load?.resolve();
        break;
      }
      case 'load-error': {
        if (msg.threads > 1 && !this.retriedSingleThread) {
          // 여러 스레드로는 못 띄운 것일 수 있다. 단일 스레드로 한 번만 더 해 본다
          this.retriedSingleThread = true;
          this.worker?.terminate();
          this.worker = null;
          this.lastProgress = null;
          this.startWorker(1);
          break;
        }
        const err = new Error(msg.message);
        err.name = 'ModelLoadError';
        this.fail(err);
        break;
      }
      case 'synth-progress': {
        this.pending.get(msg.id)?.onProgress?.(msg.progress);
        break;
      }
      case 'synth-done': {
        const p = this.pending.get(msg.id);
        if (!p) break;
        this.pending.delete(msg.id);
        p.detach();
        const audioSec = msg.samples.length / msg.sampleRate;
        if (this.workerInfo) {
          this.workerInfo.lastSynth = {
            audioSec,
            synthMs: msg.synthMs,
            rtf: audioSec > 0 ? msg.synthMs / 1000 / audioSec : 0,
            steps: p.steps,
          };
        }
        p.resolve({ samples: msg.samples, sampleRate: msg.sampleRate });
        break;
      }
      case 'synth-error': {
        const p = this.pending.get(msg.id);
        if (!p) break;
        this.pending.delete(msg.id);
        p.detach();
        const err = new Error(msg.message);
        err.name = msg.name;
        p.reject(err);
        break;
      }
    }
  }
}

let engine: WorkerTtsEngine | null = null;

function instance(): WorkerTtsEngine {
  engine ??= new WorkerTtsEngine();
  return engine;
}

/** 앱 전체가 함께 쓰는 엔진. 처음 부를 때 만들어지고, Worker 는 load() 때 뜬다 */
export function getTtsEngine(): TtsEngine {
  return instance();
}

/**
 * 모델·런타임 파일 위치나 스레드 상한을 바꾼다. 다음 load() 부터 적용된다.
 * 주소는 절대 주소이거나, 앱 위치 기준 상대 주소.
 */
export function configureTtsEngine(config: TtsEngineConfig): void {
  const target = instance();
  target.config = { ...target.config, ...config };
}

/** 엔진이 준비된 뒤의 실행 정보(스레드 수, 불러오는 데 걸린 시간, 최근 합성 속도). 준비 전에는 null */
export function getTtsEngineInfo(): TtsEngineInfo | null {
  return instance().info;
}
