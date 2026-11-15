// 샘플레이트 변환. 창을 씌운 sinc 보간이라 내릴 때 접힘 잡음이 생기지 않는다. 순수 함수.
import type { PcmAudio } from '../types.ts';

/** 한쪽으로 보는 영점 교차 수. 클수록 정확하고 느리다 */
const ZERO_CROSSINGS = 16;

export function resample(a: PcmAudio, sampleRate: number): PcmAudio {
  if (!(sampleRate > 0)) throw new Error('샘플레이트가 올바르지 않아요.');
  if (a.sampleRate === sampleRate || a.samples.length === 0) {
    return { samples: a.samples.slice(), sampleRate };
  }
  const x = a.samples;
  const ratio = sampleRate / a.sampleRate;
  const outLen = Math.max(1, Math.round(x.length * ratio));
  const out = new Float32Array(outLen);
  // 내릴 때는 새 나이퀴스트 아래로 통과 대역을 좁힌다
  const cutoff = Math.min(1, ratio) * 0.96;
  const half = ZERO_CROSSINGS / cutoff;
  for (let i = 0; i < outLen; i++) {
    const center = i / ratio;
    const from = Math.max(0, Math.ceil(center - half));
    const to = Math.min(x.length - 1, Math.floor(center + half));
    let sum = 0;
    for (let j = from; j <= to; j++) {
      const t = j - center;
      const s = t * cutoff;
      const sinc = Math.abs(s) < 1e-9 ? 1 : Math.sin(Math.PI * s) / (Math.PI * s);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / half); // Hann 창
      sum += x[j] * sinc * w;
    }
    out[i] = sum * cutoff;
  }
  return { samples: out, sampleRate };
}
