// 요원 명단 모듈의 공개 API. DOM 없이 import 할 수 있다.
import type { AgentDef, AgentLine, AgentRole, LineCategory } from '../types.ts';
import { SAMPLE_LINE_ID } from './line.ts';
import { ROSTER } from './roster.ts';

export { ROSTER } from './roster.ts';
export { SAMPLE_LINE_ID } from './line.ts';
export { LINE_TAKES, lineTake } from './takes.ts';
export { BASE_VOICES } from './baseVoices.ts';
export type { BaseVoiceInfo } from './baseVoices.ts';
export {
  BANNED_NAMES,
  CATEGORIES,
  CUSTOM_LIMITS,
  ROLES,
  ROSTER_LIMITS,
  findBannedName,
  hasExpressionTag,
  isAgentDef,
  spokenLength,
  validateAgent,
  validateRoster,
} from './validate.ts';
export type { ValidateOptions } from './validate.ts';

/** 역할 이름(한국어). 순서는 ROLES */
export const ROLE_LABEL: Record<AgentRole, string> = {
  vanguard: '선봉',
  recon: '정찰',
  anchor: '수비',
  support: '지원',
};

/** 역할이 하는 일 한 줄 */
export const ROLE_DESCRIPTION: Record<AgentRole, string> = {
  vanguard: '제일 먼저 들어가 길을 여는 사람',
  recon: '먼저 보고, 본 것을 알려 주는 사람',
  anchor: '맡은 자리를 끝까지 지키는 사람',
  support: '분대의 숨과 기운을 챙기는 사람',
};

/** 대사 분류 이름(한국어). 순서는 CATEGORIES */
export const CATEGORY_LABEL: Record<LineCategory, string> = {
  greeting: '인사',
  ready: '준비',
  tactics: '작전',
  clutch: '승부처',
  banter: '잡담',
  victory: '승리',
  comfort: '위로',
};

const BY_ID = new Map<string, AgentDef>(ROSTER.map((a) => [a.id, a]));

/** 기본 제공 요원을 id 로 찾는다. 없으면 undefined */
export function getAgent(id: string): AgentDef | undefined {
  return BY_ID.get(id);
}

/** 요원의 대표 대사. 지정된 것이 없으면 첫 대사, 대사가 하나도 없으면 undefined */
export function getSampleLine(agent: Pick<AgentDef, 'lines'>): AgentLine | undefined {
  return agent.lines.find((l) => l.id === SAMPLE_LINE_ID) ?? agent.lines[0];
}
