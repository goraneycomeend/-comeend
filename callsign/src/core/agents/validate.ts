// 요원 정의 검사. 문제점을 한국어 문장 목록으로 돌려준다(빈 배열이면 문제없음).
//
// 두 가지 엄격함이 있다.
//  - 기본 제공 요원(custom 이 아닌 것): 모양 검사에 더해 '사람 말처럼 들리는 범위'(효과·빠르기)와
//    대사 규칙(분류별 2개, 8~40자, 한글로만), 다른 게임 캐릭터 이름과 겹치지 않는지까지 본다.
//  - 사용자가 만든 요원(custom: true): 모양과 값의 범위만 본다. 효과를 세게 주는 것은 사용자의 자유다.
import { BASE_VOICE_IDS, LANGS } from '../types.ts';
import type { AgentDef, AgentRole, LineCategory, VoiceFx } from '../types.ts';
import { FX_PARAMS, NATURAL_FX_LIMITS } from '../audio/fxSchema.ts';
import { SAMPLE_LINE_ID } from './line.ts';

export const ROLES: readonly AgentRole[] = ['vanguard', 'recon', 'anchor', 'support'];
export const CATEGORIES: readonly LineCategory[] = [
  'greeting',
  'ready',
  'tactics',
  'clutch',
  'banter',
  'victory',
  'comfort',
];

/** 기본 제공 요원에게 적용하는 범위 */
export const ROSTER_LIMITS = {
  speedMin: 0.92,
  speedMax: 1.12,
  /** 대사 길이(표현 태그를 뺀 글자 수, 띄어쓰기·문장부호 포함) */
  lineMinChars: 8,
  lineMaxChars: 40,
  linesPerCategory: 2,
  /** 표현 태그를 쓴 대사는 요원당 이만큼까지 */
  maxTaggedLines: 3,
  traitCount: 3,
} as const;

/** 사용자가 만든 요원에게 적용하는 범위 */
export const CUSTOM_LIMITS = {
  speedMin: 0.8,
  speedMax: 1.4,
  lineMaxChars: 300,
  maxLines: 60,
  maxTraits: 5,
  callsignMaxChars: 16,
  taglineMaxChars: 80,
  bioMaxChars: 400,
} as const;

export interface ValidateOptions {
  /**
   * true 면 기본 제공 요원의 규칙까지 검사한다.
   * 주지 않으면 요원의 `custom` 값으로 정한다(custom 이 아니면 엄격하게).
   */
  strict?: boolean;
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const TAG_RE = /<(?:laugh|breath|sigh)>/g;
/** 기본 제공 대사에 쓸 수 있는 글자: 한글 음절, 띄어쓰기, 말의 호흡을 만드는 문장부호 */
const ROSTER_LINE_CHARS_RE = /^[가-힣 .,!?…~]+$/;

// 다른 게임의 캐릭터 이름과 겹치지 않게 대조하는 목록(이름을 쓰려는 것이 아니라 피하려는 것이다).
const BANNED_LATIN = [
  'brimstone', 'viper', 'omen', 'killjoy', 'cypher', 'sova', 'sage', 'phoenix', 'jett', 'reyna', 'raze', 'breach',
  'skye', 'yoru', 'astra', 'kayo', 'chamber', 'neon', 'fade', 'harbor', 'gekko', 'deadlock', 'iso', 'clove', 'vyse',
  'tejo', 'waylay', 'veto',
];
const BANNED_HANGUL = [
  '브림스톤', '바이퍼', '오멘', '킬조이', '사이퍼', '소바', '세이지', '피닉스', '제트', '레이나', '레이즈', '브리치',
  '스카이', '요루', '아스트라', '케이오', '체임버', '챔버', '네온', '페이드', '하버', '게코', '데드록', '데드락',
  '아이소', '클로브', '바이스', '테호', '웨이레이', '비토',
];
/** 이름 뒤에 붙을 수 있는 조사·어미. 이것까지만 같은 낱말로 본다("네온사인" 같은 다른 낱말은 걸지 않는다) */
const PARTICLES = new Set([
  '', '은', '는', '이', '가', '을', '를', '의', '와', '과', '도', '만', '야', '아', '랑', '이랑', '로', '으로',
  '님', '씨', '처럼', '같이', '보다', '한테', '에게', '까지', '부터', '이다', '이야', '예요', '이에요', '입니다',
]);

/** 대조용 이름 목록(영문 소문자, 한글) */
export const BANNED_NAMES: readonly string[] = [...BANNED_LATIN, ...BANNED_HANGUL];

/**
 * 글 안에 다른 게임 캐릭터 이름이 낱말로 들어 있으면 그 이름을, 없으면 null 을 돌려준다.
 * 낱말 단위로 본다: "MESSAGE" 나 "네온사인" 은 걸리지 않는다.
 */
export function findBannedName(text: string): string | null {
  const lower = text.normalize('NFC').toLowerCase();
  // 'KAY/O', 'kay-o' 처럼 기호가 낀 표기
  if (/(?<![a-z])kay[\s/\-.]?o(?![a-z])/.test(lower)) return 'kayo';
  for (const token of lower.split(/[^\p{L}\p{N}]+/u)) {
    if (!token) continue;
    if (BANNED_LATIN.includes(token)) return token;
    for (const name of BANNED_HANGUL) {
      if (token.startsWith(name) && PARTICLES.has(token.slice(name.length))) return name;
    }
  }
  return null;
}

/** 표현 태그를 뺀 대사 글자 수(띄어쓰기·문장부호 포함) */
export function spokenLength(text: string): number {
  return [...text.replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim()].length;
}

/** 대사에 표현 태그가 들어 있는지 */
export function hasExpressionTag(text: string): boolean {
  return text.search(TAG_RE) >= 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function charCount(s: string): number {
  return [...s].length;
}

function checkVoice(voice: unknown, strict: boolean, out: string[]): void {
  if (!isRecord(voice)) {
    out.push('목소리 설정(voice)이 없어요.');
    return;
  }

  // 혼합
  const blend = voice.blend;
  if (!isRecord(blend)) {
    out.push('기본 보이스 혼합(blend)이 없어요.');
  } else {
    let positive = 0;
    for (const [key, w] of Object.entries(blend)) {
      if (!(BASE_VOICE_IDS as readonly string[]).includes(key)) {
        out.push(`모르는 기본 보이스예요: ${key}`);
      } else if (!isFiniteNumber(w) || w < 0) {
        out.push(`기본 보이스 ${key} 의 비율은 0 이상의 숫자여야 해요.`);
      } else if (w > 0) {
        positive++;
      }
    }
    if (positive === 0) out.push('기본 보이스를 하나 이상 골라 주세요.');
    if (positive > 3) out.push('기본 보이스는 3개까지만 섞을 수 있어요.');
  }

  // 빠르기
  const min = strict ? ROSTER_LIMITS.speedMin : CUSTOM_LIMITS.speedMin;
  const max = strict ? ROSTER_LIMITS.speedMax : CUSTOM_LIMITS.speedMax;
  if (!isFiniteNumber(voice.speed)) {
    out.push('말 빠르기(speed)는 숫자여야 해요.');
  } else if (voice.speed < min - 1e-9 || voice.speed > max + 1e-9) {
    out.push(`말 빠르기는 ${min}~${max} 사이여야 해요. (지금 ${voice.speed})`);
  }

  // 효과
  const fx = voice.fx;
  if (!isRecord(fx)) {
    out.push('음향 효과(fx)가 없어요.');
    return;
  }
  for (const p of FX_PARAMS) {
    const v = fx[p.key];
    if (!isFiniteNumber(v)) {
      out.push(`효과 '${p.label}'(${p.key}) 값이 없거나 숫자가 아니에요.`);
      continue;
    }
    if (v < p.min - 1e-9 || v > p.max + 1e-9) {
      out.push(`효과 '${p.label}' 은 ${p.min}~${p.max} 사이여야 해요. (지금 ${v})`);
      continue;
    }
    if (strict) {
      const lim = NATURAL_FX_LIMITS[p.key as keyof VoiceFx];
      if (v < lim.min - 1e-9 || v > lim.max + 1e-9) {
        const range = lim.min === lim.max ? `${lim.min}` : `${lim.min}~${lim.max}`;
        out.push(`기본 요원의 '${p.label}' 은 사람 말처럼 들리는 범위(${range}) 안이어야 해요. (지금 ${v})`);
      }
    }
  }
}

function checkLines(lines: unknown, strict: boolean, out: string[]): void {
  if (!Array.isArray(lines)) {
    out.push('대사 목록(lines)이 없어요.');
    return;
  }
  if (!strict && lines.length > CUSTOM_LIMITS.maxLines) {
    out.push(`대사는 ${CUSTOM_LIMITS.maxLines}개까지 넣을 수 있어요.`);
  }

  const seen = new Set<string>();
  const perCategory = new Map<string, number>();
  let tagged = 0;
  lines.forEach((line: unknown, i) => {
    const where = `대사 ${i + 1}번`;
    if (!isRecord(line)) {
      out.push(`${where}의 모양이 잘못됐어요.`);
      return;
    }
    const { id, category, text, lang } = line;
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      out.push(`${where}의 id 는 소문자 영문·숫자·하이픈이어야 해요.`);
    } else if (seen.has(id)) {
      out.push(`대사 id 가 겹쳐요: ${id}`);
    } else {
      seen.add(id);
    }
    if (typeof category !== 'string' || !(CATEGORIES as readonly string[]).includes(category)) {
      out.push(`${where}의 분류(category)를 알 수 없어요.`);
    } else {
      perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
    }
    if (typeof lang !== 'string' || !(LANGS as readonly string[]).includes(lang)) {
      out.push(`${where}의 언어 코드를 알 수 없어요.`);
    }
    if (typeof text !== 'string' || text.trim().length === 0) {
      out.push(`${where}의 글이 비어 있어요.`);
      return;
    }

    if (!strict) {
      if (charCount(text) > CUSTOM_LIMITS.lineMaxChars) {
        out.push(`${where}이 너무 길어요. ${CUSTOM_LIMITS.lineMaxChars}자 안으로 줄여 주세요.`);
      }
      return;
    }

    // 여기부터 기본 제공 대사 규칙
    const label = typeof id === 'string' ? `대사 '${id}'` : where;
    if (lang !== 'ko') out.push(`${label}: 기본 대사는 한국어(ko)여야 해요.`);
    if (hasExpressionTag(text)) tagged++;
    const bare = text.replace(TAG_RE, ' ');
    if (/[<>]/.test(bare)) {
      out.push(`${label}: 표현 태그는 <laugh> <breath> <sigh> 만 쓸 수 있어요.`);
    } else if (!ROSTER_LINE_CHARS_RE.test(bare)) {
      out.push(`${label}: 한글과 기본 문장부호(. , ! ? … ~)로만 적어 주세요. 숫자와 영문도 한글로 풀어 씁니다.`);
    }
    if (/^\s*[.…,~]/.test(bare.trimStart())) {
      out.push(`${label}: 문장부호로 시작하면 첫소리가 어색해져요.`);
    }
    const n = spokenLength(text);
    if (n < ROSTER_LIMITS.lineMinChars || n > ROSTER_LIMITS.lineMaxChars) {
      out.push(`${label}: 길이는 ${ROSTER_LIMITS.lineMinChars}~${ROSTER_LIMITS.lineMaxChars}자여야 해요. (지금 ${n}자)`);
    }
    const banned = findBannedName(text);
    if (banned) out.push(`${label}: 다른 게임 캐릭터 이름(${banned})이 들어 있어요.`);
  });

  if (!strict) return;
  for (const c of CATEGORIES) {
    const n = perCategory.get(c) ?? 0;
    if (n !== ROSTER_LIMITS.linesPerCategory) {
      out.push(`분류 '${c}' 의 대사는 ${ROSTER_LIMITS.linesPerCategory}개여야 해요. (지금 ${n}개)`);
    }
  }
  if (!seen.has(SAMPLE_LINE_ID)) out.push(`대표 대사(id '${SAMPLE_LINE_ID}')가 없어요.`);
  if (tagged > ROSTER_LIMITS.maxTaggedLines) {
    out.push(`표현 태그를 쓴 대사는 ${ROSTER_LIMITS.maxTaggedLines}개까지예요. (지금 ${tagged}개)`);
  }
}

/**
 * 요원 정의 하나를 검사한다. 문제점 목록을 돌려주고, 문제가 없으면 빈 배열.
 * 가져온 JSON 처럼 모양을 믿을 수 없는 값을 넣어도 오류를 던지지 않는다.
 */
export function validateAgent(agent: unknown, opts: ValidateOptions = {}): string[] {
  const out: string[] = [];
  if (!isRecord(agent)) return ['요원 정보의 모양이 잘못됐어요.'];
  const strict = opts.strict ?? agent.custom !== true;

  const { id, callsign, callsignEn, role, tagline, bio, traits, color } = agent;

  if (typeof id !== 'string' || !ID_RE.test(id) || id.length > 40) {
    out.push('id 는 소문자 영문·숫자·하이픈으로 적어 주세요.');
  }

  if (typeof callsign !== 'string' || callsign.trim().length === 0) {
    out.push('콜사인을 적어 주세요.');
  } else if (charCount(callsign) > CUSTOM_LIMITS.callsignMaxChars) {
    out.push(`콜사인은 ${CUSTOM_LIMITS.callsignMaxChars}자까지예요.`);
  } else if (strict && !/^[가-힣]{2,4}$/.test(callsign)) {
    out.push('기본 요원의 콜사인은 한글 2~4자여야 해요.');
  }

  if (typeof callsignEn !== 'string') {
    out.push('영문 표기(callsignEn)가 없어요.');
  } else if (strict ? !/^[A-Z]{3,14}$/.test(callsignEn) : callsignEn !== callsignEn.toUpperCase() || callsignEn.length > 24) {
    out.push(strict ? '기본 요원의 영문 표기는 대문자 3~14자여야 해요.' : '영문 표기는 대문자로, 24자 안으로 적어 주세요.');
  }

  if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) {
    out.push('역할은 선봉·정찰·수비·지원 가운데 하나여야 해요.');
  }

  if (typeof tagline !== 'string') {
    out.push('한 줄 소개(tagline)가 없어요.');
  } else if (charCount(tagline) > CUSTOM_LIMITS.taglineMaxChars) {
    out.push(`한 줄 소개는 ${CUSTOM_LIMITS.taglineMaxChars}자까지예요.`);
  } else if (strict && charCount(tagline.trim()) < 6) {
    out.push('기본 요원에게는 한 줄 소개가 있어야 해요.');
  }

  if (typeof bio !== 'string') {
    out.push('소개 글(bio)이 없어요.');
  } else if (charCount(bio) > CUSTOM_LIMITS.bioMaxChars) {
    out.push(`소개 글은 ${CUSTOM_LIMITS.bioMaxChars}자까지예요.`);
  } else if (strict && charCount(bio.trim()) < 40) {
    out.push('기본 요원에게는 두세 문장의 소개 글이 있어야 해요.');
  }

  if (!Array.isArray(traits) || traits.some((t) => typeof t !== 'string')) {
    out.push('목소리 특징(traits)은 글자 목록이어야 해요.');
  } else if (strict ? traits.length !== ROSTER_LIMITS.traitCount : traits.length > CUSTOM_LIMITS.maxTraits) {
    out.push(
      strict
        ? `기본 요원의 목소리 특징은 ${ROSTER_LIMITS.traitCount}개여야 해요.`
        : `목소리 특징은 ${CUSTOM_LIMITS.maxTraits}개까지예요.`,
    );
  } else if (strict && traits.some((t) => (t as string).trim().length === 0)) {
    out.push('목소리 특징에 빈 항목이 있어요.');
  }

  if (typeof color !== 'string' || !COLOR_RE.test(color)) {
    out.push('대표색은 #rrggbb 꼴이어야 해요.');
  }

  if (agent.custom !== undefined && typeof agent.custom !== 'boolean') {
    out.push('custom 은 참/거짓이어야 해요.');
  }

  checkVoice(agent.voice, strict, out);
  checkLines(agent.lines, strict, out);

  if (strict) {
    const fields: Array<[string, unknown]> = [
      ['id', id],
      ['콜사인', callsign],
      ['영문 표기', callsignEn],
      ['한 줄 소개', tagline],
      ['소개 글', bio],
      ['목소리 특징', Array.isArray(traits) ? traits.join(' ') : ''],
    ];
    for (const [label, value] of fields) {
      if (typeof value !== 'string') continue;
      const banned = findBannedName(value);
      if (banned) out.push(`${label}에 다른 게임 캐릭터 이름(${banned})이 들어 있어요.`);
    }
  }

  return out;
}

/** 검사를 통과한 요원 정의인지(타입 가드). 가져온 JSON 을 받아들일 때 쓴다 */
export function isAgentDef(agent: unknown, opts: ValidateOptions = {}): agent is AgentDef {
  return validateAgent(agent, opts).length === 0;
}

function blendSignature(agent: AgentDef): string {
  const parts: string[] = [];
  let sum = 0;
  for (const id of BASE_VOICE_IDS) sum += Math.max(0, agent.voice.blend[id] ?? 0);
  for (const id of BASE_VOICE_IDS) {
    const w = Math.max(0, agent.voice.blend[id] ?? 0);
    if (w > 0 && sum > 0) parts.push(`${id}:${(w / sum).toFixed(2)}`);
  }
  return parts.join('+');
}

/**
 * 요원 명단 전체를 검사한다: 요원 하나하나의 규칙에 더해, 서로 겹치는 것이 없는지 본다.
 * (id·콜사인·대표색·보이스 혼합이 겹치지 않고, 역할이 고르게 있어야 한다)
 */
export function validateRoster(agents: readonly AgentDef[]): string[] {
  const out: string[] = [];
  const seen = {
    id: new Map<string, string>(),
    callsign: new Map<string, string>(),
    callsignEn: new Map<string, string>(),
    color: new Map<string, string>(),
    blend: new Map<string, string>(),
  };
  const roles = new Map<string, number>();

  for (const agent of agents) {
    const name = typeof agent?.callsign === 'string' ? agent.callsign : String(agent?.id);
    for (const problem of validateAgent(agent, { strict: true })) out.push(`[${name}] ${problem}`);
    if (!isRecord(agent) || !isRecord(agent.voice) || !isRecord(agent.voice.blend)) continue;

    const checks: Array<[keyof typeof seen, string, string]> = [
      ['id', agent.id, 'id'],
      ['callsign', agent.callsign, '콜사인'],
      ['callsignEn', agent.callsignEn, '영문 표기'],
      ['color', String(agent.color).toLowerCase(), '대표색'],
      ['blend', blendSignature(agent), '보이스 혼합'],
    ];
    for (const [field, value, label] of checks) {
      const other = seen[field].get(value);
      if (other !== undefined) out.push(`[${name}] ${label}이(가) ${other} 와(과) 겹쳐요: ${value}`);
      else seen[field].set(value, name);
    }
    roles.set(agent.role, (roles.get(agent.role) ?? 0) + 1);
  }

  for (const role of ROLES) {
    if ((roles.get(role) ?? 0) < 2) out.push(`역할 '${role}' 을 맡은 요원이 2명보다 적어요.`);
  }
  return out;
}
