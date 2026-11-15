import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ModelLoadError,
  assembleModelFiles,
  buildTtsAssets,
  createModelStore,
  loadModelFiles,
  openModelStore,
  parseIndexer,
  parseManifest,
  parseTtsConfig,
  sha256Hex,
  sha256HexSync,
} from '../src/core/tts/index.ts';
import type { OrtRuntimeLike } from '../src/core/tts/index.ts';
import type { ModelLoadProgress } from '../src/core/types.ts';

const nodeSha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function randomBytes(length: number, seed = 1): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

/** 파일들을 조각으로 잘라 매니페스트와 조각 저장소를 만든다 */
function makeModel(files: Record<string, Uint8Array>, partSize: number): { manifest: unknown; parts: Map<string, Uint8Array> } {
  const parts = new Map<string, Uint8Array>();
  const entries: Record<string, unknown> = {};
  let totalBytes = 0;
  for (const [name, bytes] of Object.entries(files)) {
    const list: Array<{ path: string; size: number }> = [];
    for (let off = 0, i = 0; off < bytes.length || i === 0; off += partSize, i++) {
      const piece = bytes.slice(off, off + partSize);
      const path = `${name}.${String(i).padStart(2, '0')}.bin`;
      parts.set(path, piece);
      list.push({ path, size: piece.length });
    }
    entries[name] = { size: bytes.length, sha256: nodeSha(bytes), parts: list };
    totalBytes += bytes.length;
  }
  return {
    manifest: { id: 'test-model', source: 'test', license: 'none', sampleRate: 44100, totalBytes, files: entries },
    parts,
  };
}

describe('SHA-256', () => {
  it('직접 계산한 값이 Node 의 값과 같다(블록 경계 길이 포함)', () => {
    for (const length of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 65_537]) {
      const bytes = randomBytes(length, length + 1);
      expect(sha256HexSync(bytes), `길이 ${length}`).toBe(nodeSha(bytes));
    }
    expect(sha256HexSync(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('버퍼 중간을 가리키는 배열도 맞게 계산한다', () => {
    const big = randomBytes(5000, 9);
    const view = big.subarray(123, 4321);
    expect(sha256HexSync(view)).toBe(nodeSha(view));
  });

  it('sha256Hex 는 플랫폼 구현을 쓰고 같은 값을 낸다', async () => {
    const bytes = randomBytes(300_000, 5);
    expect(await sha256Hex(bytes)).toBe(nodeSha(bytes));
  });
});

describe('parseManifest', () => {
  const good = makeModel({ 'a.bin': randomBytes(100) }, 40).manifest as { files: Record<string, { sha256: string; parts: Array<{ path: string; size: number }> }> };

  it('올바른 매니페스트를 읽고 전체 크기를 파일 크기 합으로 잡는다', () => {
    const m = parseManifest({ ...good, totalBytes: 1 });
    expect(m.id).toBe('test-model');
    expect(m.totalBytes).toBe(100);
    expect(m.files['a.bin'].parts.map((p) => p.size)).toEqual([40, 40, 20]);
  });

  it('모양이 틀리면 한국어 메시지의 ModelLoadError', () => {
    const broken = (patch: (m: typeof good) => void): unknown => {
      const copy = structuredClone(good);
      patch(copy);
      return copy;
    };
    expect(() => parseManifest(null)).toThrow(ModelLoadError);
    expect(() => parseManifest({ files: {} })).toThrow(/하나도 없어요/);
    expect(() => parseManifest(broken((m) => (m.files['a.bin'].sha256 = 'xyz')))).toThrow(/sha256/);
    expect(() => parseManifest(broken((m) => (m.files['a.bin'].parts[0].size = 41)))).toThrow(/크기 합/);
    // 조각 경로는 같은 폴더의 파일 이름만
    for (const path of ['../secret.bin', '/etc/passwd', 'https://example.com/x.bin', 'sub/x.bin', '']) {
      expect(() => parseManifest(broken((m) => (m.files['a.bin'].parts[0].path = path))), path).toThrow(/경로/);
    }
  });
});

describe('assembleModelFiles', () => {
  const files = { 'big.onnx': randomBytes(1000, 3), 'small.json': randomBytes(10, 4), 'empty.bin': new Uint8Array(0) };

  it('조각을 순서대로 합쳐 원래 파일을 만들고 진행률을 알린다', async () => {
    const { manifest, parts } = makeModel(files, 300);
    const progress: ModelLoadProgress[] = [];
    const out = await assembleModelFiles(
      manifest,
      async (path) => parts.get(path) as Uint8Array,
      (p) => progress.push(p),
    );
    expect(Object.keys(out).sort()).toEqual(['big.onnx', 'empty.bin', 'small.json']);
    expect(out['big.onnx']).toEqual(files['big.onnx']);
    expect(out['small.json']).toEqual(files['small.json']);
    expect(out['empty.bin'].length).toBe(0);

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((p) => p.phase === 'download' && p.totalBytes === 1010)).toBe(true);
    const loaded = progress.map((p) => p.loadedBytes);
    expect(loaded.every((b, i) => i === 0 || b >= loaded[i - 1])).toBe(true);
    expect(loaded[loaded.length - 1]).toBe(1010);
  });

  it('내용이 바뀐 조각은 SHA-256 검사에서 걸린다', async () => {
    const { manifest, parts } = makeModel(files, 300);
    const tampered = (parts.get('big.onnx.01.bin') as Uint8Array).slice();
    tampered[5] ^= 0xff;
    parts.set('big.onnx.01.bin', tampered);
    const err = await assembleModelFiles(manifest, async (path) => parts.get(path) as Uint8Array).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelLoadError);
    expect((err as Error).message).toMatch(/big\.onnx/);
    expect((err as Error).message).toMatch(/다시 시도/);
  });

  it('조각이 짧거나 길면 크기 검사에서 걸린다', async () => {
    const short = makeModel(files, 300);
    short.parts.set('big.onnx.00.bin', (short.parts.get('big.onnx.00.bin') as Uint8Array).slice(0, 299));
    await expect(assembleModelFiles(short.manifest, async (p) => short.parts.get(p) as Uint8Array)).rejects.toThrow(
      /끝까지 받지 못했어요/,
    );
    const long = makeModel(files, 300);
    long.parts.set('big.onnx.00.bin', randomBytes(301));
    await expect(assembleModelFiles(long.manifest, async (p) => long.parts.get(p) as Uint8Array)).rejects.toThrow(
      /적힌 크기보다 커요/,
    );
  });

  it('목록에 없는 파일을 달라고 하면 거절한다', async () => {
    const { manifest, parts } = makeModel(files, 300);
    const store = createModelStore(manifest, async (path, _size, sink) => sink(parts.get(path) as Uint8Array));
    await expect(store.load('nope.bin')).rejects.toThrow(/목록에 없는/);
    expect(store.loadedBytes).toBe(0);
    await store.load('small.json');
    expect(store.loadedBytes).toBe(10);
    expect(store.totalBytes).toBe(1010);
  });
});

describe('loadModelFiles (HTTP)', () => {
  const files = { 'model.onnx': randomBytes(5000, 7), 'tts.json': new TextEncoder().encode('{"ok":true}') };

  /** 조각을 작은 덩어리로 흘려보내는 가짜 서버 */
  function fakeFetch(
    model: ReturnType<typeof makeModel>,
    hooks: { fail?: (url: string, attempt: number) => 'network' | number | undefined } = {},
  ): { fetch: typeof fetch; urls: string[] } {
    const urls: string[] = [];
    const attempts = new Map<string, number>();
    const fetchImpl = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      urls.push(url);
      const attempt = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, attempt);
      const failure = hooks.fail?.(url, attempt);
      if (failure === 'network') throw new TypeError('fetch failed');
      if (typeof failure === 'number') return new Response('nope', { status: failure });
      const name = url.split('/').pop() as string;
      if (name === 'manifest.json') return new Response(JSON.stringify(model.manifest), { status: 200 });
      const bytes = model.parts.get(name);
      if (!bytes) return new Response('not found', { status: 404 });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let off = 0; off < bytes.length; off += 700) controller.enqueue(bytes.slice(off, off + 700));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;
    return { fetch: fetchImpl, urls };
  }

  it('매니페스트와 조각을 받아 파일로 합친다', async () => {
    const model = makeModel(files, 2000);
    const { fetch: fetchImpl, urls } = fakeFetch(model);
    const progress: ModelLoadProgress[] = [];
    // 끝에 / 가 없어도 폴더로 본다
    const out = await loadModelFiles('https://app.example/sub/models', (p) => progress.push(p), { fetch: fetchImpl });
    expect(out['model.onnx']).toEqual(files['model.onnx']);
    expect(new TextDecoder().decode(out['tts.json'])).toBe('{"ok":true}');
    expect(urls[0]).toBe('https://app.example/sub/models/manifest.json');
    expect(urls.slice(1).sort()).toEqual(
      ['model.onnx.00.bin', 'model.onnx.01.bin', 'model.onnx.02.bin', 'tts.json.00.bin'].map(
        (n) => `https://app.example/sub/models/${n}`,
      ),
    );
    expect(progress[progress.length - 1].loadedBytes).toBe(5011);
    expect(progress.some((p) => p.file === 'model.onnx')).toBe(true);
  });

  it('매니페스트를 못 받으면 한국어 메시지로 실패한다', async () => {
    const model = makeModel(files, 2000);
    const notFound = fakeFetch(model, { fail: (url) => (url.endsWith('manifest.json') ? 404 : undefined) });
    await expect(loadModelFiles('https://app.example/models/', undefined, { fetch: notFound.fetch })).rejects.toThrow(
      /HTTP 404/,
    );
    const offline = fakeFetch(model, { fail: () => 'network' });
    const err = await loadModelFiles('https://app.example/models/', undefined, { fetch: offline.fetch }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ModelLoadError);
    expect((err as Error).message).toMatch(/네트워크/);
    // 없는 파일에 첫 화면(HTML)을 200 으로 내주는 서버
    const spa = (async () => new Response('<!doctype html><title>app</title>', { status: 200 })) as unknown as typeof fetch;
    await expect(loadModelFiles('https://app.example/models/', undefined, { fetch: spa })).rejects.toThrow(
      /읽을 수 없어요.*놓여 있는지/,
    );
  });

  it('조각 하나가 잠깐 실패하면 다시 받아서 끝낸다', async () => {
    const model = makeModel(files, 2000);
    const flaky = fakeFetch(model, {
      fail: (url, attempt) => (url.endsWith('model.onnx.01.bin') && attempt === 1 ? 'network' : undefined),
    });
    const progress: ModelLoadProgress[] = [];
    const out = await loadModelFiles('https://app.example/models/', (p) => progress.push(p), { fetch: flaky.fetch });
    expect(out['model.onnx']).toEqual(files['model.onnx']);
    expect(flaky.urls.filter((u) => u.endsWith('model.onnx.01.bin')).length).toBe(2);
    // 다시 받아도 진행률이 전체 크기를 넘지 않는다
    expect(Math.max(...progress.map((p) => p.loadedBytes))).toBe(5011);
  });

  it('조각이 계속 없으면 어느 조각인지 알려 주며 실패한다', async () => {
    const model = makeModel(files, 2000);
    const missing = fakeFetch(model, { fail: (url) => (url.endsWith('model.onnx.02.bin') ? 404 : undefined) });
    await expect(loadModelFiles('https://app.example/models/', undefined, { fetch: missing.fetch })).rejects.toThrow(
      /model\.onnx\.02\.bin.*HTTP 404/,
    );
  });

  it('취소 신호를 넘기면 AbortError 로 멈춘다', async () => {
    const model = makeModel(files, 2000);
    const controller = new AbortController();
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(input).endsWith('manifest.json')) return new Response(JSON.stringify(model.manifest));
      controller.abort();
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return new Response('unreachable');
    }) as typeof fetch;
    const store = await openModelStore('https://app.example/models/', undefined, { fetch: fetchImpl, signal: controller.signal });
    const err = await store.load('model.onnx').catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
  });
});

describe('모델 자산 준비', () => {
  it('tts.json 에서 합성에 쓰는 값을 읽는다', () => {
    const json = { ae: { sample_rate: 44100, base_chunk_size: 512 }, ttl: { chunk_compress_factor: 6, latent_dim: 24 } };
    expect(parseTtsConfig(new TextEncoder().encode(JSON.stringify(json)))).toEqual({
      sampleRate: 44100,
      latentHop: 3072,
      latentChannels: 144,
    });
    expect(() => parseTtsConfig(new TextEncoder().encode('not json'))).toThrow(/tts\.json/);
    expect(() => parseTtsConfig(new TextEncoder().encode('{"ae":{}}'))).toThrow(/sample_rate/);
  });

  it('글자 색인은 little-endian int32 로 읽는다', () => {
    const raw = new Uint8Array(new Int32Array([-1, 560, 7]).buffer);
    // 큰 버퍼의 어긋난 자리에서 잘라 온 배열이어도 된다
    const shifted = new Uint8Array(raw.length + 3);
    shifted.set(raw, 3);
    expect(Array.from(parseIndexer(shifted.subarray(3)))).toEqual([-1, 560, 7]);
    expect(() => parseIndexer(new Uint8Array(5))).toThrow(/색인/);
  });

  it('큰 모델부터 세션을 만들고, 파일은 필요할 때 하나씩 달라고 한다', async () => {
    const voiceBin = new ArrayBuffer(48 + 4 * (10 * 50 * 256 + 10 * 8 * 16));
    [10, 50, 256, 10, 8, 16].forEach((v, i) => new DataView(voiceBin).setBigInt64(i * 8, BigInt(v), true));
    const files: Record<string, Uint8Array> = {
      'tts.json': new TextEncoder().encode(
        JSON.stringify({ ae: { sample_rate: 44100, base_chunk_size: 512 }, ttl: { chunk_compress_factor: 6, latent_dim: 24 } }),
      ),
      'unicode_indexer.bin': new Uint8Array(new Int32Array(65536).fill(-1).buffer),
      'voice.bin': new Uint8Array(voiceBin),
      'duration_predictor.onnx': Uint8Array.of(1),
      'text_encoder.onnx': Uint8Array.of(2),
      'vector_estimator.onnx': Uint8Array.of(3),
      'vocoder.onnx': Uint8Array.of(4),
    };
    const events: string[] = [];
    const fakeRuntime: OrtRuntimeLike = {
      Tensor: class {
        readonly data: unknown = null;
        readonly dims: readonly number[] = [];
      },
      InferenceSession: {
        async create(model, options) {
          events.push(`create:${model[0]}:${JSON.stringify(options)}`);
          return { run: async () => ({}) };
        },
      },
    };
    const assets = await buildTtsAssets(
      fakeRuntime,
      async (name) => {
        events.push(`get:${name}`);
        return files[name];
      },
      { sessionOptions: { x: 1 }, onSession: (file, done) => events.push(`${done ? 'done' : 'start'}:${file}`) },
    );
    expect(assets.config.sampleRate).toBe(44100);
    expect(assets.indexer.length).toBe(65536);
    expect(assets.voices.count).toBe(10);
    expect(Object.keys(assets.sessions).sort()).toEqual(['durationPredictor', 'textEncoder', 'vectorEstimator', 'vocoder']);
    expect(events).toEqual([
      'get:tts.json',
      'get:unicode_indexer.bin',
      'get:voice.bin',
      'get:vector_estimator.onnx',
      'start:vector_estimator.onnx',
      'create:3:{"x":1}',
      'done:vector_estimator.onnx',
      'get:text_encoder.onnx',
      'start:text_encoder.onnx',
      'create:2:{"x":1}',
      'done:text_encoder.onnx',
      'get:vocoder.onnx',
      'start:vocoder.onnx',
      'create:4:{"x":1}',
      'done:vocoder.onnx',
      'get:duration_predictor.onnx',
      'start:duration_predictor.onnx',
      'create:1:{"x":1}',
      'done:duration_predictor.onnx',
    ]);

    // 이미 받아 둔 파일 묶음으로도 만들 수 있고, 빠진 파일은 이름을 알려 준다
    await expect(buildTtsAssets(fakeRuntime, files)).resolves.toBeDefined();
    const { 'vocoder.onnx': _dropped, ...rest } = files;
    void _dropped;
    await expect(buildTtsAssets(fakeRuntime, rest)).rejects.toThrow(/vocoder\.onnx/);
  });
});
