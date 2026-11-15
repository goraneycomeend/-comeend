// 앱 상태를 기기에 남겨 두는 얇은 래퍼. 값은 JSON 으로 저장한다.
// 읽기·쓰기 모두 실패해도 던지지 않는다 — 저장소가 없는 환경에서도 앱은 그대로 돈다.
import { storage } from '../engine/platform.ts';

const PREFIX = 'callsign:';

/** 저장 키. 형식이 바뀌면 끝의 버전을 올린다 */
export const STORAGE_KEYS = {
  selectedAgent: 'agent.v1',
  radio: 'radio.v1',
  customAgents: 'custom-agents.v1',
} as const;

/**
 * 저장된 값을 읽는다. 없거나 깨졌거나 `guard` 를 통과하지 못하면 `fallback`.
 * @param guard 읽은 값이 기대한 모양인지 확인하는 함수
 */
export function readJson<T>(key: string, fallback: T, guard?: (value: unknown) => value is T): T {
  const raw = storage.get(PREFIX + key);
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (guard && !guard(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

/** 값을 저장한다. 기기에 남겼으면 true */
export function writeJson(key: string, value: unknown): boolean {
  try {
    return storage.set(PREFIX + key, JSON.stringify(value));
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  storage.remove(PREFIX + key);
}

export const isString = (v: unknown): v is string => typeof v === 'string';
export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
