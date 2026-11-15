// 미리 만들어 둔 대사 음성(클립)의 색인과 키.
//
// 클립은 효과를 입히기 전의 '원음'이다(무전 토글이나 요원 효과는 재생할 때 입힌다).
// 그래서 키에는 합성 결과를 바꾸는 값만 들어간다: 글, 언어, 보이스 혼합, 빠르기, 스텝 수.
// 효과(fx)는 넣지 않는다. 요원 효과만 손봤다면 클립을 다시 만들 필요가 없다.
//
// 이 파일은 DOM 없이 import 할 수 있다(Node 의 렌더 스크립트와 테스트가 같이 쓴다).

import { BASE_VOICE_IDS } from './types.ts';
import type { AgentDef, AgentLine, AgentVoice, TtsRequest, VoiceBlend } from './types.ts';
import { sha256HexSync } from './tts/modelStore.ts';
import { normalizeBlend } from './tts/voices.ts';

/** 클립을 만들 때 쓰는 디노이징 스텝 수. 앱 안에서 바로 합성할 때의 기본값과 같다 */
export const CLIP_STEPS = 8;

/**
 * 클립 만드는 방법(합성 → 마무리 → mp3)이 바뀌어 전부 다시 만들어야 할 때 올리는 번호.
 * 키에 들어가므로, 올리면 옛 클립은 '키가 다른 클립'이 되어 쓰이지 않는다.
 */
export const CLIP_RENDER_VERSION = 1;

/** clips.json 이 들어 있는 폴더 이름(앱 주소 기준) */
export const CLIPS_DIR = 'clips';
/** 색인 파일 이름 */
export const CLIP_INDEX_FILE = 'clips.json';

/** clips.json 의 한 항목 */
export interface ClipEntry {
  /** clipKey() 값. 지금 요원 설정으로 계산한 키와 같을 때만 이 클립을 쓴다 */
  key: string;
  /** 클립 폴더 기준 상대 경로. 예) "karang/sample.mp3" */
  file: string;
  /** 길이(초) */
  durationSec: number;
  /** 파일 크기(바이트) */
  bytes: number;
  /** 몇 번째 테이크로 만들었는지(0 부터). 같은 키라도 테이크가 다르면 다른 연기다 */
  take?: number;
}

/** clips.json 전체 */
export interface ClipIndex {
  /** 클립을 만든 음성 모델의 id (models/manifest.json 의 id) */
  model: string;
  /** "<요원 id>/<대사 id>" → 항목 */
  clips: Record<string, ClipEntry>;
}

/** 색인에서 클립을 찾는 이름. 예) "karang/sample" */
export function clipId(agentId: string, lineId: string): string {
  return `${agentId}/${lineId}`;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/**
 * 혼합 비율을 키에 넣을 모양으로 고친다.
 * 합이 1 이 되게 맞추고 소수 넷째 자리까지만 남겨, `{F1: 2, F3: 1}` 과 `{F1: 0.6667, F3: 0.3333}` 이 같은 키가 되게 한다.
 * 쓸 수 있는 성분이 없으면 빈 배열(그런 목소리는 어차피 합성하지 못한다).
 */
function canonicalBlend(blend: VoiceBlend): Array<[string, number]> {
  let norm: VoiceBlend;
  try {
    norm = normalizeBlend(blend ?? {});
  } catch {
    return [];
  }
  const out: Array<[string, number]> = [];
  for (const id of BASE_VOICE_IDS) {
    const w = norm[id];
    if (typeof w === 'number' && w > 0) out.push([id, round(w, 4)]);
  }
  return out;
}

/**
 * 대사 음성의 키. 합성에 영향을 주는 값이 같으면 언제 어디서 계산해도 같은 문자열(16진수 16자)이 나온다.
 * 효과(voice.fx)와 대사 id·분류는 들어가지 않는다.
 */
export function clipKey(voice: AgentVoice, line: AgentLine): string {
  const material = JSON.stringify([
    CLIP_RENDER_VERSION,
    CLIP_STEPS,
    line.lang,
    line.text.normalize('NFC'),
    canonicalBlend(voice.blend),
    round(Number.isFinite(voice.speed) ? voice.speed : 1, 3),
  ]);
  return sha256HexSync(new TextEncoder().encode(material)).slice(0, 16);
}

/**
 * 클립을 만들 때 쓰는 난수 시드. 키와 테이크 번호로 정해지므로 같은 대사는 언제나 같은 음성으로 다시 만들어진다.
 * 테이크 번호를 바꾸면 같은 대사의 다른 연기가 나온다.
 */
export function clipSeed(key: string, take = 0): number {
  const hex = sha256HexSync(new TextEncoder().encode(`${key}#${Math.max(0, Math.trunc(take))}`));
  return parseInt(hex.slice(0, 8), 16);
}

/** 클립을 만든 합성 요청 그대로. 렌더 스크립트와 검사 도구가 쓴다 */
export function clipRequest(voice: AgentVoice, line: AgentLine, take = 0): TtsRequest {
  return {
    text: line.text,
    lang: line.lang,
    blend: voice.blend,
    speed: voice.speed,
    steps: CLIP_STEPS,
    seed: clipSeed(clipKey(voice, line), take),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 빈 색인(클립이 하나도 없음) */
export function emptyClipIndex(): ClipIndex {
  return { model: '', clips: {} };
}

/** clips.json 내용을 확인해 색인으로 만든다. 모양이 어긋난 항목은 버린다 */
export function parseClipIndex(json: unknown): ClipIndex {
  const out = emptyClipIndex();
  if (!isRecord(json)) return out;
  if (typeof json.model === 'string') out.model = json.model;
  if (!isRecord(json.clips)) return out;
  for (const [id, raw] of Object.entries(json.clips)) {
    if (!isRecord(raw)) continue;
    const { key, file, durationSec, bytes, take } = raw;
    if (typeof key !== 'string' || typeof file !== 'string' || file.length === 0) continue;
    // 클립 폴더 밖을 가리키는 경로는 받지 않는다
    if (file.startsWith('/') || file.includes('..') || file.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(file)) continue;
    const entry: ClipEntry = {
      key,
      file,
      durationSec: typeof durationSec === 'number' && Number.isFinite(durationSec) ? durationSec : 0,
      bytes: typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : 0,
    };
    if (typeof take === 'number' && Number.isFinite(take)) entry.take = take;
    out.clips[id] = entry;
  }
  return out;
}

/** 폴더 주소를 '/' 로 끝나는 절대 주소로 만든다. 브라우저에서는 상대 주소도 받는다 */
function folderUrl(baseUrl: string | URL): URL {
  const doc = (globalThis as { document?: { baseURI?: string } }).document;
  const loc = (globalThis as { location?: { href?: string } }).location;
  const pageUrl = doc?.baseURI ?? loc?.href;
  const url = pageUrl ? new URL(String(baseUrl), pageUrl) : new URL(String(baseUrl));
  // 색인 파일 주소를 준 경우 그 폴더로
  if (url.pathname.endsWith('.json')) return new URL('.', url);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

export interface ClipFetchOptions {
  /** 기본은 전역 fetch */
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * 클립 색인을 받아 온다. `baseUrl` 은 clips.json 이 있는 폴더의 주소(끝의 '/' 는 없어도 된다).
 * 색인이 없거나 깨져 있어도 오류를 던지지 않고 빈 색인을 돌려준다 — 클립이 없으면 앱은 엔진 합성으로 넘어가면 된다.
 */
export async function loadClipIndex(baseUrl: string | URL, options: ClipFetchOptions = {}): Promise<ClipIndex> {
  try {
    const doFetch = options.fetch ?? globalThis.fetch;
    const res = await doFetch(new URL(CLIP_INDEX_FILE, folderUrl(baseUrl)), { signal: options.signal });
    if (!res.ok) return emptyClipIndex();
    return parseClipIndex(await res.json());
  } catch {
    return emptyClipIndex();
  }
}

/** 클립 파일의 주소. `baseUrl` 은 loadClipIndex 에 준 것과 같은 폴더 주소 */
export function clipUrl(baseUrl: string | URL, entry: ClipEntry | string): string {
  const file = typeof entry === 'string' ? entry : entry.file;
  return new URL(file.replace(/^\.\//, ''), folderUrl(baseUrl)).href;
}

/**
 * 이 요원의 이 대사에 쓸 수 있는 클립. 없거나, 목소리 설정이 바뀌어 키가 맞지 않으면 null.
 * (사용자가 만든 요원은 클립이 없으므로 언제나 null 이다)
 */
export function findClip(index: ClipIndex, agent: Pick<AgentDef, 'id' | 'voice'>, line: AgentLine): ClipEntry | null {
  const entry = index.clips[clipId(agent.id, line.id)];
  if (!entry) return null;
  return entry.key === clipKey(agent.voice, line) ? entry : null;
}
