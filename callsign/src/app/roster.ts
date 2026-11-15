// 요원 명단·클립 색인으로 가는 창구. 화면과 음성 서비스는 여기를 거쳐 명단을 읽는다.
// (기본 요원 + 사용자가 만든 요원을 한 목록으로 다루는 일, 채널 번호, 클립 찾기)
import { CATEGORIES, CATEGORY_LABEL, ROLES, ROLE_DESCRIPTION, ROLE_LABEL, ROSTER, getSampleLine, validateAgent } from '../core/agents/index.ts';
import { CLIPS_DIR, clipKey, clipUrl, findClip as findClipEntry, loadClipIndex } from '../core/clips.ts';
import type { ClipEntry, ClipIndex } from '../core/clips.ts';
import type { AgentDef, AgentLine, AgentRole, AgentVoice, LineCategory } from '../core/types.ts';
import { assetUrl } from '../engine/platform.ts';

export { CATEGORY_LABEL, ROLE_DESCRIPTION, ROLE_LABEL };
export type { ClipEntry };

/** 역할의 표시 순서 */
export const ROLE_ORDER: readonly AgentRole[] = ROLES;
/** 대사 분류의 표시 순서 */
export const CATEGORY_ORDER: readonly LineCategory[] = CATEGORIES;

// ── 명단 ─────────────────────────────────────────────────────

/** 기본 제공 요원 */
export function rosterAgents(): readonly AgentDef[] {
  return ROSTER;
}

/** 기본 요원 뒤에 사용자가 만든 요원을 붙인 전체 목록 */
export function allAgents(custom: readonly AgentDef[]): AgentDef[] {
  return [...ROSTER, ...custom];
}

export function findAgent(id: string, custom: readonly AgentDef[] = []): AgentDef | undefined {
  return ROSTER.find((a) => a.id === id) ?? custom.find((a) => a.id === id);
}

/** 기본 제공 요원의 id 인지(사용자가 만든 요원은 이 id 를 쓸 수 없다) */
export function isRosterId(id: string): boolean {
  return ROSTER.some((a) => a.id === id);
}

/** 요원의 채널 번호. 전체 목록에서의 자리(1부터). 못 찾으면 0 */
export function channelNumber(agent: AgentDef, custom: readonly AgentDef[] = []): number {
  return allAgents(custom).findIndex((a) => a.id === agent.id) + 1;
}

/** 'CH 03' 같은 채널 표기 */
export function channelLabel(n: number): string {
  return n > 0 ? `CH ${String(n).padStart(2, '0')}` : 'CH --';
}

/** 요원의 대표 대사. 지정된 것이 없으면 첫 대사, 대사가 하나도 없으면 null */
export function sampleLineOf(agent: AgentDef): AgentLine | null {
  return getSampleLine(agent) ?? null;
}

/** 대사에 든 표현 태그를 화면용 글로 바꾼다. 예) "<laugh> 됐다!" → "(웃음) 됐다!" */
export function displayLineText(text: string): string {
  return text
    .replace(/<laugh>/g, '(웃음) ')
    .replace(/<breath>/g, '(숨) ')
    .replace(/<sigh>/g, '(한숨) ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 요원 정의의 문제점 목록(한국어). 빈 배열이면 문제없음. 사용자가 만든 요원은 느슨한 규칙으로 본다 */
export function checkAgent(agent: unknown): string[] {
  return validateAgent(agent);
}

// ── 클립(미리 만들어 둔 대사 음성) ───────────────────────────

/** 대사 음성의 캐시·대조용 키. 합성에 영향을 주는 값이 같으면 같은 키 */
export function clipKeyOf(voice: AgentVoice, line: AgentLine): string {
  return clipKey(voice, line);
}

function clipsBase(): string {
  return assetUrl(`${CLIPS_DIR}/`);
}

let indexPromise: Promise<ClipIndex> | null = null;

/** 클립 색인을 한 번만 받아 온다. 없거나 깨졌으면 빈 색인(그때는 엔진 합성으로 넘어간다) */
function clipIndex(): Promise<ClipIndex> {
  indexPromise ??= loadClipIndex(clipsBase());
  return indexPromise;
}

/**
 * 이 대사에 쓸 수 있는 클립의 주소. 클립이 없거나, 목소리 설정이 바뀌어 키가 맞지 않으면 null.
 * 사용자가 만든 요원은 클립이 없다.
 */
export async function findClip(agent: AgentDef, line: AgentLine): Promise<{ url: string; entry: ClipEntry } | null> {
  if (agent.custom) return null;
  const entry = findClipEntry(await clipIndex(), agent, line);
  return entry ? { url: clipUrl(clipsBase(), entry), entry } : null;
}
