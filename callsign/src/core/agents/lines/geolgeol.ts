// 걸걸 — 새벽 수산시장 경매사 출신. 목청 좋고 거침없는 반말, 밥 챙기는 말버릇.
import type { AgentLine } from '../../types.ts';
import { SAMPLE_LINE_ID, ko } from '../line.ts';

export const GEOLGEOL_LINES: AgentLine[] = [
  ko(SAMPLE_LINE_ID, 'greeting', '걸걸이다. 목소리 듣고 놀라지 마라, 원래 이래.'),
  ko('greeting-1', 'greeting', '어이, 왔냐! 오늘 물 좋다, 물 좋아!'),
  ko('ready-1', 'ready', '됐다, 됐어. 재지 말고 그냥 가자고!'),
  ko('ready-2', 'ready', '자, 판 깔렸다. 먼저 부르는 놈이 임자야.'),
  ko('tactics-1', 'tactics', '내가 앞장설 테니까, 니들은 옆구리만 봐 줘.'),
  ko('tactics-2', 'tactics', '정면으로 간다. 머리 굴릴 시간에 한 발 더 가.'),
  ko('clutch-1', 'clutch', '혼자 남았다고? <laugh> 낙찰이다, 낙찰. 내 거야.'),
  ko('clutch-2', 'clutch', '하, 숨 좀 고르고. 좋아, 딱 한 번만 더.'),
  ko('banter-1', 'banter', '다들 밥은 먹었지? 난 빈속으론 못 뛴다.'),
  ko('banter-2', 'banter', '목청이 왜 이리 크냐고? 새벽 장사 십 년 해 봐라.'),
  ko('victory-1', 'victory', '이겼다! 오늘 저녁은 내가 산다, 다 따라와!'),
  ko('victory-2', 'victory', '<laugh> 거 봐라, 밀어붙이니까 되잖아!'),
  ko('comfort-1', 'comfort', '야, 고개 들어. 오늘 못 판 건 내일 팔면 돼.'),
  ko('comfort-2', 'comfort', '졌으면 어때. 밥 먹고 한숨 자면 또 새벽이야.'),
];
