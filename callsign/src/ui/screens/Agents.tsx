// 요원 화면: 명단 격자와 역할 거르기. 카드를 누르면 그 요원이 선택되고 상세가 열린다.
// 좁은 화면에서는 상세가 시트로, 넓은 화면에서는 오른쪽 단에 늘 보인다.
import { useMemo, useState } from 'react';
import { ROLE_LABEL, ROLE_ORDER, channelLabel } from '../../app/roster.ts';
import { useAgents, useAppStore, useChannelNumber, useCurrentAgent } from '../../app/store.ts';
import type { AgentDef, AgentRole } from '../../core/types.ts';
import { AgentCard } from '../components/AgentCard.tsx';
import { AgentDetail } from '../components/AgentDetail.tsx';
import { Chip } from '../components/Chip.tsx';
import { Screen, Split } from '../components/Layout.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { useWide } from '../components/useMediaQuery.ts';

type Filter = 'all' | 'mine' | AgentRole;

export default function Agents() {
  const agents = useAgents();
  const current = useCurrentAgent();
  const currentChannel = useChannelNumber(current);
  const selectAgent = useAppStore((s) => s.selectAgent);
  const wide = useWide();
  const [filter, setFilter] = useState<Filter>('all');
  const [sheetOpen, setSheetOpen] = useState(false);

  const hasMine = agents.some((a) => a.custom);
  // 채널 번호는 거르기와 상관없이 전체 목록에서의 자리다
  const numbered = useMemo(() => agents.map((agent, i) => ({ agent, channel: i + 1 })), [agents]);
  const shown = numbered.filter(({ agent }) =>
    filter === 'all' ? true : filter === 'mine' ? agent.custom === true : !agent.custom && agent.role === filter,
  );
  const countOf = (f: Filter): number =>
    f === 'all'
      ? agents.length
      : f === 'mine'
        ? agents.filter((a) => a.custom).length
        : agents.filter((a) => !a.custom && a.role === f).length;

  const pick = (agent: AgentDef): void => {
    selectAgent(agent.id);
    if (!wide) setSheetOpen(true);
  };

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: '전체' },
    ...ROLE_ORDER.map((r) => ({ key: r as Filter, label: ROLE_LABEL[r] })),
    ...(hasMine ? [{ key: 'mine' as Filter, label: '내 요원' }] : []),
  ];

  return (
    <Screen route="agents" lead="요원을 고르면 그 목소리로 대사를 듣고, 글을 읽히고, 내 목소리에 효과를 입힐 수 있어요.">
      <Split side={<AgentDetail agent={current} />} narrow="hidden" sideWidth="regular">
        <div className="roster-filter" role="group" aria-label="역할로 거르기">
          {filters.map((f) => (
            <Chip key={f.key} selected={filter === f.key} count={countOf(f.key)} onClick={() => setFilter(f.key)}>
              {f.label}
            </Chip>
          ))}
        </div>

        {shown.length > 0 ? (
          <ul className="roster" aria-label="요원 명단">
            {shown.map(({ agent, channel }) => (
              <li key={agent.id}>
                <AgentCard agent={agent} channel={channel} selected={agent.id === current.id} onSelect={pick} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="roster-empty">이 역할의 요원은 아직 없어요.</p>
        )}
      </Split>

      {!wide ? (
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={current.callsign}
          eyebrow={
            <>
              <span className="t-label">{channelLabel(currentChannel)}</span>
              <span>{current.custom ? '내 요원' : ROLE_LABEL[current.role]}</span>
            </>
          }
        >
          <AgentDetail agent={current} showName={false} onNavigate={() => setSheetOpen(false)} />
        </Sheet>
      ) : null}
    </Screen>
  );
}
