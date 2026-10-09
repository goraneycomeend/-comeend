import { useEffect, useRef, useState } from 'react';
import { deleteModel, uploadModel } from '../api';
import type { Agent, EngineInfo, ScanInfo } from '../types';

interface Props {
  agent: Agent;
  engine: EngineInfo | null;
  disabled?: boolean;
  /** 설치/삭제 후 요원 목록을 다시 불러오라는 신호 */
  onChanged: () => void;
}

function fmtBytes(n: number): string {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export default function ModelManager({ agent, engine, disabled, onChanged }: Props) {
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [indexFile, setIndexFile] = useState<File | null>(null);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState<'upload' | 'delete' | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<ScanInfo | null>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const indexInputRef = useRef<HTMLInputElement>(null);

  // 요원이 바뀌면 입력을 비운다
  useEffect(() => {
    setModelFile(null);
    setIndexFile(null);
    setError(null);
    setLastScan(null);
    setForce(false);
    if (modelInputRef.current) modelInputRef.current.value = '';
    if (indexInputRef.current) indexInputRef.current.value = '';
  }, [agent.id]);

  const install = async () => {
    if (!modelFile) return;
    setBusy('upload');
    setError(null);
    setProgress(0);
    try {
      const res = await uploadModel(agent.id, modelFile, indexFile, force, setProgress);
      setLastScan(res.install.scan);
      setModelFile(null);
      setIndexFile(null);
      if (modelInputRef.current) modelInputRef.current.value = '';
      if (indexInputRef.current) indexInputRef.current.value = '';
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm(`${agent.name} 모델 파일을 삭제할까요?`)) return;
    setBusy('delete');
    setError(null);
    try {
      await deleteModel(agent.id);
      setLastScan(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const rvcMissing = engine ? !engine.rvcAvailable : false;

  return (
    <div className="model-box" data-testid="model-manager">
      <div className="model-head">
        <strong>{agent.name} 모델</strong>
        <span className={`model-status ${agent.ready ? 'ok' : 'none'}`} data-testid="model-status">
          {agent.ready ? `설치됨${agent.hasIndex ? ' (+index)' : ''}` : '없음 → DSP 폴백'}
        </span>
      </div>

      {agent.ready && rvcMissing && (
        <p className="hint warn-text">
          모델은 있지만 RVC 의존성이 설치돼 있지 않아 아직 DSP 로 동작합니다. <code>pip install -r requirements-rvc.txt</code> 후 서버를 다시 시작하세요.
        </p>
      )}

      <div className="model-files">
        <label className="file-field">
          <span>.pth 또는 .zip</span>
          <input
            ref={modelInputRef}
            type="file"
            accept=".pth,.pt,.zip"
            disabled={disabled || busy !== null}
            onChange={(e) => setModelFile(e.target.files?.[0] ?? null)}
            data-testid="model-file"
          />
        </label>
        <label className="file-field">
          <span>.index (선택)</span>
          <input
            ref={indexInputRef}
            type="file"
            accept=".index"
            disabled={disabled || busy !== null}
            onChange={(e) => setIndexFile(e.target.files?.[0] ?? null)}
            data-testid="index-file"
          />
        </label>
      </div>

      <div className="model-actions">
        <button type="button" className="primary" disabled={!modelFile || busy !== null || disabled} onClick={() => void install()} data-testid="model-install">
          {busy === 'upload' ? (progress < 1 ? `업로드 ${Math.round(progress * 100)}%` : '검사·설치 중…') : agent.ready ? '교체 설치' : '설치'}
        </button>
        {agent.ready && (
          <button type="button" className="ghost" disabled={busy !== null || disabled} onClick={() => void remove()} data-testid="model-delete">
            삭제
          </button>
        )}
        <label className="check tiny" title="RVC 체크포인트 형식이 아니라는 경고가 떠도 설치합니다. 안전하지 않은 파일은 그래도 거부됩니다.">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} disabled={busy !== null} />
          형식 경고 무시
        </label>
      </div>

      {error && (
        <div className="banner error small" data-testid="model-error">
          {error}
        </div>
      )}
      {lastScan && (
        <div className="scan-result" data-testid="model-scan">
          검사 통과 · {lastScan.format} · {lastScan.sample_rate ?? '?'} · {lastScan.version ?? '?'} · 가중치 {lastScan.weights}개 · {fmtBytes(lastScan.size_bytes)}
          {lastScan.warnings.length > 0 && <div className="warn-text">{lastScan.warnings.join(' / ')}</div>}
        </div>
      )}
      <p className="hint">
        업로드한 .pth 는 torch 로 열기 전에 내용물을 검사해, 텐서·설정 외의 실행 코드가 들어 있으면 거부합니다. 모델 파일은 <code>server/models/</code> 에 저장되며 저장소에는 올라가지 않습니다.
      </p>
    </div>
  );
}
