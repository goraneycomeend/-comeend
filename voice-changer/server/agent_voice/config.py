"""환경 변수 기반 설정.

AGENT_VOICE_ENGINE   auto | rvc | dsp          (기본 auto: RVC 가 설치돼 있고 모델이 있으면 RVC, 아니면 DSP)
AGENT_VOICE_DEVICE   auto | cuda:0 | cpu | mps (기본 auto)
AGENT_VOICE_MODELS   모델(.pth/.index) 디렉터리 (기본 server/models)
AGENT_VOICE_AGENTS   agents.json 경로          (기본 server/agents.json)
AGENT_VOICE_WEB      빌드된 웹 UI 디렉터리     (기본 web/dist)
AGENT_VOICE_HOST / AGENT_VOICE_PORT            (기본 127.0.0.1 / 8765)
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = SERVER_DIR.parent


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


@dataclass(frozen=True)
class Settings:
    engine: str = field(default_factory=lambda: _env("AGENT_VOICE_ENGINE", "auto").lower())
    device: str = field(default_factory=lambda: _env("AGENT_VOICE_DEVICE", "auto").lower())
    models_dir: Path = field(default_factory=lambda: Path(_env("AGENT_VOICE_MODELS", str(SERVER_DIR / "models"))))
    agents_file: Path = field(default_factory=lambda: Path(_env("AGENT_VOICE_AGENTS", str(SERVER_DIR / "agents.json"))))
    web_dir: Path = field(default_factory=lambda: Path(_env("AGENT_VOICE_WEB", str(ROOT_DIR / "web" / "dist"))))
    host: str = field(default_factory=lambda: _env("AGENT_VOICE_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(_env("AGENT_VOICE_PORT", "8765")))

    def __post_init__(self) -> None:
        if self.engine not in ("auto", "rvc", "dsp"):
            raise ValueError(f"AGENT_VOICE_ENGINE 은 auto|rvc|dsp 중 하나여야 합니다: {self.engine!r}")


def load_settings() -> Settings:
    return Settings()
