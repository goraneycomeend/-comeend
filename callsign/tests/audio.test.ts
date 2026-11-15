import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  FX_PARAMS,
  NATURAL_FX_LIMITS,
  NEUTRAL_FX,
  activeRms,
  bandLevelDb,
  clampFx,
  correlation,
  decodeWav,
  encodeMp3,
  encodeMp3Bytes,
  encodeWav,
  encodeWavBytes,
  estimateF0,
  finishSpeech,
  formatFxValue,
  fromDb,
  fxTailSec,
  isNaturalFx,
  isNeutralFx,
  limitPeaks,
  peak,
  resample,
  rms,
  toDb,
  toNaturalFx,
} from '../src/core/audio/index.ts';
import { compressorAutoMakeupDb, makeRoomImpulse } from '../src/core/audio/fxGraph.ts';
import type { PcmAudio, VoiceFx } from '../src/core/types.ts';
import { MicError, toMicError } from '../src/engine/micChanger.ts';

const SR = 44100;

function sine(hz: number, seconds: number, amp = 0.3, sampleRate = SR): PcmAudio {
  const n = Math.round(seconds * sampleRate);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return { samples, sampleRate };
}

function saw(hz: number, seconds: number, amp = 0.3, sampleRate = SR): PcmAudio {
  const n = Math.round(seconds * sampleRate);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let h = 1; h <= 20 && h * hz < sampleRate / 2; h++) v += Math.sin((2 * Math.PI * hz * h * i) / sampleRate) / h;
    samples[i] = amp * 0.6 * v;
  }
  return { samples, sampleRate };
}

function silence(seconds: number, sampleRate = SR): PcmAudio {
  return { samples: new Float32Array(Math.round(seconds * sampleRate)), sampleRate };
}

function concat(...parts: PcmAudio[]): PcmAudio {
  const total = parts.reduce((s, p) => s + p.samples.length, 0);
  const samples = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    samples.set(p.samples, at);
    at += p.samples.length;
  }
  return { samples, sampleRate: parts[0].sampleRate };
}

/** 시드 고정 잡음 */
function noise(seconds: number, amp = 0.3, sampleRate = SR): PcmAudio {
  const n = Math.round(seconds * sampleRate);
  const samples = new Float32Array(n);
  let s = 1234567;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    samples[i] = amp * ((s / 4294967296) * 2 - 1);
  }
  return { samples, sampleRate };
}

const seconds = (a: PcmAudio): number => a.samples.length / a.sampleRate;

describe('효과 값 정의', () => {
  const keys: Array<keyof VoiceFx> = ['pitch', 'formant', 'warmth', 'presence', 'air', 'punch', 'room', 'radio', 'echo', 'doubler', 'robot', 'gainDb'];

  it('FX_PARAMS 가 VoiceFx 의 모든 키를 한 번씩 다룬다', () => {
    expect(FX_PARAMS.map((p) => p.key).sort()).toEqual([...keys].sort());
    for (const p of FX_PARAMS) {
      expect(p.min).toBeLessThan(p.max);
      expect(p.step).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.naturalMin).toBeGreaterThanOrEqual(p.min);
      expect(p.naturalMax).toBeLessThanOrEqual(p.max);
      expect(p.min <= 0 && p.max >= 0).toBe(true);
    }
  });

  it('NEUTRAL_FX 는 전부 0 이고 중립으로 판정된다', () => {
    for (const k of keys) expect(NEUTRAL_FX[k]).toBe(0);
    expect(isNeutralFx(NEUTRAL_FX)).toBe(true);
    expect(isNeutralFx({ ...NEUTRAL_FX, room: 0.05 })).toBe(false);
    expect(isNeutralFx({ ...NEUTRAL_FX, pitch: -0.5 })).toBe(false);
  });

  it('clampFx 는 빠진 값·이상한 값을 0 으로, 범위를 넘는 값은 끝값으로 맞추고 입력은 건드리지 않는다', () => {
    const input = { pitch: 99, formant: -99, warmth: Number.NaN, room: 2, robot: -1, gainDb: Infinity } as Partial<VoiceFx>;
    const frozen = { ...input };
    const c = clampFx(input);
    expect(c).toEqual({ ...NEUTRAL_FX, pitch: 12, formant: -6, room: 1 });
    expect(input).toEqual(frozen);
    expect(clampFx(null)).toEqual(NEUTRAL_FX);
    expect(clampFx({ pitch: '3' as unknown as number })).toEqual(NEUTRAL_FX);
  });

  it('자연스러움 범위는 설계서의 로스터 규칙과 같다', () => {
    expect(NATURAL_FX_LIMITS.pitch).toEqual({ min: -1.5, max: 1.5 });
    expect(NATURAL_FX_LIMITS.formant).toEqual({ min: -1, max: 1 });
    expect(NATURAL_FX_LIMITS.room).toEqual({ min: 0, max: 0.25 });
    expect(NATURAL_FX_LIMITS.echo).toEqual({ min: 0, max: 0.1 });
    expect(NATURAL_FX_LIMITS.radio).toEqual({ min: 0, max: 0 });
    expect(NATURAL_FX_LIMITS.robot).toEqual({ min: 0, max: 0 });

    expect(isNaturalFx(NEUTRAL_FX)).toBe(true);
    expect(isNaturalFx({ ...NEUTRAL_FX, pitch: 1.5, formant: -1, room: 0.25, echo: 0.1, warmth: 0.3 })).toBe(true);
    expect(isNaturalFx({ ...NEUTRAL_FX, pitch: 1.6 })).toBe(false);
    expect(isNaturalFx({ ...NEUTRAL_FX, radio: 0.1 })).toBe(false);
    expect(isNaturalFx({ ...NEUTRAL_FX, robot: 0.1 })).toBe(false);
    expect(isNaturalFx({ ...NEUTRAL_FX, room: 0.3 })).toBe(false);
    expect(isNaturalFx({ ...NEUTRAL_FX, echo: 0.2 })).toBe(false);

    const wild: VoiceFx = { pitch: 7, formant: -4, warmth: 1, presence: -1, air: 1, punch: 1, room: 1, radio: 1, echo: 1, doubler: 1, robot: 1, gainDb: 12 };
    const tamed = toNaturalFx(wild);
    expect(isNaturalFx(tamed)).toBe(true);
    expect(tamed.pitch).toBe(1.5);
    expect(tamed.formant).toBe(-1);
    expect(tamed.radio).toBe(0);
    expect(tamed.robot).toBe(0);
  });

  it('값 표시 문자열', () => {
    const def = (key: keyof VoiceFx) => FX_PARAMS.find((p) => p.key === key)!;
    expect(formatFxValue(def('pitch'), 1.5)).toBe('+1.5반음');
    expect(formatFxValue(def('pitch'), -2)).toBe('-2반음');
    expect(formatFxValue(def('room'), 0.25)).toBe('0.25');
    expect(formatFxValue(def('gainDb'), 0)).toBe('0dB');
  });
});

describe('측정 함수', () => {
  it('rms 와 peak', () => {
    const a = sine(440, 1, 0.5);
    expect(rms(a)).toBeCloseTo(0.5 / Math.SQRT2, 3);
    expect(peak(a)).toBeCloseTo(0.5, 3);
    expect(rms(silence(0.1))).toBe(0);
    expect(peak({ samples: new Float32Array(0), sampleRate: SR })).toBe(0);
    expect(toDb(fromDb(-18))).toBeCloseTo(-18, 6);
  });

  it('activeRms 는 쉬는 구간이 길어도 말하는 구간의 크기를 낸다', () => {
    const talk = sine(200, 0.5, 0.2);
    const withPauses = concat(silence(0.4), talk, silence(1.5), talk, silence(0.6));
    expect(activeRms(withPauses)).toBeCloseTo(0.2 / Math.SQRT2, 2);
    expect(rms(withPauses)).toBeLessThan(activeRms(withPauses) * 0.7);
  });

  it('사인파의 F0 를 1% 안으로 맞춘다', () => {
    for (const hz of [90, 110, 220, 330, 440]) {
      const est = estimateF0(sine(hz, 0.6));
      expect(Math.abs(est - hz) / hz).toBeLessThan(0.01);
    }
  });

  it('톱니파(배음이 많은 소리)에서도 기본음을 고른다', () => {
    for (const hz of [100, 150, 210]) {
      const est = estimateF0(saw(hz, 0.6));
      expect(Math.abs(est - hz) / hz).toBeLessThan(0.01);
    }
  });

  it('48kHz 입력에서도 같다', () => {
    const est = estimateF0(saw(180, 0.6, 0.3, 48000));
    expect(Math.abs(est - 180) / 180).toBeLessThan(0.01);
  });

  it('무음과 잡음에서는 0', () => {
    expect(estimateF0(silence(0.5))).toBe(0);
    expect(estimateF0(noise(0.5))).toBe(0);
    expect(estimateF0({ samples: new Float32Array(10), sampleRate: SR })).toBe(0);
  });

  it('대역 레벨: 사인파는 자기 대역에만 있다', () => {
    const a = sine(1000, 1, 0.5);
    expect(bandLevelDb(a, 800, 1200)).toBeCloseTo(toDb(0.5 / Math.SQRT2), 0);
    expect(bandLevelDb(a, 4000, 8000)).toBeLessThan(-80);
  });

  it('correlation', () => {
    const a = sine(300, 0.2);
    const inverted = { samples: a.samples.map((v) => -v), sampleRate: SR };
    expect(correlation(a.samples, a.samples)).toBeCloseTo(1, 6);
    expect(correlation(a.samples, inverted.samples)).toBeCloseTo(-1, 6);
  });
});

describe('limitPeaks', () => {
  it('한계 아래면 그대로 돌려준다(복사본)', () => {
    const a = sine(200, 0.2, 0.5);
    const out = limitPeaks(a.samples, SR, 0.891);
    expect(out).not.toBe(a.samples);
    expect(Array.from(out)).toEqual(Array.from(a.samples));
  });

  it('넘는 곳만 누르고, 어떤 샘플도 한계를 넘지 않는다', () => {
    const a = sine(200, 1, 0.3);
    // 0.5초 지점에 큰 피크 구간
    for (let i = 22050; i < 22050 + 400; i++) a.samples[i] *= 6;
    const out = limitPeaks(a.samples, SR, 0.891);
    expect(peak(out)).toBeLessThanOrEqual(0.891 + 1e-6);
    // 피크에서 멀리 떨어진 곳은 건드리지 않는다
    for (let i = 0; i < 4410; i++) expect(out[i]).toBeCloseTo(a.samples[i], 6);
    for (let i = SR - 4410; i < SR; i++) expect(Math.abs(out[i] - a.samples[i])).toBeLessThan(0.02);
    // 피크 직전까지 급하게 꺾이지 않는다: 연속한 샘플의 게인 차이가 작다
    let maxStep = 0;
    let prev = 1;
    for (let i = 21000; i < 23500; i++) {
      if (Math.abs(a.samples[i]) < 0.05) continue;
      const g = out[i] / a.samples[i];
      maxStep = Math.max(maxStep, Math.abs(g - prev));
      prev = g;
    }
    expect(maxStep).toBeLessThan(0.05);
  });

  it('NaN 이 섞여 있어도 유한한 값만 낸다', () => {
    const x = new Float32Array([0.1, Number.NaN, 2, -3, Infinity, 0.2]);
    const out = limitPeaks(x, SR, 0.5);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
    expect(peak(out)).toBeLessThanOrEqual(0.5 + 1e-6);
  });
});

describe('finishSpeech', () => {
  it('앞뒤 무음을 자르고 짧은 여백만 남긴다', () => {
    const input = concat(silence(0.35), sine(180, 1.0, 0.05), silence(0.45));
    const out = finishSpeech(input);
    // 말 1초 + 앞 30ms + 뒤 110ms (프레임 단위 오차 ±25ms)
    expect(seconds(out)).toBeGreaterThan(1.1);
    expect(seconds(out)).toBeLessThan(1.19);
    expect(out.sampleRate).toBe(SR);
  });

  it('말하는 구간의 음량을 -18dBFS RMS 로 맞춘다(입력 크기와 무관)', () => {
    for (const amp of [0.01, 0.05, 0.6]) {
      const input = concat(silence(0.2), sine(200, 0.6, amp), silence(0.5), sine(240, 0.6, amp), silence(0.2));
      const out = finishSpeech(input);
      expect(toDb(activeRms(out))).toBeGreaterThan(-18.6);
      expect(toDb(activeRms(out))).toBeLessThan(-17.4);
    }
  });

  it('거의 무음인 입력은 +30dB 까지만 키운다(잡음을 끌어올리지 않는다)', () => {
    const input = concat(silence(0.1), sine(200, 0.6, 0.0005), silence(0.1));
    const out = finishSpeech(input);
    const gainDb = toDb(peak(out)) - toDb(peak(input));
    expect(gainDb).toBeGreaterThan(29);
    expect(gainDb).toBeLessThan(30.1);
  });

  it('피크는 -1dBFS 를 넘지 않고, 잘라 내지 않는다(클리핑 없음)', () => {
    // 조용한 말 사이에 튀는 소리가 있는 입력: 음량을 맞추면 피크가 한계를 넘는다
    const input = concat(silence(0.1), sine(200, 1.2, 0.03), silence(0.1));
    for (let i = 20000; i < 20200; i++) input.samples[i] *= 14;
    const out = finishSpeech(input);
    const ceiling = fromDb(-1);
    expect(peak(out)).toBeLessThanOrEqual(ceiling + 1e-6);
    // 한계값에 붙어 있는 샘플이 길게 이어지면 잘린 것이다
    let flat = 0;
    let longest = 0;
    for (const v of out.samples) {
      flat = Math.abs(Math.abs(v) - ceiling) < 1e-4 ? flat + 1 : 0;
      longest = Math.max(longest, flat);
    }
    expect(longest).toBeLessThan(4);
  });

  it('양 끝이 0 에서 시작하고 0 으로 끝난다(5~15ms 페이드)', () => {
    const out = finishSpeech(noise(1.0, 0.2));
    expect(Math.abs(out.samples[0])).toBeLessThan(1e-4);
    expect(Math.abs(out.samples[out.samples.length - 1])).toBeLessThan(1e-3);
    const edge = (from: number, to: number): number => peak(out.samples.subarray(from, to));
    const body = rms(out.samples.subarray(SR * 0.3, SR * 0.6));
    // 1ms 안쪽은 거의 무음, 15ms 를 지나면 본래 크기
    expect(edge(0, 44)).toBeLessThan(body * 0.3);
    expect(rms(out.samples.subarray(Math.round(SR * 0.015), Math.round(SR * 0.05)))).toBeGreaterThan(body * 0.8);
    expect(edge(out.samples.length - 44, out.samples.length)).toBeLessThan(body * 0.3);
  });

  it('입력을 바꾸지 않고, 숫자가 아닌 값은 걸러 낸다', () => {
    const input = concat(silence(0.1), sine(220, 0.5, 0.1), silence(0.1));
    input.samples[9000] = Number.NaN;
    input.samples[9001] = Infinity;
    const copy = input.samples.slice();
    const out = finishSpeech(input);
    expect(Array.from(input.samples.subarray(0, 100))).toEqual(Array.from(copy.subarray(0, 100)));
    expect(Number.isNaN(input.samples[9000])).toBe(true);
    for (const v of out.samples) expect(Number.isFinite(v)).toBe(true);
  });

  it('무음이나 빈 입력에서도 NaN 없이 돌아온다', () => {
    const quiet = finishSpeech(silence(0.5));
    expect(quiet.samples.length).toBe(Math.round(0.5 * SR));
    expect(peak(quiet)).toBe(0);
    const empty = finishSpeech({ samples: new Float32Array(0), sampleRate: SR });
    expect(empty.samples.length).toBe(0);
  });

  it('두 번 돌려도 결과가 거의 같다', () => {
    const once = finishSpeech(concat(silence(0.3), saw(140, 0.8, 0.1), silence(0.3)));
    const twice = finishSpeech(once);
    expect(Math.abs(seconds(twice) - seconds(once))).toBeLessThan(0.03);
    expect(Math.abs(toDb(activeRms(twice)) - toDb(activeRms(once)))).toBeLessThan(0.3);
  });

  it('trim: false 면 길이를 그대로 둔다', () => {
    const input = concat(silence(0.3), sine(200, 0.5, 0.1), silence(0.3));
    expect(finishSpeech(input, { trim: false }).samples.length).toBe(input.samples.length);
  });
});

describe('WAV', () => {
  it('헤더와 길이가 16비트 모노 PCM 규격과 맞는다', () => {
    const a = sine(440, 0.25, 0.5);
    const bytes = encodeWavBytes(a);
    const n = a.samples.length;
    expect(bytes.length).toBe(44 + n * 2);
    const v = new DataView(bytes.buffer);
    const tag = (o: number): string => String.fromCharCode(...bytes.subarray(o, o + 4));
    expect(tag(0)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(36 + n * 2);
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // 모노
    expect(v.getUint32(24, true)).toBe(SR);
    expect(v.getUint32(28, true)).toBe(SR * 2);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(tag(36)).toBe('data');
    expect(v.getUint32(40, true)).toBe(n * 2);
  });

  it('쓰고 다시 읽으면 16비트 오차 안에서 같다', () => {
    const a = saw(150, 0.2, 0.4);
    const back = decodeWav(encodeWavBytes(a));
    expect(back.sampleRate).toBe(SR);
    expect(back.samples.length).toBe(a.samples.length);
    let maxErr = 0;
    for (let i = 0; i < a.samples.length; i++) maxErr = Math.max(maxErr, Math.abs(back.samples[i] - a.samples[i]));
    expect(maxErr).toBeLessThan(1 / 32000);
  });

  it('범위를 넘는 값은 끝값으로, NaN 은 0 으로 쓴다', () => {
    const bytes = encodeWavBytes({ samples: new Float32Array([2, -2, Number.NaN, 0.5]), sampleRate: 8000 });
    const v = new DataView(bytes.buffer);
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
    expect(v.getInt16(48, true)).toBe(0);
    expect(v.getInt16(50, true)).toBe(16384);
  });

  it('encodeWav 는 audio/wav Blob 을 준다', async () => {
    const a = sine(440, 0.1);
    const blob = encodeWav(a);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + a.samples.length * 2);
    const back = decodeWav(await blob.arrayBuffer());
    expect(back.samples.length).toBe(a.samples.length);
  });

  it('스테레오와 32비트 실수 WAV 도 모노로 읽는다', () => {
    const frames = 100;
    const stereo = new Uint8Array(44 + frames * 4);
    const sv = new DataView(stereo.buffer);
    const put = (bytes: Uint8Array, o: number, s: string): void => {
      for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i);
    };
    put(stereo, 0, 'RIFF');
    sv.setUint32(4, 36 + frames * 4, true);
    put(stereo, 8, 'WAVEfmt ');
    sv.setUint32(16, 16, true);
    sv.setUint16(20, 1, true);
    sv.setUint16(22, 2, true);
    sv.setUint32(24, 48000, true);
    sv.setUint32(28, 48000 * 4, true);
    sv.setUint16(32, 4, true);
    sv.setUint16(34, 16, true);
    put(stereo, 36, 'data');
    sv.setUint32(40, frames * 4, true);
    for (let i = 0; i < frames; i++) {
      sv.setInt16(44 + i * 4, 16384, true); // 왼쪽 0.5
      sv.setInt16(46 + i * 4, 0, true); // 오른쪽 0
    }
    const mono = decodeWav(stereo);
    expect(mono.sampleRate).toBe(48000);
    expect(mono.samples.length).toBe(frames);
    expect(mono.samples[10]).toBeCloseTo(0.25, 4);

    const fl = new Uint8Array(44 + 8);
    const fv = new DataView(fl.buffer);
    put(fl, 0, 'RIFF');
    fv.setUint32(4, 36 + 8, true);
    put(fl, 8, 'WAVEfmt ');
    fv.setUint32(16, 16, true);
    fv.setUint16(20, 3, true);
    fv.setUint16(22, 1, true);
    fv.setUint32(24, 44100, true);
    fv.setUint32(28, 44100 * 4, true);
    fv.setUint16(32, 4, true);
    fv.setUint16(34, 32, true);
    put(fl, 36, 'data');
    fv.setUint32(40, 8, true);
    fv.setFloat32(44, 0.75, true);
    fv.setFloat32(48, -0.5, true);
    expect(Array.from(decodeWav(fl).samples)).toEqual([0.75, -0.5]);
  });

  it('WAV 가 아니면 한국어 메시지로 알려 준다', () => {
    expect(() => decodeWav(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(/WAV 파일이 아니에요/);
  });
});

interface Mp3Frame {
  version: number;
  layer: number;
  bitrateIndex: number;
  rateIndex: number;
  padding: number;
  channelMode: number;
}

/** MP3 프레임 헤더를 차례로 따라가며 읽는다. 프레임 경계가 한 번이라도 어긋나면 null */
function walkMp3(bytes: Uint8Array, kbps: number, sampleRate: number): Mp3Frame[] | null {
  const frames: Mp3Frame[] = [];
  let pos = 0;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff || (bytes[pos + 1] & 0xe0) !== 0xe0) return null;
    const version = (bytes[pos + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2
    const layer = (bytes[pos + 1] >> 1) & 3; // 1 = Layer III
    const bitrateIndex = bytes[pos + 2] >> 4;
    const rateIndex = (bytes[pos + 2] >> 2) & 3;
    const padding = (bytes[pos + 2] >> 1) & 1;
    const channelMode = bytes[pos + 3] >> 6;
    frames.push({ version, layer, bitrateIndex, rateIndex, padding, channelMode });
    const samplesPerFrame = version === 3 ? 1152 : 576;
    const length = Math.floor(((samplesPerFrame / 8) * kbps * 1000) / sampleRate) + padding;
    pos += length;
  }
  return pos === bytes.length ? frames : null;
}

describe('MP3', () => {
  it('96kbps 모노 MPEG-1 Layer III 프레임이 끝까지 이어진다', async () => {
    const a = sine(220, 1.0, 0.4);
    const bytes = await encodeMp3Bytes(a);
    const frames = walkMp3(bytes, 96, 44100);
    expect(frames).not.toBeNull();
    const list = frames!;
    // 1초 = 38.3프레임 + 인코더 지연분
    expect(list.length).toBeGreaterThanOrEqual(39);
    expect(list.length).toBeLessThanOrEqual(42);
    for (const f of list) {
      expect(f.version).toBe(3); // MPEG-1
      expect(f.layer).toBe(1); // Layer III
      expect(f.bitrateIndex).toBe(7); // 96kbps
      expect(f.rateIndex).toBe(0); // 44.1kHz
      expect(f.channelMode).toBe(3); // 모노
    }
    // 96kbps → 초당 12,000바이트 안팎
    expect(bytes.length).toBeGreaterThan(11000);
    expect(bytes.length).toBeLessThan(14000);
  });

  it('비트레이트를 바꿀 수 있고 Blob 형식은 audio/mpeg', async () => {
    const a = sine(220, 0.5, 0.4);
    const bytes = await encodeMp3Bytes(a, 128);
    const frames = walkMp3(bytes, 128, 44100);
    expect(frames).not.toBeNull();
    expect(frames![0].bitrateIndex).toBe(9); // 128kbps
    const blob = await encodeMp3(a);
    expect(blob.type).toBe('audio/mpeg');
    expect(blob.size).toBe((await encodeMp3Bytes(a)).length);
  });

  it('MP3 규격에 없는 샘플레이트(96kHz)는 48kHz 로 바꿔 담는다', async () => {
    const bytes = await encodeMp3Bytes(sine(300, 0.5, 0.4, 96000));
    const frames = walkMp3(bytes, 96, 48000);
    expect(frames).not.toBeNull();
    expect(frames![0].rateIndex).toBe(1); // 48kHz
  });

  const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
  it.skipIf(!hasFfmpeg)('ffmpeg 로 풀면 같은 길이, 같은 음높이의 소리가 나온다', async () => {
    const a = saw(180, 1.5, 0.3);
    const bytes = await encodeMp3Bytes(a);
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-f', 'mp3', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', '44100', 'pipe:1'], {
      input: bytes,
      maxBuffer: 64 * 1024 * 1024,
    });
    const samples = new Float32Array(pcm.length / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
    const decoded: PcmAudio = { samples, sampleRate: 44100 };
    expect(Math.abs(seconds(decoded) - 1.5)).toBeLessThan(0.08);
    expect(Math.abs(estimateF0(decoded) - 180) / 180).toBeLessThan(0.01);
    expect(Math.abs(toDb(rms(decoded)) - toDb(rms(a)))).toBeLessThan(1);
  });
});

describe('resample', () => {
  it('길이는 비율대로, 음높이와 크기는 그대로', () => {
    const a = sine(440, 0.5, 0.4);
    const b = resample(a, 48000);
    expect(b.sampleRate).toBe(48000);
    expect(b.samples.length).toBe(Math.round((a.samples.length * 48000) / 44100));
    expect(Math.abs(estimateF0(b) - 440) / 440).toBeLessThan(0.01);
    expect(Math.abs(toDb(rms(b)) - toDb(rms(a)))).toBeLessThan(0.2);
  });

  it('내릴 때 새 나이퀴스트 위의 소리는 접히지 않고 사라진다', () => {
    const high = sine(30000, 0.3, 0.5, 96000);
    const down = resample(high, 48000);
    expect(rms(down)).toBeLessThan(rms(high) * 0.02);
    const low = resample(sine(1000, 0.3, 0.5, 96000), 48000);
    expect(Math.abs(toDb(rms(low)) - toDb(0.5 / Math.SQRT2))).toBeLessThan(0.2);
  });

  it('같은 샘플레이트면 복사본', () => {
    const a = sine(440, 0.1);
    const b = resample(a, SR);
    expect(b.samples).not.toBe(a.samples);
    expect(Array.from(b.samples)).toEqual(Array.from(a.samples));
  });
});

describe('효과 그래프의 계산 부분', () => {
  it('방 임펄스 응답은 에너지 1, 매번 같고, 값이 클수록 길다', () => {
    const small = makeRoomImpulse(SR, 0.1);
    const again = makeRoomImpulse(SR, 0.1);
    const big = makeRoomImpulse(SR, 1);
    const energy = (x: Float32Array): number => x.reduce((s, v) => s + v * v, 0);
    expect(energy(small)).toBeCloseTo(1, 3);
    expect(energy(big)).toBeCloseTo(1, 3);
    expect(Array.from(small)).toEqual(Array.from(again));
    expect(big.length).toBeGreaterThan(small.length * 2);
    // 작은 값에서는 0.3초 안에 끝난다(녹음실의 건조함만 지우는 정도)
    expect(makeRoomImpulse(SR, 0.25).length / SR).toBeLessThan(0.36);
  });

  it('꼬리 길이: 울림·메아리가 없으면 0, 있으면 그만큼', () => {
    expect(fxTailSec(NEUTRAL_FX)).toBe(0);
    expect(fxTailSec({ ...NEUTRAL_FX, warmth: 1, presence: 1, air: 1, gainDb: 6 })).toBe(0);
    expect(fxTailSec({ ...NEUTRAL_FX, room: 0.25 })).toBeGreaterThan(0.2);
    expect(fxTailSec({ ...NEUTRAL_FX, room: 0.25 })).toBeLessThan(0.4);
    expect(fxTailSec({ ...NEUTRAL_FX, echo: 1 })).toBeGreaterThan(fxTailSec({ ...NEUTRAL_FX, echo: 0.1 }));
    expect(fxTailSec({ ...NEUTRAL_FX, echo: 1, room: 1 })).toBeLessThanOrEqual(5);
  });

  it('컴프레서 자동 음량 보정: 비율 1 이면 0, 세게 누를수록 크다', () => {
    expect(compressorAutoMakeupDb(-20, 10, 1)).toBeCloseTo(0, 1);
    const mild = compressorAutoMakeupDb(-16, 10, 2.6);
    const hard = compressorAutoMakeupDb(-28, 10, 6);
    expect(mild).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(mild);
    // 무릎이 없으면 식으로 바로 나온다: 0.6 × (문턱 − 문턱/비율)
    expect(compressorAutoMakeupDb(-3, 0, 20)).toBeCloseTo(0.6 * (3 - 3 / 20), 2);
  });
});

describe('마이크 오류 문구', () => {
  const named = (name: string): Error => {
    const e = new Error('x');
    e.name = name;
    return e;
  };

  it('권한 거부, 장치 없음, 사용 중을 구분한다', () => {
    expect(toMicError(named('NotAllowedError')).kind).toBe('denied');
    expect(toMicError(named('SecurityError')).kind).toBe('denied');
    expect(toMicError(named('NotFoundError')).kind).toBe('no-device');
    expect(toMicError(named('OverconstrainedError')).kind).toBe('no-device');
    expect(toMicError(named('NotReadableError')).kind).toBe('busy');
    expect(toMicError(new Error('?')).kind).toBe('unknown');
    expect(toMicError('문자열').kind).toBe('unknown');
  });

  it('문구는 한국어이고, 이미 MicError 면 그대로 돌려준다', () => {
    const denied = toMicError(named('NotAllowedError'));
    expect(denied).toBeInstanceOf(MicError);
    expect(denied.message).toMatch(/마이크/);
    expect(denied.message).toMatch(/허용/);
    expect(toMicError(named('NotFoundError')).message).toMatch(/찾지 못했어요/);
    const same = new MicError('busy', '테스트');
    expect(toMicError(same)).toBe(same);
  });
});
