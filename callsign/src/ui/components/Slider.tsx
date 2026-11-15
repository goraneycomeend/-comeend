// 슬라이더: 이름, 지금 값, 한 줄 설명. 방향키·Page Up/Down·Home/End 로 움직인다(브라우저 기본 동작).
// 가운데가 0 인 값은 가운데에서부터 채워지고, '사람 목소리로 들리는 범위'가 있으면 띠로 표시한다.
import { useId } from 'react';
import type { CSSProperties } from 'react';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** 값 표기. 기본은 숫자 그대로 */
  format?: (value: number) => string;
  /** 이름 아래 한 줄 설명 */
  description?: string;
  /** 가운데(0)에서 양쪽으로 가는 값인지 */
  bipolar?: boolean;
  /** 이 범위를 띠로 표시한다. FxParamDef 의 naturalMin/naturalMax 를 넘긴다 */
  naturalRange?: readonly [number, number];
  /** 주면 두 번 눌러(더블클릭) 이 값으로 되돌릴 수 있다 */
  resetValue?: number;
  disabled?: boolean;
  className?: string;
}

const ratio = (v: number, min: number, max: number): number =>
  max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0;

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  description,
  bipolar = false,
  naturalRange,
  resetValue,
  disabled,
  className,
}: SliderProps) {
  const id = useId();
  const text = format ? format(value) : String(value);
  const p = ratio(value, min, max);
  const origin = bipolar ? ratio(0, min, max) : 0;
  const style = {
    '--from': Math.min(p, origin),
    '--to': Math.max(p, origin),
    '--n0': naturalRange ? ratio(naturalRange[0], min, max) : 0,
    '--n1': naturalRange ? ratio(naturalRange[1], min, max) : 0,
  } as CSSProperties;

  // 자연스러운 범위를 벗어났는지(값 옆에 표시)
  const outside = naturalRange ? value < naturalRange[0] - 1e-9 || value > naturalRange[1] + 1e-9 : false;

  return (
    <div
      className={['slider', disabled ? 'slider--disabled' : '', outside ? 'slider--outside' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      <div className="slider__head">
        <label htmlFor={id} className="slider__label">
          {label}
        </label>
        <output htmlFor={id} className="slider__value t-data">
          {text}
        </output>
      </div>
      <div className={naturalRange ? 'slider__rail slider__rail--natural' : 'slider__rail'}>
        <input
          id={id}
          type="range"
          className="slider__input"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-valuetext={text}
          aria-describedby={description ? `${id}-d` : undefined}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
          onDoubleClick={resetValue === undefined ? undefined : () => onChange(resetValue)}
        />
      </div>
      {description ? (
        <p id={`${id}-d`} className="slider__desc">
          {description}
        </p>
      ) : null}
    </div>
  );
}
