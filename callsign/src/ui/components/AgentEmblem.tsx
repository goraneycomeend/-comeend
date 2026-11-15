// 요원 엠블럼: 요원 id 에서 결정적으로 만들어지는 "성문(voiceprint)" 문양.
// 초상화나 그림 파일은 쓰지 않는다. 같은 id 는 언제나 같은 문양이 나온다.
import { useMemo } from 'react';

/** 문자열 → 32비트 해시 (FNV-1a) */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 시드 고정 난수 0..1 (mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Spoke {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  bright: boolean;
}

/** 둥근 문양: 가운데에서 바깥으로 뻗는 살. 살 길이의 굴곡이 요원마다 다르다 */
function radialSpokes(id: string, count: number): Spoke[] {
  const rand = rng(hash(`radial:${id}`));
  // 굴곡을 만드는 파동 셋. 주기가 달라 2갈래·3갈래·5갈래 같은 서로 다른 윤곽이 나온다
  const pool = [2, 3, 4, 5, 6, 7];
  const waves = [0, 1, 2].map((i) => {
    const k = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    return { k, amp: i === 0 ? 1 : 0.35 + rand() * 0.5, phase: rand() * Math.PI * 2 };
  });
  const total = waves.reduce((s, w) => s + w.amp, 0);
  const inner = 9;
  const spokes: Spoke[] = [];
  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2 - Math.PI / 2;
    let e = 0;
    for (const w of waves) e += w.amp * Math.sin(w.k * theta + w.phase);
    e = 0.5 + (0.5 * e) / total;
    e = Math.min(1, Math.max(0, e + (rand() - 0.5) * 0.26));
    const outer = inner + 3.5 + e * 15.5;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    spokes.push({
      x1: 32 + cos * inner,
      y1: 32 + sin * inner,
      x2: 32 + cos * outer,
      y2: 32 + sin * outer,
      bright: rand() < 0.14,
    });
  }
  return spokes;
}

/** 띠 문양: 말소리처럼 몇 덩어리로 부푸는 막대들 */
function stripBars(id: string, count: number): { h: number; bright: boolean }[] {
  const rand = rng(hash(`strip:${id}`));
  const bumps = Array.from({ length: 4 + Math.floor(rand() * 3) }, () => ({
    at: 0.06 + rand() * 0.88,
    width: 0.035 + rand() * 0.07,
    amp: 0.45 + rand() * 0.55,
  }));
  const bars: { h: number; bright: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    const x = i / (count - 1);
    let e = 0;
    for (const b of bumps) e = Math.max(e, b.amp * Math.exp(-((x - b.at) ** 2) / (2 * b.width ** 2)));
    e = Math.min(1, Math.max(0.05, e * (0.72 + rand() * 0.5)));
    bars.push({ h: e, bright: rand() < 0.1 });
  }
  return bars;
}

const round = (v: number): number => Math.round(v * 100) / 100;

export interface AgentEmblemProps {
  /** 문양의 씨앗. 요원 id */
  agentId: string;
  /** badge = 둥근 문양(기본), strip = 가로로 긴 띠 */
  variant?: 'badge' | 'strip';
  /** badge 의 한 변(px). 기본 48. strip 은 폭이 부모를 채우고 이 값이 높이가 된다(기본 40) */
  size?: number;
  /** 주면 그림으로 읽힌다. 없으면 장식으로 숨긴다 */
  label?: string;
  className?: string;
}

export function AgentEmblem({ agentId, variant = 'badge', size, label, className }: AgentEmblemProps) {
  const a11y = label ? ({ role: 'img', 'aria-label': label } as const) : ({ 'aria-hidden': true } as const);

  const fine = (size ?? 48) >= 44;
  const spokes = useMemo(
    () => (variant === 'badge' ? radialSpokes(agentId, fine ? 40 : 24) : []),
    [agentId, variant, fine],
  );
  const bars = useMemo(() => (variant === 'strip' ? stripBars(agentId, 72) : []), [agentId, variant]);

  if (variant === 'strip') {
    const h = size ?? 40;
    return (
      <svg
        className={['emblem emblem--strip', className].filter(Boolean).join(' ')}
        viewBox={`0 0 ${bars.length * 4} 40`}
        preserveAspectRatio="none"
        width="100%"
        height={h}
        focusable="false"
        {...a11y}
      >
        <line x1="0" y1="20" x2={bars.length * 4} y2="20" className="emblem__axis" />
        {bars.map((b, i) => (
          <rect
            key={i}
            x={i * 4 + 1}
            y={round(20 - b.h * 18)}
            width="2"
            height={round(b.h * 36)}
            className={b.bright ? 'emblem__mark emblem__mark--bright' : 'emblem__mark'}
          />
        ))}
      </svg>
    );
  }

  const px = size ?? 48;
  return (
    <svg
      className={['emblem emblem--badge', className].filter(Boolean).join(' ')}
      viewBox="0 0 64 64"
      width={px}
      height={px}
      focusable="false"
      {...a11y}
    >
      <circle cx="32" cy="32" r="31" className="emblem__plate" />
      <g strokeWidth={fine ? 1.7 : 2.6} strokeLinecap="round">
        {spokes.map((s, i) => (
          <line
            key={i}
            x1={round(s.x1)}
            y1={round(s.y1)}
            x2={round(s.x2)}
            y2={round(s.y2)}
            className={s.bright ? 'emblem__spoke emblem__spoke--bright' : 'emblem__spoke'}
          />
        ))}
      </g>
      <circle cx="32" cy="32" r={fine ? 3 : 3.6} className="emblem__core" />
    </svg>
  );
}
