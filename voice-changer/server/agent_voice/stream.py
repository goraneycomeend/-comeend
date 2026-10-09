"""실시간 스트리밍 세션.

브라우저가 보내는 짧은 청크(기본 300~500ms)를 그대로 변환하면 청크 경계마다 끊김이 생기므로

  * 이전 입력의 꼬리(context)를 앞에 붙여 변환한 뒤 현재 청크 구간만 잘라 쓰고,
  * 출력 끝부분(xfade 길이)을 다음 라운드까지 보류했다가 새로 계산된 값과 크로스페이드한다.

보류 때문에 xfade 길이(기본 20ms)만큼 지연이 추가된다. 입력이 조용하면(gate) 변환을 건너뛴다.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

from .agents import Agent
from .audio import dbfs, fit_length
from .engines import ConvertOptions, EngineManager


@dataclass
class StreamStats:
    chunks: int = 0
    skipped: int = 0
    last_process_ms: float = 0.0
    avg_process_ms: float = 0.0
    engine: str = ""


class StreamSession:
    def __init__(
        self,
        engines: EngineManager,
        agent: Agent,
        sr: int,
        *,
        pitch: float = 0.0,
        gate_db: float = -55.0,
        context_s: float = 0.25,
        xfade_ms: float = 20.0,
    ):
        self.engines = engines
        self.agent = agent
        self.sr = int(sr)
        self.options = ConvertOptions(pitch=pitch)
        self.gate_db = gate_db
        self.context = int(context_s * self.sr)
        self.xfade = int(xfade_ms * self.sr / 1000)
        self.stats = StreamStats(engine=engines.engine_name(agent))
        self._in_tail = np.zeros(0, dtype=np.float32)
        self._held: np.ndarray | None = None
        fade = np.linspace(0.0, 1.0, self.xfade, dtype=np.float32) if self.xfade > 0 else np.zeros(0, np.float32)
        self._fade_in = fade
        self._fade_out = 1.0 - fade

    # ----- 제어 ------------------------------------------------------------------------

    def set_agent(self, agent: Agent) -> None:
        if agent.id != self.agent.id:
            self.agent = agent
            self.stats.engine = self.engines.engine_name(agent)
            # 모델이 바뀌면 보류분을 버려 이전 목소리가 섞이지 않게 한다
            self._held = None

    def set_pitch(self, pitch: float) -> None:
        self.options = ConvertOptions(pitch=float(pitch))

    def set_gate(self, gate_db: float) -> None:
        self.gate_db = float(gate_db)

    # ----- 처리 ------------------------------------------------------------------------

    def process(self, chunk: np.ndarray) -> np.ndarray:
        chunk = np.asarray(chunk, dtype=np.float32)
        n = len(chunk)
        if n == 0:
            return chunk
        started = time.perf_counter()
        self.stats.chunks += 1

        if dbfs(chunk) < self.gate_db:
            self.stats.skipped += 1
            self._push_tail(chunk)
            out = self._emit(np.zeros(n + self.xfade, dtype=np.float32), n)
            self._record_time(started)
            return out

        x = np.concatenate([self._in_tail, chunk]) if self._in_tail.size else chunk
        engine = self.engines.resolve(self.agent)
        self.stats.engine = engine.name
        y, out_sr = engine.convert(x, self.sr, self.agent, self.options)
        if out_sr != self.sr:
            from .audio import resample

            y = resample(y, out_sr, self.sr)
        y = fit_length(y, len(x))
        # 뒤에서 (현재 청크 + xfade) 만큼이 "현재 구간 + 이전 보류 구간" 에 해당한다
        need = n + self.xfade
        region = y[-need:] if len(y) >= need else np.concatenate([np.zeros(need - len(y), np.float32), y])
        self._push_tail(chunk)
        out = self._emit(region, n)
        self._record_time(started)
        return out

    def _emit(self, region: np.ndarray, n: int) -> np.ndarray:
        """region: 길이 n + xfade. 앞 xfade 는 이전 보류분과 겹치는 구간, 뒤 xfade 는 새 보류분."""
        if self.xfade == 0:
            return region[:n]
        head = region[: self.xfade]
        body = region[self.xfade : n]
        new_held = region[n:]
        if self._held is not None and len(self._held) == self.xfade:
            head = self._held * self._fade_out + head * self._fade_in
        self._held = new_held.copy()
        return np.concatenate([head, body]).astype(np.float32)

    def _push_tail(self, chunk: np.ndarray) -> None:
        if self.context <= 0:
            return
        tail = np.concatenate([self._in_tail, chunk])
        self._in_tail = tail[-self.context :].copy()

    def _record_time(self, started: float) -> None:
        ms = (time.perf_counter() - started) * 1000.0
        self.stats.last_process_ms = ms
        k = min(self.stats.chunks, 20)
        self.stats.avg_process_ms += (ms - self.stats.avg_process_ms) / k

    def stats_dict(self) -> dict:
        return {
            "type": "stats",
            "chunks": self.stats.chunks,
            "skipped": self.stats.skipped,
            "processMs": round(self.stats.last_process_ms, 1),
            "avgProcessMs": round(self.stats.avg_process_ms, 1),
            "engine": self.stats.engine,
            "agent": self.agent.id,
        }
