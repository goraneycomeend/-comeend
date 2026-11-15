// scripts/fetch-models.mjs 의 순수 함수들을 확인한다. 네트워크도, public/models 도 건드리지 않는다.
//
// 스크립트는 타입 선언이 없는 .mjs 라서 아래 인터페이스로 모양을 적어 두고 실행 중에 불러온다.
// 불러오기만 해서는 아무 일도 시작하지 않아야 한다(직접 실행했을 때만 받기를 시작한다).

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assembleModelFiles, parseIndexer, parseManifest, parseVoiceBank } from '../src/core/tts/index.ts';
import { BASE_VOICE_IDS } from '../src/core/types.ts';

interface FileSpec {
  size: number;
  sha256: string;
}
interface VariantSpec {
  id: string;
  source: string;
  files: Record<string, FileSpec>;
}
type Source = Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
interface FetchModels {
  DEFAULT_VARIANT: string;
  PART_BYTES: number;
  VARIANTS: Record<string, VariantSpec>;
  VOICE_NAMES: string[];
  parseArgs(
    argv: string[],
    env?: Record<string, string | undefined>,
  ): { variant: string; outDir: string; force: boolean; check: boolean };
  checkExisting(outDir: string, variant: string, variants?: Record<string, VariantSpec>, partBytes?: number): string | null;
  unicodeIndexerToBin(jsonText: string, entries?: number): Buffer;
  voiceStylesToBin(jsonTexts: string[], layout?: { ttl: number[]; dp: number[] }): Buffer;
  partFileNames(name: string, size: number, partBytes?: number): string[];
  splitIntoParts(source: Source, partBytes: number): AsyncGenerator<Buffer>;
  writeModel(
    outDir: string,
    spec: VariantSpec,
    open: (name: string) => Source | Promise<Source>,
    partBytes?: number,
  ): Promise<void>;
}

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(APP, 'scripts', 'fetch-models.mjs');
const REAL_MODELS = path.join(APP, 'public', 'models');

// 불러오는 동안 찍히는 것이 없어야 한다(= main 이 돌지 않았다)
const importLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
const exitCodeBefore = process.exitCode;
const realModelsBefore = fs.existsSync(REAL_MODELS) ? fs.statSync(REAL_MODELS).mtimeMs : null;
const m = (await import(/* @vite-ignore */ SCRIPT)) as FetchModels;
const loggedOnImport = importLog.mock.calls.length;
importLog.mockRestore();

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** 내용이 정해진 가짜 바이트 */
function fakeBytes(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

async function collect(parts: AsyncIterable<Buffer>): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for await (const part of parts) out.push(part);
  return out;
}

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'callsign-fetch-models-'));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// writeModel 이 진행 상황을 찍는다. 테스트 출력에서는 가린다
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('불러오기', () => {
  it('import 만으로는 아무 일도 시작하지 않는다', () => {
    expect(loggedOnImport).toBe(0);
    expect(process.exitCode).toBe(exitCodeBefore);
    if (realModelsBefore !== null) expect(fs.statSync(REAL_MODELS).mtimeMs).toBe(realModelsBefore);
  });
});

describe('옵션 읽기', () => {
  it('아무것도 주지 않으면 기본 변형과 public/models', () => {
    expect(m.parseArgs([], {})).toEqual({
      variant: m.DEFAULT_VARIANT,
      outDir: REAL_MODELS,
      force: false,
      check: false,
    });
    expect(Object.keys(m.VARIANTS)).toContain(m.DEFAULT_VARIANT);
  });

  it('--variant 는 띄어 쓴 값과 = 로 붙인 값을 모두 받는다', () => {
    expect(m.parseArgs(['--variant', 'fp32'], {}).variant).toBe('fp32');
    expect(m.parseArgs(['--variant=fp32'], {}).variant).toBe('fp32');
    expect(m.parseArgs(['--variant', 'int8'], {}).variant).toBe('int8');
  });

  it('환경 변수로 변형을 고를 수 있고, --variant 가 있으면 그쪽이 이긴다', () => {
    expect(m.parseArgs([], { CALLSIGN_MODEL_VARIANT: 'fp32' }).variant).toBe('fp32');
    expect(m.parseArgs(['--variant', 'int8'], { CALLSIGN_MODEL_VARIANT: 'fp32' }).variant).toBe('int8');
    // 빈 값은 없는 것으로 본다
    expect(m.parseArgs([], { CALLSIGN_MODEL_VARIANT: '' }).variant).toBe(m.DEFAULT_VARIANT);
  });

  it('--out 은 절대 경로로 바꿔 돌려준다', () => {
    expect(m.parseArgs(['--out', '/tmp/somewhere'], {}).outDir).toBe(path.resolve('/tmp/somewhere'));
    expect(m.parseArgs(['--out=rel/dir'], {}).outDir).toBe(path.resolve('rel/dir'));
  });

  it('--check, --force 는 --variant, --out 과 어떤 순서로든 함께 쓸 수 있다', () => {
    expect(m.parseArgs(['--check', '--variant', 'fp32', '--out', '/tmp/x'], {})).toEqual({
      variant: 'fp32',
      outDir: path.resolve('/tmp/x'),
      force: false,
      check: true,
    });
    expect(m.parseArgs(['--out=/tmp/x', '--force', '--variant=fp32'], {})).toEqual({
      variant: 'fp32',
      outDir: path.resolve('/tmp/x'),
      force: true,
      check: false,
    });
  });

  it('모르는 옵션, 빠진 값, 없는 변형은 이유를 말하며 거절한다', () => {
    expect(() => m.parseArgs(['--nope'], {})).toThrow(/모르는 옵션: --nope/);
    expect(() => m.parseArgs(['extra'], {})).toThrow(/모르는 옵션: extra/);
    expect(() => m.parseArgs(['--force=1'], {})).toThrow(/모르는 옵션/);
    expect(() => m.parseArgs(['--variant'], {})).toThrow(/--variant 뒤에 값이 필요/);
    expect(() => m.parseArgs(['--out', '--check'], {})).toThrow(/--out 뒤에 값이 필요/);
    expect(() => m.parseArgs(['--out='], {})).toThrow(/--out 뒤에 값이 필요/);
    expect(() => m.parseArgs(['--variant', 'fp16'], {})).toThrow(/--variant 값이 올바르지 않습니다: fp16/);
    expect(() => m.parseArgs([], { CALLSIGN_MODEL_VARIANT: 'FP32' })).toThrow(/CALLSIGN_MODEL_VARIANT 값이 올바르지 않습니다/);
    // 객체에 원래 달려 있는 이름을 변형으로 착각하지 않는다
    expect(() => m.parseArgs(['--variant', 'constructor'], {})).toThrow(/올바르지 않습니다/);
  });
});

describe('고정값 표', () => {
  const NAMES = [
    'duration_predictor.onnx',
    'text_encoder.onnx',
    'vector_estimator.onnx',
    'vocoder.onnx',
    'tts.json',
    'unicode_indexer.bin',
    'voice.bin',
  ];

  it('두 변형 모두 앱이 읽는 파일 7개를 같은 순서로 적는다', () => {
    expect(Object.keys(m.VARIANTS).sort()).toEqual(['fp32', 'int8']);
    for (const spec of Object.values(m.VARIANTS)) {
      expect(Object.keys(spec.files)).toEqual(NAMES);
      for (const file of Object.values(spec.files)) {
        expect(Number.isSafeInteger(file.size) && file.size > 0).toBe(true);
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
    expect(m.VARIANTS.int8.id).toBe('supertonic-3-int8');
    expect(m.VARIANTS.fp32.id).toBe('supertonic-3-fp32');
  });

  it('내용이 다른 것은 vector_estimator 와 vocoder 뿐이다', () => {
    const { int8, fp32 } = m.VARIANTS;
    for (const name of NAMES) {
      const same = int8.files[name].sha256 === fp32.files[name].sha256 && int8.files[name].size === fp32.files[name].size;
      expect(same, name).toBe(name !== 'vector_estimator.onnx' && name !== 'vocoder.onnx');
    }
    expect(fp32.files['vector_estimator.onnx'].size).toBe(256_534_781);
    expect(fp32.files['vocoder.onnx'].size).toBe(101_424_195);
    const total = (spec: VariantSpec): number => Object.values(spec.files).reduce((sum, f) => sum + f.size, 0);
    expect(total(int8)).toBe(145_295_768);
    expect(total(fp32)).toBe(398_862_838);
  });

  it('fp32 의 출처에는 공식 보관 저장소와 고정한 리비전이 적혀 있다', () => {
    expect(m.VARIANTS.fp32.source).toContain('https://huggingface.co/supertone-oss-archive/supertonic-3');
    expect(m.VARIANTS.fp32.source).toContain('aafc6e32416a594460b32413efc49d7fe4ce6d46');
  });

  it('voice.bin 에 담는 순서가 앱의 기본 보이스 순서와 같다', () => {
    expect(m.VOICE_NAMES).toEqual([...BASE_VOICE_IDS]);
  });
});

describe('unicode_indexer.json → bin', () => {
  it('값마다 little-endian int32 로 적는다', () => {
    const table = [-1, 0, 1, 255, 256, 8320, 65535, 2147483647];
    const bin = m.unicodeIndexerToBin(JSON.stringify(table), table.length);
    expect(bin.length).toBe(table.length * 4);
    expect(bin.subarray(0, 4).toString('hex')).toBe('ffffffff');
    expect(bin.subarray(4, 8).toString('hex')).toBe('00000000');
    expect(bin.subarray(16, 20).toString('hex')).toBe('00010000');
    expect(bin.subarray(20, 24).toString('hex')).toBe('80200000');
    // 앱이 읽는 방법으로 읽으면 원래 표가 나온다
    expect([...parseIndexer(bin)]).toEqual(table);
  });

  it('기본은 65536칸이다', () => {
    const table = Array.from({ length: 65536 }, (_, i) => (i % 7 === 0 ? -1 : i % 9000));
    const bin = m.unicodeIndexerToBin(JSON.stringify(table));
    expect(bin.length).toBe(262_144);
    const parsed = parseIndexer(bin);
    expect(parsed[0]).toBe(-1);
    expect(parsed[0x1100]).toBe(0x1100 % 9000);
    expect(() => m.unicodeIndexerToBin(JSON.stringify(table.slice(1)))).toThrow(/65,536개인 배열이 아닙니다/);
  });

  it('배열이 아니거나 토큰 id 가 아닌 값이 있으면 거절한다', () => {
    expect(() => m.unicodeIndexerToBin('{"a":1}', 1)).toThrow(/배열이 아닙니다/);
    expect(() => m.unicodeIndexerToBin('[1, 2]', 3)).toThrow(/배열이 아닙니다/);
    expect(() => m.unicodeIndexerToBin('[1, 2.5]', 2)).toThrow(/1번째 값/);
    expect(() => m.unicodeIndexerToBin('[1, "2"]', 2)).toThrow(/1번째 값/);
    expect(() => m.unicodeIndexerToBin('[-2, 0]', 2)).toThrow(/0번째 값/);
    expect(() => m.unicodeIndexerToBin('[0, 2147483648]', 2)).toThrow(/1번째 값/);
    expect(() => m.unicodeIndexerToBin('[0, null]', 2)).toThrow(/1번째 값/);
  });
});

describe('보이스 JSON → voice.bin', () => {
  const LAYOUT = { ttl: [2, 3], dp: [1, 2] };
  const style = (ttl: number[][], dp: number[][], over: Record<string, unknown> = {}): string =>
    JSON.stringify({
      style_ttl: { data: [ttl], dims: [1, 2, 3], type: 'float32' },
      style_dp: { data: [dp], dims: [1, 1, 2], type: 'float32' },
      metadata: { source_file: 'x.wav' },
      ...over,
    });

  it('머리글 int64 × 6, 그 뒤에 style_ttl 전부, 그 뒤에 style_dp 전부를 보이스 순서대로 적는다', () => {
    const bin = m.voiceStylesToBin(
      [
        style([[0.1, -0.2, 0.3], [1, 2, 3]], [[0.5, -0.25]]),
        style([[10, 20, 30], [40, 50, 60]], [[7, 8]]),
      ],
      LAYOUT,
    );
    expect(bin.length).toBe(48 + 2 * 6 * 4 + 2 * 2 * 4);
    const header = Array.from({ length: 6 }, (_, i) => Number(bin.readBigInt64LE(i * 8)));
    expect(header).toEqual([2, 2, 3, 2, 1, 2]);

    const floats = Array.from({ length: (bin.length - 48) / 4 }, (_, i) => bin.readFloatLE(48 + i * 4));
    expect(floats).toEqual([
      // style_ttl: 첫 보이스, 둘째 보이스
      ...[0.1, -0.2, 0.3, 1, 2, 3].map(Math.fround),
      ...[10, 20, 30, 40, 50, 60],
      // style_dp: 첫 보이스, 둘째 보이스
      ...[0.5, -0.25],
      ...[7, 8],
    ]);
    // 1.0 의 float32 표기(little-endian)
    expect(bin.subarray(48 + 3 * 4, 48 + 4 * 4).toString('hex')).toBe('0000803f');
  });

  it('실제 모양(보이스 10개, 50×256, 8×16)으로 만든 것을 앱이 그대로 읽는다', () => {
    const texts = m.VOICE_NAMES.map((_, voice) =>
      JSON.stringify({
        style_ttl: {
          data: [Array.from({ length: 50 }, (_r, r) => Array.from({ length: 256 }, (_c, c) => voice + r / 100 + c / 100_000))],
          dims: [1, 50, 256],
          type: 'float32',
        },
        style_dp: {
          data: [Array.from({ length: 8 }, (_r, r) => Array.from({ length: 16 }, (_c, c) => -voice - r / 10 - c / 1000))],
          dims: [1, 8, 16],
          type: 'float32',
        },
      }),
    );
    const bin = m.voiceStylesToBin(texts);
    expect(bin.length).toBe(517_168);
    expect(bin.length).toBe(m.VARIANTS.fp32.files['voice.bin'].size);

    const bank = parseVoiceBank(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer);
    expect(bank.count).toBe(10);
    expect(bank.ttlShape).toEqual([50, 256]);
    expect(bank.dpShape).toEqual([8, 16]);
    // 보이스 7 의 style_ttl[3][5], style_dp[2][9]
    expect(bank.ttl[7 * 12800 + 3 * 256 + 5]).toBe(Math.fround(7 + 3 / 100 + 5 / 100_000));
    expect(bank.dp[7 * 128 + 2 * 16 + 9]).toBe(Math.fround(-7 - 2 / 10 - 9 / 1000));
    expect(bank.ttl[0]).toBe(0);
    expect(bank.ttl[bank.ttl.length - 1]).toBe(Math.fround(9 + 49 / 100 + 255 / 100_000));
  });

  it('모양·형식·값이 맞지 않으면 어느 보이스의 무엇인지 말하며 거절한다', () => {
    const good = style([[1, 2, 3], [4, 5, 6]], [[7, 8]]);
    const bad = (over: Record<string, unknown>): string => style([[1, 2, 3], [4, 5, 6]], [[7, 8]], over);
    const ttl = (patch: Record<string, unknown>): Record<string, unknown> => ({
      style_ttl: { data: [[[1, 2, 3], [4, 5, 6]]], dims: [1, 2, 3], type: 'float32', ...patch },
    });

    expect(() => m.voiceStylesToBin([good, bad(ttl({ dims: [1, 3, 2] }))], LAYOUT)).toThrow(/2번째 보이스의 style_ttl: 모양/);
    expect(() => m.voiceStylesToBin([bad(ttl({ dims: [2, 3] }))], LAYOUT)).toThrow(/1번째 보이스의 style_ttl: 모양/);
    expect(() => m.voiceStylesToBin([bad(ttl({ type: 'float64' }))], LAYOUT)).toThrow(/float32 가 아닙니다/);
    expect(() => m.voiceStylesToBin([bad(ttl({ data: [[[1, 2, 3], [4, 5]]] }))], LAYOUT)).toThrow(/값의 개수/);
    expect(() => m.voiceStylesToBin([bad(ttl({ data: [[[1, 2, 3], [4, 5, 'x']]] }))], LAYOUT)).toThrow(/숫자가 아닌 값/);
    expect(() => m.voiceStylesToBin([bad(ttl({ data: [[[1, 2, 3], [4, 5, 1e39]]] }))], LAYOUT)).toThrow(/숫자가 아닌 값/);
    expect(() => m.voiceStylesToBin([bad({ style_dp: undefined })], LAYOUT)).toThrow(/1번째 보이스의 style_dp: 모양/);
    expect(() => m.voiceStylesToBin(['[]'], LAYOUT)).toThrow(/style_ttl/);
  });
});

describe('조각 이름', () => {
  it('두 자리 번호를 붙이고, 조각 수는 크기를 조각 크기로 나눠 올림한 값이다', () => {
    expect(m.partFileNames('a.onnx', 1, 10)).toEqual(['a.onnx.00.bin']);
    expect(m.partFileNames('a.onnx', 10, 10)).toEqual(['a.onnx.00.bin']);
    expect(m.partFileNames('a.onnx', 11, 10)).toEqual(['a.onnx.00.bin', 'a.onnx.01.bin']);
    expect(m.partFileNames('a.onnx', 990, 10)).toHaveLength(99);
    expect(m.partFileNames('a.onnx', 1000, 10).at(-1)).toBe('a.onnx.99.bin');
  });

  it('조각이 100개 이상이면 그 파일의 번호를 전부 세 자리로 늘려, 겹치지 않고 이름순이 조각 순서가 된다', () => {
    const names = m.partFileNames('big.onnx', 1001, 10);
    expect(names).toHaveLength(101);
    expect(names[0]).toBe('big.onnx.000.bin');
    expect(names[99]).toBe('big.onnx.099.bin');
    expect(names[100]).toBe('big.onnx.100.bin');
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(names);

    const huge = m.partFileNames('huge.onnx', 12_345, 1);
    expect(huge[0]).toBe('huge.onnx.00000.bin');
    expect(huge.at(-1)).toBe('huge.onnx.12344.bin');
    expect([...huge].sort()).toEqual(huge);
  });

  it('실제 조각 크기(12MiB)에서 fp32 vector_estimator 는 21조각이다', () => {
    expect(m.PART_BYTES).toBe(12 * 1024 * 1024);
    const names = m.partFileNames('vector_estimator.onnx', m.VARIANTS.fp32.files['vector_estimator.onnx'].size);
    expect(names).toHaveLength(21);
    expect(names[0]).toBe('vector_estimator.onnx.00.bin');
    expect(names[20]).toBe('vector_estimator.onnx.20.bin');
    expect(m.partFileNames('vocoder.onnx', m.VARIANTS.fp32.files['vocoder.onnx'].size)).toHaveLength(9);
    expect(m.partFileNames('vector_estimator.onnx', m.VARIANTS.int8.files['vector_estimator.onnx'].size)).toHaveLength(7);
  });
});

describe('조각 나누기', () => {
  it('버퍼 경계와 상관없이 조각 크기만큼씩 자르고, 이어 붙이면 원래 내용이다', async () => {
    const whole = fakeBytes(1000, 7);
    const buffers = [whole.subarray(0, 3), whole.subarray(3, 3), whole.subarray(3, 400), whole.subarray(400, 1000)];
    const parts = await collect(m.splitIntoParts(buffers, 64));
    expect(parts.map((p) => p.length)).toEqual([...Array.from({ length: 15 }, () => 64), 40]);
    expect(Buffer.concat(parts).equals(whole)).toBe(true);
  });

  it('딱 나누어떨어지면 빈 조각을 덧붙이지 않고, 내용이 없으면 조각도 없다', async () => {
    expect((await collect(m.splitIntoParts([fakeBytes(128, 1)], 64))).map((p) => p.length)).toEqual([64, 64]);
    expect(await collect(m.splitIntoParts([], 64))).toEqual([]);
    expect(await collect(m.splitIntoParts([Buffer.alloc(0)], 64))).toEqual([]);
  });

  it('읽기 스트림도 받는다', async () => {
    const whole = fakeBytes(5000, 3);
    const dir = tmpDir();
    const file = path.join(dir, 'whole.bin');
    fs.writeFileSync(file, whole);
    const fromFile = await collect(m.splitIntoParts(fs.createReadStream(file, { highWaterMark: 700 }), 1024));
    expect(fromFile.map((p) => p.length)).toEqual([1024, 1024, 1024, 1024, 904]);
    expect(Buffer.concat(fromFile).equals(whole)).toBe(true);

    const fromStream = await collect(m.splitIntoParts(Readable.from([whole.subarray(0, 10), whole.subarray(10)]), 4096));
    expect(fromStream.map((p) => p.length)).toEqual([4096, 904]);
  });

  it('조각 크기가 0 이하면 거절한다(끝없이 돌지 않는다)', async () => {
    await expect(collect(m.splitIntoParts([fakeBytes(4, 1)], 0))).rejects.toThrow(/조각 크기/);
    await expect(collect(m.splitIntoParts([fakeBytes(4, 1)], -1))).rejects.toThrow(/조각 크기/);
  });
});

describe('폴더에 쓰기와 검사', () => {
  const PART = 64;
  // 작은 가짜 모델 두 벌. 이름은 같고 내용만 다르다(진짜 변형과 같은 관계)
  const contents: Record<string, Record<string, Buffer>> = {
    int8: { 'net.onnx': fakeBytes(300, 11), 'small.bin': fakeBytes(10, 12), 'exact.bin': fakeBytes(128, 13) },
    fp32: { 'net.onnx': fakeBytes(150, 21), 'small.bin': fakeBytes(10, 12), 'exact.bin': fakeBytes(128, 13) },
  };
  const variants: Record<string, VariantSpec> = Object.fromEntries(
    Object.entries(contents).map(([key, files]) => [
      key,
      {
        id: `test-${key}`,
        source: `테스트용 ${key}`,
        files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, { size: bytes.length, sha256: sha256(bytes) }])),
      },
    ]),
  );
  const write = (dir: string, key: string): Promise<void> =>
    m.writeModel(dir, variants[key], (name) => [contents[key][name]], PART);
  const check = (dir: string, key: string): string | null => m.checkExisting(dir, key, variants, PART);
  const readManifest = (dir: string): { files: Record<string, { parts: { path: string; size: number }[] }> } =>
    JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

  it('쓴 것은 검사를 통과하고, 앱의 로더가 원래 내용으로 되돌린다', async () => {
    const dir = tmpDir();
    await write(dir, 'int8');
    expect(check(dir, 'int8')).toBeNull();

    expect(fs.readdirSync(dir).sort()).toEqual([
      'exact.bin.00.bin',
      'exact.bin.01.bin',
      'manifest.json',
      'net.onnx.00.bin',
      'net.onnx.01.bin',
      'net.onnx.02.bin',
      'net.onnx.03.bin',
      'net.onnx.04.bin',
      'small.bin.00.bin',
    ]);

    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    expect(raw).toMatchObject({ id: 'test-int8', source: '테스트용 int8', license: 'OpenRAIL-M', sampleRate: 44100, totalBytes: 438 });
    expect(Object.keys(raw.files)).toEqual(['net.onnx', 'small.bin', 'exact.bin']);
    expect(raw.files['net.onnx'].parts.map((p: { size: number }) => p.size)).toEqual([64, 64, 64, 64, 44]);

    const manifest = parseManifest(raw);
    expect(manifest.totalBytes).toBe(438);
    const files = await assembleModelFiles(raw, async (p) => fs.readFileSync(path.join(dir, p)));
    for (const [name, bytes] of Object.entries(contents.int8)) {
      expect(Buffer.from(files[name]).equals(bytes), name).toBe(true);
    }
  });

  it('없는 폴더, 매니페스트가 없거나 깨진 폴더는 이유를 돌려준다', () => {
    const dir = tmpDir();
    expect(check(path.join(dir, 'missing'), 'int8')).toMatch(/manifest\.json 이 없습니다/);
    expect(check(dir, 'int8')).toMatch(/manifest\.json 이 없습니다/);
    for (const garbage of ['{ not json', 'null', '"text"', '[]', '{}']) {
      fs.writeFileSync(path.join(dir, 'manifest.json'), garbage);
      expect(check(dir, 'int8'), garbage).toMatch(/읽을 수 없습니다|모델 id 가 다릅니다/);
    }
    expect(() => m.checkExisting(dir, 'nope', variants, PART)).toThrow(/모르는 변형/);
  });

  it('다른 변형이 들어 있으면, 파일이 멀쩡해도 통과가 아니라 다시 만들 대상이다', async () => {
    const dir = tmpDir();
    await write(dir, 'int8');
    expect(check(dir, 'int8')).toBeNull();
    expect(check(dir, 'fp32')).toBe('다른 변형이 들어 있습니다(있는 것: int8, 요청한 것: fp32)');

    await write(dir, 'fp32');
    expect(check(dir, 'fp32')).toBeNull();
    expect(check(dir, 'int8')).toBe('다른 변형이 들어 있습니다(있는 것: fp32, 요청한 것: int8)');
  });

  it('모르는 id, 고정값과 다른 매니페스트를 알아챈다', async () => {
    const dir = tmpDir();
    await write(dir, 'int8');
    const manifestPath = path.join(dir, 'manifest.json');
    const original = fs.readFileSync(manifestPath, 'utf8');
    const edit = (change: (manifest: Record<string, any>) => void): void => {
      const manifest = JSON.parse(original);
      change(manifest);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    };

    edit((x) => (x.id = 'something-else'));
    expect(check(dir, 'int8')).toBe('모델 id 가 다릅니다(something-else)');
    edit((x) => (x.totalBytes += 1));
    expect(check(dir, 'int8')).toBe('전체 크기가 다릅니다');
    edit((x) => delete x.files['small.bin']);
    expect(check(dir, 'int8')).toBe('small.bin 항목이 없습니다');
    edit((x) => (x.files['net.onnx'].sha256 = sha256(Buffer.from('x'))));
    expect(check(dir, 'int8')).toBe('net.onnx 의 크기나 해시가 다릅니다');
    edit((x) => (x.files['net.onnx'].parts[0].path = '../net.onnx.00.bin'));
    expect(check(dir, 'int8')).toBe('net.onnx 의 조각 이름이 이상합니다');
    edit((x) => (x.files['net.onnx'].parts[0].path = 'net.onnx.0.bin'));
    expect(check(dir, 'int8')).toBe('net.onnx 의 조각 이름이 이상합니다');
    edit((x) => x.files['net.onnx'].parts.pop());
    expect(check(dir, 'int8')).toBe('net.onnx 의 조각 합계가 다릅니다');
    edit((x) => (x.files['net.onnx'].parts = [null]));
    expect(check(dir, 'int8')).toBe('net.onnx 의 조각 이름이 이상합니다');

    fs.writeFileSync(manifestPath, original);
    expect(check(dir, 'int8')).toBeNull();
    // 조각 크기 제한을 더 작게 잡으면 걸린다
    expect(m.checkExisting(dir, 'int8', variants, 63)).toMatch(/조각 크기 제한을 넘습니다/);
  });

  it('조각의 한 바이트만 바뀌어도, 조각이 없어지거나 잘려도 알아챈다', async () => {
    const dir = tmpDir();
    await write(dir, 'int8');
    const part = path.join(dir, 'net.onnx.02.bin');
    const original = fs.readFileSync(part);

    const flipped = Buffer.from(original);
    flipped[17] ^= 0x01;
    fs.writeFileSync(part, flipped);
    expect(check(dir, 'int8')).toBe('net.onnx 의 내용이 다릅니다');

    fs.writeFileSync(part, original.subarray(0, original.length - 1));
    expect(check(dir, 'int8')).toBe('net.onnx.02.bin 의 크기가 다릅니다');

    fs.rmSync(part);
    expect(check(dir, 'int8')).toBe('net.onnx.02.bin 가 없습니다');

    fs.writeFileSync(part, original);
    expect(check(dir, 'int8')).toBeNull();

    // 조각 두 개를 서로 바꿔 놓아도(크기는 같다) 걸린다
    const first = fs.readFileSync(path.join(dir, 'net.onnx.00.bin'));
    fs.writeFileSync(path.join(dir, 'net.onnx.00.bin'), fs.readFileSync(path.join(dir, 'net.onnx.01.bin')));
    fs.writeFileSync(path.join(dir, 'net.onnx.01.bin'), first);
    expect(check(dir, 'int8')).toBe('net.onnx 의 내용이 다릅니다');
  });

  it('내용이 고정값과 다르면 쓰기를 거절하고 매니페스트를 남기지 않는다', async () => {
    const dir = tmpDir();
    await write(dir, 'int8');

    // 같은 크기, 다른 내용
    const wrong = Buffer.from(contents.int8['net.onnx']);
    wrong[0] ^= 0xff;
    await expect(
      m.writeModel(dir, variants.int8, (name) => [name === 'net.onnx' ? wrong : contents.int8[name]], PART),
    ).rejects.toThrow(/net\.onnx: sha256 이 다릅니다/);
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(false);
    expect(check(dir, 'int8')).toMatch(/manifest\.json 이 없습니다/);

    // 짧은 것, 긴 것
    await expect(
      m.writeModel(dir, variants.int8, (name) => [contents.int8[name].subarray(0, 5)], PART),
    ).rejects.toThrow(/net\.onnx: 크기가 다릅니다\(5 \/ 기대 300\)/);
    await expect(
      m.writeModel(dir, variants.int8, (name) => [contents.int8[name], fakeBytes(1000, 5)], PART),
    ).rejects.toThrow(/net\.onnx: 고정해 둔 크기\(300바이트\)보다 깁니다/);
    // 길다는 것을 알아챈 뒤로는 더 쓰지 않는다
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('net.onnx.')).length).toBe(5);
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(false);

    // 제대로 다시 쓰면 통과한다
    await write(dir, 'int8');
    expect(check(dir, 'int8')).toBeNull();
  });

  it('다시 만들 때 전에 쓴 조각은 치우고, 폴더의 다른 파일은 건드리지 않는다', async () => {
    const dir = tmpDir();
    for (const name of ['notes.txt', 'keep.tmp', 'other.00.bin']) fs.writeFileSync(path.join(dir, name), name);
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'net.onnx.00.bin'), 'in sub');
    // 도중에 멈춘 흔적
    fs.writeFileSync(path.join(dir, 'manifest.json.tmp'), '{');
    fs.writeFileSync(path.join(dir, 'net.onnx.07.bin'), 'left over');

    await write(dir, 'int8'); // net.onnx 5조각
    await write(dir, 'fp32'); // net.onnx 3조각
    expect(check(dir, 'fp32')).toBeNull();
    expect(fs.readdirSync(dir).sort()).toEqual([
      'exact.bin.00.bin',
      'exact.bin.01.bin',
      'keep.tmp',
      'manifest.json',
      'net.onnx.00.bin',
      'net.onnx.01.bin',
      'net.onnx.02.bin',
      'notes.txt',
      'other.00.bin',
      'small.bin.00.bin',
      'sub',
    ]);
    expect(fs.readFileSync(path.join(dir, 'other.00.bin'), 'utf8')).toBe('other.00.bin');
    expect(fs.readFileSync(path.join(dir, 'sub', 'net.onnx.00.bin'), 'utf8')).toBe('in sub');
  });

  it('전 매니페스트에 적힌 조각은 지금 목록에 없는 파일의 것이어도 치운다', async () => {
    const dir = tmpDir();
    const old: VariantSpec = {
      id: 'test-old',
      source: '예전 구성',
      files: { 'gone.bin': { size: 100, sha256: sha256(fakeBytes(100, 9)) } },
    };
    await m.writeModel(dir, old, () => [fakeBytes(100, 9)], PART);
    expect(fs.readdirSync(dir).sort()).toEqual(['gone.bin.00.bin', 'gone.bin.01.bin', 'manifest.json']);

    await write(dir, 'int8');
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('gone.'))).toEqual([]);
    expect(check(dir, 'int8')).toBeNull();
  });

  it('한 파일이 100조각을 넘어도 쓰고, 검사하고, 앱의 로더로 되돌릴 수 있다', async () => {
    const dir = tmpDir();
    const bytes = fakeBytes(250, 31);
    const spec: VariantSpec = { id: 'test-many', source: '조각이 많은 것', files: { 'many.onnx': { size: 250, sha256: sha256(bytes) } } };
    await m.writeModel(dir, spec, () => Readable.from([bytes]), 2);

    const parts = readManifest(dir).files['many.onnx'].parts;
    expect(parts).toHaveLength(125);
    expect(parts[0].path).toBe('many.onnx.000.bin');
    expect(parts[99].path).toBe('many.onnx.099.bin');
    expect(parts[124].path).toBe('many.onnx.124.bin');
    expect(new Set(parts.map((p) => p.path)).size).toBe(125);
    expect(fs.readdirSync(dir).filter((n) => n !== 'manifest.json').sort()).toEqual(parts.map((p) => p.path));

    expect(m.checkExisting(dir, 'many', { many: spec }, 2)).toBeNull();
    const files = await assembleModelFiles(readManifest(dir), async (p) => fs.readFileSync(path.join(dir, p)));
    expect(Buffer.from(files['many.onnx']).equals(bytes)).toBe(true);

    // 다시 쓰면 세 자리 조각도 치워진다
    const fewer: VariantSpec = { id: 'test-many', source: '조각이 적은 것', files: { 'many.onnx': { size: 250, sha256: sha256(bytes) } } };
    await m.writeModel(dir, fewer, () => [bytes], 100);
    expect(fs.readdirSync(dir).sort()).toEqual(['manifest.json', 'many.onnx.00.bin', 'many.onnx.01.bin', 'many.onnx.02.bin']);
  });
});
