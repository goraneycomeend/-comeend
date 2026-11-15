import { describe, expect, it } from 'vitest';
import { NEUTRAL_FX, estimateF0, peak, renderVoice, rms, shiftPitch, toDb } from '../src/core/audio/index.ts';
import type { PcmAudio } from '../src/core/types.ts';

// 피치·포먼트 처리는 오디오 컨텍스트 없이 도는 계산이라 Node 에서도 확인할 수 있다.
// (울림·메아리 같은 나머지 효과는 Web Audio 가 필요해서 e2e/audio.spec.ts 에서 본다)

const SR = 44100;

function saw(hz: number, seconds: number, amp = 0.3): PcmAudio {
  const n = Math.round(seconds * SR);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let h = 1; h <= 20; h++) v += Math.sin((2 * Math.PI * hz * h * i) / SR) / h;
    samples[i] = amp * 0.6 * v;
  }
  return { samples, sampleRate: SR };
}

describe('피치·포먼트 이동 (Node)', () => {
  const input = saw(150, 1.2);

  it('+4 반음이면 F0 가 약 1.26배, 길이는 그대로', async () => {
    const out = await shiftPitch(input, 4, 0);
    expect(out.samples.length).toBe(input.samples.length);
    expect(out.sampleRate).toBe(SR);
    const ratio = estimateF0(out) / estimateF0(input);
    expect(ratio).toBeGreaterThan(1.26 * 0.96);
    expect(ratio).toBeLessThan(1.26 * 1.04);
    for (const v of out.samples) expect(Number.isFinite(v)).toBe(true);
  });

  it('-5 반음이면 F0 가 약 0.75배', async () => {
    const out = await shiftPitch(input, -5, 0);
    const ratio = estimateF0(out) / estimateF0(input);
    expect(Math.abs(ratio - Math.pow(2, -5 / 12))).toBeLessThan(0.03);
  });

  it('포먼트만 옮기면 음높이는 그대로', async () => {
    const out = await shiftPitch(input, 0, 3);
    expect(Math.abs(estimateF0(out) / estimateF0(input) - 1)).toBeLessThan(0.02);
    expect(Math.abs(toDb(rms(out)) - toDb(rms(input)))).toBeLessThan(3);
  });

  it('같은 입력이면 몇 번을 돌려도 같은 결과(사이에 다른 작업이 끼어도)', async () => {
    const a = await shiftPitch(input, 2, -1);
    await shiftPitch(saw(220, 0.5), -7, 2);
    const b = await shiftPitch(input, 2, -1);
    let maxDiff = 0;
    for (let i = 0; i < a.samples.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a.samples[i] - b.samples[i]));
    expect(maxDiff).toBe(0);
  });

  it('renderVoice: 피치만 걸린 요청은 Web Audio 없이도 처리되고 피크를 지킨다', async () => {
    const loud = saw(150, 0.8, 1.4);
    const out = await renderVoice(loud, { ...NEUTRAL_FX, pitch: 1.5, formant: 1 });
    expect(out.samples.length).toBe(loud.samples.length);
    expect(peak(out)).toBeLessThanOrEqual(0.891 + 1e-6);
  });

  it('renderVoice: 전부 0 이면 입력과 똑같은 복사본', async () => {
    const out = await renderVoice(input, NEUTRAL_FX);
    expect(out.samples).not.toBe(input.samples);
    expect(Array.from(out.samples.subarray(0, 2000))).toEqual(Array.from(input.samples.subarray(0, 2000)));
    expect(out.samples.length).toBe(input.samples.length);
  });
});
