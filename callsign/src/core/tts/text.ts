// 글 → 모델 입력. 전처리, 문장 단위 청크, 토큰화.
//
// 전처리 규칙의 뼈대는 Supertonic 참조 구현(supertone-inc/supertonic 의 web/helper.js, MIT)의
// UnicodeProcessor.preprocessText 와 chunkText 를 옮긴 것이다. 참조와 다른 점:
//  - 영어 전용 치환(`@` → " at " 등)을 언어별로 나눴다. 한국어 문장에 영어 단어를 끼워 넣지 않는다.
//  - 표현 태그 <laugh> <breath> <sigh> 만 남기고 사용자가 넣은 다른 <...> 는 지운다.
//  - 모델이 모르는 글자(-1)는 넣지 않고 걸러낸다.
//  - 한 문장이 한도를 넘으면 쉼표 → 띄어쓰기 순으로 끊는다(참조 구현은 그대로 통째로 넣는다).

import { LANGS } from '../types.ts';
import type { Lang } from '../types.ts';

/** 모델이 지원하는 것으로 확인된 표현 태그. 이 밖의 태그는 쓰지 않는다 */
export const EXPRESSION_TAGS = ['laugh', 'breath', 'sigh'] as const;
export type ExpressionTag = (typeof EXPRESSION_TAGS)[number];

/**
 * 청크 사이에 넣는 쉼(초). 0.18~0.35 범위.
 * 모델이 한 조각 안에서 문장 사이에 스스로 두는 쉼(대개 0.3~0.45초)에 맞춘 값이다.
 */
export const PAUSE_SEC = {
  /** 쉼표, 또는 문장부호 없이 길어서 끊은 자리 */
  clause: 0.18,
  /** 쌍점·쌍반점 */
  colon: 0.22,
  /** 마침표 */
  sentence: 0.3,
  /** 물음표·느낌표 */
  emphatic: 0.3,
  /** 말줄임, 문단 바뀜 */
  long: 0.35,
} as const;

export interface TextChunk {
  /** 전처리 전의 조각(사용자가 쓴 그대로에 가깝다) */
  text: string;
  /** 이 조각 다음에 넣을 쉼(초). 마지막 조각은 0 */
  pauseSec: number;
}

/** 한 번에 합성하는 글자 수 한도. 한국어·일본어는 글자당 소리가 길어 짧게 잡는다 */
export function maxChunkLength(lang: Lang): number {
  return lang === 'ko' || lang === 'ja' ? 120 : 300;
}

// 표현 태그를 전처리 동안 지켜 두는 자리표시자(사용자 영역 문자). NFKD 에 변하지 않는다.
const TAG_PLACEHOLDER_BASE = 0xe000;
const PLACEHOLDER_RE = /[-]/g;

const EMOJI_RE =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]+/gu;

/** 참조 구현의 기호 치환표 */
const SYMBOL_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ['–', '-'],
  ['‑', '-'],
  ['—', '-'],
  ['_', ' '],
  ['“', '"'],
  ['”', '"'],
  ['‘', "'"],
  ['’', "'"],
  ['´', "'"],
  ['`', "'"],
  ['[', ' '],
  [']', ' '],
  ['|', ' '],
  ['/', ' '],
  ['#', ' '],
  ['→', ' '],
  ['←', ' '],
];

/** 낱자만 이어 쓴 웃음·울음(ㅋㅋㅋ, ㅎㅎ, ㅠㅠ). 그대로 두면 소리가 될 수 없는 초성만 모델에 들어간다 */
const KO_LAUGH_RE = /[ㅋㅎ]{2,}/g;
const KO_SIGH_RE = /[ㅠㅜ]{2,}/g;
/** 음절을 이루지 못한 한글 호환 낱자 */
const KO_LOOSE_JAMO_RE = /[ㄱ-ㆎ]+/g;

function placeholderFor(tag: ExpressionTag): string {
  return String.fromCharCode(TAG_PLACEHOLDER_BASE + EXPRESSION_TAGS.indexOf(tag));
}

/** 표현 태그는 자리표시자로 바꾸고, 그 밖의 <...> 와 홑 꺾쇠는 지운다 */
function protectTags(text: string, lang: Lang): string {
  let out = text.replace(PLACEHOLDER_RE, '');
  if (lang === 'ko') {
    out = out
      .replace(KO_LAUGH_RE, ` ${placeholderFor('laugh')} `)
      .replace(KO_SIGH_RE, ` ${placeholderFor('sigh')} `)
      .replace(KO_LOOSE_JAMO_RE, ' ');
  }
  out = out.replace(/<\s*(laugh|breath|sigh)\s*>/gi, (_m, name: string) => {
    return ` ${placeholderFor(name.toLowerCase() as ExpressionTag)} `;
  });
  // 사용자가 넣은 다른 태그(언어 태그 포함)는 통째로 지운다
  out = out.replace(/<[^<>]{0,48}>/g, ' ');
  return out.replace(/[<>]/g, ' ');
}

function restoreTags(text: string): string {
  return text.replace(PLACEHOLDER_RE, (ch) => {
    const tag = EXPRESSION_TAGS[ch.charCodeAt(0) - TAG_PLACEHOLDER_BASE];
    return tag ? `<${tag}>` : '';
  });
}

// 이 치환은 NFKD 정규화 뒤에 일어난다. 끼워 넣는 말도 같은 꼴(한글은 자모)이어야 모델이 읽는다
const AT_SIGN_KO = ' 골뱅이 '.normalize('NFKD');
const AT_SIGN_JA = ' アット '.normalize('NFKD');

function replaceExpressions(text: string, lang: Lang): string {
  if (lang === 'en') {
    return text.replaceAll('@', ' at ').replaceAll('e.g.,', 'for example, ').replaceAll('i.e.,', 'that is, ');
  }
  if (lang === 'ko') return text.replaceAll('@', AT_SIGN_KO);
  if (lang === 'ja') return text.replaceAll('@', AT_SIGN_JA);
  // 그 밖의 언어: 읽는 법을 모르니 띄어쓰기로만 바꾼다(모델에 없는 글자라 어차피 걸러진다)
  return text.replaceAll('@', ' ');
}

/** 모델이 모르는 글자를 뺀다. 낱말이 서로 붙지 않게 띄어쓰기로 바꾸되, 결합 부호는 그냥 지운다 */
function dropUnsupported(text: string, indexer: Int32Array): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    const isPlaceholder = cp >= TAG_PLACEHOLDER_BASE && cp < TAG_PLACEHOLDER_BASE + EXPRESSION_TAGS.length;
    if (isPlaceholder || (cp < indexer.length && indexer[cp] >= 0)) out += ch;
    else if (!/\p{M}/u.test(ch)) out += ' ';
  }
  return out;
}

/**
 * 태그 포장 직전까지의 정리. 결과가 빈 문자열이면 읽을 것이 없다는 뜻이다.
 * 운율에 영향을 주는 문장부호(쉼표, 마침표, 물음표, 느낌표, 말줄임, 물결)는 남긴다.
 * `indexer` 를 주면 모델이 모르는 글자를 여기서 미리 빼고 띄어쓰기를 정리한다
 * (토큰화 때 빼면 그 자리에 겹친 띄어쓰기가 남는다).
 */
export function cleanText(text: string, lang: Lang, indexer?: Int32Array): string {
  let t = protectTags(text, lang);
  t = t.normalize('NFKD');
  t = t.replace(EMOJI_RE, '');
  for (const [from, to] of SYMBOL_REPLACEMENTS) t = t.replaceAll(from, to);
  t = t.replace(/[♥☆♡©\\]/g, '');
  t = replaceExpressions(t, lang);
  if (indexer) t = dropUnsupported(t, indexer);

  // 문장부호 앞 띄어쓰기 정리(공백을 먼저 하나로 접어 두어야 빠짐없이 걸린다)
  t = t
    .replace(/\s+/g, ' ')
    .replace(/ ,/g, ',')
    .replace(/ \./g, '.')
    .replace(/ !/g, '!')
    .replace(/ \?/g, '?')
    .replace(/ ;/g, ';')
    .replace(/ :/g, ':')
    .replace(/ '/g, "'");

  // 겹친 따옴표와 지나치게 긴 문장부호 반복 정리(길이 예측이 흔들린다)
  t = t.replace(/"{2,}/g, '"').replace(/'{2,}/g, "'");
  t = t
    .replace(/\.{4,}/g, '...')
    .replace(/!{3,}/g, '!!')
    .replace(/\?{3,}/g, '??')
    .replace(/,{2,}/g, ',')
    .replace(/~{3,}/g, '~~');

  t = t.replace(/\s+/g, ' ').trim();
  t = restoreTags(t);

  // 문장부호·띄어쓰기·태그만 남았으면 읽을 것이 없다
  const spoken = t.replace(/<(?:laugh|breath|sigh)>/g, '').replace(/[\s.,!?;:'"()\-~{}^*+=%&$]/g, '');
  const hasTag = /<(?:laugh|breath|sigh)>/.test(t);
  if (spoken.length === 0 && !hasTag) return '';
  return t;
}

/**
 * 모델에 넣을 문자열을 만든다. 예) `<ko>목표 지점 확보.</ko>`
 * 읽을 글자가 하나도 없으면 빈 문자열을 돌려준다.
 * `indexer`(글자 색인)를 주면 모델이 모르는 글자까지 미리 뺀다. 합성기는 항상 준다.
 */
export function preprocessText(text: string, lang: Lang, indexer?: Int32Array): string {
  if (!LANGS.includes(lang)) {
    throw new RangeError(`지원하지 않는 언어 코드예요: ${String(lang)}`);
  }
  let t = cleanText(text, lang, indexer);
  if (t.length === 0) return '';
  // 문장부호·따옴표·닫는 괄호로 끝나지 않으면 마침표를 붙인다(참조 구현과 같음)
  if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(t)) t += '.';
  return `<${lang}>${t}</${lang}>`;
}

/**
 * 코드포인트 → 토큰 id. 모델이 모르는 글자(-1, 색인 범위 밖)는 건너뛴다.
 * `text` 는 preprocessText 의 결과여야 한다.
 */
export function tokenize(text: string, indexer: Int32Array): number[] {
  const ids: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    const id = cp < indexer.length ? indexer[cp] : -1;
    if (id >= 0) ids.push(id);
  }
  return ids;
}

// ── 청크 ──────────────────────────────────────────────────────────────────

// 문장 끝: 마침표·물음표·느낌표(+닫는 따옴표/괄호) 뒤 공백. 흔한 영어 약어와 "A." 같은 머리글자는 제외한다.
const SENTENCE_SPLIT_RE =
  /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?…]["'”’)」』】]?)\s+|(?<=[。！？]["'”’)」』】]?)(?![。！？"'”’)」』】])/u;

// 쉼표 뒤(공백 포함)에서, 한중일 쉼표는 공백이 없어도 끊는다. 조각은 뒤 공백을 그대로 달고 있다.
const CLAUSE_SPLIT_RE = /(?<=[,;:]\s+)(?=\S)|(?<=[、，])(?=\S)/u;
const WORD_SPLIT_RE = /(?<=\s)(?=\S)/u;

function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 태그(<...>) 한가운데나 서러게이트 쌍 사이가 아닌, 한도 안의 가장 늦은 자리에서 자른다 */
function hardCut(s: string, maxLen: number): [string, string] {
  let cut = maxLen;
  const open = s.lastIndexOf('<', cut - 1);
  if (open > 0 && s.indexOf('>', open) >= cut) cut = open;
  const code = s.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff && cut > 1) cut -= 1;
  return [s.slice(0, cut), s.slice(cut)];
}

/**
 * 조각들을 한도 안에서 이어 붙인다. 조각은 자기 뒤 공백을 달고 있으므로 그냥 잇고, 내보낼 때만 다듬는다.
 * 혼자서 한도를 넘는 조각은 `splitOversize` 로 더 잘게 나눈다.
 */
function packParts(parts: string[], maxLen: number, splitOversize: (part: string) => string[]): string[] {
  const out: string[] = [];
  let cur = '';
  const push = (): void => {
    const t = cur.trim();
    if (t) out.push(t);
    cur = '';
  };
  for (const part of parts) {
    const pieces = part.trim().length > maxLen ? splitOversize(part) : [part];
    for (const piece of pieces) {
      if ((cur + piece).trim().length > maxLen) push();
      cur += piece;
    }
  }
  push();
  return out;
}

/** 한도를 넘는 한 문장을 쉼표 → 띄어쓰기 → 글자 수 순으로 끊는다 */
function splitLongSentence(sentence: string, maxLen: number): string[] {
  const byChars = (s: string): string[] => {
    const pieces: string[] = [];
    let rest = s;
    while (rest.trim().length > maxLen) {
      const [head, tail] = hardCut(rest, maxLen);
      pieces.push(head);
      rest = tail;
    }
    if (rest) pieces.push(rest);
    return pieces;
  };
  const byWords = (s: string): string[] => packParts(s.split(WORD_SPLIT_RE), maxLen, byChars);
  return packParts(sentence.split(CLAUSE_SPLIT_RE), maxLen, byWords);
}

/** 조각의 끝 문장부호로 다음 쉼 길이를 정한다 */
export function pauseAfter(chunk: string): number {
  // 끝의 닫는 따옴표·괄호·표현 태그는 건너뛰고 본다
  const t = chunk
    .trimEnd()
    .replace(/(?:<(?:laugh|breath|sigh)>|["'”’)\]}」』】\s])+$/gi, '')
    .normalize('NFKC');
  if (/(?:…|\.{2,})$/.test(t)) return PAUSE_SEC.long;
  if (/[!?]$/.test(t)) return PAUSE_SEC.emphatic;
  if (/[.。]$/.test(t)) return PAUSE_SEC.sentence;
  if (/[:;]$/.test(t)) return PAUSE_SEC.colon;
  return PAUSE_SEC.clause;
}

/**
 * 글을 문장 단위로 묶어 합성 단위(청크)와 그 사이 쉼을 정한다.
 * 문장은 한도 안에서 이어 붙이고(모델이 문장 사이 억양과 쉼을 스스로 만든다), 문단이 바뀌면 끊는다.
 */
export function planChunks(text: string, lang: Lang): TextChunk[] {
  const maxLen = maxChunkLength(lang);
  const normalized = text.normalize('NFC').replace(/\r\n?/g, '\n');
  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // 일본어는 문장 사이를 띄우지 않는다
  const joiner = lang === 'ja' ? '' : ' ';
  const lineStop = lang === 'ja' ? '。' : '.';

  const chunks: TextChunk[] = [];
  for (const paragraph of paragraphs) {
    // 줄바꿈 하나는 문장 경계로 본다. 문장부호 없이 끝난 줄에는 마침표를 붙여 다음 줄과 엉기지 않게 한다
    const lines = paragraph
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const sentences: string[] = [];
    lines.forEach((line, i) => {
      const isLastLine = i === lines.length - 1;
      const closed = /[.!?;:,…。！？、，~"'”’)\]}」』】>]$/.test(line);
      sentences.push(...splitSentences(isLastLine || closed ? line : line + lineStop));
    });

    const start = chunks.length;
    let current = '';
    const flush = (): void => {
      if (current) chunks.push({ text: current, pauseSec: pauseAfter(current) });
      current = '';
    };
    for (const sentence of sentences) {
      if (sentence.length > maxLen) {
        flush();
        for (const piece of splitLongSentence(sentence, maxLen)) {
          chunks.push({ text: piece, pauseSec: pauseAfter(piece) });
        }
      } else if (current.length + sentence.length + joiner.length <= maxLen) {
        current += (current ? joiner : '') + sentence;
      } else {
        flush();
        current = sentence;
      }
    }
    flush();
    // 문단 끝은 길게 쉰다
    if (chunks.length > start) chunks[chunks.length - 1].pauseSec = PAUSE_SEC.long;
  }

  // 읽을 것이 없는 조각(이모지뿐인 문장 등)은 버린다
  const speakable = chunks.filter((c) => cleanText(c.text, lang).length > 0);
  if (speakable.length > 0) speakable[speakable.length - 1].pauseSec = 0;
  return speakable;
}

/** 합성 단위로 나눈 글 조각. 각 조각은 preprocessText 에 그대로 넣을 수 있다 */
export function chunkText(text: string, lang: Lang): string[] {
  return planChunks(text, lang).map((c) => c.text);
}
