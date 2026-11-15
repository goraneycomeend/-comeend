// 앱 상태(zustand). 선택한 요원, 사용자가 만든 요원, 무전 토글, 엔진 상태 사본, 최근 생성 기록, 재생 표시, 알림.
import { useMemo } from 'react';
import { create } from 'zustand';
import { clampFx } from '../core/audio/index.ts';
import { BASE_VOICE_IDS } from '../core/types.ts';
import type { AgentDef, AgentLine, AgentRole, BaseVoiceId, VoiceBlend } from '../core/types.ts';
import { FALLBACK_AGENT_COLOR, isHexColor } from './color.ts';
import { ROLE_ORDER, allAgents, channelNumber, findAgent, isRosterId, rosterAgents } from './roster.ts';
import { STORAGE_KEYS, isBoolean, isString, readJson, writeJson } from './storage.ts';
import type { EngineMirror, PlayPhase, PlaybackState, SpokenResult, ToastItem, ToastTone } from './types.ts';

/** 최근 생성 기록에 남기는 개수 */
export const HISTORY_LIMIT = 10;
/** 한 번에 보이는 알림 개수 */
const TOAST_LIMIT = 3;

export interface AppState {
  /** 지금 고른 요원의 id. 항상 실제로 있는 요원을 가리킨다 */
  selectedAgentId: string;
  /** 랩에서 만든 요원들 (기기에 저장된다) */
  customAgents: AgentDef[];
  /** 무전 효과 토글 (대사·스튜디오가 함께 쓴다) */
  radio: boolean;
  engine: EngineMirror;
  /** 스튜디오에서 만든 음성. 최신이 앞. 메모리에만 있다 */
  history: SpokenResult[];
  playback: PlaybackState | null;
  toasts: ToastItem[];
  /** 다른 화면이 스튜디오로 넘기는 글("스튜디오에서 고치기"). 스튜디오가 읽고 비운다 */
  studioDraft: string | null;

  selectAgent(id: string): void;
  setRadio(on: boolean): void;
  /** 같은 id 가 있으면 바꾸고, 없으면 뒤에 붙인다. 저장된 꼴(다듬어진 요원)을 돌려준다 */
  upsertCustomAgent(agent: AgentDef): AgentDef;
  removeCustomAgent(id: string): void;
  setEngine(patch: Partial<EngineMirror>): void;
  addHistory(item: SpokenResult): void;
  removeHistory(id: string): void;
  clearHistory(): void;
  setPlayback(playback: PlaybackState | null): void;
  /** 알림을 띄우고 그 id 를 돌려준다 */
  pushToast(message: string, tone?: ToastTone): number;
  dismissToast(id: number): void;
  setStudioDraft(text: string | null): void;
}

// ── 저장된 값 읽기 ───────────────────────────────────────────

function isAgentLike(v: unknown): v is AgentDef {
  if (!v || typeof v !== 'object') return false;
  const a = v as Partial<AgentDef>;
  return (
    typeof a.id === 'string' &&
    a.id.length > 0 &&
    typeof a.callsign === 'string' &&
    !!a.voice &&
    typeof a.voice === 'object' &&
    !!a.voice.blend &&
    typeof a.voice.blend === 'object'
  );
}

function cleanBlend(blend: VoiceBlend): VoiceBlend {
  const out: VoiceBlend = {};
  for (const id of BASE_VOICE_IDS) {
    const w = (blend as Partial<Record<BaseVoiceId, unknown>>)[id];
    if (typeof w === 'number' && Number.isFinite(w) && w > 0) out[id] = w;
  }
  return Object.keys(out).length > 0 ? out : { F1: 1 };
}

function cleanLines(lines: unknown): AgentLine[] {
  if (!Array.isArray(lines)) return [];
  return lines.filter(
    (l): l is AgentLine =>
      !!l &&
      typeof l === 'object' &&
      typeof (l as AgentLine).id === 'string' &&
      typeof (l as AgentLine).text === 'string' &&
      typeof (l as AgentLine).category === 'string' &&
      typeof (l as AgentLine).lang === 'string',
  );
}

/** 사용자가 만든 요원을 안전한 꼴로 다듬는다(빠진 값 채우기, 범위 맞추기, custom 표시) */
export function normalizeCustomAgent(a: AgentDef): AgentDef {
  const speed = typeof a.voice.speed === 'number' && Number.isFinite(a.voice.speed) ? a.voice.speed : 1;
  const role: AgentRole = ROLE_ORDER.includes(a.role) ? a.role : 'support';
  return {
    id: isRosterId(a.id) ? `my-${a.id}` : a.id,
    callsign: a.callsign.trim() || '이름 없는 요원',
    callsignEn: typeof a.callsignEn === 'string' ? a.callsignEn : '',
    role,
    tagline: typeof a.tagline === 'string' ? a.tagline : '',
    bio: typeof a.bio === 'string' ? a.bio : '',
    traits: Array.isArray(a.traits) ? a.traits.filter(isString).slice(0, 6) : [],
    color: isHexColor(a.color) ? a.color : FALLBACK_AGENT_COLOR,
    voice: {
      blend: cleanBlend(a.voice.blend),
      speed: Math.min(1.4, Math.max(0.8, speed)),
      fx: clampFx(a.voice.fx),
    },
    lines: cleanLines(a.lines),
    custom: true,
  };
}

function loadCustomAgents(): AgentDef[] {
  const raw = readJson<unknown[]>(STORAGE_KEYS.customAgents, [], (v): v is unknown[] => Array.isArray(v));
  const seen = new Set<string>();
  const out: AgentDef[] = [];
  for (const item of raw) {
    if (!isAgentLike(item)) continue;
    try {
      const a = normalizeCustomAgent(item);
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    } catch {
      // 깨진 항목은 건너뛴다
    }
  }
  return out;
}

function firstAgentId(): string {
  return rosterAgents()[0].id;
}

const initialCustom = loadCustomAgents();
const storedAgentId = readJson<string>(STORAGE_KEYS.selectedAgent, '', isString);
const initialAgentId = findAgent(storedAgentId, initialCustom) ? storedAgentId : firstAgentId();

let toastSeq = 0;

export const useAppStore = create<AppState>()((set, get) => ({
  selectedAgentId: initialAgentId,
  customAgents: initialCustom,
  radio: readJson<boolean>(STORAGE_KEYS.radio, false, isBoolean),
  engine: { status: 'idle', progress: null, errorMessage: null },
  history: [],
  playback: null,
  toasts: [],
  studioDraft: null,

  selectAgent(id) {
    if (id === get().selectedAgentId || !findAgent(id, get().customAgents)) return;
    set({ selectedAgentId: id });
    writeJson(STORAGE_KEYS.selectedAgent, id);
  },

  setRadio(on) {
    set({ radio: on });
    writeJson(STORAGE_KEYS.radio, on);
  },

  upsertCustomAgent(agent) {
    const next = normalizeCustomAgent(agent);
    const list = get().customAgents;
    const i = list.findIndex((a) => a.id === next.id);
    const customAgents = i >= 0 ? list.map((a, k) => (k === i ? next : a)) : [...list, next];
    set({ customAgents });
    writeJson(STORAGE_KEYS.customAgents, customAgents);
    return next;
  },

  removeCustomAgent(id) {
    const customAgents = get().customAgents.filter((a) => a.id !== id);
    if (customAgents.length === get().customAgents.length) return;
    const patch: Partial<AppState> = { customAgents };
    if (get().selectedAgentId === id) {
      patch.selectedAgentId = firstAgentId();
      writeJson(STORAGE_KEYS.selectedAgent, patch.selectedAgentId);
    }
    set(patch);
    writeJson(STORAGE_KEYS.customAgents, customAgents);
  },

  setEngine(patch) {
    set({ engine: { ...get().engine, ...patch } });
  },

  addHistory(item) {
    set({ history: [item, ...get().history.filter((h) => h.id !== item.id)].slice(0, HISTORY_LIMIT) });
  },

  removeHistory(id) {
    set({ history: get().history.filter((h) => h.id !== id) });
  },

  clearHistory() {
    set({ history: [] });
  },

  setPlayback(playback) {
    const prev = get().playback;
    if (prev === playback || (prev && playback && prev.id === playback.id && prev.phase === playback.phase)) return;
    set({ playback });
  },

  pushToast(message, tone = 'info') {
    const id = ++toastSeq;
    // 같은 말이 연달아 뜨면 하나로 합친다
    const rest = get().toasts.filter((t) => t.message !== message);
    set({ toasts: [...rest, { id, message, tone }].slice(-TOAST_LIMIT) });
    return id;
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  setStudioDraft(text) {
    set({ studioDraft: text });
  },
}));

// ── 편의 함수와 훅 ───────────────────────────────────────────

/** 컴포넌트 밖에서 알림을 띄운다 */
export function toast(message: string, tone: ToastTone = 'info'): number {
  return useAppStore.getState().pushToast(message, tone);
}

/** 사용자가 만든 요원에 붙일 새 id */
export function newCustomAgentId(): string {
  const taken = new Set(useAppStore.getState().customAgents.map((a) => a.id));
  for (;;) {
    const id = `my-${Math.random().toString(36).slice(2, 8)}`;
    if (!taken.has(id) && !isRosterId(id)) return id;
  }
}

/** 지금 고른 요원(컴포넌트 밖에서) */
export function getCurrentAgent(): AgentDef {
  const s = useAppStore.getState();
  return findAgent(s.selectedAgentId, s.customAgents) ?? rosterAgents()[0];
}

/** 기본 요원 + 사용자가 만든 요원 */
export function useAgents(): AgentDef[] {
  const custom = useAppStore((s) => s.customAgents);
  return useMemo(() => allAgents(custom), [custom]);
}

/** 지금 고른 요원. 항상 있다(고른 요원이 지워지면 명단의 첫 요원) */
export function useCurrentAgent(): AgentDef {
  const id = useAppStore((s) => s.selectedAgentId);
  const custom = useAppStore((s) => s.customAgents);
  return useMemo(() => findAgent(id, custom) ?? rosterAgents()[0], [id, custom]);
}

/** 요원의 채널 번호(전체 목록에서의 자리, 1부터) */
export function useChannelNumber(agent: AgentDef): number {
  const custom = useAppStore((s) => s.customAgents);
  return useMemo(() => channelNumber(agent, custom), [agent, custom]);
}

/** 재생 버튼 하나가 볼 상태. `id` 가 지금 재생 대상이면 그 단계, 아니면 'idle' */
export function usePlayPhase(id: string | null): PlayPhase {
  return useAppStore((s) => (id !== null && s.playback?.id === id ? s.playback.phase : 'idle'));
}
