// 칩: 거르기(켜짐/꺼짐)나 짧은 동작에 쓰는 작은 버튼. 보이는 높이는 34px 이지만 누르는 영역은 44px 이다.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** 켜짐/꺼짐이 있는 칩이면 지금 상태. 주지 않으면 그냥 누르는 칩 */
  selected?: boolean;
  icon?: IconName;
  /** 글자 뒤에 붙는 작은 숫자(개수 등) */
  count?: number;
  children: ReactNode;
}

export function Chip({ selected, icon, count, className, children, ...rest }: ChipProps) {
  const cls = ['chip', selected ? 'chip--on' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button {...rest} type="button" className={cls} aria-pressed={selected}>
      <span className="chip__face">
        {icon ? <Icon name={icon} size={16} /> : null}
        <span>{children}</span>
        {count !== undefined ? <span className="chip__count t-data">{count}</span> : null}
      </span>
    </button>
  );
}

export interface TagProps {
  children: ReactNode;
  /** agent = 요원 색 테두리, plain = 중립(기본) */
  tone?: 'plain' | 'agent' | 'warn';
  className?: string;
}

/** 누를 수 없는 꼬리표(특징, 상태 표시) */
export function Tag({ children, tone = 'plain', className }: TagProps) {
  return <span className={['tag', `tag--${tone}`, className ?? ''].filter(Boolean).join(' ')}>{children}</span>;
}
