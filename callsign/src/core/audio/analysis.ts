// 소리를 숫자로 재는 순수 함수들. 테스트와 목소리 튜닝에 쓴다. Node 에서도 돈다.
import type { PcmAudio } from '../types.ts';

type Samples = PcmAudio | Float32Array;

function samplesOf(a: Samples): Float32Array {
  return a instanceof Float32Array ? a : a.samples;
}

/** 진폭 → dBFS. 0 이하는 -Infinity */
export function toDb(x: number): number {
  return x > 0 ? 20 * Math.log10(x) : -Infinity;
}

/** dB → 진폭 배율 */
export function fromDb(db: number): number {
  return Math.pow(10, db / 20);
}

/** 전체 구간의 RMS (0..1) */
export function rms(a: Samples): number {
  const x = samplesOf(a);
  if (x.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / x.length);
}

/** 절대값 최대 */
export function peak(a: Samples): number {
  const x = samplesOf(a);
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] < 0 ? -x[i] : x[i];
    if (v > p) p = v;
  }
  return p;
}

/** 프레임별 RMS. 마지막에 남는 자투리도 한 프레임으로 센다 */
export function frameRms(x: Float32Array, frame: number, hop: number = frame): Float32Array {
  if (x.length === 0 || frame <= 0) return new Float32Array(0);
  const count = Math.max(1, Math.ceil((x.length - frame) / hop) + 1);
  const out = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    const start = f * hop;
    const end = Math.min(x.length, start + frame);
    let sum = 0;
    for (let i = start; i < end; i++) sum += x[i] * x[i];
    out[f] = end > start ? Math.sqrt(sum / (end - start)) : 0;
  }
  return out;
}

/**
 * 말하는 구간만의 RMS. 쉬는 구간이 길어도 값이 흔들리지 않는다.
 * 50ms 프레임 중 가장 큰 프레임보다 40dB 넘게 작은 것을 버리고, 남은 것의 평균보다 10dB 넘게 작은 것을 한 번 더 버린다.
 */
export function activeRms(a: Samples, sampleRate?: number): number {
  const x = samplesOf(a);
  const sr = sampleRate ?? (a instanceof Float32Array ? 44100 : a.sampleRate);
  const frame = Math.max(1, Math.round(sr * 0.05));
  const fr = frameRms(x, frame);
  let max = 0;
  for (let i = 0; i < fr.length; i++) if (fr[i] > max) max = fr[i];
  if (max <= 0) return 0;
  const gate1 = max * 0.01;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < fr.length; i++) {
    if (fr[i] > gate1) {
      sum += fr[i] * fr[i];
      n++;
    }
  }
  if (n === 0) return 0;
  const gate2 = Math.sqrt(sum / n) * fromDb(-10);
  sum = 0;
  n = 0;
  for (let i = 0; i < fr.length; i++) {
    if (fr[i] > gate1 && fr[i] > gate2) {
      sum += fr[i] * fr[i];
      n++;
    }
  }
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

/** 길이가 같은 앞부분끼리의 상관계수(-1..1) */
export function correlation(x: Float32Array, y: Float32Array): number {
  const n = Math.min(x.length, y.length);
  if (n === 0) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const d = Math.sqrt(sxx * syy);
  return d > 0 ? sxy / d : 0;
}

/** y 를 얼마나 밀어야 x 와 가장 잘 맞는지. lag > 0 이면 y 가 x 보다 그만큼 늦다 */
export function bestLag(x: Float32Array, y: Float32Array, maxLag: number): { lag: number; corr: number } {
  let best = { lag: 0, corr: -Infinity };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const xs = lag < 0 ? -lag : 0;
    const ys = lag > 0 ? lag : 0;
    const n = Math.min(x.length - xs, y.length - ys);
    if (n <= 16) continue;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i++) {
      const a = x[xs + i];
      const b = y[ys + i];
      sxy += a * b;
      sxx += a * a;
      syy += b * b;
    }
    const d = Math.sqrt(sxx * syy);
    const c = d > 0 ? sxy / d : 0;
    if (c > best.corr) best = { lag, corr: c };
  }
  return best;
}

// ───────────────────────── 기본 주파수(F0) ─────────────────────────

export interface F0Options {
  /** 찾을 범위(Hz). 기본 60~500 */
  minHz?: number;
  maxHz?: number;
}

/** 프레임별 F0(Hz). 유성음으로 판단한 프레임만 담는다 */
export function f0Frames(a: PcmAudio, opts: F0Options = {}): Float32Array {
  const minHz = opts.minHz ?? 60;
  const maxHz = opts.maxHz ?? 500;
  const src = a.samples;
  if (src.length === 0 || !(a.sampleRate > 0)) return new Float32Array(0);

  // 계산량을 줄이려고 12kHz 근처로 낮춘다(구간 평균이 저역 통과 필터 노릇을 한다)
  const factor = Math.max(1, Math.round(a.sampleRate / 12000));
  const sr = a.sampleRate / factor;
  const n = Math.floor(src.length / factor);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const base = i * factor;
    for (let k = 0; k < factor; k++) s += src[base + k];
    x[i] = s / factor;
  }

  const tauMax = Math.min(Math.ceil(sr / minHz), Math.floor(n / 2) - 1);
  const tauMin = Math.max(2, Math.floor(sr / maxHz));
  if (tauMax <= tauMin + 1) return new Float32Array(0);
  const win = Math.max(tauMax, Math.round(sr * 0.025));
  const frameLen = win + tauMax + 1;
  const hop = Math.max(1, Math.round(sr * 0.01));
  if (n < frameLen) return new Float32Array(0);

  // 에너지 문턱: 가장 큰 프레임의 -30dB
  const frameCount = Math.floor((n - frameLen) / hop) + 1;
  const energy = new Float32Array(frameCount);
  let maxEnergy = 0;
  for (let f = 0; f < frameCount; f++) {
    let s = 0;
    const st = f * hop;
    for (let i = 0; i < win; i++) s += x[st + i] * x[st + i];
    energy[f] = s / win;
    if (energy[f] > maxEnergy) maxEnergy = energy[f];
  }
  if (maxEnergy <= 0) return new Float32Array(0);
  const energyGate = maxEnergy * 1e-3;

  const d = new Float32Array(tauMax + 2);
  const out: number[] = [];
  for (let f = 0; f < frameCount; f++) {
    if (energy[f] < energyGate) continue;
    const st = f * hop;
    // YIN: 차이 함수와 누적 평균 정규화
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let s = 0;
      for (let i = 0; i < win; i++) {
        const diff = x[st + i] - x[st + i + tau];
        s += diff * diff;
      }
      running += s;
      d[tau] = running > 0 ? (s * tau) / running : 1;
    }
    // 문턱 아래로 처음 내려간 골짜기를 고른다(배음에 속지 않게)
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < 0.15) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      let best = tauMin;
      for (let t = tauMin + 1; t <= tauMax; t++) if (d[t] < d[best]) best = t;
      if (d[best] > 0.3) continue; // 주기성이 약하다 → 무성음
      tau = best;
    }
    // 포물선 보간으로 소수점 아래 주기까지
    let refined = tau;
    if (tau > 1 && tau < tauMax + 1) {
      const y0 = d[tau - 1];
      const y1 = d[tau];
      const y2 = d[tau + 1];
      const denom = y0 - 2 * y1 + y2;
      if (denom > 1e-12) refined = tau + (0.5 * (y0 - y2)) / denom;
    }
    const hz = sr / refined;
    if (hz >= minHz && hz <= maxHz) out.push(hz);
  }
  return Float32Array.from(out);
}

/** 유성음 프레임 F0 의 중앙값(Hz). 못 찾으면 0 */
export function estimateF0(a: PcmAudio, opts: F0Options = {}): number {
  const frames = f0Frames(a, opts);
  if (frames.length === 0) return 0;
  const sorted = Float32Array.from(frames).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ───────────────────────── 스펙트럼 ─────────────────────────

/** 제자리 radix-2 FFT. 길이는 2의 거듭제곱 */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * 평균 파워 스펙트럼(Welch, Hann 창). 전 대역을 더하면 신호의 평균 제곱(RMS²)이 된다.
 * 반환 배열의 k 번째 값은 주파수 k * sampleRate / size 의 파워.
 */
export function powerSpectrum(a: PcmAudio, size = 2048): Float32Array {
  const x = a.samples;
  const half = size >> 1;
  const acc = new Float64Array(half + 1);
  const win = new Float32Array(size);
  let winPower = 0;
  for (let i = 0; i < size; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
    winPower += win[i] * win[i];
  }
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const hop = half;
  let frames = 0;
  for (let st = 0; st + size <= x.length || frames === 0; st += hop) {
    for (let i = 0; i < size; i++) {
      re[i] = (st + i < x.length ? x[st + i] : 0) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= half; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      acc[k] += k === 0 || k === half ? p : 2 * p;
    }
    frames++;
    if (st + size >= x.length) break;
  }
  const out = new Float32Array(half + 1);
  const norm = 1 / (frames * size * winPower);
  for (let k = 0; k <= half; k++) out[k] = acc[k] * norm;
  return out;
}

/** 주파수 대역 안의 레벨(dBFS RMS). 효과 전후 비교용 */
export function bandLevelDb(a: PcmAudio, loHz: number, hiHz: number, size = 2048): number {
  const spec = powerSpectrum(a, size);
  const binHz = a.sampleRate / size;
  const lo = Math.max(0, Math.ceil(loHz / binHz));
  const hi = Math.min(spec.length - 1, Math.floor(hiHz / binHz));
  let sum = 0;
  for (let k = lo; k <= hi; k++) sum += spec[k];
  return sum > 0 ? 10 * Math.log10(sum) : -Infinity;
}
