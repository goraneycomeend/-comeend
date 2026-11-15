// 아이콘만 있는 버튼. 44×44px. 이름(label)은 반드시 준다 — 화면에는 안 보여도 읽어 주는 프로그램과 말풍선이 쓴다.
import type { ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children' | 'aria-label'> {
  icon: IconName;
  /** 버튼이 하는 일. 예) "닫기" */
  label: string;
  /** ghost = 바탕 없음(기본), outline = 테두리 */
  variant?: 'ghost' | 'outline';
  /** 켜짐/꺼짐이 있는 버튼이면 지금 상태 */
  pressed?: boolean;
}

export function IconButton({ icon, label, variant = 'ghost', pressed, className, ...rest }: IconButtonProps) {
  const cls = ['icon-btn', `icon-btn--${variant}`, className ?? ''].filter(Boolean).join(' ');
  return (
    <button {...rest} type="button" className={cls} aria-label={label} title={label} aria-pressed={pressed}>
      <Icon name={icon} size={20} />
    </button>
  );
}
