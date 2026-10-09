#!/usr/bin/env python3
"""RVC 학습용 데이터셋 전처리.

본인에게 사용 권리가 있는 음성(본인 목소리, 동의한 화자의 녹음 등)을 RVC WebUI 가 바로 학습할 수 있는
형태로 다듬는다. 게임 음성·유튜브 음원처럼 권리가 없는 소리는 넣지 마세요.

  python tools/prepare_dataset.py raw_audio/ dataset/jett --sr 40000

처리 내용
  1. WAV/FLAC/OGG 를 모노로 읽어 목표 샘플레이트(기본 40k, RVC v2 는 40k 또는 48k) 로 리샘플
  2. 피크 -1 dBFS 로 정규화, DC 제거
  3. 무음(기본 -40 dBFS, 0.3초 이상) 기준으로 자르고 3~10초 조각으로 다시 묶음
  4. 조각을 0001.wav, 0002.wav … 로 저장하고 총 길이를 알려 줌 (10분 미만이면 경고)
"""

from __future__ import annotations

import argparse
import sys
from fractions import Fraction
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

AUDIO_SUFFIXES = {".wav", ".flac", ".ogg", ".aiff", ".aif"}


def load_mono(path: Path, sr: int) -> np.ndarray:
    audio, src_sr = sf.read(path, dtype="float32", always_2d=False)
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    if src_sr != sr:
        frac = Fraction(sr, src_sr).limit_denominator(1000)
        audio = resample_poly(audio.astype(np.float64), frac.numerator, frac.denominator).astype(np.float32)
    audio = audio - float(np.mean(audio))
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0:
        audio = audio * (10 ** (-1 / 20) / peak)
    return audio.astype(np.float32)


def split_on_silence(audio: np.ndarray, sr: int, threshold_db: float, min_silence_s: float, pad_s: float) -> list[tuple[int, int]]:
    frame = int(sr * 0.02)
    if audio.size < frame:
        return []
    n_frames = audio.size // frame
    frames = audio[: n_frames * frame].reshape(n_frames, frame)
    db = 20 * np.log10(np.sqrt(np.mean(frames**2, axis=1)) + 1e-9)
    voiced = db > threshold_db
    min_sil = max(1, int(min_silence_s / 0.02))
    pad = int(pad_s * sr)
    segments: list[tuple[int, int]] = []
    start = None
    silent_run = 0
    for i, v in enumerate(voiced):
        if v:
            if start is None:
                start = i
            silent_run = 0
        elif start is not None:
            silent_run += 1
            if silent_run >= min_sil:
                end = i - silent_run + 1
                segments.append((max(0, start * frame - pad), min(audio.size, end * frame + pad)))
                start = None
                silent_run = 0
    if start is not None:
        segments.append((max(0, start * frame - pad), audio.size))
    return segments


def regroup(segments: list[tuple[int, int]], sr: int, min_s: float, max_s: float) -> list[tuple[int, int]]:
    """짧은 조각은 이어 붙이고 긴 조각은 max 길이로 나눠 min~max 초 범위로 만든다."""
    out: list[tuple[int, int]] = []
    cur: tuple[int, int] | None = None
    min_n, max_n = int(min_s * sr), int(max_s * sr)
    for s, e in segments:
        if cur is None:
            cur = (s, e)
        elif e - cur[0] <= max_n:
            cur = (cur[0], e)
        else:
            out.append(cur)
            cur = (s, e)
    if cur is not None:
        out.append(cur)
    final: list[tuple[int, int]] = []
    for s, e in out:
        while e - s > max_n:
            final.append((s, s + max_n))
            s += max_n
        if e - s >= min_n:
            final.append((s, e))
    return final


def main() -> int:
    parser = argparse.ArgumentParser(description="RVC 학습용 데이터셋 전처리")
    parser.add_argument("src", help="원본 오디오 폴더 (wav/flac/ogg)")
    parser.add_argument("dst", help="출력 폴더")
    parser.add_argument("--sr", type=int, default=40000, choices=(32000, 40000, 48000))
    parser.add_argument("--min", type=float, default=3.0, help="조각 최소 길이(초)")
    parser.add_argument("--max", type=float, default=10.0, help="조각 최대 길이(초)")
    parser.add_argument("--silence-db", type=float, default=-40.0, help="무음 판정 dBFS")
    parser.add_argument("--min-silence", type=float, default=0.3, help="자르는 무음 최소 길이(초)")
    args = parser.parse_args()

    src, dst = Path(args.src), Path(args.dst)
    files = sorted(p for p in src.rglob("*") if p.suffix.lower() in AUDIO_SUFFIXES)
    if not files:
        print(f"오디오 파일이 없습니다: {src} (wav/flac/ogg)", file=sys.stderr)
        return 1
    dst.mkdir(parents=True, exist_ok=True)

    count = 0
    total = 0.0
    for path in files:
        try:
            audio = load_mono(path, args.sr)
        except Exception as exc:  # noqa: BLE001
            print(f"건너뜀 {path.name}: {exc}", file=sys.stderr)
            continue
        segs = regroup(split_on_silence(audio, args.sr, args.silence_db, args.min_silence, 0.1), args.sr, args.min, args.max)
        for s, e in segs:
            count += 1
            sf.write(dst / f"{count:04d}.wav", audio[s:e], args.sr, subtype="PCM_16")
            total += (e - s) / args.sr
        print(f"{path.name}: 조각 {len(segs)}개")

    minutes = total / 60
    print(f"\n완료: {count}개 조각, 총 {minutes:.1f}분 → {dst}")
    if minutes < 10:
        print("경고: 10분 미만이면 음색이 불안정합니다. 깨끗한 음성을 더 모으세요 (권장 20~40분).", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
