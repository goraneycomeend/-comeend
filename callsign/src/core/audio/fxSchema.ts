// 음향 효과 매개변수의 정의. UI 슬라이더는 FX_PARAMS 만 보고 그린다.
import type { VoiceFx } from '../types.ts';

export type FxGroup = 'voice' | 'tone' | 'space' | 'character' | 'output';

export interface FxGroupDef {
  id: FxGroup;
  label: string;
  description: string;
}

export interface FxParamDef {
  key: keyof VoiceFx;
  /** 슬라이더 이름 */
  label: string;
  /** 한 줄 설명 */
  description: string;
  min: number;
  max: number;
  step: number;
  group: FxGroup;
  /** 값 뒤에 붙는 단위. 없으면 빈 문자열 */
  unit: '반음' | 'dB' | '';
  /** 가운데가 0 인 양방향 슬라이더인지 */
  bipolar: boolean;
  /** 이 범위 안이면 '사람 목소리'로 들린다. 로스터 요원은 이 안에서만 쓴다 */
  naturalMin: number;
  naturalMax: number;
}

export const FX_GROUPS: FxGroupDef[] = [
  { id: 'voice', label: '목소리 높이', description: '높낮이와 체구. 조금만 움직여도 인상이 달라져요.' },
  { id: 'tone', label: '음색', description: '따뜻함, 또렷함, 숨결 같은 결을 다듬어요.' },
  { id: 'space', label: '공간', description: '말하는 곳의 울림.' },
  { id: 'character', label: '특수 효과', description: '무전기, 겹침, 기계음. 사람 목소리에서 멀어지는 효과예요.' },
  { id: 'output', label: '출력', description: '최종 음량.' },
];

export const FX_PARAMS: FxParamDef[] = [
  {
    key: 'pitch', label: '높낮이', description: '목소리 음높이를 반음 단위로 옮겨요.',
    min: -12, max: 12, step: 0.5, group: 'voice', unit: '반음', bipolar: true, naturalMin: -1.5, naturalMax: 1.5,
  },
  {
    key: 'formant', label: '체구', description: '낮추면 몸집이 큰 사람, 올리면 작은 사람처럼 들려요.',
    min: -6, max: 6, step: 0.25, group: 'voice', unit: '반음', bipolar: true, naturalMin: -1, naturalMax: 1,
  },
  {
    key: 'warmth', label: '온기', description: '낮은 음을 살려 포근하게, 줄이면 가볍게.',
    min: -1, max: 1, step: 0.05, group: 'tone', unit: '', bipolar: true, naturalMin: -0.5, naturalMax: 0.5,
  },
  {
    key: 'presence', label: '또렷함', description: '발음이 앞으로 나오게, 줄이면 부드럽게.',
    min: -1, max: 1, step: 0.05, group: 'tone', unit: '', bipolar: true, naturalMin: -0.5, naturalMax: 0.5,
  },
  {
    key: 'air', label: '공기감', description: '숨결과 치찰음 쪽의 밝기.',
    min: -1, max: 1, step: 0.05, group: 'tone', unit: '', bipolar: true, naturalMin: -0.5, naturalMax: 0.5,
  },
  {
    key: 'punch', label: '단단함', description: '큰 소리와 작은 소리 차이를 줄여 힘 있게.',
    min: 0, max: 1, step: 0.05, group: 'tone', unit: '', bipolar: false, naturalMin: 0, naturalMax: 0.5,
  },
  {
    key: 'room', label: '방 울림', description: '작은 방의 짧은 울림. 조금만 넣으면 녹음실 느낌이 사라져요.',
    min: 0, max: 1, step: 0.05, group: 'space', unit: '', bipolar: false, naturalMin: 0, naturalMax: 0.25,
  },
  {
    key: 'echo', label: '메아리', description: '말이 한 박자 뒤에 되돌아와요.',
    min: 0, max: 1, step: 0.05, group: 'space', unit: '', bipolar: false, naturalMin: 0, naturalMax: 0.1,
  },
  {
    key: 'radio', label: '무전기', description: '좁은 대역과 약한 잡음. 무전으로 듣는 소리.',
    min: 0, max: 1, step: 0.05, group: 'character', unit: '', bipolar: false, naturalMin: 0, naturalMax: 0,
  },
  {
    key: 'doubler', label: '겹침', description: '같은 말을 두 번 겹친 듯 두껍게.',
    min: 0, max: 1, step: 0.05, group: 'character', unit: '', bipolar: false, naturalMin: 0, naturalMax: 0,
  },
  {
    key: 'robot', label: '기계음', description: '금속성으로 떨리는 로봇 목소리.',
    min: 0, max: 1, step: 0.05, group: 'character', unit: '', bipolar: false, naturalMin: 0, naturalMax: 0,
  },
  {
    key: 'gainDb', label: '음량', description: '마지막 출력 크기.',
    min: -12, max: 12, step: 0.5, group: 'output', unit: 'dB', bipolar: true, naturalMin: -6, naturalMax: 6,
  },
];

const FX_KEYS = FX_PARAMS.map((p) => p.key);

/** 아무 처리도 하지 않는 값 */
export const NEUTRAL_FX: VoiceFx = Object.freeze({
  pitch: 0, formant: 0, warmth: 0, presence: 0, air: 0, punch: 0,
  room: 0, radio: 0, echo: 0, doubler: 0, robot: 0, gainDb: 0,
});

/**
 * '사람 말처럼 들리는' 범위.
 * pitch·formant·room·echo·radio·robot 은 설계서의 로스터 규칙 그대로이고,
 * 나머지(warmth·presence·air·punch·doubler·gainDb)는 같은 취지로 정한 권장 범위다.
 */
export const NATURAL_FX_LIMITS: Record<keyof VoiceFx, { min: number; max: number }> = Object.freeze(
  Object.fromEntries(FX_PARAMS.map((p) => [p.key, { min: p.naturalMin, max: p.naturalMax }])),
) as Record<keyof VoiceFx, { min: number; max: number }>;

/** 값이 0 으로 취급되는 문턱 */
export const FX_EPS = 1e-3;

function clampNumber(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return n < min ? min : n > max ? max : n;
}

/** 빠진 값은 0 으로 채우고, 숫자가 아니면 0, 범위를 벗어나면 끝값으로 맞춘다. 새 객체를 돌려준다 */
export function clampFx(fx: Partial<VoiceFx> | null | undefined): VoiceFx {
  const src: Partial<Record<keyof VoiceFx, unknown>> = fx ?? {};
  const out = { ...NEUTRAL_FX };
  for (const p of FX_PARAMS) out[p.key] = clampNumber(src[p.key], p.min, p.max);
  return out;
}

/** 전부 0 이면 참. 이때는 어떤 처리도 거치지 않는다 */
export function isNeutralFx(fx: VoiceFx): boolean {
  for (const k of FX_KEYS) if (Math.abs(fx[k]) >= FX_EPS) return false;
  return true;
}

/** 로스터 요원에게 허용되는 범위 안인지 */
export function isNaturalFx(fx: VoiceFx): boolean {
  for (const p of FX_PARAMS) {
    const v = fx[p.key];
    if (!(v >= p.naturalMin - 1e-9 && v <= p.naturalMax + 1e-9)) return false;
  }
  return true;
}

/** 자연스러운 범위로 끌어온다(랩의 "자연스럽게" 버튼) */
export function toNaturalFx(fx: Partial<VoiceFx>): VoiceFx {
  const c = clampFx(fx);
  for (const p of FX_PARAMS) c[p.key] = clampNumber(c[p.key], p.naturalMin, p.naturalMax);
  return c;
}

/** 슬라이더 옆에 보여 줄 값 문자열. 예) "+1.5반음", "0.25", "-3dB" */
export function formatFxValue(def: FxParamDef, value: number): string {
  const digits = def.step >= 1 ? 0 : def.step >= 0.1 ? 1 : 2;
  const rounded = Number(value.toFixed(digits));
  const sign = def.bipolar && rounded > 0 ? '+' : '';
  return `${sign}${rounded}${def.unit}`;
}
