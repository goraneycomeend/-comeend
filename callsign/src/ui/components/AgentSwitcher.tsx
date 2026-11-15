// 요원 바꾸기 시트. 어느 화면에서든 위 줄(좁은 화면)이나 왼쪽 패널(넓은 화면)에서 연다.
import { useAgents, useAppStore } from '../../app/store.ts';
import type { AgentDef } from '../../core/types.ts';
import { AgentRow } from './AgentCard.tsx';
import { Sheet } from './Sheet.tsx';

export interface AgentSwitcherProps {
  open: boolean;
  onClose: () => void;
}

export function AgentSwitcher({ open, onClose }: AgentSwitcherProps) {
  const agents = useAgents();
  const selectedId = useAppStore((s) => s.selectedAgentId);
  const selectAgent = useAppStore((s) => s.selectAgent);

  const pick = (agent: AgentDef): void => {
    selectAgent(agent.id);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="요원 바꾸기" eyebrow={`목소리 ${agents.length}개`}>
      <ul className="switcher">
        {agents.map((a, i) => (
          <li key={a.id}>
            <AgentRow agent={a} channel={i + 1} selected={a.id === selectedId} onSelect={pick} autoFocus={a.id === selectedId} />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
