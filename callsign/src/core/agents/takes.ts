// 대사별 테이크 번호.
//
// 같은 대사라도 난수 시드에 따라 억양과 쉼이 조금씩 다르게 나온다(사람이 같은 대사를 여러 번 읽는 것과 같다).
// 대사마다 테이크를 3개(첫 요원은 6개) 만들어 받아쓰기 오류율·문장 안 쉼 길이·음질 추정값을 재고,
// 가장 또렷하고 자연스럽게 나온 테이크 번호를 여기 적어 둔다(사람이 귀로 고른 것이 아니라 측정값으로 고른 것이다).
// 적혀 있지 않은 대사는 0번 테이크를 쓴다. 클립을 만드는 스크립트(scripts/render-clips.mjs)가 이 표를 읽는다.
// 대사 글이나 목소리 값을 바꾸면 그 대사의 테이크는 다시 골라야 한다(표에 남은 번호도 틀린 것은 아니지만 고른 근거가 사라진다).

/** "<요원 id>/<대사 id>" → 테이크 번호 */
export const LINE_TAKES: Readonly<Record<string, number>> = {
  'karang/sample': 1,
  'karang/greeting-1': 5,
  'karang/ready-2': 2,
  'karang/tactics-2': 5,
  'karang/clutch-1': 2,
  'karang/clutch-2': 5,
  'karang/banter-2': 3,
  'karang/victory-1': 4,
  'karang/victory-2': 5,
  'karang/comfort-2': 3,

  'geolgeol/sample': 1,
  'geolgeol/ready-1': 1,
  'geolgeol/tactics-1': 2,
  'geolgeol/tactics-2': 2,
  'geolgeol/clutch-1': 2,
  'geolgeol/clutch-2': 2,
  'geolgeol/banter-2': 1,
  'geolgeol/victory-1': 2,
  'geolgeol/comfort-1': 2,
  'geolgeol/comfort-2': 2,

  'najik/sample': 2,
  'najik/greeting-2': 1,
  'najik/ready-1': 1,
  'najik/tactics-1': 2,
  'najik/clutch-1': 1,
  'najik/clutch-2': 2,
  'najik/banter-1': 1,
  'najik/victory-1': 2,
  'najik/comfort-2': 1,

  'sikeundung/sample': 1,
  'sikeundung/greeting-1': 2,
  'sikeundung/greeting-2': 1,
  'sikeundung/clutch-1': 1,
  'sikeundung/clutch-2': 1,
  'sikeundung/comfort-1': 1,
  'sikeundung/comfort-2': 1,

  'jogon/sample': 2,
  'jogon/ready-2': 2,
  'jogon/tactics-1': 1,
  'jogon/clutch-1': 1,
  'jogon/clutch-2': 1,
  'jogon/banter-1': 2,
  'jogon/victory-1': 1,
  'jogon/comfort-2': 2,

  'ttorang/sample': 2,
  'ttorang/tactics-1': 1,
  'ttorang/clutch-2': 1,
  'ttorang/comfort-1': 2,
  'ttorang/comfort-2': 1,

  'kkankkan/sample': 2,
  'kkankkan/greeting-1': 1,
  'kkankkan/greeting-2': 1,
  'kkankkan/ready-2': 1,
  'kkankkan/clutch-1': 1,
  'kkankkan/clutch-2': 1,
  'kkankkan/banter-1': 2,
  'kkankkan/victory-1': 1,
  'kkankkan/comfort-1': 2,
  'kkankkan/comfort-2': 1,

  'neugeut/sample': 1,
  'neugeut/tactics-1': 1,
  'neugeut/clutch-2': 1,
  'neugeut/banter-1': 2,
  'neugeut/victory-1': 2,

  'nageut/greeting-1': 1,
  'nageut/greeting-2': 2,
  'nageut/ready-1': 2,
  'nageut/ready-2': 2,
  'nageut/banter-1': 2,
  'nageut/victory-2': 2,

  'neungcheong/sample': 2,
  'neungcheong/ready-1': 1,
  'neungcheong/tactics-1': 1,
  'neungcheong/tactics-2': 2,
  'neungcheong/clutch-1': 1,
  'neungcheong/banter-2': 1,
  'neungcheong/victory-1': 2,
  'neungcheong/victory-2': 2,
  'neungcheong/comfort-2': 2,
};

/** 이 대사를 몇 번째 테이크로 만들지 */
export function lineTake(agentId: string, lineId: string): number {
  const take = LINE_TAKES[`${agentId}/${lineId}`];
  return typeof take === 'number' && Number.isInteger(take) && take >= 0 ? take : 0;
}
