// PCM 재생. 한 번에 하나만 튼다 — 새로 틀면 이전 것은 멈춘다.
import type { PcmAudio } from '../core/types.ts';
import { getAudioContext } from './audioContext.ts';

/** 'ended' = 끝까지 재생됨, 'stopped' = 중간에 멈춤(stop 호출 또는 다른 재생이 시작됨) */
export type PlaybackEndReason = 'ended' | 'stopped';

export interface Playback {
  /** 멈춘다. 이미 끝났으면 아무 일도 없다 */
  stop(): void;
  /** 재생이 끝나거나 멈추면 한 번 불린다. 재생 도중에 바꿔 끼워도 된다 */
  onEnded: ((reason: PlaybackEndReason) => void) | null;
  /** 지금 재생 위치(초). 끝난 뒤에는 멈춘 위치 */
  positionSec(): number;
  readonly durationSec: number;
  readonly playing: boolean;
  /** 끝나거나 멈추면 풀린다 */
  readonly ended: Promise<PlaybackEndReason>;
}

export interface PlayOptions {
  onEnded?: (reason: PlaybackEndReason) => void;
  /** 0..1. 기본 1 */
  volume?: number;
  /** 이 위치(초)부터 재생 */
  offsetSec?: number;
}

/** 멈출 때 '딱' 소리가 나지 않게 줄이는 시간(초) */
const STOP_FADE_SEC = 0.012;

let active: Playback | null = null;

/** 소리를 튼다. 재생 중이던 것이 있으면 먼저 멈춘다 */
export function play(a: PcmAudio, opts: PlayOptions = {}): Playback {
  stopAll();
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});

  const durationSec = a.samples.length / a.sampleRate;
  const buffer = ctx.createBuffer(1, Math.max(1, a.samples.length), a.sampleRate);
  buffer.getChannelData(0).set(a.samples);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = Math.min(1, Math.max(0, opts.volume ?? 1));
  source.connect(gain);
  gain.connect(ctx.destination);

  const offset = Math.min(Math.max(0, opts.offsetSec ?? 0), durationSec);
  const startAt = ctx.currentTime;
  let finished = false;
  let finalPosition = offset;
  let resolveEnded: (reason: PlaybackEndReason) => void = () => {};
  const ended = new Promise<PlaybackEndReason>((resolve) => {
    resolveEnded = resolve;
  });

  const position = (): number => Math.min(durationSec, offset + Math.max(0, ctx.currentTime - startAt));

  const finish = (reason: PlaybackEndReason): void => {
    if (finished) return;
    finished = true;
    finalPosition = reason === 'ended' ? durationSec : position();
    if (active === playback) active = null;
    const cb = playback.onEnded;
    resolveEnded(reason);
    if (cb) cb(reason);
  };

  const playback: Playback = {
    stop(): void {
      if (finished) return;
      const now = ctx.currentTime;
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + STOP_FADE_SEC);
        source.stop(now + STOP_FADE_SEC + 0.005);
      } catch {
        // 이미 멈춘 소스
      }
      finish('stopped');
    },
    onEnded: opts.onEnded ?? null,
    positionSec: () => (finished ? finalPosition : position()),
    durationSec,
    get playing(): boolean {
      return !finished;
    },
    ended,
  };

  source.onended = () => {
    finish('ended');
    try {
      source.disconnect();
      gain.disconnect();
    } catch {
      // 이미 끊겼다
    }
  };
  source.start(startAt, offset);
  active = playback;
  return playback;
}

/** 재생 중인 것을 멈춘다 */
export function stopAll(): void {
  if (active) active.stop();
}

/** 지금 재생 중인 것. 없으면 null */
export function currentPlayback(): Playback | null {
  return active;
}
