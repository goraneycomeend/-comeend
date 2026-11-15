// AI 음성 엔진 카드: 지금 상태, 받는 진행률, 용량 안내, 불러오기 버튼.
// 모델(약 145MB)은 사용자가 버튼을 누르기 전에는 받지 않는다.
import type { ReactNode } from 'react';
import { useAppStore } from '../../app/store.ts';
import { loadEngine } from '../../app/voiceService.ts';
import { Button } from './Button.tsx';
import { Tag } from './Chip.tsx';
import { Icon } from './Icon.tsx';

/** 받기 전에 안내하는 모델 크기 */
export const MODEL_SIZE_LABEL = '약 145MB';

const mb = (bytes: number): string => `${Math.round(bytes / 1_000_000)}MB`;

export interface EngineCardProps {
  /** 엔진이 왜 필요한지 한 줄. 화면마다 다르게 준다. 예) "이 대사는 녹음본이 없어서 엔진으로 만들어야 해요." */
  reason?: ReactNode;
  /** 준비된 뒤에는 한 줄로 줄여 보인다(기본). false 면 준비된 뒤에도 카드 그대로 */
  collapseWhenReady?: boolean;
  className?: string;
}

function startLoading(): void {
  // 실패 내용은 스토어의 engine.errorMessage 로 카드에 보인다
  void loadEngine().catch(() => undefined);
}

export function EngineCard({ reason, collapseWhenReady = true, className }: EngineCardProps) {
  const engine = useAppStore((s) => s.engine);
  const cls = ['engine', `engine--${engine.status}`, className ?? ''].filter(Boolean).join(' ');

  if (engine.status === 'ready' && collapseWhenReady) {
    return (
      <p className={`${cls} engine--line`} role="status">
        <span className="engine__dot" aria-hidden="true" />
        <span>AI 음성 엔진 준비됨</span>
        <span className="c-pencil">· 이 기기 안에서 돌아가요</span>
      </p>
    );
  }

  const p = engine.progress;
  const downloading = engine.status === 'loading' && p?.phase === 'download' && p.totalBytes > 0;
  const fraction = downloading && p ? Math.min(1, p.loadedBytes / p.totalBytes) : 0;
  const percent = Math.round(fraction * 100);

  return (
    <section className={cls} aria-label="AI 음성 엔진">
      <header className="engine__head">
        <Icon name="chip" size={20} className="engine__icon" />
        <h2 className="engine__title t-head">AI 음성 엔진</h2>
        <Tag tone={engine.status === 'ready' ? 'agent' : 'plain'}>
          {engine.status === 'ready' ? '준비됨' : '기기 안에서 실행'}
        </Tag>
      </header>

      {engine.status === 'idle' ? (
        <>
          <p className="engine__text">
            {reason ?? '글을 요원 목소리로 바꾸려면 음성 모델을 한 번 불러와야 해요.'}
          </p>
          <ul className="engine__facts">
            <li>모델 크기는 {MODEL_SIZE_LABEL}. 아래 버튼을 누르기 전에는 받지 않아요.</li>
            <li>불러온 뒤에는 인터넷 없이 이 기기 안에서만 돌아가요. 적은 글은 밖으로 나가지 않아요.</li>
          </ul>
          <Button variant="primary" icon="download" onClick={startLoading}>
            AI 음성 엔진 불러오기 · {MODEL_SIZE_LABEL}
          </Button>
        </>
      ) : null}

      {engine.status === 'loading' ? (
        <div className="engine__progress" role="status" aria-live="polite">
          <div
            className={downloading ? 'bar' : 'bar bar--busy'}
            role="progressbar"
            aria-label="AI 음성 엔진 불러오는 중"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={downloading ? percent : undefined}
          >
            <div className="bar__fill" style={{ transform: `scaleX(${downloading ? fraction : 1})` }} />
          </div>
          <p className="engine__status">
            {downloading && p ? (
              <>
                <span>모델을 받는 중이에요</span>
                <span className="t-data">
                  {mb(p.loadedBytes)} / {mb(p.totalBytes)} · {percent}%
                </span>
              </>
            ) : p?.phase === 'init' ? (
              <span>다 받았어요. 엔진을 깨우는 중이에요…</span>
            ) : (
              <span>불러올 준비를 하고 있어요…</span>
            )}
          </p>
        </div>
      ) : null}

      {engine.status === 'ready' ? (
        <p className="engine__text">준비됐어요. 이제 글을 적으면 이 기기 안에서 바로 목소리로 만들어요.</p>
      ) : null}

      {engine.status === 'error' ? (
        <>
          <p className="engine__text engine__text--error" role="alert">
            {engine.errorMessage ?? 'AI 음성 엔진을 불러오지 못했어요.'}
          </p>
          <Button variant="secondary" icon="refresh" onClick={startLoading}>
            다시 불러오기
          </Button>
        </>
      ) : null}
    </section>
  );
}
