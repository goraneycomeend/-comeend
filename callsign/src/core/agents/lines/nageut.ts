// 나긋 — 응급 신고 상황실 요원 출신. 급할수록 천천히, 다정한 '~요' 말투.
import type { AgentLine } from '../../types.ts';
import { SAMPLE_LINE_ID, ko } from '../line.ts';

export const NAGEUT_LINES: AgentLine[] = [
  ko(SAMPLE_LINE_ID, 'comfort', '괜찮아요. 제 목소리만 따라오세요, 천천히.'),
  ko('greeting-1', 'greeting', '어서 와요. 오느라 고생했죠? 숨부터 돌려요.'),
  ko('greeting-2', 'greeting', '나긋이에요. 필요하면 불러요, 듣고 있을게요.'),
  ko('ready-1', 'ready', '준비됐어요. 다들 물 마셨죠? 그럼 가요.'),
  ko('ready-2', 'ready', '서두르지 않아도 돼요. 제가 뒤에서 보고 있어요.'),
  ko('tactics-1', 'tactics', '지금 위치만 말해 줘요. 나머지는 제가 맞출게요.'),
  ko('tactics-2', 'tactics', '한 사람씩 불러 볼게요. 대답만 해 줘요.'),
  ko('clutch-1', 'clutch', '혼자여도 혼자가 아니에요. 저 계속 듣고 있어요.'),
  ko('clutch-2', 'clutch', '<breath> 자, 숨 한 번 쉬고. 좋아요, 그대로요.'),
  ko('banter-1', 'banter', '방금 좀 멋있었어요. 아, 이건 기록에 남길게요.'),
  ko('banter-2', 'banter', '제가 화내는 거 보고 싶어요? <laugh> 다음에요, 다음에.'),
  ko('victory-1', 'victory', '다들 무사하죠? 그게 제일 반가운 소식이에요.'),
  ko('victory-2', 'victory', '이겼어요. 수고했어요, 정말. 이제 좀 쉬어요.'),
  ko('comfort-1', 'comfort', '오늘은 여기까지 해도 돼요. 충분히 했어요.'),
];
