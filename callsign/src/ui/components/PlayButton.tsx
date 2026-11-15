// 재생 버튼. 멈춤(idle) → 준비 중(preparing) → 재생 중(playing) 세 상태를 그린다.
import type { PlayPhase } from '../../app/types.ts';
import { Icon } from './Icon.tsx';

export interface PlayButtonProps {
  phase: PlayPhase;
  onPlay: () => void;
  onStop: () => void;
  /** 무엇을 트는지. 예) "새벽 대표 대사" → 버튼 이름이 "새벽 대표 대사 듣기 / 멈추기" 가 된다 */
  label: string;
  /** md = 44px(기본), lg = 56px */
  size?: 'md' | 'lg';
  /** solid = 요원 색으로 칠함(기본), outline = 테두리만 */
  variant?: 'solid' | 'outline';
  disabled?: boolean;
  className?: string;
}

export function PlayButton({
  phase,
  onPlay,
  onStop,
  label,
  size = 'md',
  variant = 'solid',
  disabled,
  className,
}: PlayButtonProps) {
  const active = phase !== 'idle';
  const name = active ? `${label} 멈추기` : `${label} 듣기`;
  const cls = ['play-btn', `play-btn--${size}`, `play-btn--${variant}`, active ? 'play-btn--active' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      aria-label={name}
      title={name}
      data-phase={phase}
      disabled={disabled}
      onClick={active ? onStop : onPlay}
    >
      {phase === 'preparing' ? (
        <span className="spinner" aria-hidden="true" />
      ) : (
        <Icon name={phase === 'playing' ? 'stop' : 'play'} size={size === 'lg' ? 26 : 20} />
      )}
    </button>
  );
}
