"""DSP 폴백 엔진 — 신경망 모델 없이 피치·포먼트·효과만으로 목소리를 바꾼다.

RVC 모델이 없을 때도 앱이 동작하도록 하는 용도이며, "요원과 똑같은 목소리" 는 RVC 엔진 + 모델이 필요하다.

알고리즘
  1. 위상 보코더(phase vocoder) 로 시간 신축 후 리샘플 → 피치 이동 (포먼트도 함께 이동)
  2. STFT 영역에서 켑스트럼 스펙트럼 포락선을 추출해 주파수축으로 늘리거나 줄여 포먼트만 보정
  3. 선택 효과: robot(링 변조), ghost(짧은 잔향 + 저역 통과), radio(대역 통과 + 소프트 클립)
  4. 입력 RMS 에 맞춰 레벨 정규화
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, istft, lfilter, stft

from ..agents import Agent
from ..audio import fit_length, match_rms, rms
from .base import ConvertOptions

_N_FFT = 2048
_HOP = 512
_LIFTER = 40  # 켑스트럼 포락선에 남길 저 쿼프런시 계수 개수 (클수록 포락선이 세밀)


def _time_stretch(x: np.ndarray, speed: float) -> np.ndarray:
    """위상 보코더 시간 신축. speed>1 이면 짧아진다."""
    if abs(speed - 1.0) < 1e-6 or x.size < _N_FFT:
        return x
    _, _, D = stft(x, nperseg=_N_FFT, noverlap=_N_FFT - _HOP, window="hann", padded=True)
    n_bins, n_frames = D.shape
    time_steps = np.arange(0, n_frames, speed)
    phi_advance = np.linspace(0, np.pi * _HOP, n_bins)
    D_pad = np.pad(D, [(0, 0), (0, 2)])
    out = np.zeros((n_bins, len(time_steps)), dtype=np.complex128)
    phase_acc = np.angle(D_pad[:, 0])
    for t, step in enumerate(time_steps):
        i = int(step)
        frac = step - i
        c0 = D_pad[:, i]
        c1 = D_pad[:, i + 1]
        mag = (1.0 - frac) * np.abs(c0) + frac * np.abs(c1)
        out[:, t] = mag * np.exp(1j * phase_acc)
        dphase = np.angle(c1) - np.angle(c0) - phi_advance
        dphase -= 2.0 * np.pi * np.round(dphase / (2.0 * np.pi))
        phase_acc = phase_acc + phi_advance + dphase
    _, y = istft(out, nperseg=_N_FFT, noverlap=_N_FFT - _HOP, window="hann")
    target = int(round(len(x) / speed))
    return fit_length(y.astype(np.float32), target)


def _resample_ratio(x: np.ndarray, ratio: float) -> np.ndarray:
    """선형 보간 리샘플. ratio>1 이면 재생이 빨라져 길이가 1/ratio 로 줄고 피치가 ratio 배 올라간다."""
    if abs(ratio - 1.0) < 1e-6 or x.size < 2:
        return x
    n_out = max(1, int(round(len(x) / ratio)))
    src_pos = np.arange(n_out, dtype=np.float64) * ratio
    return np.interp(src_pos, np.arange(len(x), dtype=np.float64), x).astype(np.float32)


def pitch_shift(x: np.ndarray, semitones: float) -> np.ndarray:
    """길이는 유지하고 피치(와 포먼트)를 semitones 만큼 이동."""
    if abs(semitones) < 1e-3:
        return x
    ratio = 2.0 ** (semitones / 12.0)
    stretched = _time_stretch(x, speed=1.0 / ratio)  # 길이 × ratio
    shifted = _resample_ratio(stretched, ratio)  # 길이 복원, 피치 × ratio
    return fit_length(shifted, len(x))


def _spectral_envelope(mag: np.ndarray) -> np.ndarray:
    """프레임별 켑스트럼 리프터링으로 매끄러운 스펙트럼 포락선을 구한다. mag: (bins, frames)"""
    log_mag = np.log(mag + 1e-8)
    ceps = np.fft.irfft(log_mag, axis=0)
    lifter = np.zeros(ceps.shape[0])
    lifter[:_LIFTER] = 1.0
    lifter[-(_LIFTER - 1):] = 1.0
    smooth = np.fft.rfft(ceps * lifter[:, None], axis=0).real
    return np.exp(smooth[: mag.shape[0]])


def formant_shift(x: np.ndarray, ratio: float) -> np.ndarray:
    """피치는 두고 스펙트럼 포락선만 주파수축으로 ratio 배 늘인다(>1: 밝게, <1: 어둡게)."""
    if abs(ratio - 1.0) < 1e-3 or x.size < _N_FFT:
        return x
    _, _, D = stft(x, nperseg=_N_FFT, noverlap=_N_FFT - _HOP, window="hann", padded=True)
    mag = np.abs(D)
    env = _spectral_envelope(mag)
    fine = mag / (env + 1e-8)
    bins = np.arange(mag.shape[0], dtype=np.float64)
    src = np.clip(bins / ratio, 0, bins[-1])
    warped = np.empty_like(env)
    for t in range(env.shape[1]):
        warped[:, t] = np.interp(src, bins, env[:, t])
    new_mag = fine * warped
    _, y = istft(new_mag * np.exp(1j * np.angle(D)), nperseg=_N_FFT, noverlap=_N_FFT - _HOP, window="hann")
    return fit_length(y.astype(np.float32), len(x))


def _fx_robot(x: np.ndarray, sr: int) -> np.ndarray:
    t = np.arange(len(x)) / sr
    carrier = np.sin(2.0 * np.pi * 55.0 * t).astype(np.float32)
    return (0.35 * x + 0.65 * x * carrier).astype(np.float32)


def _fx_ghost(x: np.ndarray, sr: int) -> np.ndarray:
    out = x.copy()
    for delay_ms, gain in ((23, 0.35), (41, 0.28), (67, 0.2), (97, 0.14)):
        d = int(sr * delay_ms / 1000)
        if d < len(x):
            out[d:] += gain * x[:-d]
    b, a = butter(2, 3800 / (sr / 2), btype="low")
    return lfilter(b, a, out).astype(np.float32)


def _fx_radio(x: np.ndarray, sr: int) -> np.ndarray:
    hi = min(3400.0, sr / 2 - 200.0)
    b, a = butter(3, [300 / (sr / 2), hi / (sr / 2)], btype="band")
    y = lfilter(b, a, x)
    return np.tanh(2.2 * y).astype(np.float32)


_FX = {"robot": _fx_robot, "ghost": _fx_ghost, "radio": _fx_radio}


class DspEngine:
    name = "dsp"

    def supports(self, agent: Agent) -> bool:  # noqa: ARG002 - 모든 요원에 대해 항상 가능
        return True

    def convert(self, audio: np.ndarray, sr: int, agent: Agent, options: ConvertOptions) -> tuple[np.ndarray, int]:
        x = np.asarray(audio, dtype=np.float32)
        if x.size == 0:
            return x, sr
        level = rms(x)
        semitones = agent.dsp.pitch + options.pitch
        pitch_ratio = 2.0 ** (semitones / 12.0)
        y = pitch_shift(x, semitones)
        # pitch_shift 가 포먼트도 pitch_ratio 배 옮겼으므로, 최종 포먼트가 agent.dsp.formant 배가 되도록 보정
        y = formant_shift(y, agent.dsp.formant / pitch_ratio)
        if agent.dsp.fx in _FX:
            y = _FX[agent.dsp.fx](y, sr)
        y = match_rms(y, level)
        return np.clip(y, -1.0, 1.0).astype(np.float32), sr

    def describe(self) -> dict:
        return {"name": self.name, "device": "cpu", "label": "DSP 폴백 (피치·포먼트 변환)"}
