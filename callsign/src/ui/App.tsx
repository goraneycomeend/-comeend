// 앱 뼈대. 좁은 화면: 위 줄(요원 전환·정보) + 본문 + 아래 탭 5개.
// 넓은 화면(1024px 이상): 왼쪽 내비게이션과 지금 요원 패널 + 넓은 작업 영역.
import { Component, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, CSSProperties, MouseEvent, ReactNode } from 'react';
import { agentTint } from '../app/color.ts';
import { ROUTE_LABEL, TAB_ROUTES, navigate, useRoute } from '../app/hash.ts';
import type { Route } from '../app/hash.ts';
import { ROLE_LABEL, channelLabel, sampleLineOf } from '../app/roster.ts';
import { installShortcuts } from '../app/shortcuts.ts';
import { useAgents, useChannelNumber, useCurrentAgent, usePlayPhase } from '../app/store.ts';
import { linePlayId, stopPlayback } from '../app/voiceService.ts';
import type { AgentDef } from '../core/types.ts';
import { playSampleLine } from './components/AgentDetail.tsx';
import { AgentEmblem } from './components/AgentEmblem.tsx';
import { AgentSwitcher } from './components/AgentSwitcher.tsx';
import { Button } from './components/Button.tsx';
import { Icon } from './components/Icon.tsx';
import type { IconName } from './components/Icon.tsx';
import { IconButton } from './components/IconButton.tsx';
import { Notice, Screen } from './components/Layout.tsx';
import { PlayButton } from './components/PlayButton.tsx';
import { ToastHost } from './components/Toast.tsx';
import { useWide } from './components/useMediaQuery.ts';

// ── 화면 연결 ────────────────────────────────────────────────
// `screens/<이름>.tsx` 가 기본 내보내기로 컴포넌트를 주면 그 화면이 된다(이름은 화면 이름의 첫 글자를 대문자로).
// 파일이 아직 없는 화면은 "준비 중" 안내가 대신 나온다.
const screenModules = import.meta.glob<{ default?: ComponentType }>('./screens/*.tsx', { eager: true });

function screenFor(route: Route): ComponentType | null {
  const name = route.charAt(0).toUpperCase() + route.slice(1);
  return screenModules[`./screens/${name}.tsx`]?.default ?? null;
}

const ROUTE_ICON: Record<Route, IconName> = {
  agents: 'agents',
  lines: 'lines',
  studio: 'studio',
  changer: 'changer',
  lab: 'lab',
  about: 'info',
};

/** 화면 하나가 그리다 실패해도 앱 전체가 멈추지 않게 받아 낸다 */
class ScreenBoundary extends Component<{ route: Route; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <Screen route={this.props.route}>
        <div className="screen-fallback">
          <Notice tone="error" title="이 화면을 그리다가 문제가 생겼어요.">
            다른 화면은 그대로 쓸 수 있어요. 다시 열어도 같으면 앱을 새로 고쳐 주세요.
          </Notice>
          <Button icon="refresh" onClick={() => this.setState({ failed: false })}>
            다시 열기
          </Button>
        </div>
      </Screen>
    );
  }
}

function NotReady({ route }: { route: Route }) {
  return (
    <Screen route={route}>
      <div className="screen-fallback">
        <Notice title={`${ROUTE_LABEL[route]} 화면은 아직 준비 중이에요.`}>곧 여기서 쓸 수 있게 돼요.</Notice>
      </div>
    </Screen>
  );
}

function go(e: MouseEvent<HTMLAnchorElement>, route: Route): void {
  // 새 탭으로 열기 같은 조합 키는 브라우저에 맡긴다
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  navigate(route);
}

/** 앱 표식: 작은 성문 */
function BrandMark() {
  return (
    <svg className="brand__mark" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M4 12v4M9 8v12M14 4v20M19 9v10M24 12.5v3" />
      </g>
    </svg>
  );
}

/** 눈금 띠 위에서 바늘이 지금 요원의 채널을 가리킨다 */
function ChannelDial({ channel, count }: { channel: number; count: number }) {
  const at = count > 0 && channel > 0 ? (channel - 0.5) / count : 0.5;
  return (
    <div className="dial" style={{ '--at': at } as CSSProperties} aria-hidden="true">
      <span className="dial__needle" />
    </div>
  );
}

function TopBar({ agent, channel, route, onSwitch }: { agent: AgentDef; channel: number; route: Route; onSwitch: () => void }) {
  return (
    <header className="topbar">
      <button
        type="button"
        className="agent-chip"
        aria-haspopup="dialog"
        aria-label={`요원 바꾸기. 지금 요원은 ${agent.callsign}`}
        onClick={onSwitch}
      >
        <AgentEmblem agentId={agent.id} size={38} />
        <span className="agent-chip__text">
          <span className="agent-chip__name">{agent.callsign}</span>
          <span className="agent-chip__meta">
            <span className="t-label">{channelLabel(channel)}</span>
            <span>{agent.custom ? '내 요원' : ROLE_LABEL[agent.role]}</span>
          </span>
        </span>
        <Icon name="swap" size={18} className="agent-chip__swap" />
      </button>
      <IconButton icon="info" label="정보" pressed={route === 'about'} onClick={() => navigate(route === 'about' ? 'agents' : 'about')} />
    </header>
  );
}

function TabBar({ route }: { route: Route }) {
  return (
    <nav className="tabbar" aria-label="화면 이동">
      {TAB_ROUTES.map((r) => (
        <a
          key={r}
          href={`#${r}`}
          className="tabbar__item"
          aria-current={route === r ? 'page' : undefined}
          onClick={(e) => go(e, r)}
        >
          <Icon name={ROUTE_ICON[r]} size={22} />
          <span>{ROUTE_LABEL[r]}</span>
        </a>
      ))}
    </nav>
  );
}

function SideNav({ agent, channel, route, onSwitch }: { agent: AgentDef; channel: number; route: Route; onSwitch: () => void }) {
  const sample = sampleLineOf(agent);
  const phase = usePlayPhase(sample ? linePlayId(agent.id, sample.id) : null);
  return (
    <aside className="sidenav">
      <div className="brand">
        <BrandMark />
        <div>
          <p className="brand__name">콜사인</p>
          <p className="brand__en t-label">callsign</p>
        </div>
      </div>

      <nav aria-label="화면 이동">
        <ul className="sidenav__list">
          {TAB_ROUTES.map((r, i) => (
            <li key={r}>
              <a href={`#${r}`} className="sidenav__item" aria-current={route === r ? 'page' : undefined} onClick={(e) => go(e, r)}>
                <Icon name={ROUTE_ICON[r]} size={20} />
                <span>{ROUTE_LABEL[r]}</span>
                <kbd className="sidenav__key" aria-hidden="true">
                  {i + 1}
                </kbd>
              </a>
            </li>
          ))}
          <li className="sidenav__rule" aria-hidden="true" />
          <li>
            <a href="#about" className="sidenav__item" aria-current={route === 'about' ? 'page' : undefined} onClick={(e) => go(e, 'about')}>
              <Icon name="info" size={20} />
              <span>{ROUTE_LABEL.about}</span>
            </a>
          </li>
        </ul>
      </nav>

      <section className="now-agent" aria-label="지금 요원">
        <p className="t-caption" aria-hidden="true">
          지금 요원
        </p>
        <div className="now-agent__id">
          <AgentEmblem agentId={agent.id} size={52} />
          <div className="grow">
            <p className="now-agent__name">{agent.callsign}</p>
            <p className="now-agent__meta">
              <span className="t-label">{channelLabel(channel)}</span>
              <span>{agent.custom ? '내 요원' : ROLE_LABEL[agent.role]}</span>
            </p>
          </div>
        </div>
        <div className="now-agent__actions">
          {sample ? (
            <PlayButton
              phase={phase}
              variant="outline"
              label={`${agent.callsign} 대표 대사`}
              onPlay={() => playSampleLine(agent, sample)}
              onStop={stopPlayback}
            />
          ) : null}
          <Button icon="swap" onClick={onSwitch} aria-haspopup="dialog">
            요원 바꾸기
          </Button>
        </div>
      </section>
    </aside>
  );
}

export default function App() {
  const route = useRoute();
  const agent = useCurrentAgent();
  const agents = useAgents();
  const channel = useChannelNumber(agent);
  const wide = useWide();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const main = useRef<HTMLElement>(null);

  // 고른 요원의 색을 화면 강조색으로 넣는다
  useLayoutEffect(() => {
    const tint = agentTint(agent.color);
    const style = document.documentElement.style;
    style.setProperty('--agent', tint.agent);
    style.setProperty('--agent-ink', tint.ink);
    style.setProperty('--on-agent', tint.onAgent);
  }, [agent.color]);

  useEffect(() => installShortcuts(), []);

  // 화면이 바뀌면 맨 위로 올리고, 창 제목도 맞춘다
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
    document.title = route === 'agents' ? '콜사인' : `콜사인 · ${ROUTE_LABEL[route]}`;
  }, [route]);

  const ScreenView = screenFor(route);
  const openSwitcher = (): void => setSwitcherOpen(true);

  return (
    <div className={wide ? 'shell shell--wide' : 'shell'} data-route={route}>
      <button type="button" className="skip-link" onClick={() => main.current?.focus()}>
        본문으로 건너뛰기
      </button>

      {wide ? (
        <SideNav agent={agent} channel={channel} route={route} onSwitch={openSwitcher} />
      ) : (
        <TopBar agent={agent} channel={channel} route={route} onSwitch={openSwitcher} />
      )}

      <main ref={main} className="shell__main" tabIndex={-1}>
        <ChannelDial channel={channel} count={agents.length} />
        <ScreenBoundary key={route} route={route}>
          {ScreenView ? <ScreenView /> : <NotReady route={route} />}
        </ScreenBoundary>
      </main>

      {wide ? null : <TabBar route={route} />}

      <AgentSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
      <ToastHost />
    </div>
  );
}
