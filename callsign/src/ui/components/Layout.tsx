// 화면 뼈대: Screen(제목 줄), Split(넓은 화면에서 2단), Panel(이름 붙은 구획), Notice(안내 줄).
import type { ReactNode } from 'react';
import { ROUTE_LABEL, TAB_ROUTES } from '../../app/hash.ts';
import type { Route } from '../../app/hash.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

export interface ScreenProps {
  /** 이 화면의 이름. 제목과 번호가 여기서 나온다 */
  route: Route;
  /** 제목 아래 한두 줄 안내 */
  lead?: ReactNode;
  /** 제목 줄 오른쪽에 놓는 조작(토글, 버튼) */
  actions?: ReactNode;
  children: ReactNode;
}

/** 화면 하나의 바깥 틀. 번호·제목(h1)·안내 글을 그리고 그 아래에 내용을 놓는다 */
export function Screen({ route, lead, actions, children }: ScreenProps) {
  const n = TAB_ROUTES.indexOf(route) + 1;
  return (
    <div className="screen" data-screen={route}>
      <header className="screen__head">
        <div className="screen__titles">
          <p className="screen__index t-label" aria-hidden="true">
            {n > 0 ? `${String(n).padStart(2, '0')} ` : ''}
            <span>{route}</span>
          </p>
          <h1 className="screen__title t-title">{ROUTE_LABEL[route]}</h1>
          {lead ? <p className="screen__lead">{lead}</p> : null}
        </div>
        {actions ? <div className="screen__actions">{actions}</div> : null}
      </header>
      <div className="screen__body">{children}</div>
    </div>
  );
}

export interface SplitProps {
  /** 옆 단에 놓을 내용 */
  side: ReactNode;
  /** 넓은 화면에서 옆 단의 자리. 기본 'end'(오른쪽) */
  sidePosition?: 'start' | 'end';
  /** 옆 단의 폭. narrow ≈ 300px, regular ≈ 380px(기본), wide ≈ 46% */
  sideWidth?: 'narrow' | 'regular' | 'wide';
  /** 좁은 화면(1023px 이하)에서 옆 단을 어디에 둘지. 기본 'after'(본문 아래). 'hidden' 이면 좁은 화면에서는 그리지 않는다 */
  narrow?: 'before' | 'after' | 'hidden';
  /** 넓은 화면에서 옆 단을 스크롤해도 따라오게 할지. 기본 true */
  sticky?: boolean;
  children: ReactNode;
}

/** 1024px 이상에서 두 단으로 갈라지는 틀. 그보다 좁으면 한 줄로 쌓인다 */
export function Split({
  side,
  sidePosition = 'end',
  sideWidth = 'regular',
  narrow = 'after',
  sticky = true,
  children,
}: SplitProps) {
  const cls = ['split', `split--side-${sidePosition}`, `split--${sideWidth}`, `split--narrow-${narrow}`].join(' ');
  return (
    <div className={cls}>
      <div className="split__main">{children}</div>
      <aside className={sticky ? 'split__side split__side--sticky' : 'split__side'}>{side}</aside>
    </div>
  );
}

export interface PanelProps {
  /** 구획 이름(h2) */
  title?: string;
  /** 이름 옆 작은 글씨 */
  hint?: ReactNode;
  /** 이름 줄 오른쪽 조작 */
  actions?: ReactNode;
  /** plain = 선만(기본), raised = 올라온 면 */
  tone?: 'plain' | 'raised';
  className?: string;
  children: ReactNode;
}

/** 이름이 붙은 구획. 위에 괘선 한 줄과 이름표가 놓인다 */
export function Panel({ title, hint, actions, tone = 'plain', className, children }: PanelProps) {
  return (
    <section className={['panel', `panel--${tone}`, className ?? ''].filter(Boolean).join(' ')}>
      {title || actions ? (
        <header className="panel__head">
          {title ? <h2 className="panel__title">{title}</h2> : null}
          {hint ? <span className="panel__hint">{hint}</span> : null}
          {actions ? <div className="panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="panel__body">{children}</div>
    </section>
  );
}

export interface NoticeProps {
  /** info = 안내(기본), ok = 잘됨, warn = 주의, error = 문제 */
  tone?: 'info' | 'ok' | 'warn' | 'error';
  icon?: IconName;
  /** 굵은 첫 줄 */
  title?: ReactNode;
  /** 오른쪽(좁으면 아래)에 놓는 버튼 */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}

const NOTICE_ICON: Record<NonNullable<NoticeProps['tone']>, IconName> = {
  info: 'info',
  ok: 'check',
  warn: 'warning',
  error: 'warning',
};

/** 한 줄 안내. "실시간 음향 효과예요(AI 합성 아님)" 같은 표기에 쓴다 */
export function Notice({ tone = 'info', icon, title, action, className, children }: NoticeProps) {
  return (
    <div
      className={['notice', `notice--${tone}`, className ?? ''].filter(Boolean).join(' ')}
      role={tone === 'error' ? 'alert' : 'note'}
    >
      <Icon name={icon ?? NOTICE_ICON[tone]} size={18} className="notice__icon" />
      <div className="notice__text">
        {title ? <p className="notice__title">{title}</p> : null}
        {children ? <div className="notice__body">{children}</div> : null}
      </div>
      {action ? <div className="notice__action">{action}</div> : null}
    </div>
  );
}
