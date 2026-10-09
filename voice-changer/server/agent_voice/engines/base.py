"""음성 변환 엔진 공통 인터페이스."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import numpy as np

from ..agents import Agent


@dataclass(frozen=True)
class ConvertOptions:
    pitch: float = 0.0  # 사용자가 UI 에서 추가로 조절한 피치 (반음)


@runtime_checkable
class VoiceEngine(Protocol):
    name: str

    def supports(self, agent: Agent) -> bool:
        """이 엔진으로 해당 요원을 변환할 수 있는지 (예: RVC 는 모델 파일이 있어야 함)."""
        ...

    def convert(self, audio: np.ndarray, sr: int, agent: Agent, options: ConvertOptions) -> tuple[np.ndarray, int]:
        """모노 float32 오디오를 변환해 (오디오, sr) 로 돌려준다. 길이는 입력과 (시간상) 같아야 한다."""
        ...

    def describe(self) -> dict:
        ...
