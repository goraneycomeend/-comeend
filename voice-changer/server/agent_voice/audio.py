"""오디오 유틸: 디코딩/인코딩, 모노 변환, 리샘플링, 레벨 계산."""

from __future__ import annotations

import io
from fractions import Fraction

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly


def to_mono_f32(audio: np.ndarray) -> np.ndarray:
    a = np.asarray(audio, dtype=np.float32)
    if a.ndim == 2:
        a = a.mean(axis=1)
    return np.ascontiguousarray(a, dtype=np.float32)


def decode(data: bytes) -> tuple[np.ndarray, int]:
    """WAV/FLAC/OGG 바이트 → (모노 float32, sr)."""
    audio, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
    return to_mono_f32(audio), int(sr)


def encode_wav(audio: np.ndarray, sr: int, subtype: str = "PCM_16") -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.clip(audio, -1.0, 1.0), sr, format="WAV", subtype=subtype)
    return buf.getvalue()


def resample(audio: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    if src_sr == dst_sr or audio.size == 0:
        return audio.astype(np.float32, copy=False)
    frac = Fraction(dst_sr, src_sr).limit_denominator(1000)
    out = resample_poly(audio.astype(np.float64), frac.numerator, frac.denominator)
    return out.astype(np.float32)


def rms(audio: np.ndarray) -> float:
    if audio.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(audio, dtype=np.float64))))


def dbfs(audio: np.ndarray) -> float:
    r = rms(audio)
    return -120.0 if r <= 1e-9 else float(20.0 * np.log10(r))


def match_rms(audio: np.ndarray, target_rms: float, limit: float = 0.98) -> np.ndarray:
    cur = rms(audio)
    if cur <= 1e-9 or target_rms <= 1e-9:
        return audio
    out = audio * (target_rms / cur)
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > limit:
        out = out * (limit / peak)
    return out.astype(np.float32)


def fit_length(audio: np.ndarray, length: int) -> np.ndarray:
    """앞쪽을 기준으로 길이를 맞춘다 (짧으면 뒤를 0 으로 채움)."""
    if audio.shape[0] == length:
        return audio
    if audio.shape[0] > length:
        return audio[:length]
    return np.concatenate([audio, np.zeros(length - audio.shape[0], dtype=audio.dtype)])
