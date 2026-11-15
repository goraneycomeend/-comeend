// 시트: 좁은 화면에서는 아래에서 올라오고, 넓은 화면에서는 가운데 뜨는 창.
// 열려 있는 동안 뒤 화면은 조작할 수 없다. Esc, 바깥 누르기, 닫기 버튼으로 닫는다.
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscape, useModalLock } from '../../app/shortcuts.ts';
import { IconButton } from './IconButton.tsx';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** 창 이름. 읽어 주는 프로그램이 읽고, 머리줄에도 보인다 */
  title: string;
  /** 제목 위 작은 글씨. 영문·숫자 부분은 `<span className="t-label">` 로 감싸면 채널 표기처럼 보인다 */
  eyebrow?: ReactNode;
  /** 아래에 붙어 있는 버튼 줄 */
  footer?: ReactNode;
  /** 넓은 화면에서의 폭. md ≈ 520px(기본), lg ≈ 720px */
  size?: 'md' | 'lg';
  className?: string;
  children: ReactNode;
}

/** 열려 있는 시트 수. 하나라도 열려 있으면 뒤 화면(#root)을 막는다 */
let openCount = 0;

function lockBackground(): () => void {
  const root = document.getElementById('root');
  openCount++;
  root?.setAttribute('inert', '');
  return () => {
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) root?.removeAttribute('inert');
  };
}

export function Sheet({ open, onClose, title, eyebrow, footer, size = 'md', className, children }: SheetProps) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  useModalLock(open);
  useEscape(onClose, open);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlock = lockBackground();
    const el = panel.current;
    (el?.querySelector<HTMLElement>('[data-autofocus]') ?? el)?.focus({ preventScroll: true });
    return () => {
      unlock();
      // 닫히면 열었던 버튼으로 포커스를 돌려준다
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-layer__backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        className={['sheet', `sheet--${size}`, className ?? ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        tabIndex={-1}
      >
        <header className="sheet__head">
          <div className="grow">
            {eyebrow ? <p className="sheet__eyebrow">{eyebrow}</p> : null}
            <h2 id={`${id}-t`} className="sheet__title t-head">
              {title}
            </h2>
          </div>
          <IconButton icon="close" label="닫기" onClick={onClose} />
        </header>
        <div className="sheet__body">{children}</div>
        {footer ? <footer className="sheet__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
