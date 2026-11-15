// 입력 레벨 미터. 마이크 소리 크기를 눈금 띠로 보여 준다.
// 값이 1초에 수십 번 바뀌므로, React 상태로 돌리지 않고 `ref.current.set(rms, peak)` 로 직접 밀어 넣을 수도 있다.
import { useEffect, useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';

export interface LevelMeterHandle {
  /** 레벨을 바로 반영한다. rms·peak 는 0..1 의 선형 진폭 */
  set(rms: number, peak?: number): void;
}

export interface LevelMeterProps {
  /** 0..1 의 선형 진폭(RMS). ref 로 밀어 넣을 때는 주지 않아도 된다 */
  level?: number;
  /** 0..1 의 순간 최대값. 주면 가는 표시선으로 그린다 */
  peak?: number;
  /** 미터 이름. 기본 "입력 레벨" */
  label?: string;
  /** 이름을 화면에 보일지. 기본 false(읽어 주기만) */
  showLabel?: boolean;
  ref?: Ref<LevelMeterHandle>;
  className?: string;
}

/** 표시 범위의 바닥(dBFS). 이보다 작은 소리는 0 칸 */
const FLOOR_DB = -54;

/** 선형 진폭 → 미터 위치 0..1 (dB 눈금) */
function toMeter(amp: number): number {
  if (!(amp > 0)) return 0;
  const db = 20 * Math.log10(amp);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
}

export function LevelMeter({ level, peak, label = '입력 레벨', showLabel = false, ref, className }: LevelMeterProps) {
  const el = useRef<HTMLDivElement>(null);

  const apply = (rms: number, pk?: number): void => {
    const node = el.current;
    if (!node) return;
    const m = toMeter(rms);
    node.style.setProperty('--level', m.toFixed(3));
    node.style.setProperty('--peak', toMeter(pk ?? rms).toFixed(3));
    node.setAttribute('aria-valuenow', String(Math.round(m * 100)));
    // 거의 꽉 차면 경고색
    node.classList.toggle('meter--hot', toMeter(pk ?? rms) > 0.96);
  };

  useImperativeHandle(ref, () => ({ set: apply }), []);

  useEffect(() => {
    if (level !== undefined) apply(level, peak);
  }, [level, peak]);

  return (
    <div className={['meter-wrap', className ?? ''].filter(Boolean).join(' ')}>
      {showLabel ? <span className="field-label">{label}</span> : null}
      <div
        ref={el}
        className="meter"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
      >
        <div className="meter__fill" />
        <div className="meter__peak" />
      </div>
    </div>
  );
}
