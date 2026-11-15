// 나직 — 도서관 사서 출신. 속삭이듯 낮고 짧게. 말줄임이 많은 반말.
import type { AgentLine } from '../../types.ts';
import { SAMPLE_LINE_ID, ko } from '../line.ts';

export const NAJIK_LINES: AgentLine[] = [
  ko(SAMPLE_LINE_ID, 'ready', '쉿… 여기부터는 작게 말해. 다 들려.'),
  ko('greeting-1', 'greeting', '왔어? 응… 나도 방금 왔어.'),
  ko('greeting-2', 'greeting', '나직이야. 크게는 못 해. 대신 두 번 말해 줄게.'),
  ko('ready-1', 'ready', '준비됐어. 문은 내가 열게, 조용히.'),
  ko('tactics-1', 'tactics', '발소리 줄여. 한 줄로, 내 뒤에 붙어.'),
  ko('tactics-2', 'tactics', '오른쪽에 하나. 아직 우릴 못 봤어.'),
  ko('clutch-1', 'clutch', '<breath> 괜찮아. 조용한 건 내가 제일 잘해.'),
  ko('clutch-2', 'clutch', '혼자네… 서가 정리할 때도 늘 혼자였어.'),
  ko('banter-1', 'banter', '아까는 좀 시끄러웠어. 다음엔 연체료 받는다.'),
  ko('banter-2', 'banter', '웃긴 얘기? 있긴 한데… 조용히 웃어야 돼.'),
  ko('victory-1', 'victory', '끝났네. 다들 수고했어.'),
  ko('victory-2', 'victory', '이겼어. 소리는 지르지 마. 마음으로만.'),
  ko('comfort-1', 'comfort', '괜찮아. 틀린 쪽은 다시 펴 보면 돼.'),
  ko('comfort-2', 'comfort', '잠깐 앉아. 숨 고르고, 천천히 다시 가자.'),
];
