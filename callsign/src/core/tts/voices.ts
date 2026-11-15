// voice.bin 읽기와 기본 보이스 혼합.
//
// 목소리는 모델에 들어 있는 기본 보이스 10개의 스타일 벡터를 섞어서만 만든다.
// 사람 목소리 샘플에서 스타일을 뽑아내는 기능은 없다(만들지 않는다).

import { BASE_VOICE_IDS } from '../types.ts';
import type { BaseVoiceId, VoiceBlend } from '../types.ts';

/** voice.bin 의 내용. 보이스 순서는 BASE_VOICE_IDS 와 같다 */
export interface VoiceBank {
  /** 보이스 수(10) */
  count: number;
  /** 보이스 하나의 style_ttl 모양 [50, 256] */
  ttlShape: [number, number];
  /** 보이스 하나의 style_dp 모양 [8, 16] */
  dpShape: [number, number];
  /** count × 50 × 256 */
  ttl: Float32Array;
  /** count × 8 × 16 */
  dp: Float32Array;
}

export interface BlendedStyle {
  ttl: Float32Array;
  dp: Float32Array;
  /** [1, 50, 256] */
  ttlDims: number[];
  /** [1, 8, 16] */
  dpDims: number[];
}

/** 한 목소리에 섞을 수 있는 기본 보이스 수 */
export const MAX_BLEND_COMPONENTS = 3;

const HEADER_BYTES = 48;

/**
 * voice.bin 을 읽는다.
 * 형식: little-endian int64 × 6 = [보이스 수, 50, 256, 보이스 수, 8, 16] → style_ttl f32 → style_dp f32.
 */
export function parseVoiceBank(buf: ArrayBuffer): VoiceBank {
  if (buf.byteLength < HEADER_BYTES) {
    throw new Error('보이스 파일이 너무 짧아요. 모델 파일을 다시 받아 주세요.');
  }
  const view = new DataView(buf);
  const header: number[] = [];
  for (let i = 0; i < 6; i++) header.push(Number(view.getBigInt64(i * 8, true)));
  const [count, t1, t2, count2, d1, d2] = header;
  const sane = header.every((n) => Number.isInteger(n) && n > 0 && n < 100_000);
  if (!sane || count !== count2) {
    throw new Error('보이스 파일 머리글이 올바르지 않아요. 모델 파일을 다시 받아 주세요.');
  }
  const ttlLen = count * t1 * t2;
  const dpLen = count * d1 * d2;
  if (buf.byteLength !== HEADER_BYTES + 4 * (ttlLen + dpLen)) {
    throw new Error('보이스 파일 크기가 머리글과 맞지 않아요. 모델 파일을 다시 받아 주세요.');
  }
  if (count !== BASE_VOICE_IDS.length) {
    throw new Error(`기본 보이스가 ${BASE_VOICE_IDS.length}개여야 하는데 ${count}개가 들어 있어요.`);
  }
  // 복사해서 가진다(원본 버퍼를 놓아줄 수 있게)
  const ttl = new Float32Array(buf.slice(HEADER_BYTES, HEADER_BYTES + 4 * ttlLen));
  const dp = new Float32Array(buf.slice(HEADER_BYTES + 4 * ttlLen));
  return { count, ttlShape: [t1, t2], dpShape: [d1, d2], ttl, dp };
}

/**
 * 혼합 비율을 정리한다: 모르는 키·0 이하·숫자가 아닌 값은 버리고, 큰 것부터 3개만 남겨 합이 1 이 되게 한다.
 * 결과의 키 순서는 BASE_VOICE_IDS 순서로 고정된다(같은 혼합이면 언제나 같은 모양).
 * 남는 성분이 없으면 오류.
 */
export function normalizeBlend(blend: VoiceBlend): VoiceBlend {
  const entries: Array<[BaseVoiceId, number]> = [];
  for (const id of BASE_VOICE_IDS) {
    const w = blend[id];
    if (typeof w === 'number' && Number.isFinite(w) && w > 0) entries.push([id, w]);
  }
  if (entries.length === 0) {
    throw new RangeError('기본 보이스를 하나 이상 골라 주세요.');
  }
  // 큰 것부터 3개. 비율이 같으면 BASE_VOICE_IDS 에서 앞선 것이 남는다(sort 는 안정 정렬)
  const kept = [...entries].sort((a, b) => b[1] - a[1]).slice(0, MAX_BLEND_COMPONENTS);
  const keptIds = new Set(kept.map(([id]) => id));
  const sum = kept.reduce((acc, [, w]) => acc + w, 0);
  const out: VoiceBlend = {};
  for (const [id, w] of entries) {
    if (keptIds.has(id)) out[id] = w / sum;
  }
  return out;
}

/** 기본 보이스들의 스타일 벡터를 비율대로 더한다(볼록 결합) */
export function blendStyle(bank: VoiceBank, blend: VoiceBlend): BlendedStyle {
  const norm = normalizeBlend(blend);
  const ttlSize = bank.ttlShape[0] * bank.ttlShape[1];
  const dpSize = bank.dpShape[0] * bank.dpShape[1];
  const ttl = new Float32Array(ttlSize);
  const dp = new Float32Array(dpSize);
  for (const id of BASE_VOICE_IDS) {
    const w = norm[id];
    if (w === undefined) continue;
    const index = BASE_VOICE_IDS.indexOf(id);
    const ttlOff = index * ttlSize;
    const dpOff = index * dpSize;
    for (let j = 0; j < ttlSize; j++) ttl[j] += w * bank.ttl[ttlOff + j];
    for (let j = 0; j < dpSize; j++) dp[j] += w * bank.dp[dpOff + j];
  }
  return { ttl, dp, ttlDims: [1, ...bank.ttlShape], dpDims: [1, ...bank.dpShape] };
}
