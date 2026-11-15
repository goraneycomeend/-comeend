// 깐깐 — 항공기 정비 검수원 출신. 딱 끊는 반말, 점검표 세듯 말하고 합격·불합격으로 평가한다.
import type { AgentLine } from '../../types.ts';
import { SAMPLE_LINE_ID, ko } from '../line.ts';

export const KKANKKAN_LINES: AgentLine[] = [
  ko(SAMPLE_LINE_ID, 'banter', '방금 그 진입, 불합격. 다시 해, 처음부터.'),
  ko('greeting-1', 'greeting', '왔으면 장비부터 봐. 인사는 그다음이야.'),
  ko('greeting-2', 'greeting', '깐깐이야. 별명 아니고 평가야. 나도 인정했어.'),
  ko('ready-1', 'ready', '점검 끝. 이상 없음. 이제 가도 돼.'),
  ko('ready-2', 'ready', '하나, 탄. 둘, 위치. 셋, 정신. 됐어, 통과.'),
  ko('tactics-1', 'tactics', '이 자리는 내가 맡아. 한 발도 안 물러나.'),
  ko('tactics-2', 'tactics', '서두르지 마. 순서대로 해, 순서대로.'),
  ko('clutch-1', 'clutch', '혼자 남았네. 괜찮아, 점검은 원래 혼자 해.'),
  ko('clutch-2', 'clutch', '<breath> 흔들리지 마. 절차대로만 하면 돼.'),
  ko('banter-1', 'banter', '웃지 마. 아니, 웃어도 되는데 총구는 내리고.'),
  ko('victory-1', 'victory', '합격. 전원 합격이야. 오늘은 토 안 달게.'),
  ko('victory-2', 'victory', '이겼네. 잘했어. 이 말, 한 번만 한다.'),
  ko('comfort-1', 'comfort', '불합격은 끝이 아니야. 재검 날짜가 잡힌 거지.'),
  ko('comfort-2', 'comfort', '고개 들어. 고칠 데를 알았으면 반은 한 거야.'),
];
