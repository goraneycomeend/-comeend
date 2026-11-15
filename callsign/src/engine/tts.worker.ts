// AI 음성 엔진 Worker. 화면이 멈추지 않게 onnxruntime-web(wasm)을 여기서 돌린다.
//
// 모델 파일을 받고 → 세션을 만들고 → 요청이 오면 합성해 PCM 을 돌려준다.
// 글과 음성은 이 Worker 밖(기기 밖)으로 나가지 않는다. 네트워크는 모델 파일을 받을 때만 쓴다.

// 반드시 '/wasm' 진입점을 쓴다. 기본 진입점은 public/ort 에 없는 WebGPU 용 파일을 찾는다.
import * as ort from 'onnxruntime-web/wasm';

import { buildTtsAssets, createSynthesizer, openModelStore } from '../core/tts/index.ts';
import type { Synthesizer } from '../core/tts/index.ts';
import type { ModelLoadProgress, TtsProgress, TtsRequest } from '../core/types.ts';

// ── 화면 ↔ Worker 메시지 ──────────────────────────────────────────────────

export type TtsWorkerRequest =
  | {
      type: 'load';
      /** manifest.json 이 있는 폴더의 절대 주소(끝에 /) */
      modelsUrl: string;
      /** onnxruntime wasm 파일이 있는 폴더의 절대 주소(끝에 /) */
      ortUrl: string;
      /** 스레드 수 상한. 교차 출처 격리가 아니면 무시하고 1 로 돈다 */
      maxThreads: number;
      /** 여러 스레드로 런타임을 띄울 때 기다리는 한도(ms). 넘으면 실패로 알린다 */
      threadInitTimeoutMs: number;
      /** 세션 옵션 덮어쓰기(튜닝·실험용). 없으면 기본값 */
      sessionOptions?: Record<string, unknown>;
    }
  | { type: 'synthesize'; id: number; request: TtsRequest }
  | { type: 'abort'; id: number };

export interface TtsWorkerInfo {
  /** 실제로 쓰는 wasm 스레드 수 */
  threads: number;
  crossOriginIsolated: boolean;
  /** 받기 시작부터 준비 끝까지 걸린 시간(ms) */
  loadMs: number;
  sampleRate: number;
  /** 매니페스트의 모델 id */
  modelId: string;
  totalBytes: number;
}

export type TtsWorkerResponse =
  | { type: 'load-progress'; progress: ModelLoadProgress }
  | { type: 'loaded'; info: TtsWorkerInfo }
  | {
      type: 'load-error';
      message: string;
      /** 실패한 시도가 쓰려던 스레드 수. 1 보다 크면 화면 쪽이 단일 스레드로 한 번 더 해 본다 */
      threads: number;
    }
  | { type: 'synth-progress'; id: number; progress: TtsProgress }
  | {
      type: 'synth-done';
      id: number;
      samples: Float32Array;
      sampleRate: number;
      /** 줄 서서 기다린 시간을 뺀, 실제 합성에 걸린 시간(ms) */
      synthMs: number;
    }
  | { type: 'synth-error'; id: number; name: string; message: string };

// ── Worker 본문 ───────────────────────────────────────────────────────────

const scope = self as unknown as DedicatedWorkerGlobalScope;

const post = (message: TtsWorkerResponse, transfer: Transferable[] = []): void => {
  scope.postMessage(message, transfer);
};

const DEFAULT_SESSION_OPTIONS: Record<string, unknown> = {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'all',
};

let synthesizer: Synthesizer | null = null;
let loading = false;
const controllers = new Map<number, AbortController>();

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** wasm 런타임의 스레드용 Worker 스크립트 이름(onnxruntime-web 이 정한 것) */
const ORT_THREAD_SCRIPT = 'ort-wasm-simd-threaded.mjs';

/**
 * 스레드용 Worker 를 띄울 수 있는지 미리 본다. 교차 출처 격리된 문서 안에서는 Worker 스크립트 응답에도
 * 같은 헤더가 있어야 하는데, 문서에만 헤더를 붙이고 이 파일에는 빠뜨린 서버에서는 런타임이 끝없이 기다린다.
 */
async function threadWorkersAllowed(ortUrl: string): Promise<boolean> {
  try {
    const res = await fetch(new URL(ORT_THREAD_SCRIPT, ortUrl).href, { method: 'HEAD' });
    const policy = res.headers.get('cross-origin-embedder-policy') ?? '';
    return res.ok && /require-corp|credentialless/i.test(policy);
  } catch {
    return false;
  }
}

async function load(msg: Extract<TtsWorkerRequest, { type: 'load' }>): Promise<void> {
  if (synthesizer || loading) return;
  loading = true;
  const startedAt = performance.now();
  let threads = 1;
  try {
    // 여러 스레드는 교차 출처 격리(SharedArrayBuffer)일 때만 가능하다. 아니면 단일 스레드.
    const isolated = scope.crossOriginIsolated === true;
    const cores = scope.navigator.hardwareConcurrency || 1;
    const wanted = isolated ? Math.max(1, Math.min(4, cores, Math.floor(msg.maxThreads) || 1)) : 1;
    threads = wanted > 1 && (await threadWorkersAllowed(msg.ortUrl)) ? wanted : 1;

    ort.env.wasm.wasmPaths = msg.ortUrl;
    ort.env.wasm.numThreads = threads;
    // 스레드를 못 띄워 멈춰 버리는 일이 없게 한도를 둔다. 넘으면 오류가 나고, 화면 쪽이 단일 스레드로 다시 시도한다
    ort.env.wasm.initTimeout = threads > 1 ? msg.threadInitTimeoutMs : 0;
    // 이미 Worker 안이다. 런타임이 Worker 를 한 겹 더 만들지 않게 한다
    ort.env.wasm.proxy = false;
    ort.env.logLevel = 'error';

    const store = await openModelStore(msg.modelsUrl, (progress) => post({ type: 'load-progress', progress }));
    const totalBytes = store.totalBytes;

    // 파일을 하나 받을 때마다 바로 세션으로 만들고 바이트를 놓는다(145MB 를 한꺼번에 들고 있지 않는다)
    const assets = await buildTtsAssets(ort, (name) => store.load(name), {
      sessionOptions: { ...DEFAULT_SESSION_OPTIONS, ...msg.sessionOptions },
      onSession: (file, done) => {
        // 다 받았으면 그때부터는 '준비 중'
        if (!done && store.loadedBytes >= totalBytes) {
          post({ type: 'load-progress', progress: { phase: 'init', loadedBytes: totalBytes, totalBytes, file } });
        }
      },
    });
    synthesizer = createSynthesizer(ort, assets);
    post({
      type: 'loaded',
      info: {
        threads,
        crossOriginIsolated: isolated,
        loadMs: performance.now() - startedAt,
        sampleRate: synthesizer.sampleRate,
        modelId: store.manifest.id,
        totalBytes,
      },
    });
  } catch (err) {
    post({ type: 'load-error', message: errorMessage(err, '음성 엔진을 준비하지 못했어요.'), threads });
  } finally {
    loading = false;
  }
}

async function synthesize(msg: Extract<TtsWorkerRequest, { type: 'synthesize' }>): Promise<void> {
  const { id } = msg;
  const controller = new AbortController();
  controllers.set(id, controller);
  let startedAt = 0;
  try {
    if (!synthesizer) throw new Error('음성 엔진이 아직 준비되지 않았어요.');
    const audio = await synthesizer.synthesize(msg.request, {
      signal: controller.signal,
      onProgress: (progress) => {
        // 첫 진행 알림이 곧 이 요청의 차례가 온 순간이다
        if (startedAt === 0) startedAt = performance.now();
        post({ type: 'synth-progress', id, progress });
      },
    });
    const synthMs = startedAt === 0 ? 0 : performance.now() - startedAt;
    post({ type: 'synth-done', id, samples: audio.samples, sampleRate: audio.sampleRate, synthMs }, [
      audio.samples.buffer as ArrayBuffer,
    ]);
  } catch (err) {
    post({
      type: 'synth-error',
      id,
      name: err instanceof Error ? err.name : 'Error',
      message: errorMessage(err, '음성을 만들지 못했어요.'),
    });
  } finally {
    controllers.delete(id);
  }
}

scope.onmessage = (event: MessageEvent<TtsWorkerRequest>): void => {
  const msg = event.data;
  if (msg.type === 'load') void load(msg);
  else if (msg.type === 'synthesize') void synthesize(msg);
  else if (msg.type === 'abort') controllers.get(msg.id)?.abort();
};
