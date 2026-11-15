// ONNX Runtime 을 감싸는 최소 인터페이스와 모델 자산 준비.
//
// 합성 파이프라인(synth.ts)은 여기 정의한 모양만 쓴다. 그래서 같은 코드가
// onnxruntime-node(Node: 테스트·사전 렌더)와 onnxruntime-web/wasm(브라우저 Worker) 양쪽에서 돈다.
// 이 파일은 어느 런타임도 import 하지 않는다. 부르는 쪽이 런타임 객체를 넘겨준다.

import { parseVoiceBank } from './voices.ts';
import type { VoiceBank } from './voices.ts';

export interface OrtTensorLike {
  readonly data: unknown;
  readonly dims: readonly number[];
}

export interface OrtSessionLike {
  run(feeds: Record<string, OrtTensorLike>): Promise<Readonly<Record<string, OrtTensorLike>>>;
  release?(): Promise<void>;
}

/** 합성에 필요한 것은 텐서 생성자뿐이다(세션은 TtsAssets 로 따로 받는다) */
export interface OrtLike {
  Tensor: new (
    type: 'float32' | 'int64',
    data: Float32Array | BigInt64Array,
    dims: readonly number[],
  ) => OrtTensorLike;
}

/** 세션까지 만들 수 있는 런타임. `import * as ort from 'onnxruntime-node'` 나 'onnxruntime-web/wasm' 을 그대로 넘기면 된다 */
export interface OrtRuntimeLike extends OrtLike {
  InferenceSession: {
    create(model: Uint8Array, options?: Record<string, unknown>): Promise<OrtSessionLike>;
  };
}

/** tts.json 에서 합성에 쓰는 값 */
export interface TtsConfig {
  sampleRate: number;
  /** 잠재 1칸이 덮는 샘플 수 (base_chunk_size × chunk_compress_factor = 3072) */
  latentHop: number;
  /** 잠재 채널 수 (latent_dim × chunk_compress_factor = 144) */
  latentChannels: number;
}

export interface TtsSessions {
  durationPredictor: OrtSessionLike;
  textEncoder: OrtSessionLike;
  vectorEstimator: OrtSessionLike;
  vocoder: OrtSessionLike;
}

export interface TtsAssets {
  sessions: TtsSessions;
  config: TtsConfig;
  /** 코드포인트 → 토큰 id (65536칸, 미지원은 -1) */
  indexer: Int32Array;
  voices: VoiceBank;
}

/**
 * 세션으로 만드는 모델 파일. **순서가 곧 로드 순서**다: 가장 큰 것부터 올린다.
 * 세션을 만드는 동안 런타임은 모델 바이트를 한 벌 더 들고 있다가 놓는다. 큰 모델을 먼저 올리면
 * 그때 놓인 자리를 뒤의 작은 모델들이 다시 써서, 로드가 끝난 뒤 계속 차지하는 메모리가 줄어든다.
 * (Chromium 단일 스레드에서 잰 렌더러 메모리: 큰 것부터 = 로드 뒤 약 570MB·최대 약 730MB,
 *  작은 것부터 = 로드 뒤 약 650MB·최대 약 680MB. 오래 켜 두는 앱이라 로드 뒤 값을 골랐다)
 */
export const SESSION_FILES = [
  ['vectorEstimator', 'vector_estimator.onnx'],
  ['textEncoder', 'text_encoder.onnx'],
  ['vocoder', 'vocoder.onnx'],
  ['durationPredictor', 'duration_predictor.onnx'],
] as const satisfies ReadonlyArray<readonly [keyof TtsSessions, string]>;

export const DATA_FILES = {
  config: 'tts.json',
  indexer: 'unicode_indexer.bin',
  voices: 'voice.bin',
} as const;

/** 엔진이 쓰는 파일 이름 전부(로드 순서) */
export const MODEL_FILE_NAMES: readonly string[] = [
  DATA_FILES.config,
  DATA_FILES.indexer,
  DATA_FILES.voices,
  ...SESSION_FILES.map(([, file]) => file),
];

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function positiveInt(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
    throw new Error(`모델 설정 파일(tts.json)의 ${name} 값이 올바르지 않아요.`);
  }
  return v;
}

export function parseTtsConfig(bytes: Uint8Array): TtsConfig {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('모델 설정 파일(tts.json)을 읽을 수 없어요. 모델 파일을 다시 받아 주세요.');
  }
  const ae = asRecord(asRecord(json).ae);
  const ttl = asRecord(asRecord(json).ttl);
  const sampleRate = positiveInt(ae.sample_rate, 'ae.sample_rate');
  const baseChunk = positiveInt(ae.base_chunk_size, 'ae.base_chunk_size');
  const compress = positiveInt(ttl.chunk_compress_factor, 'ttl.chunk_compress_factor');
  const latentDim = positiveInt(ttl.latent_dim, 'ttl.latent_dim');
  return { sampleRate, latentHop: baseChunk * compress, latentChannels: latentDim * compress };
}

/** unicode_indexer.bin: little-endian int32 × 65536 */
export function parseIndexer(bytes: Uint8Array): Int32Array {
  if (bytes.byteLength === 0 || bytes.byteLength % 4 !== 0) {
    throw new Error('글자 색인 파일(unicode_indexer.bin) 크기가 올바르지 않아요. 모델 파일을 다시 받아 주세요.');
  }
  // 정렬된 새 버퍼로 복사한다(원본은 큰 버퍼의 중간일 수 있다)
  return new Int32Array(bytes.slice().buffer);
}

export type ModelFileSource = Record<string, Uint8Array | undefined> | ((name: string) => Promise<Uint8Array>);

export interface BuildAssetsOptions {
  /** InferenceSession.create 에 그대로 넘긴다 */
  sessionOptions?: Record<string, unknown>;
  /** 세션 하나를 만들기 직전(`done=false`)과 직후(`done=true`)에 불린다 */
  onSession?: (file: string, done: boolean) => void;
}

/**
 * 모델 파일들로 합성에 필요한 자산을 만든다.
 * `source` 가 함수면 파일을 필요한 순간에 하나씩 달라고 한다(받기와 세션 만들기를 번갈아 해서
 * 145MB 를 한꺼번에 들고 있지 않게). 객체면 이미 받아 둔 파일을 쓴다.
 * 어느 쪽이든 세션을 만든 뒤에는 모델 바이트를 붙들고 있지 않는다.
 */
export async function buildTtsAssets(
  ort: OrtRuntimeLike,
  source: ModelFileSource,
  options: BuildAssetsOptions = {},
): Promise<TtsAssets> {
  const get = async (name: string): Promise<Uint8Array> => {
    const bytes = typeof source === 'function' ? await source(name) : source[name];
    if (!bytes) throw new Error(`모델 파일이 빠져 있어요: ${name}`);
    return bytes;
  };

  const config = parseTtsConfig(await get(DATA_FILES.config));
  const indexer = parseIndexer(await get(DATA_FILES.indexer));
  const voiceBytes = await get(DATA_FILES.voices);
  const voices = parseVoiceBank(
    voiceBytes.buffer.slice(voiceBytes.byteOffset, voiceBytes.byteOffset + voiceBytes.byteLength) as ArrayBuffer,
  );

  const sessions: Partial<TtsSessions> = {};
  for (const [key, file] of SESSION_FILES) {
    // 블록 안에서만 바이트를 잡고 있다가, 세션이 만들어지면 바로 놓는다
    {
      const bytes = await get(file);
      options.onSession?.(file, false);
      try {
        sessions[key] = await ort.InferenceSession.create(bytes, options.sessionOptions);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`음성 모델(${file})을 준비하지 못했어요. ${detail}`, { cause });
      }
    }
    options.onSession?.(file, true);
  }
  return { sessions: sessions as TtsSessions, config, indexer, voices };
}

/** 세션을 닫는다(런타임이 release 를 주는 경우에만) */
export async function releaseTtsAssets(assets: TtsAssets): Promise<void> {
  for (const session of Object.values(assets.sessions) as OrtSessionLike[]) {
    try {
      await session.release?.();
    } catch {
      // 이미 닫힌 세션은 무시한다
    }
  }
}
