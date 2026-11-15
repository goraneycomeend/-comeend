import { describe, expect, it } from 'vitest';

import { MAX_BLEND_COMPONENTS, blendStyle, normalizeBlend, parseVoiceBank } from '../src/core/tts/index.ts';
import { BASE_VOICE_IDS } from '../src/core/types.ts';

/** 시험용 voice.bin: 보이스 i 의 style_ttl 은 전부 (i+1), style_dp 는 전부 (i+1)*10 */
function makeVoiceBin(header: number[] = [10, 50, 256, 10, 8, 16]): ArrayBuffer {
  const [n, t1, t2, , d1, d2] = header;
  const ttlLen = n * t1 * t2;
  const dpLen = n * d1 * d2;
  const buf = new ArrayBuffer(48 + 4 * (ttlLen + dpLen));
  const view = new DataView(buf);
  header.forEach((v, i) => view.setBigInt64(i * 8, BigInt(v), true));
  const ttl = new Float32Array(buf, 48, ttlLen);
  const dp = new Float32Array(buf, 48 + 4 * ttlLen, dpLen);
  for (let i = 0; i < n; i++) {
    ttl.fill(i + 1, i * t1 * t2, (i + 1) * t1 * t2);
    dp.fill((i + 1) * 10, i * d1 * d2, (i + 1) * d1 * d2);
  }
  return buf;
}

describe('parseVoiceBank', () => {
  it('머리글과 두 가지 스타일 묶음을 읽는다', () => {
    const buf = makeVoiceBin();
    expect(buf.byteLength).toBe(517_168);
    const bank = parseVoiceBank(buf);
    expect(bank.count).toBe(10);
    expect(bank.ttlShape).toEqual([50, 256]);
    expect(bank.dpShape).toEqual([8, 16]);
    expect(bank.ttl.length).toBe(10 * 50 * 256);
    expect(bank.dp.length).toBe(10 * 8 * 16);
    // 보이스 순서가 BASE_VOICE_IDS 순서와 같다
    expect(bank.ttl[0]).toBe(1);
    expect(bank.ttl[9 * 50 * 256]).toBe(10);
    expect(bank.ttl[bank.ttl.length - 1]).toBe(10);
    expect(bank.dp[0]).toBe(10);
    expect(bank.dp[5 * 8 * 16]).toBe(60);
  });

  it('원본 버퍼와 메모리를 나눠 쓰지 않는다(원본을 놓아줄 수 있다)', () => {
    const buf = makeVoiceBin();
    const bank = parseVoiceBank(buf);
    new Float32Array(buf, 48, 1)[0] = 999;
    expect(bank.ttl[0]).toBe(1);
  });

  it('깨진 파일은 한국어 메시지로 거절한다', () => {
    expect(() => parseVoiceBank(new ArrayBuffer(10))).toThrow(/보이스 파일/);
    expect(() => parseVoiceBank(makeVoiceBin().slice(0, 1000))).toThrow(/크기/);
    // 두 묶음의 보이스 수가 다르다
    const mismatched = makeVoiceBin();
    new DataView(mismatched).setBigInt64(24, 9n, true);
    expect(() => parseVoiceBank(mismatched)).toThrow(/머리글/);
    // 보이스가 10개가 아니다
    expect(() => parseVoiceBank(makeVoiceBin([4, 50, 256, 4, 8, 16]))).toThrow(/10개/);
  });
});

describe('normalizeBlend', () => {
  const sum = (b: Record<string, number | undefined>): number => Object.values(b).reduce<number>((a, w) => a + (w ?? 0), 0);

  it('합이 1 이 되게 맞춘다', () => {
    expect(normalizeBlend({ F1: 2 })).toEqual({ F1: 1 });
    expect(normalizeBlend({ F1: 1, M1: 1 })).toEqual({ F1: 0.5, M1: 0.5 });
    const b = normalizeBlend({ F2: 0.6, M3: 0.3, F5: 0.3 });
    expect(sum(b)).toBeCloseTo(1, 12);
    expect(b.F2).toBeCloseTo(0.5, 12);
  });

  it('0 이하, 숫자가 아닌 값, 모르는 키는 버린다', () => {
    const dirty = { F1: 1, F2: 0, F3: -1, M1: Number.NaN, M2: Infinity, XX: 5 } as unknown as Parameters<
      typeof normalizeBlend
    >[0];
    expect(normalizeBlend(dirty)).toEqual({ F1: 1 });
  });

  it('성분은 큰 것부터 최대 3개만 남긴다', () => {
    expect(MAX_BLEND_COMPONENTS).toBe(3);
    const b = normalizeBlend({ F1: 0.1, F2: 0.4, F3: 0.2, M1: 0.3, M2: 0.05 });
    expect(Object.keys(b)).toEqual(['F2', 'F3', 'M1']);
    expect(sum(b)).toBeCloseTo(1, 12);
    expect(b.F2).toBeCloseTo(0.4 / 0.9, 12);
  });

  it('넣은 순서와 상관없이 같은 혼합은 같은 모양이 된다', () => {
    const a = normalizeBlend({ M3: 1, F1: 3 });
    const b = normalizeBlend({ F1: 3, M3: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.keys(a)).toEqual(['F1', 'M3']);
  });

  it('남는 성분이 없으면 오류', () => {
    expect(() => normalizeBlend({})).toThrow(/보이스/);
    expect(() => normalizeBlend({ F1: 0 })).toThrow(/보이스/);
  });
});

describe('blendStyle', () => {
  const bank = parseVoiceBank(makeVoiceBin());

  it('보이스 하나면 그 보이스의 스타일 그대로', () => {
    for (const [index, id] of BASE_VOICE_IDS.entries()) {
      const s = blendStyle(bank, { [id]: 1 });
      expect(s.ttlDims).toEqual([1, 50, 256]);
      expect(s.dpDims).toEqual([1, 8, 16]);
      expect(s.ttl.length).toBe(50 * 256);
      expect(s.dp.length).toBe(8 * 16);
      expect(s.ttl.every((v) => v === index + 1)).toBe(true);
      expect(s.dp.every((v) => v === (index + 1) * 10)).toBe(true);
    }
  });

  it('비율대로 더한다(볼록 결합)', () => {
    // F1(=1) 과 M1(=6) 을 반반 → 3.5
    const half = blendStyle(bank, { F1: 1, M1: 1 });
    expect(half.ttl[0]).toBeCloseTo(3.5, 5);
    expect(half.dp[0]).toBeCloseTo(35, 4);
    // F1 75% + M5(=10) 25% → 3.25
    const mostly = blendStyle(bank, { F1: 3, M5: 1 });
    expect(mostly.ttl[100]).toBeCloseTo(3.25, 5);
    // 셋을 섞어도 가장 작은 값과 큰 값 사이
    const three = blendStyle(bank, { F1: 0.2, F3: 0.3, M2: 0.5 });
    expect(three.ttl[0]).toBeCloseTo(0.2 * 1 + 0.3 * 3 + 0.5 * 7, 5);
  });

  it('원본 묶음을 건드리지 않는다', () => {
    const before = bank.ttl[0];
    const s = blendStyle(bank, { F1: 1 });
    s.ttl[0] = 123;
    expect(bank.ttl[0]).toBe(before);
  });
});
