/**
 * 모든 연동 계정의 상점을 확인하고 위시리스트와 대조해 알림을 보낸다.
 * 포그라운드(앱 열림/수동)와 백그라운드 태스크 양쪽에서 호출된다.
 */
import { buildSession, fetchRegion, fetchUserInfo, reauthWithSsid, ReauthRequiredError } from './riot/auth';
import { expectedDailyRotationKey, fetchRawStorefront, parseStorefront, resolveStorefront } from './riot/store';
import { catalogHasOffer, fetchCatalog } from './riot/catalog';
import { clearRiotCookies, readRiotSsid } from './riot/cookies';
import { isExpired, shardForRegion } from './riot/tokens';
import type { Catalog, RiotSession, RiotTokens } from './riot/types';
import { deleteSsid, loadSsid, saveSsid } from './storage/secure';
import { matchWishlist, notifiedKey } from './matcher';
import { notifyMatches, notifyReauth, notifySummary } from './notify';
import { ensureHydrated, useApp, type Account, type LastRun, MAX_ACCOUNTS } from './store';

/** 1시간짜리 세션은 메모리에만 둔다 (SecureStore 용량 제한 회피) */
const sessionCache = new Map<string, RiotSession>();

let running: Promise<LastRun> | null = null;

export class AccountLimitError extends Error {
  constructor() {
    super(`계정은 최대 ${MAX_ACCOUNTS}개까지 연동할 수 있어요.`);
    this.name = 'AccountLimitError';
  }
}

/**
 * WebView 로그인 직후 호출. 토큰으로 계정 정보를 조회하고 ssid 를 안전하게 저장한다.
 * 이미 연동된 계정이면 세션만 갱신한다.
 */
export async function linkAccountFromTokens(tokens: RiotTokens): Promise<Account> {
  const ssid = await readRiotSsid();
  // 다음 계정 로그인 및 계정별 Cookie 헤더 전송을 위해 네이티브 쿠키는 비운다.
  await clearRiotCookies();
  if (!ssid) throw new Error('로그인 쿠키(ssid)를 읽지 못했어요. 다시 시도해 주세요.');

  const info = await fetchUserInfo(tokens.accessToken);
  const state = useApp.getState();
  const existing = state.accounts.find((a) => a.puuid === info.puuid);
  if (!existing && state.accounts.length >= MAX_ACCOUNTS) throw new AccountLimitError();

  const region = existing?.region ?? (await fetchRegion(tokens));
  const session = await buildSession(tokens, info.puuid, region);
  sessionCache.set(info.puuid, session);
  await saveSsid(info.puuid, ssid);

  const account: Account = {
    puuid: info.puuid,
    gameName: info.gameName,
    tagLine: info.tagLine,
    region,
    shard: shardForRegion(region),
    status: 'ok',
    lastError: null,
    lastCheckedAt: existing?.lastCheckedAt ?? null,
    createdAt: existing?.createdAt ?? Date.now(),
  };
  state.upsertAccount(account);
  return account;
}

export async function unlinkAccount(puuid: string): Promise<void> {
  sessionCache.delete(puuid);
  await deleteSsid(puuid).catch(() => undefined);
  useApp.getState().removeAccount(puuid);
}

async function getSession(account: Account): Promise<RiotSession> {
  const cached = sessionCache.get(account.puuid);
  if (cached && !isExpired(cached)) return cached;

  const ssid = await loadSsid(account.puuid);
  if (!ssid) throw new ReauthRequiredError('저장된 로그인 정보가 없어요.');

  await clearRiotCookies();
  const { tokens, newSsid } = await reauthWithSsid(ssid);
  // Android 에서는 응답 쿠키가 네이티브 저장소에 남으므로 여기서도 읽어 갱신 후 비운다.
  const stored = newSsid ?? (await readRiotSsid());
  await clearRiotCookies();
  if (stored && stored !== ssid) await saveSsid(account.puuid, stored);

  const session = await buildSession(tokens, account.puuid, account.region);
  sessionCache.set(account.puuid, session);
  return session;
}

async function ensureCatalog(offerIds: string[]): Promise<Catalog> {
  const state = useApp.getState();
  const lang = state.settings.catalogLanguage;
  let catalog = state.catalog;
  const stale = !catalog || catalog.language !== lang || Date.now() - catalog.fetchedAt > 24 * 60 * 60 * 1000;
  const missing = catalog ? offerIds.some((id) => !catalogHasOffer(catalog!, id)) : true;
  if (stale || missing) {
    try {
      catalog = await fetchCatalog(lang);
      state.setCatalog(catalog);
    } catch (e) {
      if (!catalog) throw e;
    }
  }
  return catalog!;
}

export async function refreshCatalog(): Promise<Catalog> {
  const state = useApp.getState();
  const catalog = await fetchCatalog(state.settings.catalogLanguage);
  state.setCatalog(catalog);
  return catalog;
}

async function checkOne(account: Account, trigger: LastRun['trigger']): Promise<void> {
  const state = useApp.getState();
  const session = await getSession(account);
  const raw = await fetchRawStorefront(session);
  const sf = parseStorefront(raw);
  const allIds = [...sf.daily, ...(sf.nightMarket ?? [])].map((o) => o.offerId);
  const catalog = await ensureCatalog(allIds);
  const resolved = resolveStorefront(account.puuid, sf, catalog);
  state.setStoreCache(account.puuid, resolved);

  const allOffers = [...resolved.daily, ...resolved.nightMarket];
  const matches = matchWishlist(allOffers, state.wishlist, account.puuid);
  const keyFor = (offerId: string, kind: string) =>
    notifiedKey(account.puuid, kind === 'night_market' ? resolved.nightMarketRotationKey ?? 'nm' : resolved.dailyRotationKey, offerId);
  const fresh = matches.filter((m) => !state.notifiedKeys.includes(keyFor(m.offer.offerId, m.offer.kind)));
  if (fresh.length > 0) {
    await notifyMatches(account, fresh);
    state.markNotified(fresh.map((m) => keyFor(m.offer.offerId, m.offer.kind)));
  }

  const dailyCheckKey = `${account.puuid}|${resolved.dailyRotationKey}`;
  const isNewRotation = !state.checkedRotations.includes(dailyCheckKey);
  if (isNewRotation && state.settings.dailySummary && fresh.length === 0 && trigger !== 'manual') {
    await notifySummary(account, resolved.daily);
  }
  state.markChecked(dailyCheckKey);
  state.patchAccount(account.puuid, { status: 'ok', lastError: null, lastCheckedAt: Date.now() });
}

export interface RunOptions {
  trigger: LastRun['trigger'];
  /** true 면 이번 로테이션을 이미 확인했어도 다시 조회 */
  force?: boolean;
}

/** 모든 계정 확인. 동시 실행은 합쳐진다. */
export function runCheck(options: RunOptions): Promise<LastRun> {
  if (running) return running;
  running = doRun(options).finally(() => {
    running = null;
  });
  return running;
}

async function doRun({ trigger, force = false }: RunOptions): Promise<LastRun> {
  await ensureHydrated();
  const state = useApp.getState();
  const expected = expectedDailyRotationKey();
  const run: LastRun = { at: Date.now(), trigger, ok: 0, failed: 0, errors: [] };

  for (const account of state.accounts) {
    const alreadyChecked = state.checkedRotations.includes(`${account.puuid}|${expected}`);
    if (!force && alreadyChecked && trigger === 'background') {
      run.ok += 1;
      continue;
    }
    try {
      await checkOne(account, trigger);
      run.ok += 1;
    } catch (e) {
      run.failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      run.errors.push(`${account.gameName}: ${msg}`);
      if (e instanceof ReauthRequiredError) {
        sessionCache.delete(account.puuid);
        const today = new Date().toISOString().slice(0, 10);
        const key = notifiedKey(account.puuid, `reauth:${today}`, '-');
        state.patchAccount(account.puuid, { status: 'reauth_required', lastError: msg });
        if (!state.notifiedKeys.includes(key)) {
          await notifyReauth(account).catch(() => undefined);
          state.markNotified([key]);
        }
      } else {
        state.patchAccount(account.puuid, { status: 'error', lastError: msg });
      }
    }
  }
  state.setLastRun(run);
  return run;
}
