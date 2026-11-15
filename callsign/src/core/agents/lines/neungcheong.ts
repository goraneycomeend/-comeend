// 능청 — 홈쇼핑 생방송 진행자 출신. 물건 팔듯 띄우는, 능글맞은 '~요' 말투.
import type { AgentLine } from '../../types.ts';
import { SAMPLE_LINE_ID, ko } from '../line.ts';

export const NEUNGCHEONG_LINES: AgentLine[] = [
  ko(SAMPLE_LINE_ID, 'ready', '자, 딱 십 초 드릴게요. 놓치면 후회하실걸요?'),
  ko('greeting-1', 'greeting', '아이고, 오셨어요? 오늘 얼굴 좋으시네, 진짜로.'),
  ko('greeting-2', 'greeting', '능청입니다. 믿으셔도 돼요. 반쯤은요.'),
  ko('ready-1', 'ready', '준비요? 저야 늘 방송 대기 중이죠.'),
  ko('tactics-1', 'tactics', '이쪽은 제가 받칠게요. 편하게 들어가 보세요.'),
  ko('tactics-2', 'tactics', '지금 왼쪽이 비었거든요? 이런 기회 흔치 않아요.'),
  ko('clutch-1', 'clutch', '혼자 남았네요. 뭐, 단독 진행도 해 봤습니다.'),
  ko('clutch-2', 'clutch', '<breath> 자, 마지막 구성입니다. 집중할게요.'),
  ko('banter-1', 'banter', '방금 그건 반품 안 됩니다? 이미 뜯으셨어요.'),
  ko('banter-2', 'banter', '제 칭찬은 공짜예요. <laugh> 그래서 막 드리는 거고요.'),
  ko('victory-1', 'victory', '매진입니다, 매진! 오늘 준비한 승리, 다 나갔어요.'),
  ko('victory-2', 'victory', '이겼죠? 제가 뭐랬어요. 된다고 했잖아요.'),
  ko('comfort-1', 'comfort', '에이, 괜찮아요. 다음 방송에서 만회하면 되죠.'),
  ko('comfort-2', 'comfort', '진 건 환불이 안 돼요. 대신 다음 판은 덤으로 드릴게요.'),
];
