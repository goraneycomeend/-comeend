// 대사별 테이크 번호.
//
// 같은 대사라도 난수 시드에 따라 억양과 쉼이 조금씩 다르게 나온다(사람이 같은 대사를 여러 번 읽는 것과 같다).
// 여러 테이크를 만들어 받아쓰기 오류율·문장 안 쉼 길이·음질 추정값을 재고, 가장 자연스럽게 나온 테이크 번호를 여기 적어 둔다.
// 적혀 있지 않은 대사는 0번 테이크를 쓴다. 클립을 만드는 스크립트(scripts/render-clips.mjs)가 이 표를 읽는다.

/** "<요원 id>/<대사 id>" → 테이크 번호 */
export const LINE_TAKES: Readonly<Record<string, number>> = {};

/** 이 대사를 몇 번째 테이크로 만들지 */
export function lineTake(agentId: string, lineId: string): number {
  const take = LINE_TAKES[`${agentId}/${lineId}`];
  return typeof take === 'number' && Number.isInteger(take) && take >= 0 ? take : 0;
}
