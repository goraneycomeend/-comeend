// 시큰둥 — 출판사 교열자 출신. 힘 뺀 반말, 한숨, 틀린 곳부터 짚는 말버릇.
import type { AgentLine } from '../../types.ts';
import { SAMPLE_LINE_ID, ko } from '../line.ts';

export const SIKEUNDUNG_LINES: AgentLine[] = [
  ko(SAMPLE_LINE_ID, 'tactics', '하… 왼쪽에 둘. 내가 말했다, 분명히.'),
  ko('greeting-1', 'greeting', '어, 왔네. 뭐… 반갑다 치자.'),
  ko('greeting-2', 'greeting', '시큰둥이야. 기대는 하지 마, 실망도 안 하게.'),
  ko('ready-1', 'ready', '준비? 됐지 그럼. 빨리 끝내자, 좀.'),
  ko('ready-2', 'ready', '<sigh> 가긴 가는데, 이 계획 누가 짰어?'),
  ko('tactics-1', 'tactics', '거기 아니야. 한 칸 옆. 응, 거기.'),
  ko('clutch-1', 'clutch', '나만 남았어? 아… 귀찮게 됐네.'),
  ko('clutch-2', 'clutch', '조용히 해 봐. 지금 틀린 데 찾는 중이니까.'),
  ko('banter-1', 'banter', '방금 건 잘했네. 뭐야, 칭찬 처음 들어 봐?'),
  ko('banter-2', 'banter', '저쪽 움직임에 오타 있다. 고쳐 주고 올게.'),
  ko('victory-1', 'victory', '이겼네. 응, 좋아. 이게 좋아하는 얼굴이야.'),
  ko('victory-2', 'victory', '끝. 고칠 데 없음. 오늘은 그냥 넘어가 줄게.'),
  ko('comfort-1', 'comfort', '틀려도 돼. 고치라고 내가 있는 거잖아.'),
  ko('comfort-2', 'comfort', '<sigh> 됐어, 초고는 다 그래. 다음 판에 고치자.'),
];
