// 버튼. 높이 44px 이상. 강조(primary)는 요원 색으로 칠한다.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** primary = 요원 색으로 칠한 주 동작, secondary = 테두리만(기본), ghost = 글자만, danger = 지우기 같은 되돌릴 수 없는 동작 */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** md = 44px(기본), lg = 52px */
  size?: 'md' | 'lg';
  /** 글자 앞 아이콘 */
  icon?: IconName;
  /** 부모 폭을 채운다 */
  block?: boolean;
  /** 일하는 중: 누를 수 없고 회전 표시가 뜬다 */
  busy?: boolean;
  type?: 'button' | 'submit';
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  block = false,
  busy = false,
  type = 'button',
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const cls = ['btn', `btn--${variant}`, `btn--${size}`, block ? 'btn--block' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button {...rest} type={type} className={cls} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={18} /> : null}
      <span className="btn__label">{children}</span>
    </button>
  );
}
