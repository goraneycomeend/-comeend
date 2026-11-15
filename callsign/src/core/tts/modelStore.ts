// 모델 파일 받기: 매니페스트 + 12MiB 이하 조각 → 원래 파일. 조각 크기와 파일 전체 SHA-256 을 확인한다.
//
// 네트워크는 여기서만 쓴다. 받는 것은 앱과 같은 자리에 놓인 모델 파일뿐이고, 밖으로 보내는 것은 없다.
// 브라우저 전용 API(fetch, crypto.subtle)는 함수 안에서만 만진다.

import type { ModelLoadProgress } from '../types.ts';

export interface ModelManifestPart {
  /** 매니페스트 폴더 기준 상대 경로 */
  path: string;
  size: number;
}

export interface ModelManifestFile {
  size: number;
  /** 합친 파일 전체의 SHA-256 (소문자 16진수) */
  sha256: string;
  parts: ModelManifestPart[];
}

export interface ModelManifest {
  id: string;
  source: string;
  license: string;
  sampleRate: number;
  totalBytes: number;
  files: Record<string, ModelManifestFile>;
}

/** 모델 파일을 받거나 확인하다 실패했을 때. 메시지는 화면에 그대로 보여줄 수 있는 한국어다 */
export class ModelLoadError extends Error {
  override name = 'ModelLoadError';
}

/**
 * 조각 하나를 읽어 `sink` 로 흘려보낸다. 여러 번에 나눠 줘도 되고 한 번에 줘도 된다.
 * `sink` 에 넘긴 배열은 호출이 끝나면 다시 써도 된다(바로 복사해 간다).
 */
export type PartReader = (
  path: string,
  expectedSize: number,
  sink: (chunk: Uint8Array) => void,
  signal?: AbortSignal,
) => Promise<void>;

export interface ModelStore {
  readonly manifest: ModelManifest;
  /** 매니페스트에 적힌 파일 전체 크기 */
  readonly totalBytes: number;
  /** 지금까지 받은 바이트 */
  readonly loadedBytes: number;
  /** 파일 하나를 받아 합치고 확인해서 돌려준다 */
  load(name: string): Promise<Uint8Array>;
}

export interface ModelFetchOptions {
  /** 기본은 전역 fetch */
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

/** 한 파일의 조각을 동시에 몇 개까지 받을지 */
const PART_CONCURRENCY = 4;
/** 조각 하나를 다시 시도하는 횟수 */
const PART_RETRIES = 2;
/** 진행률을 알리는 최소 간격(바이트). 메시지가 쏟아지지 않게 한다 */
const PROGRESS_STEP_BYTES = 256 * 1024;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSize(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** 매니페스트 모양을 확인한다. 조각 경로는 같은 폴더 안의 파일 이름만 허용한다 */
export function parseManifest(json: unknown): ModelManifest {
  const bad = (why: string): never => {
    throw new ModelLoadError(`음성 모델 목록(manifest.json)이 올바르지 않아요: ${why}`);
  };
  if (!isRecord(json) || !isRecord(json.files)) return bad('files 항목이 없어요.');
  const files: Record<string, ModelManifestFile> = {};
  let sum = 0;
  for (const [name, raw] of Object.entries(json.files)) {
    if (!isRecord(raw) || !isSize(raw.size) || typeof raw.sha256 !== 'string' || !Array.isArray(raw.parts)) {
      return bad(`${name} 항목이 깨졌어요.`);
    }
    if (!/^[0-9a-f]{64}$/.test(raw.sha256)) return bad(`${name} 의 sha256 값이 이상해요.`);
    const parts: ModelManifestPart[] = [];
    let partSum = 0;
    for (const p of raw.parts) {
      if (!isRecord(p) || typeof p.path !== 'string' || !isSize(p.size)) return bad(`${name} 의 조각 정보가 깨졌어요.`);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p.path)) return bad(`${name} 의 조각 경로가 허용되지 않아요.`);
      parts.push({ path: p.path, size: p.size });
      partSum += p.size;
    }
    if (parts.length === 0 || partSum !== raw.size) return bad(`${name} 의 조각 크기 합이 파일 크기와 달라요.`);
    files[name] = { size: raw.size, sha256: raw.sha256, parts };
    sum += raw.size;
  }
  if (Object.keys(files).length === 0) return bad('파일이 하나도 없어요.');
  return {
    id: typeof json.id === 'string' ? json.id : '',
    source: typeof json.source === 'string' ? json.source : '',
    license: typeof json.license === 'string' ? json.license : '',
    sampleRate: typeof json.sampleRate === 'number' ? json.sampleRate : 0,
    totalBytes: sum,
    files,
  };
}

// ── SHA-256 ───────────────────────────────────────────────────────────────

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

/**
 * 순수 계산으로 구한 SHA-256. `crypto.subtle` 이 없는 곳(보안 연결이 아닌 http 주소 등)에서 쓴다.
 */
export function sha256HexSync(bytes: Uint8Array): string {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const length = bytes.length;
  // 마지막 블록들: 남은 바이트 + 0x80 + 0 채움 + 길이(비트, 64비트 big-endian)
  const tailStart = length - (length % 64);
  const tailLen = length - tailStart;
  const tail = new Uint8Array(tailLen + 9 <= 64 ? 64 : 128);
  tail.set(bytes.subarray(tailStart));
  tail[tailLen] = 0x80;
  const tailView = new DataView(tail.buffer);
  tailView.setUint32(tail.length - 8, Math.floor(length / 0x20000000), false);
  tailView.setUint32(tail.length - 4, (length << 3) >>> 0, false);

  const compress = (block: Uint8Array, offset: number): void => {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = (block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + SHA256_K[i] + w[i]) | 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  };

  for (let off = 0; off < tailStart; off += 64) compress(bytes, off);
  for (let off = 0; off < tail.length; off += 64) compress(tail, off);

  let hex = '';
  for (let i = 0; i < 8; i++) hex += h[i].toString(16).padStart(8, '0');
  return hex;
}

/** SHA-256 (소문자 16진수). 가능하면 플랫폼 구현을 쓰고, 없으면 직접 계산한다 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256HexSync(bytes);
  // digest 는 ArrayBuffer 에 얹힌 배열만 받는다고 타입에 적혀 있다(SharedArrayBuffer 제외). 여기 들어오는 것은 항상 그렇다
  const digest = await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// ── 저장소 ────────────────────────────────────────────────────────────────

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * 매니페스트와 조각 읽는 방법으로 저장소를 만든다.
 * 진행률의 `loadedBytes` 는 이 저장소에서 지금까지 받은 양의 합이다.
 */
export function createModelStore(
  manifestJson: unknown,
  readPart: PartReader,
  onProgress?: (p: ModelLoadProgress) => void,
  signal?: AbortSignal,
): ModelStore {
  const manifest = parseManifest(manifestJson);
  const totalBytes = manifest.totalBytes;
  let loadedBytes = 0;
  let lastReported = -PROGRESS_STEP_BYTES;

  const report = (file: string, force: boolean): void => {
    if (!onProgress) return;
    if (!force && loadedBytes - lastReported < PROGRESS_STEP_BYTES) return;
    lastReported = loadedBytes;
    onProgress({ phase: 'download', loadedBytes, totalBytes, file });
  };

  async function readOnePart(
    name: string,
    part: ModelManifestPart,
    dest: Uint8Array,
    destOffset: number,
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= PART_RETRIES; attempt++) {
      let written = 0;
      try {
        await readPart(
          part.path,
          part.size,
          (chunk) => {
            if (written + chunk.length > part.size) {
              throw new ModelLoadError(`모델 조각이 적힌 크기보다 커요(${part.path}). 다시 시도해 주세요.`);
            }
            dest.set(chunk, destOffset + written);
            written += chunk.length;
            loadedBytes += chunk.length;
            report(name, false);
          },
          signal,
        );
        if (written !== part.size) {
          throw new ModelLoadError(
            `모델 조각을 끝까지 받지 못했어요(${part.path}: ${written} / ${part.size}바이트). 다시 시도해 주세요.`,
          );
        }
        return;
      } catch (err) {
        // 이번 시도에서 센 만큼은 되돌린다
        loadedBytes -= written;
        lastError = err;
        if (isAbort(err) || signal?.aborted) throw err;
        // 잠깐 쉬었다가 다시 받는다
        if (attempt < PART_RETRIES) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  async function load(name: string): Promise<Uint8Array> {
    const entry = manifest.files[name];
    if (!entry) throw new ModelLoadError(`모델 목록에 없는 파일이에요: ${name}`);
    const dest = new Uint8Array(entry.size);
    const offsets: number[] = [];
    let acc = 0;
    for (const part of entry.parts) {
      offsets.push(acc);
      acc += part.size;
    }

    // 조각을 몇 개씩 동시에 받는다
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= entry.parts.length) return;
        await readOnePart(name, entry.parts[i], dest, offsets[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, entry.parts.length) }, worker));

    const actual = await sha256Hex(dest);
    if (actual !== entry.sha256) {
      loadedBytes -= entry.size;
      throw new ModelLoadError(`받은 모델 파일이 원본과 달라요(${name}). 손상됐을 수 있으니 다시 시도해 주세요.`);
    }
    report(name, true);
    return dest;
  }

  return {
    manifest,
    totalBytes,
    get loadedBytes() {
      return loadedBytes;
    },
    load,
  };
}

function resolveBase(baseUrl: string | URL): URL {
  const raw = String(baseUrl);
  const withSlash = raw.endsWith('/') ? raw : `${raw}/`;
  const here = (globalThis as { location?: { href?: string } }).location?.href;
  try {
    return here ? new URL(withSlash, here) : new URL(withSlash);
  } catch {
    throw new ModelLoadError(`모델 위치 주소가 올바르지 않아요: ${raw}`);
  }
}

/** HTTP 로 조각을 스트리밍해 읽는 PartReader */
export function httpPartReader(baseUrl: string | URL, options: ModelFetchOptions = {}): PartReader {
  const base = resolveBase(baseUrl);
  return async (path, _expectedSize, sink, signal) => {
    const doFetch = options.fetch ?? globalThis.fetch;
    let res: Response;
    try {
      res = await doFetch(new URL(path, base).href, { signal: signal ?? options.signal });
    } catch (err) {
      if (isAbort(err)) throw err;
      throw new ModelLoadError(`모델 파일을 받는 중에 연결이 끊겼어요(${path}). 네트워크를 확인하고 다시 시도해 주세요.`);
    }
    if (!res.ok) {
      throw new ModelLoadError(`모델 파일을 받지 못했어요(${path}, HTTP ${res.status}).`);
    }
    if (!res.body) {
      sink(new Uint8Array(await res.arrayBuffer()));
      return;
    }
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) sink(value);
      }
    } catch (err) {
      if (isAbort(err)) throw err;
      throw new ModelLoadError(`모델 파일을 받는 중에 연결이 끊겼어요(${path}). 네트워크를 확인하고 다시 시도해 주세요.`);
    }
  };
}

/**
 * 모델 폴더 주소로 저장소를 연다(매니페스트만 먼저 받는다). 파일은 `store.load(name)` 으로 하나씩 받는다.
 * `baseUrl` 은 manifest.json 이 있는 폴더의 절대 주소.
 */
export async function openModelStore(
  baseUrl: string | URL,
  onProgress?: (p: ModelLoadProgress) => void,
  options: ModelFetchOptions = {},
): Promise<ModelStore> {
  const base = resolveBase(baseUrl);
  const doFetch = options.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(new URL('manifest.json', base).href, { signal: options.signal });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ModelLoadError('음성 모델 목록을 받지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.');
  }
  if (!res.ok) {
    throw new ModelLoadError(
      `음성 모델 목록을 받지 못했어요(HTTP ${res.status}). 모델 파일이 앱과 함께 놓여 있는지 확인해 주세요.`,
    );
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    if (isAbort(err)) throw err;
    // 파일이 없을 때 첫 화면(HTML)을 대신 내주는 서버가 있다. 그러면 여기서 걸린다
    throw new ModelLoadError('음성 모델 목록을 읽을 수 없어요. 모델 파일이 앱과 함께 놓여 있는지 확인해 주세요.');
  }
  return createModelStore(json, httpPartReader(base, options), onProgress, options.signal);
}

/**
 * 매니페스트에 있는 파일을 전부 받아 `{ 파일 이름: 내용 }` 으로 돌려준다.
 * 조각 크기와 파일 전체 SHA-256 을 확인하고, 어긋나면 한국어 메시지의 ModelLoadError 를 던진다.
 */
export async function loadModelFiles(
  baseUrl: string | URL,
  onProgress?: (p: ModelLoadProgress) => void,
  options: ModelFetchOptions = {},
): Promise<Record<string, Uint8Array>> {
  const store = await openModelStore(baseUrl, onProgress, options);
  const files: Record<string, Uint8Array> = {};
  for (const name of Object.keys(store.manifest.files)) {
    files[name] = await store.load(name);
  }
  return files;
}

/**
 * 네트워크 없이 모델 파일을 모은다(Node 스크립트·테스트용).
 * 예) `assembleModelFiles(JSON.parse(manifestText), (p) => fs.readFile(path.join(dir, p)))`
 */
export async function assembleModelFiles(
  manifestJson: unknown,
  readPart: (path: string) => Promise<Uint8Array>,
  onProgress?: (p: ModelLoadProgress) => void,
): Promise<Record<string, Uint8Array>> {
  const store = createModelStore(manifestJson, async (path, _size, sink) => sink(await readPart(path)), onProgress);
  const files: Record<string, Uint8Array> = {};
  for (const name of Object.keys(store.manifest.files)) {
    files[name] = await store.load(name);
  }
  return files;
}
