// 카랑 — 야구장 장내 아나운서 출신. 무슨 일이든 중계하듯, 밝고 빠르게. 편한 반말.
import type { AgentLine } from '../../types.ts';
import { SAMPLE_LINE_ID, ko } from '../line.ts';

export const KARANG_LINES: AgentLine[] = [
  ko(SAMPLE_LINE_ID, 'greeting', '자, 카랑 들어갑니다! 다들 귀 열어 두셨죠?'),
  ko('greeting-1', 'greeting', '어, 왔어? 나 오늘 목 상태 완전 좋아.'),
  ko('ready-1', 'ready', '준비 끝! 신호만 줘, 바로 뛸게.'),
  ko('ready-2', 'ready', '하나, 둘, 셋 하면 가는 거야. 셋에 간다?'),
  ko('tactics-1', 'tactics', '내가 먼저 문 열게. 뒤에 딱 붙어서 와.'),
  ko('tactics-2', 'tactics', '왼쪽 비었어, 왼쪽! 지금 밀면 돼!'),
  ko('clutch-1', 'clutch', '나 혼자 남았네? <laugh> 뭐, 주인공은 원래 혼자지.'),
  ko('clutch-2', 'clutch', '쉿, 중계는 잠깐 쉴게. 지금은 집중.'),
  ko('banter-1', 'banter', '방금 그거 봤어? 와, 다시 보기 없나, 진짜.'),
  ko('banter-2', 'banter', '나보고 조용히 하라고? <laugh> 그게 되겠냐고.'),
  ko('victory-1', 'victory', '경기 끝! 오늘의 수훈 선수는, 우리 전부!'),
  ko('victory-2', 'victory', '이겼다! 아, 목 쉬겠네. 근데 기분은 최고야.'),
  ko('comfort-1', 'comfort', '괜찮아, 괜찮아. 구 회 말 투 아웃부터가 진짜잖아.'),
  ko('comfort-2', 'comfort', '한 판 졌다고 시즌 안 끝나. 물 마시고, 다음!'),
];
