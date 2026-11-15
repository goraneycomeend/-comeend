// 음성 파형. PcmAudio 를 캔버스에 막대로 그리고, 재생 중이면 지나간 부분을 요원 색으로 칠한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { useAppStore } from '../../app/store.ts';
import type { PcmAudio } from '../../core/types.ts';

export interface WaveformViewProps {
  audio: PcmAudio | null;
  /**
   * 지금 재생 위치(초)를 돌려주는 함수. 재생 중이 아니면 null 을 돌려준다.
   * 예) `() => playbackPosition(resultPlayId(result.id))`
   */
  position?: () => number | null;
  /** 높이(px). 기본 72 */
  height?: number;
  /** 누른 자리의 시간(초)을 받는다. 주면 파형을 눌러 그 자리부터 들을 수 있다 */
  onSeek?: (sec: number) => void;
  className?: string;
}

/** 막대 하나의 폭과 사이 간격(px) */
const BAR = 2;
const GAP = 2;

/** 구간마다 가장 큰 진폭을 뽑아 0..1 로 맞춘다 */
function barLevels(audio: PcmAudio, count: number): Float32Array {
  const out = new Float32Array(count);
  const n = audio.samples.length;
  if (n === 0 || count === 0) return out;
  let top = 0;
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * n) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * n) / count));
    // 긴 음성은 구간 안에서 건너뛰며 본다
    const stride = Math.max(1, Math.floor((to - from) / 96));
    let peak = 0;
    for (let k = from; k < to; k += stride) {
      const v = Math.abs(audio.samples[k]);
      if (v > peak) peak = v;
    }
    out[i] = peak;
    if (peak > top) top = peak;
  }
  const scale = 1 / Math.max(top, 0.02);
  for (let i = 0; i < count; i++) out[i] = Math.min(1, out[i] * scale);
  return out;
}

/** 요소에 적용된 색을 캔버스가 알아듣는 문자열로. 못 읽으면 대체색 */
function resolveColor(probe: HTMLElement, ctx: CanvasRenderingContext2D, value: string, fallback: string): string {
  probe.style.color = value;
  const computed = getComputedStyle(probe).color;
  ctx.fillStyle = '#000000';
  ctx.fillStyle = computed;
  // 캔버스가 못 알아들은 색은 무시되어 직전 값(#000000)이 남는다
  return ctx.fillStyle === '#000000' && !/^rgba?\(0, 0, 0/.test(computed) ? fallback : computed;
}

export function WaveformView({ audio, position, height = 72, onSeek, className }: WaveformViewProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const colors = useRef<{ at: number; played: string; rest: string; head: string } | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = (): void => setWidth(Math.floor(el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const count = Math.max(0, Math.floor((width + GAP) / (BAR + GAP)));
  const levels = useMemo(() => (audio ? barLevels(audio, count) : null), [audio, count]);
  const durationSec = audio ? audio.samples.length / audio.sampleRate : 0;

  const draw = useCallback(
    (playedSec: number | null): void => {
      const cv = canvas.current;
      const pr = probe.current;
      if (!cv || !pr || width === 0) return;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = Math.round(width * dpr);
      const h = Math.round(height * dpr);
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      // 색은 요원을 바꾸면 달라진다. 매 프레임 읽지는 않고 가끔만 다시 읽는다
      const now = performance.now();
      if (!colors.current || now - colors.current.at > 400) {
        colors.current = {
          at: now,
          played: resolveColor(pr, ctx, 'var(--agent)', '#d8a548'),
          rest: resolveColor(pr, ctx, 'var(--pencil)', '#9da2a5'),
          head: resolveColor(pr, ctx, 'var(--paper)', '#e9eae6'),
        };
      }
      const { played, rest, head } = colors.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const mid = height / 2;

      if (!levels || durationSec === 0) {
        // 아직 소리가 없을 때: 가운데 점선
        ctx.fillStyle = rest;
        ctx.globalAlpha = 0.45;
        for (let i = 0; i < count; i++) ctx.fillRect(i * (BAR + GAP), mid - 0.5, BAR, 1);
        ctx.globalAlpha = 1;
        return;
      }

      const playedBars = playedSec === null ? -1 : (playedSec / durationSec) * count;
      for (let i = 0; i < count; i++) {
        const half = Math.max(1, levels[i] * (mid - 2));
        const done = i < playedBars;
        ctx.fillStyle = playedSec === null || done ? played : rest;
        ctx.globalAlpha = playedSec === null ? 0.9 : done ? 1 : 0.5;
        ctx.fillRect(i * (BAR + GAP), mid - half, BAR, half * 2);
      }
      ctx.globalAlpha = 1;
      if (playedSec !== null) {
        ctx.fillStyle = head;
        ctx.fillRect(Math.min(width - 1, (playedSec / durationSec) * width), 0, 1, height);
      }
    },
    [count, durationSec, height, levels, width],
  );

  // 재생 위치를 따라 다시 그린다. 위치가 바뀔 때만 그린다
  useEffect(() => {
    draw(position ? position() : null);
    if (!position) return;
    let raf = 0;
    let last: number | null | undefined;
    const tick = (): void => {
      const p = position();
      if (p !== last) {
        last = p;
        draw(p);
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [draw, position]);

  // 요원을 바꾸면 강조색이 (부드럽게) 바뀐다. 바뀐 직후와 다 바뀐 뒤에 한 번씩 색을 다시 읽어 그린다
  const agentId = useAppStore((s) => s.selectedAgentId);
  useEffect(() => {
    const repaint = (): void => {
      colors.current = null;
      draw(position ? position() : null);
    };
    repaint();
    const timer = window.setTimeout(repaint, 450);
    return () => window.clearTimeout(timer);
    // position 은 매 렌더마다 새 함수일 수 있어 일부러 뺀다
  }, [agentId, draw]);

  const seek = (e: PointerEvent<HTMLDivElement>): void => {
    if (!onSeek || durationSec === 0 || width === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(Math.min(durationSec, Math.max(0, ((e.clientX - rect.left) / rect.width) * durationSec)));
  };

  const label = audio ? `음성 파형, 길이 ${durationSec.toFixed(1)}초` : '음성 파형, 아직 소리 없음';

  return (
    <div
      ref={wrap}
      className={['waveform', onSeek && audio ? 'waveform--seek' : '', className ?? ''].filter(Boolean).join(' ')}
      style={{ height }}
      role="img"
      aria-label={label}
      onPointerDown={onSeek ? seek : undefined}
    >
      <canvas ref={canvas} className="waveform__canvas" style={{ width: '100%', height }} />
      <span ref={probe} className="waveform__probe" aria-hidden="true" />
    </div>
  );
}
