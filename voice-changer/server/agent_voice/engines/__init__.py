"""엔진 선택: 요원별로 RVC 모델이 있으면 RVC, 없으면 DSP 폴백."""

from __future__ import annotations

import logging

from ..agents import Agent, AgentRegistry
from .base import ConvertOptions, VoiceEngine
from .dsp import DspEngine
from .rvc import RvcEngine, rvc_available

log = logging.getLogger(__name__)

__all__ = ["ConvertOptions", "VoiceEngine", "DspEngine", "RvcEngine", "EngineManager"]


class EngineManager:
    def __init__(self, mode: str, device: str, registry: AgentRegistry):
        self.mode = mode
        self.dsp = DspEngine()
        self.rvc: RvcEngine | None = None
        self.rvc_error: str | None = None

        want_rvc = mode in ("auto", "rvc")
        any_model = any(a.model_ready for a in registry.all())
        if want_rvc:
            if not rvc_available():
                self.rvc_error = "rvc-python 이 설치돼 있지 않습니다 (pip install -r requirements-rvc.txt)"
            elif not any_model and mode == "auto":
                self.rvc_error = "models/ 에 요원 모델(.pth) 이 없어 DSP 폴백으로 동작합니다"
            else:
                try:
                    self.rvc = RvcEngine(device=device)
                except Exception as exc:  # noqa: BLE001
                    self.rvc_error = f"RVC 초기화 실패: {exc}"
        if mode == "rvc" and self.rvc is None:
            raise RuntimeError(self.rvc_error or "RVC 엔진을 사용할 수 없습니다")
        if self.rvc_error:
            log.warning("%s", self.rvc_error)

    def resolve(self, agent: Agent) -> VoiceEngine:
        if self.rvc is not None and self.rvc.supports(agent):
            return self.rvc
        return self.dsp

    def engine_name(self, agent: Agent) -> str:
        return self.resolve(agent).name

    def describe(self) -> dict:
        active = self.rvc if self.rvc is not None else self.dsp
        return {
            "mode": self.mode,
            "active": active.describe(),
            "rvcAvailable": rvc_available(),
            "rvcError": self.rvc_error,
        }
