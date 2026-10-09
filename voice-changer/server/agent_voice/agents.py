"""agents.json 로딩과 요원별 설정.

모델 파일(.pth / .index)은 저장소에 포함하지 않습니다. 사용자가 직접 구한 RVC 모델을
``models/`` 에 넣고 agents.json 의 ``model`` / ``index`` 경로만 맞추면 됩니다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

ROLES = {"duelist": "타격대", "initiator": "척후대", "controller": "전략가", "sentinel": "감시자"}
DSP_FX = {None, "robot", "ghost", "radio"}


@dataclass(frozen=True)
class DspPreset:
    pitch: float = 0.0  # 반음 단위 피치 이동
    formant: float = 1.0  # 포먼트 비율 (1 보다 크면 밝고 작은 성도, 작으면 어둡고 큰 성도)
    fx: str | None = None  # robot | ghost | radio | None


@dataclass(frozen=True)
class Agent:
    id: str
    name: str
    name_en: str
    role: str
    color: str
    model: Path | None
    index: Path | None
    pitch: float  # RVC f0 up key (반음). 모델 기준 추가 보정값
    dsp: DspPreset = field(default_factory=DspPreset)

    @property
    def model_ready(self) -> bool:
        return self.model is not None and self.model.is_file()

    @property
    def role_ko(self) -> str:
        return ROLES.get(self.role, self.role)


def _resolve(base: Path, value: str | None) -> Path | None:
    if not value:
        return None
    p = Path(value)
    return p if p.is_absolute() else (base / p)


def parse_agents(data: dict, base_dir: Path) -> list[Agent]:
    agents: list[Agent] = []
    seen: set[str] = set()
    for raw in data.get("agents", []):
        agent_id = str(raw["id"])
        if agent_id in seen:
            raise ValueError(f"요원 id 가 중복됩니다: {agent_id}")
        seen.add(agent_id)
        role = str(raw.get("role", "")).lower()
        if role not in ROLES:
            raise ValueError(f"{agent_id}: 알 수 없는 역할 {role!r} (가능: {', '.join(ROLES)})")
        dsp_raw = raw.get("dsp") or {}
        fx = dsp_raw.get("fx")
        if fx not in DSP_FX:
            raise ValueError(f"{agent_id}: 알 수 없는 dsp.fx {fx!r}")
        agents.append(
            Agent(
                id=agent_id,
                name=str(raw.get("name", agent_id)),
                name_en=str(raw.get("nameEn", agent_id)),
                role=role,
                color=str(raw.get("color", "#ff4655")),
                model=_resolve(base_dir, raw.get("model")),
                index=_resolve(base_dir, raw.get("index")),
                pitch=float(raw.get("pitch", 0)),
                dsp=DspPreset(
                    pitch=float(dsp_raw.get("pitch", 0)),
                    formant=float(dsp_raw.get("formant", 1.0)),
                    fx=fx,
                ),
            )
        )
    if not agents:
        raise ValueError("agents.json 에 요원이 하나도 없습니다")
    return agents


class AgentRegistry:
    def __init__(self, agents: Iterable[Agent]):
        self._agents = {a.id: a for a in agents}

    @classmethod
    def from_file(cls, path: Path, models_dir: Path | None = None) -> "AgentRegistry":
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        # 모델 경로는 agents.json 이 있는 디렉터리 기준. AGENT_VOICE_MODELS 가 주어지면 그 디렉터리 기준으로
        # "models/xxx.pth" 의 "models/" 접두어를 치환해 준다.
        base_dir = path.parent
        agents = parse_agents(data, base_dir)
        if models_dir is not None and models_dir.resolve() != (base_dir / "models").resolve():
            agents = [_remap_models(a, base_dir / "models", models_dir) for a in agents]
        return cls(agents)

    def all(self) -> list[Agent]:
        return list(self._agents.values())

    def get(self, agent_id: str) -> Agent | None:
        return self._agents.get(agent_id)

    def __len__(self) -> int:
        return len(self._agents)


def _remap_models(agent: Agent, old_dir: Path, new_dir: Path) -> Agent:
    def remap(p: Path | None) -> Path | None:
        if p is None:
            return None
        try:
            return new_dir / p.resolve().relative_to(old_dir.resolve())
        except ValueError:
            return p

    return Agent(
        id=agent.id,
        name=agent.name,
        name_en=agent.name_en,
        role=agent.role,
        color=agent.color,
        model=remap(agent.model),
        index=remap(agent.index),
        pitch=agent.pitch,
        dsp=agent.dsp,
    )
