interface Props {
  /** RMS (0~1) */
  rms: number;
  /** 게이트 임계값 dBFS. 이 아래면 변환을 건너뛴다. */
  gateDb: number;
}

const MIN_DB = -80;

export default function LevelMeter({ rms, gateDb }: Props) {
  const db = rms > 1e-6 ? 20 * Math.log10(rms) : MIN_DB;
  const pct = Math.max(0, Math.min(100, ((db - MIN_DB) / -MIN_DB) * 100));
  const gatePct = Math.max(0, Math.min(100, ((gateDb - MIN_DB) / -MIN_DB) * 100));
  const open = db >= gateDb;
  return (
    <div className="meter" title={`${db.toFixed(0)} dBFS`}>
      <div className={`meter-fill${open ? ' open' : ''}`} style={{ width: `${pct}%` }} />
      <div className="meter-gate" style={{ left: `${gatePct}%` }} />
      <span className="meter-label">{db <= MIN_DB ? '−∞' : `${db.toFixed(0)} dB`}</span>
    </div>
  );
}
