// 기본 제공 요원 10명. 전부 이 앱을 위해 새로 지은 인물이다.
//
// 콜사인은 '무전에서 들리는 목소리 그대로' 붙인 별명이라는 설정이다(카랑카랑, 나직나직, 조곤조곤 …).
// 초능력이나 고유 기술 같은 설정은 없다. 목소리와 말버릇, 그리고 그 말버릇이 생긴 예전 직업만 있다.
//
// 목소리는 모델의 기본 보이스 10개를 섞은 비율(blend)과 말 빠르기(speed), 약한 음향 효과(fx)로 정한다.
// 값은 실제로 합성해서 잰 결과(기본 주파수, 글자당 길이, 받아쓰기 오류율, 음질 추정)를 보고 골랐다.
// fx 는 '사람 말처럼 들리는 범위'(NATURAL_FX_LIMITS) 안쪽에서만 쓴다.
import type { AgentDef, VoiceFx } from '../types.ts';
import { NEUTRAL_FX } from '../audio/fxSchema.ts';
import { GEOLGEOL_LINES } from './lines/geolgeol.ts';
import { JOGON_LINES } from './lines/jogon.ts';
import { KARANG_LINES } from './lines/karang.ts';
import { KKANKKAN_LINES } from './lines/kkankkan.ts';
import { NAGEUT_LINES } from './lines/nageut.ts';
import { NAJIK_LINES } from './lines/najik.ts';
import { NEUGEUT_LINES } from './lines/neugeut.ts';
import { NEUNGCHEONG_LINES } from './lines/neungcheong.ts';
import { SIKEUNDUNG_LINES } from './lines/sikeundung.ts';
import { TTORANG_LINES } from './lines/ttorang.ts';

/** 적지 않은 값은 0(처리 없음) */
function fx(patch: Partial<VoiceFx>): VoiceFx {
  return { ...NEUTRAL_FX, ...patch };
}

export const ROSTER: AgentDef[] = [
  // ── 선봉 ──────────────────────────────────────────────────
  {
    id: 'karang',
    callsign: '카랑',
    callsignEn: 'KARANG',
    role: 'vanguard',
    tagline: '문이 열리기도 전에 목소리가 먼저 도착한다.',
    bio: '야구장 장내 아나운서로 일하던 버릇이 그대로 남아서, 무슨 일이든 중계하듯 말한다. 제일 먼저 뛰어들면서 분대 기운까지 같이 끌고 들어가는 사람. 조용히 해야 하는 작전에는 영 소질이 없다.',
    traits: ['맑고 높은 톤', '빠른 템포', '중계하듯 띄우는 말'],
    color: '#f2b441',
    voice: { blend: { F2: 1 }, speed: 1.08, fx: fx({ presence: 0.2, air: 0.15, punch: 0.25, room: 0.12 }) },
    lines: KARANG_LINES,
  },
  {
    id: 'geolgeol',
    callsign: '걸걸',
    callsignEn: 'GEOLGEOL',
    role: 'vanguard',
    tagline: '목은 쉬었어도 기세는 안 쉰다.',
    bio: '새벽 수산시장에서 경매를 붙이던 사람이라 목이 늘 반쯤 쉬어 있다. 재고 따지는 걸 못 참아서 일단 들어가고 본다. 싸움이 끝나면 꼭 밥은 먹었는지부터 묻는다.',
    traits: ['굵은 중저음', '호탕한 웃음', '밥부터 챙기는 말버릇'],
    color: '#e8804f',
    voice: { blend: { M4: 1 }, speed: 1.1, fx: fx({ warmth: 0.2, presence: 0.15, punch: 0.3, room: 0.1 }) },
    lines: GEOLGEOL_LINES,
  },
  {
    id: 'najik',
    callsign: '나직',
    callsignEn: 'NAJIK',
    role: 'vanguard',
    tagline: '말수는 적고, 발소리는 더 적다.',
    bio: '도서관 사서였다. 큰 소리를 내면 큰일 나는 줄 아는 버릇이 아직 남아서 무전에서도 속삭이듯 말한다. 말없이 제일 먼저 들어가고, 꼭 필요한 말만 한 줄로 끝낸다.',
    traits: ['아주 낮은 저음', '느린 호흡', '짧게 끊는 말'],
    color: '#7ea6e0',
    voice: { blend: { M5: 1 }, speed: 0.94, fx: fx({ warmth: 0.25, presence: -0.1, punch: 0.15, room: 0.08 }) },
    lines: NAJIK_LINES,
  },

  // ── 정찰 ──────────────────────────────────────────────────
  {
    id: 'sikeundung',
    callsign: '시큰둥',
    callsignEn: 'SIKEUNDUNG',
    role: 'recon',
    tagline: '틀린 곳은 귀신같이 찾는다. 감탄은 안 한다.',
    bio: '출판사에서 남의 원고 틀린 곳만 십 년을 찾았다. 그래서 상대가 어디서 어긋나게 움직이는지 누구보다 먼저 본다. 다만 알려 주는 말투가 좀 심드렁할 뿐이다.',
    traits: ['낮게 깔린 톤', '힘을 뺀 말투', '한숨 섞인 말끝'],
    color: '#b3c264',
    voice: { blend: { F5: 1 }, speed: 0.98, fx: fx({ warmth: 0.1, presence: -0.1, punch: 0.1, room: 0.15 }) },
    lines: SIKEUNDUNG_LINES,
  },
  {
    id: 'jogon',
    callsign: '조곤',
    callsignEn: 'JOGON',
    role: 'recon',
    tagline: '오늘의 전장 예보, 근거부터 말씀드릴게요.',
    bio: '기상 예보관이었다. 감으로 말하는 법이 없고, 늘 근거와 확률을 붙여서 조곤조곤 설명한다. 예보가 빗나가면 변명하는 대신 다음 예보를 고친다.',
    traits: ['차분한 중음', '또박또박한 설명', '확률로 말하는 버릇'],
    color: '#58c4d8',
    voice: { blend: { M1: 1 }, speed: 1.0, fx: fx({ presence: 0.15, punch: 0.2, room: 0.1 }) },
    lines: JOGON_LINES,
  },
  {
    id: 'ttorang',
    callsign: '또랑',
    callsignEn: 'TTORANG',
    role: 'recon',
    tagline: '보고는 또박또박, 실수는 가끔.',
    bio: '분대 막내. 학교 방송부에서 아침 방송을 맡았던 덕에 발음 하나는 누구보다 또렷하다. 본 것은 빠짐없이 보고하려다가 안 해도 될 말까지 가끔 한다.',
    traits: ['또렷한 발음', '씩씩한 말끝', '가끔 새는 본심'],
    color: '#5fd3a0',
    voice: { blend: { F1: 1 }, speed: 1.05, fx: fx({ presence: 0.25, air: 0.15, punch: 0.2, room: 0.12 }) },
    lines: TTORANG_LINES,
  },

  // ── 수비 ──────────────────────────────────────────────────
  {
    id: 'kkankkan',
    callsign: '깐깐',
    callsignEn: 'KKANKKAN',
    role: 'anchor',
    tagline: '대충은 없다. 합격 아니면 다시.',
    bio: '항공기 정비 검수원이었다. 나사 하나도 그냥 넘긴 적이 없는 사람이라, 맡은 자리는 점검표대로 끝까지 지킨다. 칭찬은 드물지만 한번 합격이라고 하면 진짜다.',
    traits: ['단단한 톤', '딱 끊는 말끝', '점검하듯 세는 버릇'],
    color: '#9c9df2',
    voice: { blend: { F4: 1 }, speed: 1.02, fx: fx({ warmth: -0.1, presence: 0.2, punch: 0.3, room: 0.08 }) },
    lines: KKANKKAN_LINES,
  },
  {
    id: 'neugeut',
    callsign: '느긋',
    callsignEn: 'NEUGEUT',
    role: 'anchor',
    tagline: '서두른다고 감이 먼저 익나.',
    bio: '산자락에서 과수원을 돌보던 사람. 기다리는 일이라면 누구보다 자신 있어서, 한번 자리를 잡으면 해가 져도 그대로다. 급한 젊은 요원들을 자네라고 부르며 느릿느릿 달랜다.',
    traits: ['굵고 느린 저음', '늘어지는 말끝', '구수한 옛말투'],
    color: '#cdb590',
    voice: { blend: { M2: 1 }, speed: 0.92, fx: fx({ warmth: 0.25, air: -0.15, punch: 0.15, room: 0.2 }) },
    lines: NEUGEUT_LINES,
  },

  // ── 지원 ──────────────────────────────────────────────────
  {
    id: 'nageut',
    callsign: '나긋',
    callsignEn: 'NAGEUT',
    role: 'support',
    tagline: '급할수록, 목소리는 천천히.',
    bio: '응급 신고 전화를 받던 상황실 요원이었다. 수화기 너머 사람을 목소리 하나로 진정시키던 솜씨로, 지금은 분대의 숨을 고르게 한다. 화내는 모습을 본 사람이 아직 없다.',
    traits: ['부드러운 중음', '느리고 고른 호흡', '안심시키는 말끝'],
    color: '#ea9bb0',
    voice: { blend: { F3: 1 }, speed: 0.95, fx: fx({ warmth: 0.15, presence: -0.05, air: 0.1, punch: 0.1, room: 0.18 }) },
    lines: NAGEUT_LINES,
  },
  {
    id: 'neungcheong',
    callsign: '능청',
    callsignEn: 'NEUNGCHEONG',
    role: 'support',
    tagline: '지금 이 기회, 다시는 안 옵니다.',
    bio: '홈쇼핑 생방송을 진행하던 사람. 어떤 상황이든 지금이 기회라고 띄우는 재주가 있어서, 처진 분대도 금세 솔깃하게 만든다. 진심인지 농담인지는 본인만 안다.',
    traits: ['매끄러운 중음', '능글맞은 억양', '물건 팔듯 띄우는 말'],
    color: '#cf86e0',
    voice: { blend: { M3: 1 }, speed: 1.04, fx: fx({ warmth: 0.1, presence: 0.1, air: 0.1, punch: 0.3, room: 0.1 }) },
    lines: NEUNGCHEONG_LINES,
  },
];
