import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { convertClip, fetchAgents } from './api';
import { MicCapture, listDevices, requestMicPermission, supportsOutputSelection } from './audio/capture';
import { StreamPlayer } from './audio/playback';
import { VoiceStream } from './audio/stream';
import { concatFloat32, encodeWav } from './audio/wav';
import AgentGrid from './components/AgentGrid';
import LevelMeter from './components/LevelMeter';
import ModelManager from './components/ModelManager';
import type { Agent, EngineInfo, StreamStats } from './types';

type Mode = 'live' | 'clip';

interface LiveStatus {
  running: boolean;
  connecting: boolean;
  stats: StreamStats | null;
  rttMs: number;
  bufferedMs: number;
  underruns: number;
  error: string | null;
}

const LS_KEY = 'agent-voice:settings';

interface Persisted {
  agentId?: string;
  inputId?: string;
  outputId?: string;
  pitch?: number;
  chunkMs?: number;
  gateDb?: number;
  noiseSuppression?: boolean;
  monitor?: boolean;
}

function loadPersisted(): Persisted {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Persisted;
  } catch {
    return {};
  }
}

export default function App() {
  const persisted = useMemo(loadPersisted, []);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(persisted.agentId ?? null);

  const [mode, setMode] = useState<Mode>('live');
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [inputId, setInputId] = useState(persisted.inputId ?? '');
  const [outputId, setOutputId] = useState(persisted.outputId ?? 'default');
  const [pitch, setPitch] = useState(persisted.pitch ?? 0);
  const [chunkMs, setChunkMs] = useState(persisted.chunkMs ?? 400);
  const [gateDb, setGateDb] = useState(persisted.gateDb ?? -55);
  const [noiseSuppression, setNoiseSuppression] = useState(persisted.noiseSuppression ?? true);
  const [monitor, setMonitor] = useState(persisted.monitor ?? false);

  const [level, setLevel] = useState(0);
  const [live, setLive] = useState<LiveStatus>({
    running: false,
    connecting: false,
    stats: null,
    rttMs: 0,
    bufferedMs: 0,
    underruns: 0,
    error: null,
  });

  const [recording, setRecording] = useState(false);
  const [converting, setConverting] = useState(false);
  const [clipResult, setClipResult] = useState<{ url: string; engine: string; agent: string } | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);

  const captureRef = useRef<MicCapture | null>(null);
  const streamRef = useRef<VoiceStream | null>(null);
  const playerRef = useRef<StreamPlayer | null>(null);
  const monitorRef = useRef<StreamPlayer | null>(null);
  const clipChunksRef = useRef<Float32Array[]>([]);

  const selected = agents.find((a) => a.id === selectedId) ?? null;
  const outputSelectable = supportsOutputSelection();

  // ----- 초기 로드 ---------------------------------------------------------------------

  const reloadAgents = useCallback(async () => {
    try {
      const res = await fetchAgents();
      setAgents(res.agents);
      setEngine(res.engine);
      setLoadError(null);
      setSelectedId((cur) => (cur && res.agents.some((a) => a.id === cur) ? cur : (res.agents[0]?.id ?? null)));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reloadAgents();
    void refreshDevices();
  }, [reloadAgents]);

  useEffect(() => {
    const data: Persisted = { agentId: selectedId ?? undefined, inputId, outputId, pitch, chunkMs, gateDb, noiseSuppression, monitor };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch {
      /* 저장 못 해도 동작에는 지장 없음 */
    }
  }, [selectedId, inputId, outputId, pitch, chunkMs, gateDb, noiseSuppression, monitor]);

  const refreshDevices = useCallback(async () => {
    try {
      const d = await listDevices();
      setInputs(d.inputs);
      setOutputs(d.outputs);
    } catch {
      /* 권한 전에는 비어 있을 수 있음 */
    }
  }, []);

  const grantPermission = useCallback(async () => {
    try {
      await requestMicPermission();
      await refreshDevices();
    } catch (e) {
      setLive((s) => ({ ...s, error: `마이크 권한을 얻지 못했습니다: ${(e as Error).message}` }));
    }
  }, [refreshDevices]);

  // ----- 실시간 모드 --------------------------------------------------------------------

  const stopLive = useCallback(async () => {
    streamRef.current?.close();
    streamRef.current = null;
    await captureRef.current?.stop();
    captureRef.current = null;
    await playerRef.current?.close();
    playerRef.current = null;
    await monitorRef.current?.close();
    monitorRef.current = null;
    setLevel(0);
    setLive((s) => ({ ...s, running: false, connecting: false }));
  }, []);

  const startLive = useCallback(async () => {
    if (!selected) return;
    setLive((s) => ({ ...s, connecting: true, error: null, underruns: 0, rttMs: 0, bufferedMs: 0 }));
    const capture = new MicCapture();
    try {
      await capture.start({
        deviceId: inputId || undefined,
        chunkMs,
        noiseSuppression,
        echoCancellation: false,
        autoGainControl: false,
      });
      const sr = capture.sampleRate;
      const player = new StreamPlayer(sr);
      await player.setSink(outputId);
      await player.resume();
      let monitorPlayer: StreamPlayer | null = null;
      if (monitor && outputId !== 'default') {
        monitorPlayer = new StreamPlayer(sr);
        await monitorPlayer.resume();
      }
      const stream = new VoiceStream({
        onAudio: (samples, rtt) => {
          // 새 청크를 넣기 전 남아 있는 버퍼가 실제 재생 대기 시간이다 (넣은 뒤 재면 방금 넣은 청크까지 더해짐)
          const waiting = player.bufferedMs;
          player.push(samples);
          monitorPlayer?.push(samples);
          setLive((s) => ({ ...s, rttMs: rtt, bufferedMs: waiting, underruns: player.underruns }));
        },
        onStats: (stats) => setLive((s) => ({ ...s, stats })),
        onError: (message) => setLive((s) => ({ ...s, error: message })),
        onClose: () => {
          if (!stream.closedByUser) {
            setLive((s) => ({ ...s, error: '서버와의 연결이 끊어졌습니다' }));
            void stopLive();
          }
        },
      });
      await stream.connect({ agent: selected.id, sr, pitch, gate: gateDb, context: 0.25, xfade: 20 });
      capture.onChunk = (samples) => stream.send(samples);
      capture.onLevel = (rms) => setLevel(rms);
      captureRef.current = capture;
      streamRef.current = stream;
      playerRef.current = player;
      monitorRef.current = monitorPlayer;
      setLive((s) => ({ ...s, running: true, connecting: false }));
      void refreshDevices();
    } catch (e) {
      await capture.stop();
      setLive((s) => ({ ...s, running: false, connecting: false, error: (e as Error).message }));
    }
  }, [selected, inputId, outputId, chunkMs, gateDb, noiseSuppression, pitch, monitor, refreshDevices, stopLive]);

  // 실행 중 설정 변경은 재시작 없이 반영
  useEffect(() => {
    if (live.running && selected) streamRef.current?.set({ agent: selected.id });
  }, [selected, live.running]);
  useEffect(() => {
    if (!live.running) return;
    const t = setTimeout(() => streamRef.current?.set({ pitch }), 150);
    return () => clearTimeout(t);
  }, [pitch, live.running]);
  useEffect(() => {
    if (live.running) streamRef.current?.set({ gate: gateDb });
  }, [gateDb, live.running]);
  useEffect(() => {
    if (live.running) captureRef.current?.setChunkMs(chunkMs);
  }, [chunkMs, live.running]);
  useEffect(() => {
    if (live.running) void playerRef.current?.setSink(outputId);
  }, [outputId, live.running]);

  useEffect(() => () => void stopLive(), [stopLive]);

  // ----- 클립 모드 ----------------------------------------------------------------------

  const startRecording = useCallback(async () => {
    if (recording || converting) return;
    setClipError(null);
    const capture = new MicCapture();
    try {
      clipChunksRef.current = [];
      await capture.start({ deviceId: inputId || undefined, chunkMs: 100, noiseSuppression, echoCancellation: false, autoGainControl: false });
      capture.onChunk = (s) => clipChunksRef.current.push(s);
      capture.onLevel = (rms) => setLevel(rms);
      captureRef.current = capture;
      setRecording(true);
    } catch (e) {
      await capture.stop();
      setClipError((e as Error).message);
    }
  }, [recording, converting, inputId, noiseSuppression]);

  const stopRecording = useCallback(async () => {
    const capture = captureRef.current;
    if (!capture || !recording) return;
    const sr = capture.sampleRate;
    await capture.stop();
    captureRef.current = null;
    setRecording(false);
    setLevel(0);
    const samples = concatFloat32(clipChunksRef.current);
    clipChunksRef.current = [];
    if (samples.length < sr * 0.2 || !selected) {
      setClipError('녹음이 너무 짧습니다 (0.2초 이상 말해 주세요)');
      return;
    }
    setConverting(true);
    try {
      const { blob, engine: usedEngine } = await convertClip(encodeWav(samples, sr), selected.id, pitch);
      setClipResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url: URL.createObjectURL(blob), engine: usedEngine, agent: selected.name };
      });
    } catch (e) {
      setClipError((e as Error).message);
    } finally {
      setConverting(false);
    }
  }, [recording, selected, pitch]);

  const switchMode = useCallback(
    async (next: Mode) => {
      if (next === mode) return;
      if (live.running || live.connecting) await stopLive();
      if (recording) await stopRecording();
      setMode(next);
    },
    [mode, live.running, live.connecting, recording, stopLive, stopRecording],
  );

  // ----- 렌더 ----------------------------------------------------------------------------

  const readyCount = agents.filter((a) => a.ready).length;
  const estLatency = live.running ? Math.round(chunkMs + live.rttMs + live.bufferedMs) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>요원보이스</h1>
          <span className="brand-sub">VALORANT 요원 목소리 변환</span>
        </div>
        <div className="engine-chip" data-engine={engine?.active.name ?? 'none'}>
          {engine ? (
            <>
              <strong>{engine.active.label}</strong>
              <span>
                모델 {readyCount}/{agents.length}
              </span>
            </>
          ) : loadError ? (
            <strong className="err">서버 연결 실패</strong>
          ) : (
            <span>불러오는 중…</span>
          )}
        </div>
      </header>

      {loadError && (
        <div className="banner error">
          서버에 연결할 수 없습니다: {loadError}
          <br />
          <code>voice-changer/server</code> 에서 <code>python -m agent_voice</code> 를 실행했는지 확인하세요.
        </div>
      )}
      {engine && engine.active.name === 'dsp' && (
        <div className="banner warn">
          지금은 <b>DSP 폴백</b>(피치·포먼트 변환)으로 동작 중입니다. 요원과 똑같은 목소리를 내려면 요원별 RVC 모델을{' '}
          <code>server/models/</code> 에 넣고 RVC 의존성을 설치하세요.
          {engine.rvcError && <span className="banner-detail"> ({engine.rvcError})</span>}
        </div>
      )}

      <main className="layout">
        <section className="panel agents-panel">
          <div className="panel-head">
            <h2>요원 선택</h2>
            {selected && (
              <span className="selected-pill" style={{ ['--agent' as string]: selected.color }}>
                {selected.name} · {selected.roleKo} · {selected.engine.toUpperCase()}
              </span>
            )}
          </div>
          <AgentGrid agents={agents} selectedId={selectedId} onSelect={(a) => setSelectedId(a.id)} />
          {selected && <ModelManager agent={selected} engine={engine} disabled={live.running || live.connecting} onChanged={() => void reloadAgents()} />}
        </section>

        <aside className="panel controls-panel">
          <div className="mode-switch" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'live'} className={mode === 'live' ? 'on' : ''} onClick={() => void switchMode('live')}>
              실시간
            </button>
            <button type="button" role="tab" aria-selected={mode === 'clip'} className={mode === 'clip' ? 'on' : ''} onClick={() => void switchMode('clip')}>
              녹음 후 변환
            </button>
          </div>

          <div className="field">
            <label htmlFor="input-device">입력 (마이크)</label>
            <div className="row">
              <select id="input-device" value={inputId} onChange={(e) => setInputId(e.target.value)} disabled={live.running || recording}>
                <option value="">기본 마이크</option>
                {inputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `마이크 ${d.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
              <button type="button" className="ghost" onClick={() => void grantPermission()} title="장치 이름을 보려면 마이크 권한이 필요합니다">
                권한/새로고침
              </button>
            </div>
          </div>

          {mode === 'live' && (
            <div className="field">
              <label htmlFor="output-device">출력</label>
              <select id="output-device" value={outputId} onChange={(e) => setOutputId(e.target.value)} disabled={!outputSelectable}>
                <option value="default">기본 스피커</option>
                {outputs
                  .filter((d) => d.deviceId !== 'default')
                  .map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `출력 ${d.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
              </select>
              <p className="hint">
                게임·디스코드에서 쓰려면 가상 케이블(VB-CABLE 등)의 <b>Input</b> 을 여기서 고르고, 게임 마이크를 그 케이블의 <b>Output</b> 으로
                설정하세요.
                {!outputSelectable && ' (이 브라우저는 출력 장치 선택을 지원하지 않습니다 — Chrome/Edge 권장)'}
              </p>
              {outputId !== 'default' && (
                <label className="check">
                  <input type="checkbox" checked={monitor} onChange={(e) => setMonitor(e.target.checked)} disabled={live.running} />
                  기본 스피커로도 함께 듣기 (모니터)
                </label>
              )}
            </div>
          )}

          <div className="field">
            <label htmlFor="pitch">
              피치 보정 <span className="value">{pitch > 0 ? `+${pitch}` : pitch} 반음</span>
            </label>
            <input id="pitch" type="range" min={-12} max={12} step={1} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} />
            <p className="hint">본인 목소리가 낮으면 +, 높으면 − 로 맞추세요. RVC 모델에도 그대로 더해집니다.</p>
          </div>

          {mode === 'live' && (
            <>
              <div className="field">
                <label htmlFor="chunk">
                  청크 길이 <span className="value">{chunkMs} ms</span>
                </label>
                <input id="chunk" type="range" min={200} max={800} step={50} value={chunkMs} onChange={(e) => setChunkMs(Number(e.target.value))} />
                <p className="hint">짧을수록 지연이 줄지만 품질이 떨어지고 GPU 부하가 커집니다. RVC 는 300~500ms 권장.</p>
              </div>
              <div className="field">
                <label htmlFor="gate">
                  노이즈 게이트 <span className="value">{gateDb} dB</span>
                </label>
                <input id="gate" type="range" min={-80} max={-20} step={1} value={gateDb} onChange={(e) => setGateDb(Number(e.target.value))} />
              </div>
            </>
          )}

          <label className="check">
            <input type="checkbox" checked={noiseSuppression} onChange={(e) => setNoiseSuppression(e.target.checked)} disabled={live.running || recording} />
            브라우저 노이즈 억제 사용
          </label>

          <div className="field">
            <label>입력 레벨</label>
            <LevelMeter rms={level} gateDb={mode === 'live' ? gateDb : -80} />
          </div>

          {mode === 'live' ? (
            <>
              <button
                type="button"
                className={`big ${live.running ? 'stop' : 'start'}`}
                disabled={!selected || live.connecting}
                onClick={() => void (live.running ? stopLive() : startLive())}
                data-testid="live-toggle"
              >
                {live.connecting ? '연결 중…' : live.running ? '■ 정지' : '● 변환 시작'}
              </button>
              {live.error && <div className="banner error small">{live.error}</div>}
              <dl className="stats" data-testid="live-stats">
                <dt>엔진</dt>
                <dd>{live.stats?.engine?.toUpperCase() ?? '-'}</dd>
                <dt>처리 시간</dt>
                <dd>{live.stats ? `${live.stats.processMs} ms (평균 ${live.stats.avgProcessMs})` : '-'}</dd>
                <dt>왕복</dt>
                <dd>{live.running ? `${Math.round(live.rttMs)} ms` : '-'}</dd>
                <dt>예상 지연</dt>
                <dd>{estLatency !== null ? `약 ${estLatency} ms` : '-'}</dd>
                <dt>청크</dt>
                <dd data-testid="chunk-count">{live.stats ? `${live.stats.chunks} (무음 건너뜀 ${live.stats.skipped})` : '-'}</dd>
                <dt>끊김</dt>
                <dd>{live.running ? `${live.underruns}회` : '-'}</dd>
              </dl>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`big ${recording ? 'stop' : 'start'}`}
                disabled={!selected || converting}
                onPointerDown={() => void startRecording()}
                onPointerUp={() => void stopRecording()}
                onPointerLeave={() => recording && void stopRecording()}
                onKeyDown={(e) => {
                  if ((e.key === ' ' || e.key === 'Enter') && !recording) void startRecording();
                }}
                onKeyUp={(e) => {
                  if ((e.key === ' ' || e.key === 'Enter') && recording) void stopRecording();
                }}
              >
                {converting ? '변환 중…' : recording ? '● 녹음 중 — 놓으면 변환' : '누르고 있는 동안 녹음'}
              </button>
              {clipError && <div className="banner error small">{clipError}</div>}
              {clipResult && (
                <div className="clip-result">
                  <div className="clip-meta">
                    {clipResult.agent} · {clipResult.engine.toUpperCase()}
                  </div>
                  <audio controls src={clipResult.url} autoPlay />
                  <a className="ghost" href={clipResult.url} download={`${selected?.id ?? 'voice'}.wav`}>
                    WAV 저장
                  </a>
                </div>
              )}
            </>
          )}
        </aside>
      </main>

      <footer className="foot">
        비공식 팬 제작 도구이며 Riot Games 와 무관합니다. 요원 목소리는 실제 성우의 음성이므로, 변환 결과는 개인 게임·방송 용도로만 쓰고 타인을
        속이거나 상업적으로 이용하지 마세요.
      </footer>
    </div>
  );
}
