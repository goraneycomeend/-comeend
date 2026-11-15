// VoiceFx → Web Audio 그래프. 같은 빌더가 AudioContext(실시간)와 OfflineAudioContext(렌더) 양쪽에서 돈다.
// 값이 0 인 효과는 노드를 아예 만들지 않는다. 전부 0 이면 입력이 그대로 출력으로 이어진다.
import type { VoiceFx } from '../types.ts';
import { fromDb } from './analysis.ts';
import { FX_EPS, clampFx } from './fxSchema.ts';
import { seededGaussian, seededRandom } from './prng.ts';

export interface FxGraphOptions {
  /**
   * 'node' — 그래프 끝에 리미터 노드를 둔다(실시간용).
   * 'none' — 두지 않는다. 오프라인 렌더는 결과에 순수 함수 리미터(limitPeaks)를 따로 건다.
   */
  safety?: 'node' | 'none';
}

export interface FxGraph {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** 그래프 안에서 생기는 지연(초). 컴프레서·리미터의 미리보기 */
  readonly latencySec: number;
  update(fx: VoiceFx): void;
  dispose(): void;
}

interface Stage {
  readonly input: AudioNode;
  readonly output: AudioNode;
  readonly latencySec: number;
  apply(fx: VoiceFx, immediate: boolean): void;
  dispose(): void;
}

type StageKey = 'warmth' | 'presence' | 'air' | 'punch' | 'robot' | 'doubler' | 'room' | 'radio' | 'echo' | 'gain' | 'safety';

/** 신호가 지나가는 순서. 방 울림이 무전기보다 앞이다(방에서 말한 소리를 무전기가 잡는다) */
const STAGE_ORDER: StageKey[] = ['warmth', 'presence', 'air', 'punch', 'robot', 'doubler', 'room', 'radio', 'echo', 'gain', 'safety'];

/** DynamicsCompressorNode 의 미리보기 지연(초) */
const COMPRESSOR_LOOKAHEAD_SEC = 0.006;

// ───────────────────────── 값 → 물리량 매핑 ─────────────────────────
// 0.25 이하에서는 '처리한 티'가 나지 않게 잡았다. 큰 값은 체인저와 랩에서만 쓴다.

/** 온기: 250Hz 아래 선반 ±5dB (0.25 → 1.25dB) */
const warmthDb = (fx: VoiceFx): number => fx.warmth * 5;
/** 또렷함: 3kHz 종 모양 ±5dB */
const presenceDb = (fx: VoiceFx): number => fx.presence * 5;
/** 공기감: 8kHz 위 선반 ±6dB */
const airDb = (fx: VoiceFx): number => fx.air * 6;

const punchThresholdDb = (p: number): number => -12 - 16 * p;
const punchRatio = (p: number): number => 1.5 + 4.5 * p;
const PUNCH_KNEE_DB = 10;
/** 눌린 만큼 되살리는 양(dB). -18dBFS 로 맞춘 실제 음성 10개로 재서, 켜기 전후의 말하는 구간 음량이 거의 같게(1 에서 +0.5dB) 맞춘 값 */
const punchLoudnessDb = (p: number): number => 7.5 * p + 4.1 * p * p;

/** 방 울림의 잔향 시간(초). 0.25 → 약 0.31초 */
export const roomRt60 = (room: number): number => 0.2 + 0.6 * Math.pow(room, 1.2);
/** 원음 대비 울림의 크기(dB). 0.1 → -24, 0.25 → -20, 1 → -7 */
const roomWetDb = (room: number): number => -7 - 20 * Math.pow(1 - room, 1.5);

const radioHighpassHz = (r: number): number => 60 * Math.pow(300 / 60, r);
const radioLowpassHz = (r: number): number => 14000 * Math.pow(3400 / 14000, r);
const radioDrive = (r: number): number => 2.2 * r;
/** 무전기는 목소리 크기를 세게 고르게 만든다(송신기의 음성 압축). 대역을 깎으면 목소리마다 음량이 달라지는 것도 이걸로 잡는다 */
const radioCompThresholdDb = (r: number): number => -14 - 18 * r;
const radioCompRatio = (r: number): number => 1 + 3 * r;
const RADIO_COMP_KNEE_DB = 6;
/** 대역을 깎고 누른 뒤의 음량 보정(dB). -18dBFS 로 맞춘 실제 음성 10개의 평균이 켜기 전과 같게 맞춘 값 */
const radioMakeupDb = (r: number): number => 11.7 * r + 4.3 * r * r;
/** 잡음 크기. 1 에서 말이 없을 때 출력 기준 약 -50dBFS */
const radioNoiseGain = (r: number): number => 0.0019 * r * r;

const echoTimeSec = (e: number): number => 0.22 + 0.1 * e;
const echoFeedback = (e: number): number => 0.2 + 0.35 * e;
const echoWet = (e: number): number => 0.6 * Math.pow(e, 1.3);

const doublerWet = (d: number): number => 0.5 * d;

const ROBOT_CARRIER_HZ = 72;

/** 실시간 리미터 설정 */
const SAFETY = { thresholdDb: -3, kneeDb: 0, ratio: 20, attack: 0.001, release: 0.1 };

/**
 * DynamicsCompressorNode 는 설정에 따라 자동으로 음량을 올린다(규격에 정해진 동작).
 * 그 양(dB)을 같은 식으로 계산해서 되돌리는 데 쓴다.
 */
export function compressorAutoMakeupDb(thresholdDb: number, kneeDb: number, ratio: number): number {
  const lin = (db: number): number => Math.pow(10, db / 20);
  const db = (x: number): number => 20 * Math.log10(x);
  const linearThreshold = lin(thresholdDb);
  const kneeThresholdDb = thresholdDb + kneeDb;
  const kneeThreshold = lin(kneeThresholdDb);
  const kneeCurve = (x: number, k: number): number =>
    x < linearThreshold ? x : linearThreshold + (1 - Math.exp(-k * (x - linearThreshold))) / k;
  const slopeAt = (x: number, k: number): number => {
    if (x < linearThreshold) return 1;
    const x2 = x * 1.001;
    return (db(kneeCurve(x2, k)) - db(kneeCurve(x, k))) / (db(x2) - db(x));
  };
  // 무릎 끝에서 기울기가 1/ratio 가 되는 k 를 이분법으로 찾는다
  let minK = 0.1;
  let maxK = 10000;
  let k = 5;
  for (let i = 0; i < 15; i++) {
    if (slopeAt(kneeThreshold, k) < 1 / ratio) maxK = k;
    else minK = k;
    k = Math.sqrt(minK * maxK);
  }
  const yKneeDb = db(kneeCurve(kneeThreshold, k));
  // 0dBFS 입력이 눌린 뒤의 크기
  const fullRange = 1 < kneeThreshold ? kneeCurve(1, k) : lin(yKneeDb + (0 - kneeThresholdDb) / ratio);
  return 0.6 * -db(fullRange);
}

/** 효과가 끝난 뒤에도 남는 소리의 길이(초). 오프라인 렌더가 이만큼 더 길게 뽑는다 */
export function fxTailSec(fx: VoiceFx): number {
  let tail = 0;
  if (fx.punch >= FX_EPS) tail += COMPRESSOR_LOOKAHEAD_SEC;
  if (fx.doubler >= FX_EPS) tail += 0.05;
  if (fx.room >= FX_EPS) tail += roomRt60(fx.room) + 0.03;
  if (fx.radio >= FX_EPS) tail += 0.01 + COMPRESSOR_LOOKAHEAD_SEC;
  if (fx.echo >= FX_EPS) {
    // 되울림이 -50dB 아래로 내려갈 때까지
    const repeats = 1 + Math.log(0.0032 / echoWet(fx.echo)) / Math.log(echoFeedback(fx.echo));
    tail += Math.max(1, repeats) * echoTimeSec(fx.echo);
  }
  return Math.min(tail, 5);
}

// ───────────────────────── 만들어 쓰는 버퍼들 ─────────────────────────

/**
 * 작은 방의 임펄스 응답. 에너지 합이 1 이 되게 맞춘다.
 * 앞쪽은 벽에서 한두 번 튕긴 초기 반사, 뒤쪽은 빠르게 사그라드는 잔향. 고역은 벽이 먹고 저역은 웅웅거리지 않게 덜어 낸다.
 */
export function makeRoomImpulse(sampleRate: number, room: number): Float32Array<ArrayBuffer> {
  const rt60 = roomRt60(room);
  const length = Math.ceil(sampleRate * (rt60 + 0.02));
  const early = new Float32Array(length);
  const late = new Float32Array(length);

  const spread = 0.8 + 0.6 * room;
  const taps: Array<[number, number]> = [
    [0.0043, 0.62], [0.0091, -0.48], [0.0137, 0.41], [0.0189, -0.33], [0.0251, 0.27], [0.0317, -0.2], [0.0389, 0.16],
  ];
  let earlyEnergy = 0;
  for (const [t, amp] of taps) {
    const at = Math.round(t * spread * sampleRate);
    if (at < length) {
      early[at] += amp;
      earlyEnergy += amp * amp;
    }
  }

  const gauss = seededGaussian(0x524f4f4d);
  const start = Math.round(0.006 * sampleRate);
  const fadeIn = Math.round(0.01 * sampleRate);
  const lowpass = 1 - Math.exp((-2 * Math.PI * 5200) / sampleRate);
  const highpass = 1 - Math.exp((-2 * Math.PI * 180) / sampleRate);
  let lp = 0;
  let hpState = 0;
  let lateEnergy = 0;
  for (let i = start; i < length; i++) {
    const t = (i - start) / sampleRate;
    const env = Math.exp((-6.9078 * t) / rt60) * Math.min(1, (i - start) / fadeIn);
    lp += lowpass * (gauss() - lp);
    hpState += highpass * (lp - hpState);
    const v = (lp - hpState) * env;
    late[i] = v;
    lateEnergy += v * v;
  }

  // 방이 클수록 잔향 쪽 비중이 커진다
  const lateTarget = earlyEnergy * (0.8 + 1.5 * room);
  const lateScale = lateEnergy > 0 ? Math.sqrt(lateTarget / lateEnergy) : 0;
  const ir = new Float32Array(length);
  let energy = 0;
  for (let i = 0; i < length; i++) {
    ir[i] = early[i] + late[i] * lateScale;
    energy += ir[i] * ir[i];
  }
  const norm = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (let i = 0; i < length; i++) ir[i] *= norm;
  return ir;
}

/**
 * 무전기 포화 곡선. 작은 소리는 그대로 두고(기울기 1) 큰 소리만 둥글게 누른다.
 * k 가 0 에 가까우면 직선이라서, 무전 값이 작을 때 음색이 튀지 않는다.
 */
function makeDriveCurve(k: number): Float32Array<ArrayBuffer> {
  const n = 2049;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = k < 1e-3 ? x : Math.tanh(k * x) / k;
  }
  return curve;
}

/** 리미터 뒤의 마지막 안전망. ±0.85 까지는 그대로, 그 위는 0.99 에 붙도록 둥글게 누른다. 입력 범위는 ±4 */
const SAFETY_RANGE = 4;
function makeSafetyCurve(): Float32Array<ArrayBuffer> {
  const n = 8193;
  const curve = new Float32Array(n);
  const knee = 0.85;
  const room = 0.99 - knee;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * SAFETY_RANGE;
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + room * Math.tanh((ax - knee) / room);
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}

function makeNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.round(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const rand = seededRandom(0x4e4f4953);
  for (let i = 0; i < length; i++) data[i] = rand() * 2 - 1;
  return buffer;
}

// ───────────────────────── 단계 ─────────────────────────

function setParam(ctx: BaseAudioContext, param: AudioParam, value: number, immediate: boolean): void {
  if (immediate) param.value = value;
  else param.setTargetAtTime(value, ctx.currentTime, 0.015);
}

function disconnectAll(nodes: AudioNode[]): void {
  for (const n of nodes) {
    try {
      n.disconnect();
    } catch {
      // 이미 끊긴 노드
    }
  }
}

function stopSource(src: AudioScheduledSourceNode): void {
  try {
    src.stop();
  } catch {
    // 이미 멈춘 소스
  }
}

function eqStage(ctx: BaseAudioContext, type: BiquadFilterType, hz: number, q: number, gainOf: (fx: VoiceFx) => number): Stage {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = hz;
  filter.Q.value = q;
  return {
    input: filter,
    output: filter,
    latencySec: 0,
    apply: (fx, immediate) => setParam(ctx, filter.gain, gainOf(fx), immediate),
    dispose: () => disconnectAll([filter]),
  };
}

function punchStage(ctx: BaseAudioContext): Stage {
  const comp = ctx.createDynamicsCompressor();
  comp.knee.value = PUNCH_KNEE_DB;
  comp.attack.value = 0.004; // 자음의 첫 타격은 살린다
  comp.release.value = 0.14;
  const makeup = ctx.createGain();
  comp.connect(makeup);
  return {
    input: comp,
    output: makeup,
    latencySec: COMPRESSOR_LOOKAHEAD_SEC,
    apply: (fx, immediate) => {
      const threshold = punchThresholdDb(fx.punch);
      const ratio = punchRatio(fx.punch);
      setParam(ctx, comp.threshold, threshold, immediate);
      setParam(ctx, comp.ratio, ratio, immediate);
      const auto = compressorAutoMakeupDb(threshold, PUNCH_KNEE_DB, ratio);
      setParam(ctx, makeup.gain, fromDb(punchLoudnessDb(fx.punch) - auto), immediate);
    },
    dispose: () => disconnectAll([comp, makeup]),
  };
}

function robotStage(ctx: BaseAudioContext): Stage {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const ring = ctx.createGain();
  ring.gain.value = 0; // 반송파가 이 게인을 흔든다 = 곱셈
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = ROBOT_CARRIER_HZ;
  const depth = ctx.createGain();
  osc.connect(depth);
  depth.connect(ring.gain);
  input.connect(dry);
  dry.connect(output);
  input.connect(ring);
  ring.connect(output);
  osc.start();
  return {
    input,
    output,
    latencySec: 0,
    apply: (fx, immediate) => {
      setParam(ctx, dry.gain, 1 - fx.robot, immediate);
      // 링 변조는 음량이 3dB 줄어서 그만큼 보탠다
      setParam(ctx, depth.gain, Math.SQRT2 * fx.robot, immediate);
    },
    dispose: () => {
      stopSource(osc);
      disconnectAll([input, dry, ring, osc, depth, output]);
    },
  };
}

function doublerStage(ctx: BaseAudioContext): Stage {
  const input = ctx.createGain();
  const output = ctx.createGain();
  input.connect(output);
  const voices: Array<{ delay: DelayNode; wet: GainNode; lfo: OscillatorNode; depth: GainNode }> = [];
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 7000;
  tone.connect(output);
  const specs: Array<[number, number, number]> = [
    [0.021, 0.31, 0.0025],
    [0.034, 0.23, 0.003],
  ];
  for (const [time, rate, swing] of specs) {
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = time;
    const wet = ctx.createGain();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const depth = ctx.createGain();
    depth.gain.value = swing;
    lfo.connect(depth);
    depth.connect(delay.delayTime);
    input.connect(delay);
    delay.connect(wet);
    wet.connect(tone);
    lfo.start();
    voices.push({ delay, wet, lfo, depth });
  }
  return {
    input,
    output,
    latencySec: 0,
    apply: (fx, immediate) => {
      for (const v of voices) setParam(ctx, v.wet.gain, doublerWet(fx.doubler), immediate);
    },
    dispose: () => {
      for (const v of voices) {
        stopSource(v.lfo);
        disconnectAll([v.delay, v.wet, v.lfo, v.depth]);
      }
      disconnectAll([input, tone, output]);
    },
  };
}

function roomStage(ctx: BaseAudioContext): Stage {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.normalize = false; // 임펄스 응답을 직접 맞췄다
  const wet = ctx.createGain();
  input.connect(output);
  input.connect(convolver);
  convolver.connect(wet);
  wet.connect(output);
  let builtFor = -1;
  return {
    input,
    output,
    latencySec: 0,
    apply: (fx, immediate) => {
      // 슬라이더를 움직일 때마다 다시 만들지 않게 0.05 단위로만 바꾼다
      const step = Math.max(0.05, Math.round(fx.room * 20) / 20);
      if (step !== builtFor) {
        const ir = makeRoomImpulse(ctx.sampleRate, step);
        const buffer = ctx.createBuffer(1, ir.length, ctx.sampleRate);
        buffer.getChannelData(0).set(ir);
        convolver.buffer = buffer;
        builtFor = step;
      }
      setParam(ctx, wet.gain, fromDb(roomWetDb(fx.room)), immediate);
    },
    dispose: () => disconnectAll([input, convolver, wet, output]),
  };
}

function radioStage(ctx: BaseAudioContext): Stage {
  const pre = ctx.createGain();
  const hp1 = ctx.createBiquadFilter();
  const hp2 = ctx.createBiquadFilter();
  const lp1 = ctx.createBiquadFilter();
  const lp2 = ctx.createBiquadFilter();
  hp1.type = 'highpass';
  hp2.type = 'highpass';
  lp1.type = 'lowpass';
  lp2.type = 'lowpass';
  // 두 개를 이어 4차 버터워스로 만든다(Q 는 dB 단위)
  hp1.Q.value = -5.3;
  hp2.Q.value = 2.3;
  lp1.Q.value = -5.3;
  lp2.Q.value = 2.3;
  const shaper = ctx.createWaveShaper();
  const honk = ctx.createBiquadFilter();
  honk.type = 'peaking';
  honk.frequency.value = 1700;
  honk.Q.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.knee.value = RADIO_COMP_KNEE_DB;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  const post = ctx.createGain();
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(ctx);
  noise.loop = true;
  const noiseGain = ctx.createGain();
  noise.connect(noiseGain);
  noiseGain.connect(hp1);
  // 고역 통과 한 단은 포화 뒤에 둔다. 포화가 만들어 내는 낮은 찌꺼기 소리까지 걸러진다
  pre.connect(hp1);
  hp1.connect(shaper);
  shaper.connect(hp2);
  hp2.connect(lp1);
  lp1.connect(lp2);
  lp2.connect(honk);
  honk.connect(comp);
  comp.connect(post);
  noise.start();
  let curveFor = -1;
  return {
    input: pre,
    output: post,
    latencySec: COMPRESSOR_LOOKAHEAD_SEC,
    apply: (fx, immediate) => {
      const r = fx.radio;
      setParam(ctx, hp1.frequency, radioHighpassHz(r), immediate);
      setParam(ctx, hp2.frequency, radioHighpassHz(r), immediate);
      setParam(ctx, lp1.frequency, radioLowpassHz(r), immediate);
      setParam(ctx, lp2.frequency, radioLowpassHz(r), immediate);
      setParam(ctx, honk.gain, 3 * r, immediate);
      const k = radioDrive(r);
      if (k !== curveFor) {
        shaper.curve = makeDriveCurve(k);
        curveFor = k;
      }
      const threshold = radioCompThresholdDb(r);
      const ratio = radioCompRatio(r);
      setParam(ctx, comp.threshold, threshold, immediate);
      setParam(ctx, comp.ratio, ratio, immediate);
      const auto = compressorAutoMakeupDb(threshold, RADIO_COMP_KNEE_DB, ratio);
      setParam(ctx, post.gain, fromDb(radioMakeupDb(r) - auto), immediate);
      setParam(ctx, noiseGain.gain, radioNoiseGain(r), immediate);
    },
    dispose: () => {
      stopSource(noise);
      disconnectAll([pre, hp1, hp2, shaper, lp1, lp2, honk, comp, post, noise, noiseGain]);
    },
  };
}

function echoStage(ctx: BaseAudioContext): Stage {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const delay = ctx.createDelay(0.5);
  const wet = ctx.createGain();
  const feedback = ctx.createGain();
  // 되돌아올수록 흐려지게
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 3800;
  const thin = ctx.createBiquadFilter();
  thin.type = 'highpass';
  thin.frequency.value = 180;
  input.connect(output);
  input.connect(delay);
  delay.connect(damp);
  damp.connect(thin);
  thin.connect(wet);
  wet.connect(output);
  thin.connect(feedback);
  feedback.connect(delay);
  return {
    input,
    output,
    latencySec: 0,
    apply: (fx, immediate) => {
      setParam(ctx, delay.delayTime, echoTimeSec(fx.echo), immediate);
      setParam(ctx, feedback.gain, echoFeedback(fx.echo), immediate);
      setParam(ctx, wet.gain, echoWet(fx.echo), immediate);
    },
    dispose: () => disconnectAll([input, delay, damp, thin, wet, feedback, output]),
  };
}

function gainStage(ctx: BaseAudioContext): Stage {
  const gain = ctx.createGain();
  return {
    input: gain,
    output: gain,
    latencySec: 0,
    apply: (fx, immediate) => setParam(ctx, gain.gain, fromDb(fx.gainDb), immediate),
    dispose: () => disconnectAll([gain]),
  };
}

function safetyStage(ctx: BaseAudioContext): Stage {
  const trim = ctx.createGain();
  // 컴프레서가 자동으로 올리는 만큼 미리 내려서, 문턱 아래 소리는 크기가 그대로다
  trim.gain.value = fromDb(-compressorAutoMakeupDb(SAFETY.thresholdDb, SAFETY.kneeDb, SAFETY.ratio));
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = SAFETY.thresholdDb;
  limiter.knee.value = SAFETY.kneeDb;
  limiter.ratio.value = SAFETY.ratio;
  limiter.attack.value = SAFETY.attack;
  limiter.release.value = SAFETY.release;
  const scale = ctx.createGain();
  scale.gain.value = 1 / SAFETY_RANGE;
  const clip = ctx.createWaveShaper();
  clip.curve = makeSafetyCurve();
  trim.connect(limiter);
  limiter.connect(scale);
  scale.connect(clip);
  return {
    input: trim,
    output: clip,
    latencySec: COMPRESSOR_LOOKAHEAD_SEC,
    apply: () => {},
    dispose: () => disconnectAll([trim, limiter, scale, clip]),
  };
}

function isActive(key: StageKey, fx: VoiceFx, safety: boolean): boolean {
  switch (key) {
    case 'warmth':
    case 'presence':
    case 'air':
      return Math.abs(fx[key]) >= FX_EPS;
    case 'punch':
    case 'robot':
    case 'doubler':
    case 'room':
    case 'radio':
    case 'echo':
      return fx[key] >= FX_EPS;
    case 'gain':
      return Math.abs(fx.gainDb) >= FX_EPS;
    case 'safety':
      // 다른 효과가 하나라도 켜져 있을 때만. 전부 0 이면 아무것도 거치지 않는다
      return safety && STAGE_ORDER.some((k) => k !== 'safety' && isActive(k, fx, false));
  }
}

function createStage(ctx: BaseAudioContext, key: StageKey): Stage {
  switch (key) {
    case 'warmth':
      return eqStage(ctx, 'lowshelf', 250, 0.7, warmthDb);
    case 'presence':
      return eqStage(ctx, 'peaking', 3000, 0.9, presenceDb);
    case 'air':
      return eqStage(ctx, 'highshelf', 8000, 0.7, airDb);
    case 'punch':
      return punchStage(ctx);
    case 'robot':
      return robotStage(ctx);
    case 'doubler':
      return doublerStage(ctx);
    case 'room':
      return roomStage(ctx);
    case 'radio':
      return radioStage(ctx);
    case 'echo':
      return echoStage(ctx);
    case 'gain':
      return gainStage(ctx);
    case 'safety':
      return safetyStage(ctx);
  }
}

/**
 * 효과 그래프를 만든다. 피치·포먼트는 여기 없다(pitch.ts 가 앞단에 따로 붙인다).
 * update() 로 값을 바꾸면, 켜진 효과의 구성이 그대로일 때는 값만 부드럽게 옮기고
 * 구성이 달라지면 안쪽 노드를 다시 짠다(실시간에서는 짧게 소리를 줄였다가 바꾼다).
 */
export function buildFxGraph(ctx: BaseAudioContext, fx: VoiceFx, opts: FxGraphOptions = {}): FxGraph {
  const safety = opts.safety === 'node';
  const input = ctx.createGain();
  const output = ctx.createGain();
  let current = clampFx(fx);
  let stages: Array<{ key: StageKey; stage: Stage }> = [];
  let signature = '';
  let swapTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const signatureOf = (f: VoiceFx): string => STAGE_ORDER.filter((k) => isActive(k, f, safety)).join('+');

  const rebuild = (): void => {
    disconnectAll([input]);
    for (const s of stages) s.stage.dispose();
    signature = signatureOf(current);
    stages = STAGE_ORDER.filter((k) => isActive(k, current, safety)).map((key) => ({ key, stage: createStage(ctx, key) }));
    let prev: AudioNode = input;
    for (const s of stages) {
      s.stage.apply(current, true);
      prev.connect(s.stage.input);
      prev = s.stage.output;
    }
    prev.connect(output);
  };

  rebuild();

  return {
    input,
    output,
    get latencySec(): number {
      let sum = 0;
      for (const s of stages) sum += s.stage.latencySec;
      return sum;
    },
    update(next: VoiceFx): void {
      if (disposed) return;
      current = clampFx(next);
      if (signatureOf(current) === signature) {
        if (swapTimer === null) for (const s of stages) s.stage.apply(current, false);
        return;
      }
      if (ctx.state !== 'running') {
        rebuild();
        return;
      }
      if (swapTimer !== null) return; // 이미 바꾸는 중. 타이머가 최신 값으로 다시 짠다
      const now = ctx.currentTime;
      output.gain.cancelScheduledValues(now);
      output.gain.setValueAtTime(output.gain.value, now);
      output.gain.linearRampToValueAtTime(0, now + 0.012);
      swapTimer = setTimeout(() => {
        swapTimer = null;
        if (disposed) return;
        rebuild();
        const t = ctx.currentTime;
        output.gain.cancelScheduledValues(t);
        output.gain.setValueAtTime(0, t);
        output.gain.linearRampToValueAtTime(1, t + 0.02);
      }, 16);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (swapTimer !== null) clearTimeout(swapTimer);
      swapTimer = null;
      for (const s of stages) s.stage.dispose();
      stages = [];
      disconnectAll([input, output]);
    },
  };
}
