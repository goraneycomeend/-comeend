"""RVC(Retrieval-based Voice Conversion) 엔진.

`rvc-python` 패키지(https://github.com/daswer123/rvc-python) 를 사용한다. 설치:

    pip install -r requirements-rvc.txt     # torch 는 CUDA 버전에 맞게 별도 설치 권장

요원별 모델은 agents.json 의 ``model``(.pth) / ``index``(.index) 로 지정한다. 모델 파일은 저장소에
포함하지 않으며, 사용자가 직접 준비해 ``models/`` 에 넣는다.

torch / rvc_python 임포트는 모두 지연(lazy) 로드라서, 설치돼 있지 않아도 서버는 DSP 엔진으로 뜬다.
"""

from __future__ import annotations

import logging
import os
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path

import numpy as np
import soundfile as sf

from ..agents import Agent
from ..audio import fit_length, match_rms, resample, rms
from .base import ConvertOptions

log = logging.getLogger(__name__)

# RVC 추론 기본값. index_rate 가 높을수록 모델 음색에 가깝고 낮을수록 발음이 또렷하다.
DEFAULT_PARAMS = dict(
    f0method="rmvpe",
    index_rate=0.75,
    filter_radius=3,
    resample_sr=0,
    rms_mix_rate=0.25,
    protect=0.33,
)


def rvc_available() -> bool:
    try:
        import rvc_python  # noqa: F401
    except Exception:  # noqa: BLE001 - 어떤 이유든 못 쓰면 False
        return False
    return True


def pick_device(preference: str = "auto") -> str:
    if preference not in ("", "auto"):
        return preference
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda:0"
        if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
            return "mps"
    except Exception:  # noqa: BLE001
        pass
    return "cpu"


class RvcEngine:
    """요원별 RVC 모델을 필요할 때 로드하고, 최근 사용한 모델 몇 개만 메모리에 유지한다."""

    name = "rvc"

    def __init__(self, device: str = "auto", max_loaded: int = 2):
        self.device = pick_device(device)
        self.max_loaded = max(1, max_loaded)
        self._instances: "OrderedDict[str, object]" = OrderedDict()
        self._lock = threading.Lock()

    # ----- 공개 API -----------------------------------------------------------------

    def supports(self, agent: Agent) -> bool:
        return agent.model_ready

    def convert(self, audio: np.ndarray, sr: int, agent: Agent, options: ConvertOptions) -> tuple[np.ndarray, int]:
        if not agent.model_ready:
            raise FileNotFoundError(f"{agent.name} 모델 파일이 없습니다: {agent.model}")
        x = np.asarray(audio, dtype=np.float32)
        if x.size == 0:
            return x, sr
        level = rms(x)
        with self._lock:
            rvc = self._get_instance(agent)
            rvc.set_params(f0up_key=float(agent.pitch + options.pitch), **DEFAULT_PARAMS)
            y, out_sr = self._infer(rvc, x, sr)
        y = resample(y, out_sr, sr)
        y = fit_length(y, len(x))
        y = match_rms(y, level)
        return np.clip(y, -1.0, 1.0).astype(np.float32), sr

    def describe(self) -> dict:
        return {"name": self.name, "device": self.device, "label": f"RVC ({self.device})"}

    # ----- 내부 ----------------------------------------------------------------------

    def _get_instance(self, agent: Agent):
        key = agent.id
        inst = self._instances.get(key)
        if inst is not None:
            self._instances.move_to_end(key)
            return inst
        from rvc_python.infer import RVCInference  # 지연 임포트 (torch 포함)

        log.info("RVC 모델 로드: %s (%s)", agent.name, agent.model)
        inst = RVCInference(device=self.device)
        index_path = str(agent.index) if agent.index is not None and agent.index.is_file() else None
        inst.load_model(str(agent.model), index_path=index_path)
        self._instances[key] = inst
        while len(self._instances) > self.max_loaded:
            old_key, old = self._instances.popitem(last=False)
            log.info("RVC 모델 해제: %s", old_key)
            try:
                old.unload_model()
            except Exception:  # noqa: BLE001
                pass
        return inst

    @staticmethod
    def _infer(rvc, x: np.ndarray, sr: int) -> tuple[np.ndarray, int]:
        """rvc-python 은 파일 기반 API 가 가장 안정적이라 임시 WAV 로 주고받는다."""
        tmp_dir = tempfile.mkdtemp(prefix="agent-voice-")
        in_path = Path(tmp_dir) / "in.wav"
        out_path = Path(tmp_dir) / "out.wav"
        try:
            sf.write(in_path, x, sr, subtype="FLOAT")
            rvc.infer_file(str(in_path), str(out_path))
            y, out_sr = sf.read(out_path, dtype="float32", always_2d=False)
            if y.ndim == 2:
                y = y.mean(axis=1)
            return y.astype(np.float32), int(out_sr)
        finally:
            for p in (in_path, out_path):
                try:
                    os.remove(p)
                except OSError:
                    pass
            try:
                os.rmdir(tmp_dir)
            except OSError:
                pass
