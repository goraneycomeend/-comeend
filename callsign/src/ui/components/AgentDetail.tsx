// 요원 상세: 소개, 특징, 대표 대사 듣기, 목소리 구성, "이 요원으로 말하기".
// 좁은 화면에서는 시트 안에, 넓은 화면에서는 요원 화면의 오른쪽 단에 들어간다.
import { useEffect, useState } from 'react';
import { navigate } from '../../app/hash.ts';
import { ROLE_LABEL, channelLabel, displayLineText, sampleLineOf } from '../../app/roster.ts';
import { toast, useChannelNumber, usePlayPhase } from '../../app/store.ts';
import { EngineNeededError, linePlayId, speakLine, stopPlayback, voiceErrorMessage } from '../../app/voiceService.ts';
import { FX_PARAMS, formatFxValue } from '../../core/audio/index.ts';
import { BASE_VOICE_IDS } from '../../core/types.ts';
import type { AgentDef, AgentLine } from '../../core/types.ts';
import { AgentEmblem } from './AgentEmblem.tsx';
import { Button } from './Button.tsx';
import { Tag } from './Chip.tsx';
import { EngineCard } from './EngineCard.tsx';
import { PlayButton } from './PlayButton.tsx';

/** 기본 보이스 혼합을 '보이스 이름 + 비율(%)' 목록으로. 비율이 큰 것부터 */
function blendParts(agent: AgentDef): { id: string; percent: number }[] {
  const parts = BASE_VOICE_IDS.map((id) => ({ id, w: agent.voice.blend[id] ?? 0 })).filter((p) => p.w > 0);
  const total = parts.reduce((s, p) => s + p.w, 0) || 1;
  return parts
    .map((p) => ({ id: p.id, percent: Math.round((p.w / total) * 100) }))
    .sort((a, b) => b.percent - a.percent);
}

/** 0 이 아닌 효과만 '이름 값' 목록으로 */
function fxParts(agent: AgentDef): string[] {
  return FX_PARAMS.filter((p) => Math.abs(agent.voice.fx[p.key]) >= 1e-3).map(
    (p) => `${p.label} ${formatFxValue(p, agent.voice.fx[p.key])}`,
  );
}

/**
 * 대표 대사를 튼다(무전 효과 없이, 요원 본래 목소리로). 실패하면 알림으로 이유를 알려 준다.
 * `onEngineNeeded` 를 주면, 엔진이 필요해서 못 튼 경우에는 알림 대신 그 함수를 부른다.
 */
export function playSampleLine(agent: AgentDef, line: AgentLine, onEngineNeeded?: () => void): void {
  speakLine(agent, line, { radio: false }).catch((err: unknown) => {
    if (err instanceof EngineNeededError && onEngineNeeded) {
      onEngineNeeded();
      return;
    }
    const message = voiceErrorMessage(err);
    if (message) toast(message, 'warn');
  });
}

export interface AgentDetailProps {
  agent: AgentDef;
  /** 요원 이름을 h2 로 그릴지. 시트처럼 바깥에 이미 제목이 있으면 false */
  showName?: boolean;
  /** "이 요원으로 말하기"·"대사 듣기"를 누른 뒤 부른다(시트를 닫을 때) */
  onNavigate?: () => void;
}

export function AgentDetail({ agent, showName = true, onNavigate }: AgentDetailProps) {
  const channel = useChannelNumber(agent);
  const sample = sampleLineOf(agent);
  const phase = usePlayPhase(sample ? linePlayId(agent.id, sample.id) : null);
  const blend = blendParts(agent);
  const fx = fxParts(agent);
  // 녹음본이 없는 대사를 누르면 그 자리에 엔진 카드를 보여 준다
  const [needEngine, setNeedEngine] = useState(false);
  useEffect(() => setNeedEngine(false), [agent.id]);

  const go = (route: 'studio' | 'lines'): void => {
    navigate(route);
    onNavigate?.();
  };

  return (
    <article className="detail" data-agent={agent.id}>
      <AgentEmblem agentId={agent.id} variant="strip" size={44} className="detail__strip" />

      {showName ? (
        <header className="detail__head">
          <p className="detail__meta">
            <span className="t-label c-agent">{channelLabel(channel)}</span>
            <span>{agent.custom ? '내 요원' : ROLE_LABEL[agent.role]}</span>
          </p>
          <h2 className="detail__name t-display">{agent.callsign}</h2>
          {agent.callsignEn ? <p className="detail__en t-label">{agent.callsignEn}</p> : null}
        </header>
      ) : null}

      {agent.tagline ? <p className="detail__tagline t-head">{agent.tagline}</p> : null}
      {agent.bio ? <p className="detail__bio">{agent.bio}</p> : null}

      {agent.traits.length > 0 ? (
        <ul className="detail__traits" aria-label="목소리 특징">
          {agent.traits.map((t) => (
            <li key={t}>
              <Tag tone="agent">{t}</Tag>
            </li>
          ))}
        </ul>
      ) : null}

      {sample ? (
        <div className="detail__sample">
          <PlayButton
            phase={phase}
            size="lg"
            label={`${agent.callsign} 대표 대사`}
            onPlay={() => playSampleLine(agent, sample, () => setNeedEngine(true))}
            onStop={stopPlayback}
          />
          <div className="grow">
            <p className="t-caption">대표 대사</p>
            <p className="detail__quote">{displayLineText(sample.text)}</p>
          </div>
        </div>
      ) : (
        <p className="detail__empty">아직 적어 둔 대사가 없어요. 스튜디오에서 바로 말을 시켜 볼 수 있어요.</p>
      )}

      {needEngine ? (
        <EngineCard reason="이 대사는 미리 녹음해 둔 게 없어요. AI 음성 엔진을 불러오면 바로 만들어서 들려드려요." />
      ) : null}

      <div className="detail__actions">
        <Button variant="primary" icon="studio" onClick={() => go('studio')}>
          이 요원으로 말하기
        </Button>
        <Button variant="secondary" icon="lines" onClick={() => go('lines')}>
          대사 듣기
        </Button>
      </div>

      <dl className="detail__record">
        <div>
          <dt>목소리 구성</dt>
          <dd className="t-data">
            {blend.map((b, i) => (
              <span key={b.id}>
                {i > 0 ? ' + ' : ''}
                {b.id} {b.percent}%
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt>말 빠르기</dt>
          <dd className="t-data">×{agent.voice.speed.toFixed(2)}</dd>
        </div>
        <div>
          <dt>음향 처리</dt>
          <dd>{fx.length > 0 ? fx.join(' · ') : '없음 (원음 그대로)'}</dd>
        </div>
      </dl>
    </article>
  );
}
