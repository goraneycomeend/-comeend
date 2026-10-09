import { ROLE_ORDER, type Agent, type Role } from '../types';

const ROLE_LABEL: Record<Role, string> = {
  duelist: '타격대',
  initiator: '척후대',
  controller: '전략가',
  sentinel: '감시자',
};

interface Props {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (agent: Agent) => void;
}

export default function AgentGrid({ agents, selectedId, onSelect }: Props) {
  return (
    <div className="agent-groups">
      {ROLE_ORDER.map((role) => {
        const list = agents.filter((a) => a.role === role);
        if (list.length === 0) return null;
        return (
          <section key={role} className="agent-group">
            <h3 className="agent-group-title">{ROLE_LABEL[role]}</h3>
            <div className="agent-grid">
              {list.map((a) => {
                const selected = a.id === selectedId;
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`agent-card${selected ? ' selected' : ''}`}
                    style={{ ['--agent' as string]: a.color }}
                    onClick={() => onSelect(a)}
                    aria-pressed={selected}
                    data-agent={a.id}
                  >
                    <span className="agent-avatar" aria-hidden="true">
                      {a.nameEn.replace('/', '').slice(0, 2).toUpperCase()}
                    </span>
                    <span className="agent-name">{a.name}</span>
                    <span className="agent-name-en">{a.nameEn}</span>
                    <span className={`agent-badge ${a.engine}`} title={a.ready ? 'RVC 모델 준비됨' : '모델 없음 → DSP 폴백'}>
                      {a.engine === 'rvc' ? 'RVC' : 'DSP'}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
