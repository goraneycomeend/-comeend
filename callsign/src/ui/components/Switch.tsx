// 켜고 끄는 스위치(무전 효과, 내 목소리 듣기 등). 줄 전체가 누르는 영역이다.
import { useId } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** 라벨 아래 한 줄 설명 */
  description?: ReactNode;
  icon?: IconName;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, description, icon, disabled, className }: SwitchProps) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-l`}
      aria-describedby={description ? `${id}-d` : undefined}
      disabled={disabled}
      className={['switch', checked ? 'switch--on' : '', className ?? ''].filter(Boolean).join(' ')}
      onClick={() => onChange(!checked)}
    >
      {icon ? <Icon name={icon} size={20} className="switch__icon" /> : null}
      <span className="switch__text">
        <span id={`${id}-l`} className="switch__label">
          {label}
        </span>
        {description ? (
          <span id={`${id}-d`} className="switch__desc">
            {description}
          </span>
        ) : null}
      </span>
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
    </button>
  );
}
