// 또랑 — 분대 막내, 학교 방송부 출신. 또박또박한 '~습니다' 말투에 가끔 본심이 샌다.
import type { AgentLine } from '../../types.ts';
import { SAMPLE_LINE_ID, ko } from '../line.ts';

export const TTORANG_LINES: AgentLine[] = [
  ko(SAMPLE_LINE_ID, 'greeting', '막내 또랑, 보고드립니다! 전방 이상 없습니다!'),
  ko('greeting-1', 'greeting', '안녕하십니까! 아, 너무 컸습니까? 줄이겠습니다.'),
  ko('ready-1', 'ready', '준비 완료했습니다! 신발 끈도 두 번 묶었습니다!'),
  ko('ready-2', 'ready', '저 먼저 가도 됩니까? 아닙니다, 기다리겠습니다.'),
  ko('tactics-1', 'tactics', '앞에 둘, 위에 하나 봤습니다. 확실합니다!'),
  ko('tactics-2', 'tactics', '제가 보고 오겠습니다. 금방 다녀오겠습니다!'),
  ko('clutch-1', 'clutch', '저 혼자입니까? <breath> 네, 할 수 있습니다.'),
  ko('clutch-2', 'clutch', '배운 대로만 하겠습니다. 하나씩, 침착하게.'),
  ko('banter-1', 'banter', '선배님, 방금 그건 좀 멋있었습니다. 진짜로요.'),
  ko('banter-2', 'banter', '아침 방송 때보다 떨립니다. 그땐 대본이 있었거든요.'),
  ko('victory-1', 'victory', '이겼습니다! 와, 진짜 이겼습니다, 우리가!'),
  ko('victory-2', 'victory', '승리 보고드립니다! 아, 다들 이미 아십니까?'),
  ko('comfort-1', 'comfort', '괜찮습니다! 저는 매일 틀리는데도 멀쩡합니다.'),
  ko('comfort-2', 'comfort', '선배님, 물 드십시오. 다음엔 제가 더 잘 보겠습니다.'),
];
