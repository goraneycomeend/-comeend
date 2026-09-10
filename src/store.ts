import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Catalog, ResolvedStorefront } from './riot/types';
import type { WishlistEntry } from './matcher';

export const MAX_ACCOUNTS = 4;

export type AccountStatus = 'ok' | 'reauth_required' | 'error' | 'new';

export interface Account {
  puuid: string;
  gameName: string;
  tagLine: string;
  region: string;
  shard: string;
  status: AccountStatus;
  lastError: string | null;
  lastCheckedAt: number | null;
  createdAt: number;
}

export interface Settings {
  /** 위시리스트 매칭이 없어도 매일 상점 전체를 알림으로 보낼지 */
  dailySummary: boolean;
  /** 매일 상점 갱신 시각에 앱 열기 리마인더 로컬 알림 */
  dailyReminder: boolean;
  discordWebhookUrl: string;
  catalogLanguage: string;
}

export interface HistoryItem {
  id: string;
  at: number;
  puuid: string;
  accountName: string;
  title: string;
  body: string;
  kind: 'match' | 'summary' | 'reauth' | 'error' | 'test';
  icon?: string | null;
}

export interface LastRun {
  at: number;
  trigger: 'manual' | 'foreground' | 'background';
  ok: number;
  failed: number;
  errors: string[];
}

interface AppState {
  accounts: Account[];
  wishlist: WishlistEntry[];
  settings: Settings;
  storeCache: Record<string, ResolvedStorefront>;
  history: HistoryItem[];
  notifiedKeys: string[];
  checkedRotations: string[];
  lastRun: LastRun | null;
  catalog: Catalog | null;

  upsertAccount: (account: Account) => void;
  patchAccount: (puuid: string, patch: Partial<Account>) => void;
  removeAccount: (puuid: string) => void;
  addWish: (entry: Omit<WishlistEntry, 'id' | 'createdAt'>) => void;
  removeWish: (id: string) => void;
  setSettings: (patch: Partial<Settings>) => void;
  setStoreCache: (puuid: string, sf: ResolvedStorefront) => void;
  addHistory: (item: Omit<HistoryItem, 'id' | 'at'>) => void;
  clearHistory: () => void;
  markNotified: (keys: string[]) => void;
  markChecked: (key: string) => void;
  setLastRun: (run: LastRun) => void;
  setCatalog: (catalog: Catalog | null) => void;
}

export const DEFAULT_SETTINGS: Settings = {
  dailySummary: false,
  dailyReminder: false,
  discordWebhookUrl: '',
  catalogLanguage: 'ko-KR',
};

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function capped<T>(arr: T[], max: number): T[] {
  return arr.length > max ? arr.slice(arr.length - max) : arr;
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      accounts: [],
      wishlist: [],
      settings: DEFAULT_SETTINGS,
      storeCache: {},
      history: [],
      notifiedKeys: [],
      checkedRotations: [],
      lastRun: null,
      catalog: null,

      upsertAccount: (account) =>
        set((s) => {
          const idx = s.accounts.findIndex((a) => a.puuid === account.puuid);
          if (idx >= 0) {
            const next = s.accounts.slice();
            next[idx] = { ...next[idx], ...account };
            return { accounts: next };
          }
          return { accounts: [...s.accounts, account] };
        }),
      patchAccount: (puuid, patch) =>
        set((s) => ({ accounts: s.accounts.map((a) => (a.puuid === puuid ? { ...a, ...patch } : a)) })),
      removeAccount: (puuid) =>
        set((s) => {
          const storeCache = { ...s.storeCache };
          delete storeCache[puuid];
          return {
            accounts: s.accounts.filter((a) => a.puuid !== puuid),
            wishlist: s.wishlist.filter((w) => w.accountPuuid !== puuid),
            storeCache,
          };
        }),
      addWish: (entry) =>
        set((s) => {
          const dup = s.wishlist.some(
            (w) => w.kind === entry.kind && w.value === entry.value && w.accountPuuid === entry.accountPuuid,
          );
          if (dup) return {};
          return { wishlist: [...s.wishlist, { ...entry, id: uid(), createdAt: Date.now() }] };
        }),
      removeWish: (id) => set((s) => ({ wishlist: s.wishlist.filter((w) => w.id !== id) })),
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setStoreCache: (puuid, sf) => set((s) => ({ storeCache: { ...s.storeCache, [puuid]: sf } })),
      addHistory: (item) =>
        set((s) => ({ history: capped([...s.history, { ...item, id: uid(), at: Date.now() }], 200) })),
      clearHistory: () => set({ history: [] }),
      markNotified: (keys) =>
        set((s) => ({ notifiedKeys: capped([...s.notifiedKeys, ...keys.filter((k) => !s.notifiedKeys.includes(k))], 600) })),
      markChecked: (key) =>
        set((s) => (s.checkedRotations.includes(key) ? {} : { checkedRotations: capped([...s.checkedRotations, key], 100) })),
      setLastRun: (run) => set({ lastRun: run }),
      setCatalog: (catalog) => set({ catalog }),
    }),
    {
      name: 'valorant-skin-alert',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/** 백그라운드 태스크처럼 React 밖에서 쓸 때 하이드레이션을 보장한다. */
export async function ensureHydrated(): Promise<void> {
  if (useApp.persist.hasHydrated()) return;
  await useApp.persist.rehydrate();
}

export function accountLabel(a: Pick<Account, 'gameName' | 'tagLine'>): string {
  return a.tagLine ? `${a.gameName}#${a.tagLine}` : a.gameName;
}
