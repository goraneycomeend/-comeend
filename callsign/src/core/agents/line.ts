// 대사를 적을 때 쓰는 작은 도우미와, 대사 id 규칙.
import type { AgentLine, LineCategory } from '../types.ts';

/**
 * 요원마다 하나씩 있는 대표 대사의 id.
 * 로스터 카드와 상세 시트의 "들어 보기"가 이 대사를 튼다. 모든 요원이 같은 id 를 쓴다.
 */
export const SAMPLE_LINE_ID = 'sample';

/** 한국어 대사 한 줄 */
export function ko(id: string, category: LineCategory, text: string): AgentLine {
  return { id, category, text, lang: 'ko' };
}
