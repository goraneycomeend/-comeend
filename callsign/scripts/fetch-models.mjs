#!/usr/bin/env node
// 음성 모델 가중치를 받아 public/models/ 에 12MiB 이하 조각과 manifest.json 으로 풀어 놓는다.
//
//   node scripts/fetch-models.mjs                  없으면 받고, 이미 있고 맞으면 건너뛴다
//   node scripts/fetch-models.mjs --force          있어도 다시 만든다
//   node scripts/fetch-models.mjs --check          받지 않고 검사만 한다(안 맞으면 종료 코드 1)
//   node scripts/fetch-models.mjs --variant fp32   받을 변형을 고른다(int8 | fp32). --variant=fp32 도 된다
//   node scripts/fetch-models.mjs --out <폴더>      public/models 대신 다른 폴더에 쓴다. --check, --force 와 함께 쓸 수 있다
//
// 변형 — 앱이 읽는 파일 7개의 이름은 같고, 내용이 다른 것은 vector_estimator.onnx 와 vocoder.onnx 둘뿐이다
//   int8  sherpa-onnx 가 int8 로 줄인 것(약 145MB). npm 패키지 3개에 base64 조각으로 나뉘어 들어 있다.
//         tarball 은 sha512(dist.integrity)로 확인한다.
//   fp32  Supertone 이 공개한 원본 그대로(32비트 부동소수, 약 399MB). Hugging Face 의 공식 보관 저장소에서
//         리비전을 고정해 받는다. 받은 파일마다 크기와 sha256 을 확인하고, unicode_indexer.json 과
//         voice_styles/*.json 은 앱이 읽는 unicode_indexer.bin, voice.bin 으로 바꾼다.
//   어느 쪽이든 다 만든 파일은 크기와 sha256 으로 한 번 더 확인한다. 값은 전부 아래에 고정해 둔다.
//
// 환경 변수
//   CALLSIGN_MODEL_VARIANT  --variant 를 주지 않았을 때 쓸 변형
//   CALLSIGN_TARBALL_DIR    (int8) 미리 받아 둔 tarball 폴더(`npm pack` 이 만드는 파일명). 여기 있으면 내려받지 않는다
//   CALLSIGN_REGISTRY       (int8) 레지스트리 주소(기본 https://registry.npmjs.org/)
//   CALLSIGN_HF_DIR         (fp32) 미리 받아 둔 저장소 폴더(onnx/…, voice_styles/… 그대로). 여기 있고 고정값과 맞으면 내려받지 않는다
//   CALLSIGN_HF_ENDPOINT    (fp32) Hugging Face 주소(기본 https://huggingface.co)
//
// 큰 파일은 흘려 읽고 쓴다(받으면서 해시를 계산하고, 조각 하나만큼만 메모리에 둔다).
// tar 명령 같은 외부 도구 없이 Node 내장 모듈만 쓴다.
// 테스트가 import 해서 함수만 쓸 수 있게, 직접 실행했을 때만 일을 시작한다(맨 아래).

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT_DIR = path.join(APP_DIR, 'public', 'models');
const CACHE_DIR = path.join(APP_DIR, 'node_modules', '.cache', 'callsign-models');
const MANIFEST_NAME = 'manifest.json';

/** --variant 도 CALLSIGN_MODEL_VARIANT 도 없을 때 받는 변형 */
export const DEFAULT_VARIANT = 'int8';

/** 조각 하나의 최대 크기. 정적 호스팅의 파일당 용량 제한(15MB)보다 작게 잡는다 */
export const PART_BYTES = 12 * 1024 * 1024;

const MODEL_LICENSE = 'OpenRAIL-M';
const SAMPLE_RATE = 44100;

// ── int8: npm 패키지 ──

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

// ── fp32: Hugging Face 공식 보관 저장소 ──

const HF_REPO = 'supertone-oss-archive/supertonic-3';
/** 받을 커밋. 브랜치 이름이 아니라 커밋 해시라서 저장소가 바뀌어도 같은 파일을 받는다 */
const HF_REVISION = 'aafc6e32416a594460b32413efc49d7fe4ce6d46';

/** voice.bin 에 담는 순서. 앱의 BASE_VOICE_IDS(src/core/types.ts)와 같아야 한다 */
export const VOICE_NAMES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];

/** unicode_indexer 의 칸 수(코드포인트 U+0000..U+FFFF) */
const INDEXER_ENTRIES = 65536;
/** 보이스 하나의 style_ttl, style_dp 모양(맨 앞 배치 차원 1 은 뺀 것) */
const VOICE_LAYOUT = { ttl: [50, 256], dp: [8, 16] };

/**
 * 저장소에서 받는 파일 16개의 크기와 sha256. 위 리비전에서 받아 `sha256sum` 으로 확인한 값이고,
 * .onnx 4개는 저장소가 LFS 포인터에 적어 둔 값과도 같다.
 */
const HF_FILES = {
  'onnx/duration_predictor.onnx': {
    size: 3700147,
    sha256: 'c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db',
  },
  'onnx/text_encoder.onnx': {
    size: 36416150,
    sha256: 'c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff',
  },
  'onnx/vector_estimator.onnx': {
    size: 256534781,
    sha256: '883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c',
  },
  'onnx/vocoder.onnx': {
    size: 101424195,
    sha256: '085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba',
  },
  'onnx/tts.json': {
    size: 8253,
    sha256: '42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09',
  },
  'onnx/unicode_indexer.json': {
    size: 277676,
    sha256: '9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f',
  },
  'voice_styles/F1.json': {
    size: 292046,
    sha256: 'bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2',
  },
  'voice_styles/F2.json': {
    size: 292423,
    sha256: '7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6',
  },
  'voice_styles/F3.json': {
    size: 290794,
    sha256: '12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab',
  },
  'voice_styles/F4.json': {
    size: 291808,
    sha256: 'c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b',
  },
  'voice_styles/F5.json': {
    size: 291479,
    sha256: '45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d',
  },
  'voice_styles/M1.json': {
    size: 291748,
    sha256: 'e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b',
  },
  'voice_styles/M2.json': {
    size: 292055,
    sha256: 'b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50',
  },
  'voice_styles/M3.json': {
    size: 290198,
    sha256: 'ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b',
  },
  'voice_styles/M4.json': {
    size: 291522,
    sha256: 'ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303',
  },
  'voice_styles/M5.json': {
    size: 291469,
    sha256: 'dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2',
  },
};

// ── 변형별로 앱이 읽는 파일 ──

/**
 * 변형마다: 매니페스트에 적는 id·출처, 그리고 다 만든 파일의 크기와 sha256(이 순서대로 매니페스트에 적는다).
 * 파일 이름 7개는 두 변형이 같다. vector_estimator.onnx 와 vocoder.onnx 만 내용이 다르고 나머지 5개는 같다.
 */
export const VARIANTS = {
  int8: {
    id: 'supertonic-3-int8',
    source:
      'Supertone Supertonic 3 (https://huggingface.co/Supertone/supertonic-3) 을 sherpa-onnx 가 int8 로 변환한 것. ' +
      'npm @3sln/donki-lle-voice-multi, -multi-2, -multi-3 (0.1.1) 에서 받음',
    files: {
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
    },
  },
  fp32: {
    id: 'supertonic-3-fp32',
    source:
      'Supertone Supertonic 3 공식 가중치(32비트 부동소수 원본). ' +
      `https://huggingface.co/${HF_REPO} 의 리비전 ${HF_REVISION} 에서 받음. ` +
      'unicode_indexer.bin 과 voice.bin 은 같은 리비전의 onnx/unicode_indexer.json, voice_styles/*.json 을 변환한 것',
    files: {
      // 저장소 파일을 그대로 쓰는 것은 위 고정값을 그대로 가리킨다
      'duration_predictor.onnx': HF_FILES['onnx/duration_predictor.onnx'],
      'text_encoder.onnx': HF_FILES['onnx/text_encoder.onnx'],
      'vector_estimator.onnx': HF_FILES['onnx/vector_estimator.onnx'],
      'vocoder.onnx': HF_FILES['onnx/vocoder.onnx'],
      'tts.json': HF_FILES['onnx/tts.json'],
      // 아래 둘은 받은 JSON 을 변환해 만든다. 변환 결과도 고정해 둔다(int8 세트에 든 것과 바이트 단위로 같다)
      'unicode_indexer.bin': {
        size: 262144,
        sha256: '8402ca48e5189a8950138580b0fff64db6f072f24ac07cd54ba8b2fbb9883b30',
      },
      'voice.bin': {
        size: 517168,
        sha256: '67d5209b0ee8ce6c74105ffbe12fe6a7628aea3b4ba2fcb308a4a67938a93ce8',
      },
    },
  },
};

const totalBytesOf = (spec) => Object.values(spec.files).reduce((sum, f) => sum + f.size, 0);

/** 조각 목록이 들어 있는 패키지 안의 매니페스트 */
const UPSTREAM_MANIFEST_ENTRY = 'package/voice.js';
const CHUNK_ENTRY = /^package\/(c\/\d{3}\.js)$/;
/** 조각 파일 이름: <파일명>.<번호>.bin. 번호는 두 자리, 조각이 100개 이상일 때만 더 길다 */
const PART_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.\d{2,}\.bin$/;

const log = (msg) => console.log(`[모델] ${msg}`);
const num = (n) => n.toLocaleString('en-US');
const mb = (n) => `${(n / 1e6).toFixed(1)}MB`;

// ───────────────────────── 옵션 ─────────────────────────

/**
 * 명령줄 인자와 환경 변수를 읽는다. 변형은 --variant → CALLSIGN_MODEL_VARIANT → DEFAULT_VARIANT 순서로 정한다.
 * 돌려주는 값: { variant, outDir(절대 경로), force, check }
 */
export function parseArgs(argv, env = {}) {
  let variant;
  let variantFrom = '--variant';
  let out;
  let force = false;
  let check = false;
  const unknown = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const key = eq < 0 ? arg : arg.slice(0, eq);
    // 값은 `--이름 값` 이나 `--이름=값` 으로 받는다
    const value = () => {
      const v = eq < 0 ? argv[++i] : arg.slice(eq + 1);
      if (v === undefined || v === '' || (eq < 0 && v.startsWith('--'))) throw new Error(`${key} 뒤에 값이 필요합니다`);
      return v;
    };
    if (arg === '--force') force = true;
    else if (arg === '--check') check = true;
    else if (key === '--variant') variant = value();
    else if (key === '--out') out = value();
    else unknown.push(arg);
  }
  if (unknown.length) {
    throw new Error(`모르는 옵션: ${unknown.join(' ')} (쓸 수 있는 것: --variant <int8|fp32>, --out <폴더>, --force, --check)`);
  }

  if (variant === undefined && env.CALLSIGN_MODEL_VARIANT) {
    variant = env.CALLSIGN_MODEL_VARIANT;
    variantFrom = 'CALLSIGN_MODEL_VARIANT';
  }
  variant ??= DEFAULT_VARIANT;
  if (!Object.hasOwn(VARIANTS, variant)) {
    throw new Error(`${variantFrom} 값이 올바르지 않습니다: ${variant} (쓸 수 있는 것: ${Object.keys(VARIANTS).join(', ')})`);
  }
  return { variant, outDir: out === undefined ? DEFAULT_OUT_DIR : path.resolve(out), force, check };
}

// ───────────────────────── 이미 받아 둔 것 검사 ─────────────────────────

/**
 * outDir 에 든 것이 요청한 변형의 고정값과 맞는지 본다. 맞으면 null, 아니면 이유.
 * 매니페스트에 적힌 변형이 요청한 것과 다르면, 파일이 멀쩡해도 '다시 만들어야 하는 것'이다.
 * (variants 와 partBytes 는 테스트가 작은 값으로 바꿔 넣을 수 있게 열어 둔 것)
 */
export function checkExisting(outDir, variant, variants = VARIANTS, partBytes = PART_BYTES) {
  const spec = variants[variant];
  if (!spec) throw new Error(`모르는 변형입니다: ${variant}`);
  const manifestPath = path.join(outDir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return `${MANIFEST_NAME} 이 없습니다`;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return `${MANIFEST_NAME} 을 읽을 수 없습니다`;
  }
  if (typeof manifest !== 'object' || manifest === null) return `${MANIFEST_NAME} 을 읽을 수 없습니다`;
  if (manifest.id !== spec.id) {
    const present = Object.keys(variants).find((key) => variants[key].id === manifest.id);
    return present
      ? `다른 변형이 들어 있습니다(있는 것: ${present}, 요청한 것: ${variant})`
      : `모델 id 가 다릅니다(${manifest.id})`;
  }
  if (manifest.totalBytes !== totalBytesOf(spec)) return '전체 크기가 다릅니다';

  for (const [name, want] of Object.entries(spec.files)) {
    const entry = manifest.files?.[name];
    if (!entry || !Array.isArray(entry.parts)) return `${name} 항목이 없습니다`;
    if (entry.size !== want.size || entry.sha256 !== want.sha256) return `${name} 의 크기나 해시가 다릅니다`;

    const hash = createHash('sha256');
    let total = 0;
    for (const part of entry.parts) {
      if (typeof part?.path !== 'string' || !PART_FILE.test(part.path)) return `${name} 의 조각 이름이 이상합니다`;
      if (part.size > partBytes) return `${part.path} 가 조각 크기 제한을 넘습니다`;
      const partPath = path.join(outDir, part.path);
      if (!fs.existsSync(partPath)) return `${part.path} 가 없습니다`;
      // 크기부터 본다. 엉뚱하게 큰 파일을 통째로 읽지 않게
      if (fs.statSync(partPath).size !== part.size) return `${part.path} 의 크기가 다릅니다`;
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

// ───────────────────────── 내려받기 ─────────────────────────
//
// 받는 파일마다 '고정값'(pin)이 있다: { algorithm, digest, size? }
//   tarball  algorithm 'sha512', digest 는 npm 표기(sha512-<base64>). 크기는 고정하지 않는다
//   그 밖     algorithm 'sha256', digest 는 소문자 16진수, size 는 바이트 수

/** `npm pack` 이 붙이는 파일명과 같게 맞춘다: @3sln/x → 3sln-x-0.1.1.tgz */
function tarballFileName(pkg) {
  return `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`;
}

function tarballUrl(pkg) {
  const registry = (process.env.CALLSIGN_REGISTRY || 'https://registry.npmjs.org/').replace(/\/+$/, '');
  const base = pkg.name.slice(pkg.name.indexOf('/') + 1);
  return `${registry}/${pkg.name}/-/${base}-${pkg.version}.tgz`;
}

function hfUrl(repoPath) {
  const endpoint = (process.env.CALLSIGN_HF_ENDPOINT || 'https://huggingface.co').replace(/\/+$/, '');
  return `${endpoint}/${HF_REPO}/resolve/${HF_REVISION}/${repoPath}`;
}

/** 해시를 고정값과 같은 표기로 바꾼다 */
function digestText(algorithm, hash) {
  return algorithm === 'sha512' ? `sha512-${hash.digest('base64')}` : hash.digest('hex');
}

/** 파일을 흘려 읽으며 해시를 구한다(큰 파일도 메모리에 올리지 않는다) */
function digestOfFile(file, algorithm) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(digestText(algorithm, hash)));
  });
}

async function matchesPin(file, pin) {
  if (pin.size !== undefined && fs.statSync(file).size !== pin.size) return false;
  return (await digestOfFile(file, pin.algorithm)) === pin.digest;
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

/** 다시 받아도 결과가 같을 실패 */
function fatal(message) {
  const err = new Error(message);
  err.noRetry = true;
  return err;
}

/** url 을 dest 로 받는다. 받으면서 해시를 계산하고, 고정값과 맞을 때만 dest 로 이름을 바꾼다 */
async function downloadOnce(url, dest, pin) {
  const res = await httpGet(url);
  const expected = Number(res.headers['content-length'] ?? 0);
  if (pin.size !== undefined && expected > 0 && expected !== pin.size) {
    res.destroy();
    throw fatal(`서버가 알려 준 크기가 고정값과 다릅니다(${num(expected)} / 기대 ${num(pin.size)}바이트)`);
  }
  const limit = pin.size ?? Infinity;
  const tmp = `${dest}.partial`;
  const hash = createHash(pin.algorithm);
  let received = 0;
  let nextMark = 0.25;

  // 지나가는 바이트를 세고 해시에 넣는다
  const meter = new Transform({
    transform(chunk, _encoding, done) {
      received += chunk.length;
      if (received > limit) {
        // 고정해 둔 크기를 넘으면 더 받지 않는다(디스크를 채우지 않게)
        done(fatal(`고정해 둔 크기(${num(limit)}바이트)보다 많이 옵니다. 받기를 멈춥니다`));
        return;
      }
      hash.update(chunk);
      if (expected > 0 && nextMark < 1 && received / expected >= nextMark) {
        log(`  ${Math.round(nextMark * 100)}% (${mb(received)} / ${mb(expected)})`);
        nextMark += 0.25;
      }
      done(null, chunk);
    },
  });

  try {
    await pipeline(res, meter, fs.createWriteStream(tmp));
    if ((expected > 0 && received !== expected) || (pin.size !== undefined && received !== pin.size)) {
      throw new Error(`받다가 끊겼습니다(${num(received)} / ${num(expected || pin.size)}바이트)`);
    }
    const digest = digestText(pin.algorithm, hash);
    if (digest !== pin.digest) {
      // 끝까지 받았는데 내용이 다른 것이라 다시 받아도 같다
      throw fatal(`무결성 값이 다릅니다. 받은 파일을 버립니다.\n  기대: ${pin.digest}\n  실제: ${digest}`);
    }
    fs.renameSync(tmp, dest);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * 고정값과 맞는 파일의 경로를 돌려준다. 미리 받아 둔 것 → 캐시 → 내려받기 순서.
 * local 은 미리 받아 둔 파일이 있을 자리(없으면 undefined), cached 는 캐시에 둘 자리.
 */
async function obtainPinned({ label, url, pin, local, cached }) {
  if (local && fs.existsSync(local)) {
    if (await matchesPin(local, pin)) {
      log(`${label}: 미리 받아 둔 파일을 씁니다`);
      return local;
    }
    log(`${label}: 미리 받아 둔 파일의 무결성 값이 달라 쓰지 않습니다`);
  }

  fs.mkdirSync(path.dirname(cached), { recursive: true });
  if (fs.existsSync(cached)) {
    if (await matchesPin(cached, pin)) {
      log(`${label}: 캐시에 있는 파일을 씁니다`);
      return cached;
    }
    fs.rmSync(cached, { force: true });
  }

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      log(`${label}: 내려받는 중${attempt > 1 ? ` (${attempt}번째 시도)` : ''}`);
      await downloadOnce(url, cached, pin);
      log(`${label}: 받았습니다. ${pin.algorithm} 일치`);
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

/** 무결성이 확인된 tarball 경로를 돌려준다 */
function obtainTarball(pkg) {
  const fileName = tarballFileName(pkg);
  const localDir = process.env.CALLSIGN_TARBALL_DIR;
  return obtainPinned({
    label: `${pkg.name}@${pkg.version}`,
    url: tarballUrl(pkg),
    pin: { algorithm: 'sha512', digest: pkg.integrity },
    local: localDir ? path.join(localDir, fileName) : undefined,
    cached: path.join(CACHE_DIR, fileName),
  });
}

/** 크기와 sha256 이 확인된 저장소 파일의 경로를 돌려준다. 캐시는 리비전별 폴더에 저장소와 같은 구조로 둔다 */
function obtainHfFile(repoPath) {
  const { size, sha256 } = HF_FILES[repoPath];
  const segments = repoPath.split('/');
  const localDir = process.env.CALLSIGN_HF_DIR;
  return obtainPinned({
    label: repoPath,
    url: hfUrl(repoPath),
    pin: { algorithm: 'sha256', digest: sha256, size },
    local: localDir ? path.join(localDir, ...segments) : undefined,
    cached: path.join(CACHE_DIR, 'supertonic-3', HF_REVISION, ...segments),
  });
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

// ───────────────────────── int8: npm 패키지의 조각 합치기 ─────────────────────────

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

/** 메모리에 있는 내용(버퍼 목록)이 고정값과 맞는지 본다 */
function verifyBuffers(name, buffers, want) {
  const size = buffers.reduce((sum, b) => sum + b.length, 0);
  if (size !== want.size) throw new Error(`${name}: 크기가 다릅니다(${num(size)} / 기대 ${num(want.size)})`);
  const hash = createHash('sha256');
  for (const b of buffers) hash.update(b);
  const sha256 = hash.digest('hex');
  if (sha256 !== want.sha256) throw new Error(`${name}: sha256 이 다릅니다(${sha256})`);
}

function checkSampleRate(ttsJson) {
  const config = JSON.parse(ttsJson.toString('utf8'));
  if (config?.ae?.sample_rate !== SAMPLE_RATE) {
    throw new Error(`tts.json 의 샘플레이트가 ${SAMPLE_RATE} 이 아닙니다`);
  }
}

/**
 * int8: tarball 3개를 받아 조각을 메모리에 모으고(전부 합쳐 약 145MB), 파일별로 이어 붙여 크기·sha256 을 확인한다.
 * 돌려주는 함수는 파일 이름을 받아 그 내용(버퍼 목록)을 내준다.
 */
async function prepareInt8(spec) {
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
  const wantNames = Object.keys(spec.files).sort();
  if (upstreamNames.join('|') !== wantNames.join('|')) {
    throw new Error(`패키지에 든 파일 목록이 예상과 다릅니다: ${upstreamNames.join(', ')}`);
  }

  const contents = new Map();
  for (const [name, want] of Object.entries(spec.files)) {
    const buffers = upstream.files[name].parts.map((key) => {
      const buf = chunks.get(key);
      if (!buf) throw new Error(`${name}: 조각 ${key} 가 없습니다`);
      return buf;
    });
    verifyBuffers(name, buffers, want);
    if (name === 'tts.json') checkSampleRate(Buffer.concat(buffers));
    contents.set(name, buffers);
  }

  return (name) => {
    const buffers = contents.get(name);
    // 한 번 내준 것은 놓아 준다(다 쓰고 나면 메모리에서 사라지게)
    contents.delete(name);
    return buffers;
  };
}

// ───────────────────────── fp32: 공식 저장소 파일 → 앱이 읽는 파일 ─────────────────────────

/**
 * unicode_indexer.json(코드포인트 → 토큰 id 를 늘어놓은 배열, 미지원은 -1) → little-endian int32 × 65536.
 * (entries 는 테스트가 작은 표로 확인할 수 있게 열어 둔 것)
 */
export function unicodeIndexerToBin(jsonText, entries = INDEXER_ENTRIES) {
  const table = JSON.parse(jsonText);
  if (!Array.isArray(table) || table.length !== entries) {
    throw new Error(`unicode_indexer.json: 항목이 ${num(entries)}개인 배열이 아닙니다`);
  }
  const out = Buffer.alloc(entries * 4);
  for (let i = 0; i < entries; i++) {
    const id = table[i];
    if (!Number.isInteger(id) || id < -1 || id > 0x7fffffff) {
      throw new Error(`unicode_indexer.json: ${i}번째 값이 토큰 id 가 아닙니다(${JSON.stringify(id)})`);
    }
    out.writeInt32LE(id, i * 4);
  }
  return out;
}

/** 보이스 JSON 의 텐서 하나({ data: 여러 겹 배열, dims: [1, …shape], type: 'float32' })를 숫자 한 줄로 편다 */
function flattenStyleTensor(label, tensor, shape) {
  const dims = tensor?.dims;
  const dimsOk =
    Array.isArray(dims) && dims.length === shape.length + 1 && dims[0] === 1 && shape.every((n, i) => dims[i + 1] === n);
  if (!dimsOk) throw new Error(`${label}: 모양이 [1, ${shape.join(', ')}] 이 아닙니다(${JSON.stringify(dims)})`);
  if (tensor.type !== 'float32') throw new Error(`${label}: float32 가 아닙니다(${JSON.stringify(tensor.type)})`);
  const flat = Array.isArray(tensor.data) ? tensor.data.flat(Infinity) : [];
  if (flat.length !== shape.reduce((a, b) => a * b, 1)) throw new Error(`${label}: 값의 개수가 모양과 맞지 않습니다(${num(flat.length)}개)`);
  for (const v of flat) {
    // float32 로 줄였을 때 유한한 수여야 한다
    if (typeof v !== 'number' || !Number.isFinite(Math.fround(v))) throw new Error(`${label}: 숫자가 아닌 값이 있습니다(${JSON.stringify(v)})`);
  }
  return flat;
}

/**
 * 보이스 JSON 여러 개(넘겨준 순서 = 보이스 인덱스) → voice.bin.
 * 헤더 little-endian int64 × 6 = [보이스 수, 50, 256, 보이스 수, 8, 16], 이어서 style_ttl 을 보이스 순서대로
 * float32 little-endian 으로, 그 뒤에 style_dp 를 같은 순서로 적는다.
 * JSON 의 수는 float32 를 십진수로 적은 것이라, 가장 가까운 float32 로 되돌리면 원래 값이 그대로 나온다.
 * (layout 은 테스트가 작은 모양으로 확인할 수 있게 열어 둔 것)
 */
export function voiceStylesToBin(jsonTexts, layout = VOICE_LAYOUT) {
  const count = jsonTexts.length;
  const ttlLen = layout.ttl.reduce((a, b) => a * b, 1);
  const dpLen = layout.dp.reduce((a, b) => a * b, 1);
  const header = [count, ...layout.ttl, count, ...layout.dp];
  const ttlStart = header.length * 8;
  const dpStart = ttlStart + count * ttlLen * 4;
  const out = Buffer.alloc(dpStart + count * dpLen * 4);
  header.forEach((v, i) => out.writeBigInt64LE(BigInt(v), i * 8));

  jsonTexts.forEach((text, voice) => {
    const style = JSON.parse(text);
    const label = `${voice + 1}번째 보이스`;
    const ttl = flattenStyleTensor(`${label}의 style_ttl`, style?.style_ttl, layout.ttl);
    const dp = flattenStyleTensor(`${label}의 style_dp`, style?.style_dp, layout.dp);
    ttl.forEach((v, i) => out.writeFloatLE(v, ttlStart + (voice * ttlLen + i) * 4));
    dp.forEach((v, i) => out.writeFloatLE(v, dpStart + (voice * dpLen + i) * 4));
  });
  return out;
}

/** 작은 저장소 파일을 통째로 읽는다. 읽은 그 내용을 고정값과 다시 맞춰 본다(확인한 뒤에 바뀌었을 수도 있으므로) */
function readPinned(file, repoPath) {
  const data = fs.readFileSync(file);
  verifyBuffers(repoPath, [data], HF_FILES[repoPath]);
  return data;
}

/**
 * fp32: 공식 저장소 파일 16개를 구해(미리 받아 둔 것 → 캐시 → 내려받기) 크기·sha256 을 확인하고,
 * JSON 두 종류를 앱이 읽는 unicode_indexer.bin, voice.bin 으로 바꾼다.
 * 돌려주는 함수는 파일 이름을 받아 그 내용을 내준다. 큰 .onnx 는 읽기 스트림으로 준다(메모리에 올리지 않는다).
 */
async function prepareFp32(spec) {
  const local = {};
  for (const repoPath of Object.keys(HF_FILES)) local[repoPath] = await obtainHfFile(repoPath);

  const ttsJson = readPinned(local['onnx/tts.json'], 'onnx/tts.json');
  checkSampleRate(ttsJson);

  const indexer = unicodeIndexerToBin(readPinned(local['onnx/unicode_indexer.json'], 'onnx/unicode_indexer.json').toString('utf8'));
  const voices = voiceStylesToBin(
    VOICE_NAMES.map((voice) => {
      const repoPath = `voice_styles/${voice}.json`;
      return readPinned(local[repoPath], repoPath).toString('utf8');
    }),
  );
  verifyBuffers('unicode_indexer.bin', [indexer], spec.files['unicode_indexer.bin']);
  verifyBuffers('voice.bin', [voices], spec.files['voice.bin']);
  log('unicode_indexer.json → unicode_indexer.bin, voice_styles/*.json → voice.bin 으로 바꿨습니다. 크기와 sha256 일치');

  const small = { 'tts.json': ttsJson, 'unicode_indexer.bin': indexer, 'voice.bin': voices };
  return (name) => {
    if (small[name]) return [small[name]];
    const file = local[`onnx/${name}`];
    if (!file) throw new Error(`${name}: 어디서 가져올지 모르는 파일입니다`);
    return fs.createReadStream(file, { highWaterMark: 1 << 20 });
  };
}

// ───────────────────────── 조각으로 나눠 쓰기 ─────────────────────────

/**
 * 크기가 size 인 파일의 조각 이름들: <파일명>.<번호>.bin.
 * 번호는 두 자리(00, 01, …). 조각이 100개 이상이면 그 파일의 번호 전체를 자릿수를 늘려 붙인다(000, 001, …).
 * 그래야 이름이 겹치지 않고, 이름순이 곧 조각 순서다.
 */
export function partFileNames(name, size, partBytes = PART_BYTES) {
  const count = Math.ceil(size / partBytes);
  const width = Math.max(2, String(count - 1).length);
  return Array.from({ length: count }, (_, i) => `${name}.${String(i).padStart(width, '0')}.bin`);
}

/**
 * 내용을 이어 붙인 것처럼 보고 partBytes 씩 잘라 낸다.
 * source 는 버퍼 목록이어도 되고 읽기 스트림이어도 된다. 한 번에 조각 하나만큼만 메모리에 둔다.
 */
export async function* splitIntoParts(source, partBytes) {
  if (!Number.isInteger(partBytes) || partBytes <= 0) throw new Error(`조각 크기가 올바르지 않습니다: ${partBytes}`);
  let current = [];
  let currentLen = 0;
  for await (const buf of source) {
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

/**
 * 전에 만든 것을 치운다. 이 스크립트가 만든 것(매니페스트, 거기 적힌 조각, 지금 만들 파일의 조각)만 지우고
 * 폴더에 있는 다른 파일은 건드리지 않는다(--out 으로 아무 폴더나 가리킬 수 있으므로).
 */
function clearOutput(outDir, spec) {
  fs.mkdirSync(outDir, { recursive: true });
  const manifestPath = path.join(outDir, MANIFEST_NAME);

  const stale = new Set();
  try {
    const old = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const entry of Object.values(old?.files ?? {})) {
      for (const part of Array.isArray(entry?.parts) ? entry.parts : []) {
        if (typeof part?.path === 'string' && PART_FILE.test(part.path)) stale.add(part.path);
      }
    }
  } catch {
    // 매니페스트가 없거나 깨졌으면 이름으로만 고른다
  }
  const ours = new Set(Object.keys(spec.files));
  for (const name of fs.readdirSync(outDir)) {
    if (PART_FILE.test(name) && ours.has(name.replace(/\.\d+\.bin$/, ''))) stale.add(name);
  }

  // 매니페스트부터 지운다. 도중에 멈춰도 '다 된 것처럼' 보이지 않게
  fs.rmSync(manifestPath, { force: true });
  fs.rmSync(`${manifestPath}.tmp`, { force: true });
  for (const name of stale) fs.rmSync(path.join(outDir, name), { force: true });
}

/** 화면에 찍을 폴더 이름. 앱 폴더 안이면 상대 경로로 */
function showDir(dir) {
  const rel = path.relative(APP_DIR, dir);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : dir;
}

/**
 * spec 의 파일들을 outDir 에 partBytes 이하 조각과 매니페스트로 쓴다.
 * open(name) 은 그 파일의 내용(버퍼 목록이나 읽기 스트림)을 내준다. 쓰면서 크기와 sha256 을 다시 확인하고,
 * 하나라도 고정값과 다르면 매니페스트를 쓰지 않고 던진다.
 */
export async function writeModel(outDir, spec, open, partBytes = PART_BYTES) {
  clearOutput(outDir, spec);
  const manifestFiles = {};
  let partCount = 0;

  for (const [name, want] of Object.entries(spec.files)) {
    const names = partFileNames(name, want.size, partBytes);
    const hash = createHash('sha256');
    const parts = [];
    let size = 0;
    for await (const part of splitIntoParts(await open(name), partBytes)) {
      // 고정해 둔 크기를 넘는 순간 멈춘다(끝없이 쓰지 않게)
      if (parts.length >= names.length) throw new Error(`${name}: 고정해 둔 크기(${num(want.size)}바이트)보다 깁니다`);
      const partName = names[parts.length];
      hash.update(part);
      fs.writeFileSync(path.join(outDir, partName), part);
      parts.push({ path: partName, size: part.length });
      size += part.length;
    }
    if (size !== want.size) throw new Error(`${name}: 크기가 다릅니다(${num(size)} / 기대 ${num(want.size)})`);
    const sha256 = hash.digest('hex');
    if (sha256 !== want.sha256) throw new Error(`${name}: sha256 이 다릅니다(${sha256})`);

    manifestFiles[name] = { size, sha256, parts };
    partCount += parts.length;
    log(`${name.padEnd(24)} ${num(size).padStart(11)}B  조각 ${parts.length}개`);
  }

  // 매니페스트는 맨 마지막에, 임시 파일로 쓴 뒤 이름을 바꾼다
  const totalBytes = totalBytesOf(spec);
  const manifest = {
    id: spec.id,
    source: spec.source,
    license: MODEL_LICENSE,
    sampleRate: SAMPLE_RATE,
    totalBytes,
    files: manifestFiles,
  };
  const manifestPath = path.join(outDir, MANIFEST_NAME);
  fs.writeFileSync(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(`${manifestPath}.tmp`, manifestPath);

  log(`완료: 파일 ${Object.keys(spec.files).length}개, ${num(totalBytes)}바이트, 조각 ${partCount}개 → ${showDir(outDir)}`);
}

// ───────────────────────── 실행 ─────────────────────────

/** 변형별로 원본을 구해 확인하는 방법. 전부 확인이 끝난 뒤에야 출력 폴더를 건드린다 */
const PREPARE = { int8: prepareInt8, fp32: prepareFp32 };

async function main() {
  const { variant, outDir, force, check } = parseArgs(process.argv.slice(2), process.env);
  const spec = VARIANTS[variant];
  const summary = `파일 ${Object.keys(spec.files).length}개, ${num(totalBytesOf(spec))}바이트`;
  log(`변형 ${variant} (${spec.id}) · ${showDir(outDir)}`);

  const problem = checkExisting(outDir, variant);

  if (check) {
    if (problem) {
      log(`검사 실패: ${problem}`);
      process.exitCode = 1;
    } else {
      log(`검사 통과: ${summary}, 크기와 sha256 일치`);
    }
    return;
  }

  if (!problem && !force) {
    log(`이미 준비되어 있습니다(${summary}, 크기와 sha256 확인). 건너뜁니다.`);
    return;
  }
  log(problem ? `새로 만듭니다: ${problem}` : '--force: 다시 만듭니다');

  const open = await PREPARE[variant](spec);
  await writeModel(outDir, spec, open);

  const after = checkExisting(outDir, variant);
  if (after) throw new Error(`쓰고 나서 다시 확인했는데 맞지 않습니다: ${after}`);
}

/** `node scripts/fetch-models.mjs` 처럼 직접 실행했는지. import 해서 쓸 때는 아무 일도 시작하지 않는다 */
function isEntryPoint() {
  // 요즘 Node 는 직접 알려 준다. 없으면(22.18 미만) 실행한 파일의 경로와 견준다
  if (typeof import.meta.main === 'boolean') return import.meta.main;
  try {
    const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
    return same(fs.realpathSync(process.argv[1]), fs.realpathSync(fileURLToPath(import.meta.url)));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((err) => {
    console.error(`[모델] 오류: ${err.message}`);
    process.exitCode = 1;
  });
}
