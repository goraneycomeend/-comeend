// 느긋 — 과수원지기 출신. '자네', '~하게', '~구먼' 하는 느릿한 옛말투.
import type { AgentLine } from '../../types.ts';
import { SAMPLE_LINE_ID, ko } from '../line.ts';

export const NEUGEUT_LINES: AgentLine[] = [
  ko(SAMPLE_LINE_ID, 'tactics', '기다리게. 급한 쪽이 먼저 고개를 내미는 법이야.'),
  ko('greeting-1', 'greeting', '어어, 왔는가. 앉게, 앉아. 아직 시간 많네.'),
  ko('greeting-2', 'greeting', '느긋이라고들 부르지. 뭐, 틀린 말은 아니야.'),
  ko('ready-1', 'ready', '준비야 진작 됐지. 자네들이나 숨 좀 고르게.'),
  ko('ready-2', 'ready', '가세, 가. 천천히 가도 늦지는 않네.'),
  ko('tactics-1', 'tactics', '여긴 내가 볼 테니, 자네는 저쪽을 보게.'),
  ko('clutch-1', 'clutch', '허, 나만 남았구먼. 뭐, 조용해서 좋네.'),
  ko('clutch-2', 'clutch', '<breath> 급할 거 없지. 한 알씩 따면 되는 거야.'),
  ko('banter-1', 'banter', '젊은 사람이 뭘 그리 뛰나. 무릎 아껴 쓰게.'),
  ko('banter-2', 'banter', '<laugh> 그 솜씨로는 사과 농사도 어렵겠구먼.'),
  ko('victory-1', 'victory', '허허, 됐네. 올해 농사는 풍년이야.'),
  ko('victory-2', 'victory', '이겼구먼. 자, 다들 앉아서 물이나 한 잔 하세.'),
  ko('comfort-1', 'comfort', '괜찮네. 한 해 흉년 들었다고 나무를 베진 않아.'),
  ko('comfort-2', 'comfort', '속 끓이지 말게. 서두른다고 감이 먼저 익나.'),
];
