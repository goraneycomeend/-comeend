// 여러 값 중 하나를 고르는 붙은 버튼 줄(품질: 빠르게 / 기본 / 정성껏 같은 곳). 방향키로 옮길 수 있다.
import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** 라벨 아래 작은 글씨 */
  hint?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  /** 이 묶음의 이름(화면에 보인다) */
  label: string;
  /** 이름을 화면에서 숨기고 읽어 주기만 할지 */
  hideLabel?: boolean;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

export function Segmented<T extends string>({
  label,
  hideLabel = false,
  value,
  options,
  onChange,
  className,
}: SegmentedProps<T>) {
  const id = useId();
  const group = useRef<HTMLDivElement>(null);

  const move = (e: KeyboardEvent<HTMLDivElement>): void => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const enabled = options.filter((o) => !o.disabled);
    const at = enabled.findIndex((o) => o.value === value);
    const next = enabled[(at + delta + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    group.current?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  };

  return (
    <div className={['segmented', className ?? ''].filter(Boolean).join(' ')}>
      <span id={`${id}-l`} className={hideLabel ? 'sr-only' : 'field-label'}>
        {label}
      </span>
      <div ref={group} className="segmented__group" role="radiogroup" aria-labelledby={`${id}-l`} onKeyDown={move}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              data-value={o.value}
              disabled={o.disabled}
              className={on ? 'segmented__item segmented__item--on' : 'segmented__item'}
              onClick={() => onChange(o.value)}
            >
              <span>{o.label}</span>
              {o.hint ? <span className="segmented__hint">{o.hint}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
