// 조곤 — 기상 예보관 출신. 근거와 확률을 붙여 차근차근 설명하는 '~요' 말투.
import type { AgentLine } from '../../types.ts';
import { SAMPLE_LINE_ID, ko } from '../line.ts';

export const JOGON_LINES: AgentLine[] = [
  ko(SAMPLE_LINE_ID, 'tactics', '오른쪽으로 올 확률이 높아요. 열에 일곱쯤이요.'),
  ko('greeting-1', 'greeting', '안녕하세요. 오늘 전장 예보부터 전해 드릴게요.'),
  ko('greeting-2', 'greeting', '조곤입니다. 궁금한 건 물어보세요, 차근차근 말씀드릴게요.'),
  ko('ready-1', 'ready', '준비됐어요. 변수는 세 가지, 전부 따져 봤어요.'),
  ko('ready-2', 'ready', '지금 들어가면 조금 일러요. 다섯만 세고 가요.'),
  ko('tactics-1', 'tactics', '뒤쪽이 좀 흐려요. 한 분은 뒤를 봐 주세요.'),
  ko('clutch-1', 'clutch', '혼자네요. 음… 확률은 낮지만, 영은 아니에요.'),
  ko('clutch-2', 'clutch', '<breath> 침착하게요. 한 번에 하나씩만 볼게요.'),
  ko('banter-1', 'banter', '제 예보가 틀렸다고요? 그건, 음, 국지성이었어요.'),
  ko('banter-2', 'banter', '우산은 챙기셨어요? 아, 여긴 실내였죠.'),
  ko('victory-1', 'victory', '예보대로네요. 오늘은 종일 맑음이에요.'),
  ko('victory-2', 'victory', '이겼어요. 근거 있는 승리라 더 좋네요.'),
  ko('comfort-1', 'comfort', '괜찮아요. 비 온 다음 날이 제일 맑더라고요.'),
  ko('comfort-2', 'comfort', '이번 판은 흐렸네요. 다음 예보는 제가 고칠게요.'),
];
