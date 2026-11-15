// 요원 카드(명단의 한 칸)와 요원 줄(전환 목록의 한 줄). 둘 다 그 요원의 색으로 칠해진다.
import type { CSSProperties } from 'react';
import { agentStyle } from '../../app/color.ts';
import { ROLE_LABEL, channelLabel } from '../../app/roster.ts';
import type { AgentDef } from '../../core/types.ts';
import { AgentEmblem } from './AgentEmblem.tsx';
import { Icon } from './Icon.tsx';

export interface AgentCardProps {
  agent: AgentDef;
  /** 채널 번호(1부터) */
  channel: number;
  /** 지금 고른 요원인지 */
  selected: boolean;
  onSelect: (agent: AgentDef) => void;
}

/** 명단 격자의 카드. 카드 전체가 버튼이다 */
export function AgentCard({ agent, channel, selected, onSelect }: AgentCardProps) {
  return (
    <button
      type="button"
      className={selected ? 'agent-card agent-scope agent-card--on' : 'agent-card agent-scope'}
      style={agentStyle(agent.color) as CSSProperties}
      aria-pressed={selected}
      data-agent={agent.id}
      onClick={() => onSelect(agent)}
    >
      <span className="agent-card__top">
        <span className="t-label agent-card__ch">{channelLabel(channel)}</span>
        <span className="agent-card__role">{agent.custom ? '내 요원' : ROLE_LABEL[agent.role]}</span>
      </span>
      <AgentEmblem agentId={agent.id} size={56} className="agent-card__emblem" />
      <span className="agent-card__name">{agent.callsign}</span>
      {agent.callsignEn ? <span className="agent-card__en t-label">{agent.callsignEn}</span> : null}
      {agent.tagline ? <span className="agent-card__tagline">{agent.tagline}</span> : null}
      {selected ? (
        <span className="agent-card__mark">
          <Icon name="check" size={14} />
          <span>선택됨</span>
        </span>
      ) : null}
    </button>
  );
}

export interface AgentRowProps extends AgentCardProps {
  /** 시트가 열릴 때 이 줄에 포커스를 둔다 */
  autoFocus?: boolean;
}

/** 전환 목록의 한 줄 */
export function AgentRow({ agent, channel, selected, onSelect, autoFocus }: AgentRowProps) {
  return (
    <button
      type="button"
      className={selected ? 'agent-row agent-scope agent-row--on' : 'agent-row agent-scope'}
      style={agentStyle(agent.color) as CSSProperties}
      aria-pressed={selected}
      data-agent={agent.id}
      data-autofocus={autoFocus ? '' : undefined}
      onClick={() => onSelect(agent)}
    >
      <AgentEmblem agentId={agent.id} size={40} />
      <span className="agent-row__text">
        <span className="agent-row__name">{agent.callsign}</span>
        <span className="agent-row__meta">
          <span className="t-label">{channelLabel(channel)}</span>
          <span>{agent.custom ? '내 요원' : ROLE_LABEL[agent.role]}</span>
        </span>
      </span>
      {selected ? <Icon name="check" size={20} className="agent-row__check" /> : null}
    </button>
  );
}
