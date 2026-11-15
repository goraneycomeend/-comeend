#!/usr/bin/env node
// 음성 모델 가중치를 npm 레지스트리에서 받아 public/models/ 에 풀어 놓는다.
//
//   node scripts/fetch-models.mjs            없으면 받고, 이미 있고 맞으면 건너뛴다
//   node scripts/fetch-models.mjs --force    있어도 다시 만든다
//   node scripts/fetch-models.mjs --check    받지 않고 검사만 한다(안 맞으면 종료 코드 1)
//
// 환경 변수
//   CALLSIGN_TARBALL_DIR  미리 받아 둔 tarball 폴더(`npm pack` 이 만드는 파일명). 여기 있으면 내려받지 않는다
//   CALLSIGN_REGISTRY     레지스트리 주소(기본 https://registry.npmjs.org/)
//
// 가중치는 npm 패키지 3개에 base64 조각으로 나뉘어 들어 있다.
// tarball 은 sha512(dist.integrity)로, 다 합친 파일은 크기와 sha256 으로 확인한다. 값은 전부 아래에 고정해 둔다.
// tar 명령 같은 외부 도구 없이 Node 내장 모듈만 쓴다.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(APP_DIR, 'public', 'models');
const CACHE_DIR = path.join(APP_DIR, 'node_modules', '.cache', 'callsign-models');
const MANIFEST_NAME = 'manifest.json';

/** 조각 하나의 최대 크기. 정적 호스팅의 파일당 용량 제한(15MB)보다 작게 잡는다 */
const PART_BYTES = 12 * 1024 * 1024;

const MODEL_ID = 'supertonic-3-int8';
const MODEL_LICENSE = 'OpenRAIL-M';
const MODEL_SOURCE =
  'Supertone Supertonic 3 (https://huggingface.co/Supertone/supertonic-3) 을 sherpa-onnx 가 int8 로 변환한 것. ' +
  'npm @3sln/donki-lle-voice-multi, -multi-2, -multi-3 (0.1.1) 에서 받음';
const SAMPLE_RATE = 44100;

/** `npm view <이름>@0.1.1 dist.integrity` 로 확인한 값 */
const PACKAGES = [
  {
    name: '@3sln/donki-lle-voice-multi',
    version: '0.1.1',
    integrity: 'sha512-pe1OCsPhCti+EePT8G6L/jEqTuQV8uF7d0hOlyYHVGF3WSBbR+P7ffF3cNDEP/arF2OWlmbRFvbNAUmUGtAJBw==',
  },
  {
    name: '@3sln/donki-lle-voice-multi-2',
    version: '0.1.1',
    integrity: 'sha512-bVgNjfBfSGHl45+OTYNY9eI4qWQOa1PKlnCCWWGLiK6+w8BlhRqZI62am01bQ4F4tQkPI7AZsJXilUer1ZZR6A==',
  },
  {
    name: '@3sln/donki-lle-voice-multi-3',
    version: '0.1.1',
    integrity: 'sha512-nwNCbKbkSovvloXo7n649d4IbDdl76RpdC4om6PFBKKK6VtEU5w0sMSOazjmUcBQsT8QcXlJ6oyO1s//NqnvRA==',
  },
];

/** 다 합친 파일의 크기와 sha256. 이 순서대로 매니페스트에 적는다 */
const FILES = {
  'duration_predictor.onnx': {
    size: 3700147,
    sha256: 'c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db',
  },
  'text_encoder.onnx': {
    size: 36416150,
    sha256: 'c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff',
  },
  'vector_estimator.onnx': {
    size: 78400833,
    sha256: '20cd86fa5c6effedfda0e7cffe5b0569ca401c440a0c3a1d72bf39286c0db3fd',
  },
  'vocoder.onnx': {
    size: 25991073,
    sha256: 'e923d60f53f95eb1ce235f1dc33ec56d9c057823c96fa6f8acf98f32b0da6152',
  },
  'tts.json': {
    size: 8253,
    sha256: '42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09',
  },
  'unicode_indexer.bin': {
    size: 262144,
    sha256: '8402ca48e5189a8950138580b0fff64db6f072f24ac07cd54ba8b2fbb9883b30',
  },
  'voice.bin': {
    size: 517168,
    sha256: '67d5209b0ee8ce6c74105ffbe12fe6a7628aea3b4ba2fcb308a4a67938a93ce8',
  },
};
const TOTAL_BYTES = Object.values(FILES).reduce((sum, f) => sum + f.size, 0);

/** 조각 목록이 들어 있는 패키지 안의 매니페스트 */
const UPSTREAM_MANIFEST_ENTRY = 'package/voice.js';
const CHUNK_ENTRY = /^package\/(c\/\d{3}\.js)$/;
const PART_FILE = /^[A-Za-z0-9_.-]+\.\d{2}\.bin$/;

const log = (msg) => console.log(`[모델] ${msg}`);
const num = (n) => n.toLocaleString('en-US');
const mb = (n) => `${(n / 1e6).toFixed(1)}MB`;

// ───────────────────────── 이미 받아 둔 것 검사 ─────────────────────────

/** public/models 가 고정값과 맞는지 본다. 맞으면 null, 아니면 이유 */
function checkExisting() {
  const manifestPath = path.join(OUT_DIR, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return `${MANIFEST_NAME} 이 없습니다`;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return `${MANIFEST_NAME} 을 읽을 수 없습니다`;
  }
  if (manifest.id !== MODEL_ID) return `모델 id 가 다릅니다(${manifest.id})`;
  if (manifest.totalBytes !== TOTAL_BYTES) return '전체 크기가 다릅니다';

  for (const [name, want] of Object.entries(FILES)) {
    const entry = manifest.files?.[name];
    if (!entry || !Array.isArray(entry.parts)) return `${name} 항목이 없습니다`;
    if (entry.size !== want.size || entry.sha256 !== want.sha256) return `${name} 의 크기나 해시가 다릅니다`;

    const hash = createHash('sha256');
    let total = 0;
    for (const part of entry.parts) {
      if (typeof part.path !== 'string' || !PART_FILE.test(part.path)) return `${name} 의 조각 이름이 이상합니다`;
      if (part.size > PART_BYTES) return `${part.path} 가 조각 크기 제한을 넘습니다`;
      const partPath = path.join(OUT_DIR, part.path);
      if (!fs.existsSync(partPath)) return `${part.path} 가 없습니다`;
      const data = fs.readFileSync(partPath);
      if (data.length !== part.size) return `${part.path} 의 크기가 다릅니다`;
      hash.update(data);
      total += data.length;
    }
    if (total !== want.size) return `${name} 의 조각 합계가 다릅니다`;
    if (hash.digest('hex') !== want.sha256) return `${name} 의 내용이 다릅니다`;
  }
  return null;
}

// ───────────────────────── tarball 받기 ─────────────────────────

/** `npm pack` 이 붙이는 파일명과 같게 맞춘다: @3sln/x → 3sln-x-0.1.1.tgz */
function tarballFileName(pkg) {
  return `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`;
}

function tarballUrl(pkg) {
  const registry = (process.env.CALLSIGN_REGISTRY || 'https://registry.npmjs.org/').replace(/\/+$/, '');
  const base = pkg.name.slice(pkg.name.indexOf('/') + 1);
  return `${registry}/${pkg.name}/-/${base}-${pkg.version}.tgz`;
}

function integrityOf(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(`sha512-${hash.digest('base64')}`));
  });
}

// 프록시 환경 변수(HTTPS_PROXY, NO_PROXY)를 따른다. 이 옵션을 모르는 옛 Node 는 그냥 직접 연결한다.
const agent = new https.Agent({ proxyEnv: process.env });

function httpGet(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (!url.startsWith('https://')) {
      reject(new Error(`https 주소만 받습니다: ${url}`));
      return;
    }
    const req = https.get(url, { agent, headers: { 'user-agent': 'callsign-fetch-models', accept: '*/*' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) reject(new Error('리다이렉트가 너무 많습니다'));
        else httpGet(new URL(res.headers.location, url).href, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        const err = new Error(`HTTP ${status} (${url})`);
        // 4xx 는 다시 해 봐도 같다
        err.noRetry = status >= 400 && status < 500 && status !== 408 && status !== 429;
        reject(err);
        return;
      }
      resolve(res);
    });
    req.setTimeout(60_000, () => req.destroy(new Error('응답이 없어 연결을 끊었습니다')));
    req.on('error', reject);
  });
}

async function downloadOnce(pkg, dest) {
  const res = await httpGet(tarballUrl(pkg));
  const expected = Number(res.headers['content-length'] ?? 0);
  const tmp = `${dest}.partial`;
  const hash = createHash('sha512');
  let received = 0;
  let nextMark = 0.25;

  // 지나가는 바이트를 세고 해시에 넣는다
  const meter = new Transform({
    transform(chunk, _encoding, done) {
      hash.update(chunk);
      received += chunk.length;
      if (expected > 0 && nextMark < 1 && received / expected >= nextMark) {
        log(`  ${Math.round(nextMark * 100)}% (${mb(received)} / ${mb(expected)})`);
        nextMark += 0.25;
      }
      done(null, chunk);
    },
  });

  try {
    await pipeline(res, meter, fs.createWriteStream(tmp));
    if (expected > 0 && received !== expected) {
      throw new Error(`받다가 끊겼습니다(${num(received)} / ${num(expected)}바이트)`);
    }
    const integrity = `sha512-${hash.digest('base64')}`;
    if (integrity !== pkg.integrity) {
      const err = new Error(`무결성 값이 다릅니다. 받은 파일을 버립니다.\n  기대: ${pkg.integrity}\n  실제: ${integrity}`);
      // 끝까지 받았는데 내용이 다른 것이라 다시 받아도 같다
      err.noRetry = true;
      throw err;
    }
    fs.renameSync(tmp, dest);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** 무결성이 확인된 tarball 경로를 돌려준다. 미리 받아 둔 것 → 캐시 → 내려받기 순서 */
async function obtainTarball(pkg) {
  const fileName = tarballFileName(pkg);
  const label = `${pkg.name}@${pkg.version}`;

  const localDir = process.env.CALLSIGN_TARBALL_DIR;
  if (localDir) {
    const local = path.join(localDir, fileName);
    if (fs.existsSync(local)) {
      if ((await integrityOf(local)) === pkg.integrity) {
        log(`${label}: 미리 받아 둔 파일을 씁니다`);
        return local;
      }
      log(`${label}: 미리 받아 둔 파일의 무결성 값이 달라 쓰지 않습니다`);
    }
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cached = path.join(CACHE_DIR, fileName);
  if (fs.existsSync(cached)) {
    if ((await integrityOf(cached)) === pkg.integrity) {
      log(`${label}: 캐시에 있는 파일을 씁니다`);
      return cached;
    }
    fs.rmSync(cached, { force: true });
  }

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      log(`${label}: 내려받는 중${attempt > 1 ? ` (${attempt}번째 시도)` : ''}`);
      await downloadOnce(pkg, cached);
      log(`${label}: 받았습니다. sha512 일치`);
      return cached;
    } catch (err) {
      lastError = err;
      log(`${label}: 실패 — ${err.message}`);
      if (err.noRetry) break;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error(`${label} 을 받지 못했습니다: ${lastError.message}`);
}

// ───────────────────────── tar.gz 읽기 ─────────────────────────

function tarString(block, start, end) {
  let stop = start;
  while (stop < end && block[stop] !== 0) stop++;
  return block.toString('utf8', start, stop);
}

function tarNumber(block, start, end) {
  // 맨 앞 비트가 서 있으면 8진수 문자열이 아니라 2진 숫자(큰 파일용)
  if (block[start] & 0x80) {
    let value = 0;
    for (let i = start + 1; i < end; i++) value = value * 256 + block[i];
    return value;
  }
  const text = block.toString('latin1', start, end).replace(/[\0 ]+/g, '');
  return text ? parseInt(text, 8) : 0;
}

function parseTarHeader(block) {
  const stored = tarNumber(block, 148, 156);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];
  if (sum !== stored) throw new Error('tar 헤더 체크섬이 맞지 않습니다');

  let name = tarString(block, 0, 100);
  if (block.toString('latin1', 257, 262) === 'ustar') {
    const prefix = tarString(block, 345, 500);
    if (prefix) name = `${prefix}/${name}`;
  }
  const type = block[156] === 0 ? '0' : String.fromCharCode(block[156]);
  return { name, size: tarNumber(block, 124, 136), type };
}

/** pax 확장 헤더("길이 키=값\n" 의 나열)에서 다음 항목의 이름·크기를 읽는다 */
function parsePax(body) {
  const fields = {};
  let pos = 0;
  while (pos < body.length) {
    const space = body.indexOf(0x20, pos);
    if (space < 0) break;
    const len = parseInt(body.toString('latin1', pos, space), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = body.toString('utf8', space + 1, pos + len - 1);
    const eq = record.indexOf('=');
    if (eq > 0) fields[record.slice(0, eq)] = record.slice(eq + 1);
    pos += len;
  }
  return fields;
}

/**
 * tar.gz 를 처음부터 끝까지 흘려 읽으며 일반 파일마다 want(name) 을 묻고, 원하는 것만 모아 onFile 로 넘긴다.
 * 디스크에는 아무것도 풀지 않는다(이름은 비교에만 쓴다).
 */
async function readTarGz(file, want, onFile) {
  const source = fs.createReadStream(file);
  const gunzip = zlib.createGunzip({ chunkSize: 1 << 20 });
  source.on('error', (err) => gunzip.destroy(err));
  source.pipe(gunzip);

  const EMPTY = Buffer.alloc(0);
  let rest = EMPTY;
  let state = 'header';
  let entry = null;
  let keep = false;
  let pieces = [];
  let bodyLeft = 0;
  let padLeft = 0;
  let override = {};
  let zeroBlocks = 0;
  let ended = false;

  const finishEntry = () => {
    const body = keep ? Buffer.concat(pieces) : EMPTY;
    pieces = [];
    if (entry.type === 'x') {
      const pax = parsePax(body);
      if (pax.path) override.name = pax.path;
      if (pax.size) override.size = Number(pax.size);
    } else if (entry.type === 'L') {
      override.name = tarString(body, 0, body.length);
    } else if (keep) {
      onFile(entry.name, body);
    }
    state = 'header';
  };

  for await (const chunk of gunzip) {
    let buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
    let off = 0;

    for (;;) {
      if (state === 'header') {
        if (buf.length - off < 512) break;
        const block = buf.subarray(off, off + 512);
        off += 512;
        if (block.every((byte) => byte === 0)) {
          if (++zeroBlocks >= 2) {
            ended = true;
            break;
          }
          continue;
        }
        zeroBlocks = 0;

        entry = parseTarHeader(block);
        const isMeta = entry.type === 'x' || entry.type === 'g' || entry.type === 'L';
        if (!isMeta) {
          if (override.name !== undefined) entry.name = override.name;
          if (override.size !== undefined) entry.size = override.size;
          override = {};
        }
        const isFile = entry.type === '0' || entry.type === '7';
        keep = entry.type === 'x' || entry.type === 'L' || (isFile && want(entry.name));
        bodyLeft = entry.size;
        padLeft = (512 - (entry.size % 512)) % 512;
        if (bodyLeft === 0) finishEntry();
        else state = 'body';
      } else if (state === 'body') {
        const take = Math.min(buf.length - off, bodyLeft);
        if (take === 0) break;
        if (keep) pieces.push(buf.subarray(off, off + take));
        off += take;
        bodyLeft -= take;
        if (bodyLeft === 0) {
          if (padLeft === 0) finishEntry();
          else state = 'pad';
        }
      } else {
        const take = Math.min(buf.length - off, padLeft);
        if (take === 0) break;
        off += take;
        padLeft -= take;
        if (padLeft === 0) finishEntry();
      }
    }

    rest = off < buf.length ? buf.subarray(off) : EMPTY;
    if (ended) break;
  }

  if (!ended && (state !== 'header' || rest.length > 0)) {
    throw new Error(`${path.basename(file)}: tar 가 중간에 끊겼습니다`);
  }
}

// ───────────────────────── 조각 합치기 ─────────────────────────

/** `export default "<base64>";` 한 줄짜리 모듈에서 바이너리를 꺼낸다 */
function decodeChunkModule(name, source) {
  const open = source.indexOf(0x22);
  const close = source.lastIndexOf(0x22);
  const head = source.toString('latin1', 0, Math.max(open, 0)).trim();
  if (open < 0 || close <= open || head !== 'export default') {
    throw new Error(`${name}: 예상한 형식(export default "…")이 아닙니다`);
  }
  return Buffer.from(source.toString('latin1', open + 1, close), 'base64');
}

/** `export default { … };` 에서 객체 부분만 JSON 으로 읽는다. 받은 코드를 실행하지는 않는다 */
function parseUpstreamManifest(source) {
  const text = source.toString('utf8');
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  if (open < 0 || close <= open) throw new Error('패키지 매니페스트(voice.js) 형식이 예상과 다릅니다');
  return JSON.parse(text.slice(open, close + 1));
}

/** 버퍼 목록을 이어 붙인 것처럼 보고 partBytes 씩 잘라 낸다 */
function* splitIntoParts(buffers, partBytes) {
  let current = [];
  let currentLen = 0;
  for (const buf of buffers) {
    let off = 0;
    while (off < buf.length) {
      const take = Math.min(buf.length - off, partBytes - currentLen);
      current.push(buf.subarray(off, off + take));
      currentLen += take;
      off += take;
      if (currentLen === partBytes) {
        yield Buffer.concat(current, currentLen);
        current = [];
        currentLen = 0;
      }
    }
  }
  if (currentLen > 0) yield Buffer.concat(current, currentLen);
}

function clearOutput() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // 매니페스트부터 지운다. 도중에 멈춰도 '다 된 것처럼' 보이지 않게
  fs.rmSync(path.join(OUT_DIR, MANIFEST_NAME), { force: true });
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (PART_FILE.test(name) || name.endsWith('.tmp')) fs.rmSync(path.join(OUT_DIR, name), { force: true });
  }
}

async function build() {
  // 1) tarball 3개를 받아 조각을 메모리에 모은다(전부 합쳐 약 145MB)
  const chunks = new Map();
  let upstream = null;

  for (const pkg of PACKAGES) {
    const tarball = await obtainTarball(pkg);
    const prefix = `${pkg.name}@${pkg.version}/`;
    let count = 0;
    await readTarGz(
      tarball,
      (name) => CHUNK_ENTRY.test(name) || name === UPSTREAM_MANIFEST_ENTRY,
      (name, body) => {
        if (name === UPSTREAM_MANIFEST_ENTRY) {
          upstream = parseUpstreamManifest(body);
          return;
        }
        const key = prefix + CHUNK_ENTRY.exec(name)[1];
        chunks.set(key, decodeChunkModule(key, body));
        count++;
      },
    );
    log(`${pkg.name}@${pkg.version}: 조각 ${count}개를 풀었습니다`);
  }
  if (!upstream?.files) throw new Error('패키지 매니페스트(voice.js)를 찾지 못했습니다');

  const upstreamNames = Object.keys(upstream.files).sort();
  const wantNames = Object.keys(FILES).sort();
  if (upstreamNames.join('|') !== wantNames.join('|')) {
    throw new Error(`패키지에 든 파일 목록이 예상과 다릅니다: ${upstreamNames.join(', ')}`);
  }

  // 2) 파일별로 이어 붙여 크기·sha256 을 확인하고 12MiB 조각으로 쓴다
  clearOutput();
  const manifestFiles = {};
  let partCount = 0;

  for (const [name, want] of Object.entries(FILES)) {
    const buffers = upstream.files[name].parts.map((key) => {
      const buf = chunks.get(key);
      if (!buf) throw new Error(`${name}: 조각 ${key} 가 없습니다`);
      return buf;
    });

    const size = buffers.reduce((sum, b) => sum + b.length, 0);
    if (size !== want.size) throw new Error(`${name}: 크기가 다릅니다(${num(size)} / 기대 ${num(want.size)})`);
    const hash = createHash('sha256');
    for (const b of buffers) hash.update(b);
    const sha256 = hash.digest('hex');
    if (sha256 !== want.sha256) throw new Error(`${name}: sha256 이 다릅니다(${sha256})`);

    if (name === 'tts.json') {
      const config = JSON.parse(Buffer.concat(buffers).toString('utf8'));
      if (config?.ae?.sample_rate !== SAMPLE_RATE) {
        throw new Error(`tts.json 의 샘플레이트가 ${SAMPLE_RATE} 이 아닙니다`);
      }
    }

    const parts = [];
    let index = 0;
    for (const part of splitIntoParts(buffers, PART_BYTES)) {
      const partName = `${name}.${String(index++).padStart(2, '0')}.bin`;
      fs.writeFileSync(path.join(OUT_DIR, partName), part);
      parts.push({ path: partName, size: part.length });
    }
    manifestFiles[name] = { size, sha256, parts };
    partCount += parts.length;
    log(`${name.padEnd(24)} ${num(size).padStart(11)}B  조각 ${parts.length}개`);

    // 다 쓴 조각은 놓아 준다
    for (const key of upstream.files[name].parts) chunks.delete(key);
  }

  // 3) 매니페스트는 맨 마지막에, 임시 파일로 쓴 뒤 이름을 바꾼다
  const manifest = {
    id: MODEL_ID,
    source: MODEL_SOURCE,
    license: MODEL_LICENSE,
    sampleRate: SAMPLE_RATE,
    totalBytes: TOTAL_BYTES,
    files: manifestFiles,
  };
  const manifestPath = path.join(OUT_DIR, MANIFEST_NAME);
  fs.writeFileSync(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(`${manifestPath}.tmp`, manifestPath);

  log(`완료: 파일 ${Object.keys(FILES).length}개, ${num(TOTAL_BYTES)}바이트, 조각 ${partCount}개 → ${path.relative(APP_DIR, OUT_DIR)}`);
}

// ───────────────────────── 실행 ─────────────────────────

async function main() {
  const args = new Set(process.argv.slice(2));
  const unknown = [...args].filter((a) => a !== '--force' && a !== '--check');
  if (unknown.length) throw new Error(`모르는 옵션: ${unknown.join(' ')} (쓸 수 있는 것: --force, --check)`);

  const problem = checkExisting();

  if (args.has('--check')) {
    if (problem) {
      log(`검사 실패: ${problem}`);
      process.exitCode = 1;
    } else {
      log(`검사 통과: 파일 ${Object.keys(FILES).length}개, ${num(TOTAL_BYTES)}바이트, 크기와 sha256 일치`);
    }
    return;
  }

  if (!problem && !args.has('--force')) {
    log(`이미 준비되어 있습니다(${num(TOTAL_BYTES)}바이트, 크기와 sha256 확인). 건너뜁니다.`);
    return;
  }
  log(problem ? `새로 만듭니다: ${problem}` : '--force: 다시 만듭니다');

  await build();

  const after = checkExisting();
  if (after) throw new Error(`쓰고 나서 다시 확인했는데 맞지 않습니다: ${after}`);
}

main().catch((err) => {
  console.error(`[모델] 오류: ${err.message}`);
  process.exitCode = 1;
});
