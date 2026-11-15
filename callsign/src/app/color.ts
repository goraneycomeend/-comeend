// 요원 색을 화면 강조색으로 쓸 때 필요한 계산: 대비 확인, 글자용 보정색.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** 요원 색이 없거나 잘못됐을 때 쓰는 기본 강조색 */
export const FALLBACK_AGENT_COLOR = '#d8a548';
/** 바탕(흑연)과 글자(종이)의 대표값. tokens.css 의 중립색과 같은 계열 */
const GRAPHITE: Rgb = { r: 16, g: 18, b: 19 };
const INK_DARK = '#101213';
const INK_LIGHT = '#f4f4f1';

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function hexToRgb(hex: string): Rgb {
  const h = isHexColor(hex) ? hex : FALLBACK_AGENT_COLOR;
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (v: number): string =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** 상대 휘도 0..1 */
export function luminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** 두 색의 명도 대비 1..21 */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

export interface AgentTint {
  /** 강조색(면·선). 입력 그대로 */
  agent: string;
  /** 어두운 바탕 위 글자로 써도 읽히는 색. 어두운 요원 색은 밝혀서 돌려준다 */
  ink: string;
  /** 강조색으로 칠한 면 위에 올릴 글자색 */
  onAgent: string;
}

/** 요원 색 하나에서 화면에 필요한 세 가지 색을 만든다 */
export function agentTint(color: string): AgentTint {
  const agent = isHexColor(color) ? color.toLowerCase() : FALLBACK_AGENT_COLOR;
  const rgb = hexToRgb(agent);

  // 글자로 쓸 때는 바탕과 대비 4.5 이상이 되도록 흰색 쪽으로 조금씩 민다
  let ink = rgb;
  for (let t = 0; contrast(ink, GRAPHITE) < 4.5 && t < 1; t += 0.06) {
    ink = mix(rgb, { r: 255, g: 255, b: 255 }, t);
  }

  const onDark = contrast(rgb, hexToRgb(INK_DARK));
  const onLight = contrast(rgb, hexToRgb(INK_LIGHT));
  return { agent, ink: rgbToHex(ink), onAgent: onDark >= onLight ? INK_DARK : INK_LIGHT };
}

/** 요소의 style 에 펼쳐 넣을 CSS 변수 묶음. 카드 하나만 다른 요원 색으로 칠할 때 쓴다 */
export function agentStyle(color: string): Record<string, string> {
  const t = agentTint(color);
  return { '--agent': t.agent, '--agent-ink': t.ink, '--on-agent': t.onAgent };
}
