// 합성한 음성의 마무리: 앞뒤 무음 정리 → 음량 맞춤 → 피크 제한 → 페이드. 순수 함수.
import type { PcmAudio } from '../types.ts';
import { activeRms, frameRms, fromDb } from './analysis.ts';
import { limitPeaks } from './limiter.ts';

export interface FinishOptions {
  /** 말하는 구간의 목표 음량(dBFS RMS). 기본 -18 */
  targetRmsDb?: number;
  /** 피크 한계(dBFS). 기본 -1 */
  peakDb?: number;
  /** 말 시작 앞에 남기는 여백(ms). 기본 30 */
  headMs?: number;
  /** 말 끝 뒤에 남기는 여백(ms). 기본 110 — 끝소리와 숨이 잘리지 않게 넉넉히 */
  tailMs?: number;
  /** 페이드 인/아웃(ms). 기본 8 / 12 */
  fadeInMs?: number;
  fadeOutMs?: number;
  /** false 면 길이를 건드리지 않는다 */
  trim?: boolean;
}

/** 소리가 있는 구간 [start, end) 을 찾는다. 전부 무음이면 null */
function findSpeechBounds(x: Float32Array, sampleRate: number): { start: number; end: number } | null {
  const frame = Math.max(1, Math.round(sampleRate * 0.01));
  const fr = frameRms(x, frame);
  let max = 0;
  for (let i = 0; i < fr.length; i++) if (fr[i] > max) max = fr[i];
  if (max < 1e-5) return null;
  // 가장 큰 프레임보다 45dB 작은 소리까지는 말의 일부로 본다(숨소리, 약한 자음)
  const gate = Math.max(max * fromDb(-45), 1e-5);
  let first = 0;
  while (first < fr.length && fr[first] < gate) first++;
  let last = fr.length - 1;
  while (last > first && fr[last] < gate) last--;
  return { start: first * frame, end: Math.min(x.length, (last + 1) * frame) };
}

/**
 * 모델이 낸 소리를 듣기 좋게 다듬는다. 입력은 바꾸지 않고 새 버퍼를 돌려준다.
 * - 앞뒤 무음을 잘라 내되 짧은 여백은 남긴다
 * - 말하는 구간 기준으로 음량을 맞춘다(쉬는 구간 길이에 흔들리지 않는다)
 * - 피크는 미리보기 리미터로 한계 아래에 둔다(잘라서 찌그러뜨리지 않는다)
 * - 양 끝을 짧게 페이드해 '딱' 소리를 없앤다
 */
export function finishSpeech(a: PcmAudio, opts: FinishOptions = {}): PcmAudio {
  const sampleRate = a.sampleRate;
  const targetRms = fromDb(opts.targetRmsDb ?? -18);
  const ceiling = fromDb(opts.peakDb ?? -1);

  // 숫자가 아닌 값이 섞여 있으면 0 으로
  let x = new Float32Array(a.samples.length);
  for (let i = 0; i < x.length; i++) x[i] = Number.isFinite(a.samples[i]) ? a.samples[i] : 0;
  if (x.length === 0) return { samples: x, sampleRate };

  if (opts.trim !== false) {
    const bounds = findSpeechBounds(x, sampleRate);
    if (bounds) {
      const head = Math.round(((opts.headMs ?? 30) / 1000) * sampleRate);
      const tail = Math.round(((opts.tailMs ?? 110) / 1000) * sampleRate);
      const start = Math.max(0, bounds.start - head);
      const end = Math.min(x.length, bounds.end + tail);
      x = x.slice(start, end);
    }
  }

  const level = activeRms(x, sampleRate);
  if (level > 1e-5) {
    // 거의 무음인 입력을 잡음까지 끌어올리지 않게 증폭은 +30dB 까지만
    const gain = Math.min(targetRms / level, fromDb(30));
    for (let i = 0; i < x.length; i++) x[i] *= gain;
    x = limitPeaks(x, sampleRate, ceiling);
  }

  const fadeIn = Math.min(Math.round(((opts.fadeInMs ?? 8) / 1000) * sampleRate), x.length >> 1);
  const fadeOut = Math.min(Math.round(((opts.fadeOutMs ?? 12) / 1000) * sampleRate), x.length >> 1);
  for (let i = 0; i < fadeIn; i++) x[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
  for (let i = 0; i < fadeOut; i++) x[x.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut);

  return { samples: x, sampleRate };
}
