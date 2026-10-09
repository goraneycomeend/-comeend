import numpy as np
import pytest

from agent_voice.agents import Agent, DspPreset
from agent_voice.engines import ConvertOptions, DspEngine
from agent_voice.engines.dsp import formant_shift, pitch_shift

SR = 48_000


def _agent(pitch=0.0, formant=1.0, fx=None) -> Agent:
    return Agent(
        id="t", name="테스트", name_en="Test", role="duelist", color="#fff",
        model=None, index=None, pitch=0.0, dsp=DspPreset(pitch=pitch, formant=formant, fx=fx),
    )


def _tone(freq: float, seconds: float = 0.6, sr: int = SR) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    # 배음이 있는 신호 (목소리 비슷하게)
    return (0.5 * np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * 2 * freq * t)).astype(np.float32)


def _dominant_freq(x: np.ndarray, sr: int = SR) -> float:
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    freqs = np.fft.rfftfreq(len(x), 1 / sr)
    spec[freqs < 50] = 0
    return float(freqs[np.argmax(spec)])


def test_pitch_shift_keeps_length_and_moves_frequency():
    x = _tone(220.0)
    y = pitch_shift(x, 12.0)
    assert len(y) == len(x)
    assert y.dtype == np.float32
    f = _dominant_freq(y)
    assert 400 < f < 480, f  # 한 옥타브 위 (440Hz 근처)


def test_pitch_shift_down():
    x = _tone(440.0)
    y = pitch_shift(x, -12.0)
    f = _dominant_freq(y)
    assert 200 < f < 240, f


def test_formant_shift_keeps_pitch():
    x = _tone(200.0)
    y = formant_shift(x, 1.2)
    assert len(y) == len(x)
    # 기본 주파수는 그대로여야 한다 (포먼트만 이동)
    assert abs(_dominant_freq(y) - 200.0) < 15


@pytest.mark.parametrize("fx", [None, "robot", "ghost", "radio"])
def test_engine_convert_shape_and_level(fx):
    eng = DspEngine()
    x = _tone(180.0, seconds=0.5)
    y, sr = eng.convert(x, SR, _agent(pitch=5, formant=1.15, fx=fx), ConvertOptions())
    assert sr == SR
    assert y.shape == x.shape
    assert np.all(np.abs(y) <= 1.0)
    # 레벨 정규화: 입력 RMS 와 비슷해야 한다
    in_rms = np.sqrt(np.mean(x**2))
    out_rms = np.sqrt(np.mean(y**2))
    assert 0.5 * in_rms < out_rms < 1.5 * in_rms


def test_engine_handles_empty_and_silence():
    eng = DspEngine()
    y, _ = eng.convert(np.zeros(0, np.float32), SR, _agent(), ConvertOptions())
    assert y.size == 0
    y, _ = eng.convert(np.zeros(4800, np.float32), SR, _agent(pitch=3), ConvertOptions())
    assert y.shape == (4800,)
    assert np.all(np.isfinite(y))


def test_user_pitch_option_adds_to_preset():
    eng = DspEngine()
    x = _tone(220.0)
    y, _ = eng.convert(x, SR, _agent(pitch=0), ConvertOptions(pitch=12))
    assert 400 < _dominant_freq(y) < 480
