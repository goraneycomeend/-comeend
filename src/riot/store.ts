import type { RiotSession, StoreOffer, Storefront, Catalog, ResolvedOffer, ResolvedStorefront, Wallet } from './types';
import { CLIENT_PLATFORM_B64, getClientVersion, ReauthRequiredError, RiotApiError } from './auth';

/** VP 화폐 UUID */
export const VP_CURRENCY_ID = '85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741';
/** Radianite Points */
export const RP_CURRENCY_ID = 'e59aa87c-4cbf-517a-5983-6e81511be9b7';
/** Kingdom Credits */
export const KC_CURRENCY_ID = '85ca954a-41f2-ce94-9b45-8ca3dd39a00d';

export interface RawStorefront {
  SkinsPanelLayout?: {
    SingleItemOffers?: string[];
    SingleItemStoreOffers?: RawOffer[];
    SingleItemOffersRemainingDurationInSeconds?: number;
  };
  BonusStore?: {
    BonusStoreOffers?: Array<{
      BonusOfferID: string;
      Offer: RawOffer;
      DiscountPercent: number;
      DiscountCosts?: Record<string, number>;
    }>;
    BonusStoreRemainingDurationInSeconds?: number;
  };
}

interface RawOffer {
  OfferID: string;
  Cost?: Record<string, number>;
  Rewards?: Array<{ ItemTypeID: string; ItemID: string }>;
}

export async function fetchRawStorefront(session: RiotSession): Promise<RawStorefront> {
  const version = await getClientVersion();
  const headers = {
    Authorization: `Bearer ${session.accessToken}`,
    'X-Riot-Entitlements-JWT': session.entitlementsToken,
    'X-Riot-ClientPlatform': CLIENT_PLATFORM_B64,
    'X-Riot-ClientVersion': version.riotClientVersion,
    'Content-Type': 'application/json',
  };
  const base = `https://pd.${session.shard}.a.pvp.net/store`;
  let res = await fetch(`${base}/v3/storefront/${session.puuid}`, { method: 'POST', headers, body: '{}' });
  if (res.status === 404 || res.status === 405) {
    res = await fetch(`${base}/v2/storefront/${session.puuid}`, { headers });
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new ReauthRequiredError(`상점 조회 권한 오류 (${res.status})`);
  }
  if (!res.ok) throw new RiotApiError(`상점 조회 실패 (${res.status})`, res.status);
  return (await res.json()) as RawStorefront;
}

export async function fetchWallet(session: RiotSession): Promise<Wallet> {
  const version = await getClientVersion();
  const res = await fetch(`https://pd.${session.shard}.a.pvp.net/store/v1/wallet/${session.puuid}`, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'X-Riot-Entitlements-JWT': session.entitlementsToken,
      'X-Riot-ClientPlatform': CLIENT_PLATFORM_B64,
      'X-Riot-ClientVersion': version.riotClientVersion,
    },
  });
  if (!res.ok) throw new RiotApiError(`지갑 조회 실패 (${res.status})`, res.status);
  const json = (await res.json()) as { Balances?: Record<string, number> };
  return parseWallet(json);
}

export function parseWallet(json: { Balances?: Record<string, number> }): Wallet {
  const b = json.Balances ?? {};
  return { vp: b[VP_CURRENCY_ID] ?? 0, rp: b[RP_CURRENCY_ID] ?? 0, kc: b[KC_CURRENCY_ID] ?? 0 };
}

function toIsoDateUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 남은 시간을 더한 종료 시각을 정시로 반올림해 날짜 키를 만든다 (몇 초 오차로 날짜가 바뀌는 것 방지). */
export function rotationKey(prefix: string, now: number, remainingSeconds: number): string {
  const end = now + remainingSeconds * 1000;
  const rounded = Math.round(end / 3_600_000) * 3_600_000;
  return `${prefix}:${toIsoDateUtc(rounded)}`;
}

/** 지금 시각 기준으로 일일 상점이 끝나는(다음 UTC 자정) 로테이션 키 */
export function expectedDailyRotationKey(now: number = Date.now()): string {
  const d = new Date(now);
  const nextMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return `daily:${toIsoDateUtc(nextMidnight)}`;
}

export function parseStorefront(raw: RawStorefront, now: number = Date.now()): Storefront {
  const panel = raw.SkinsPanelLayout ?? {};
  const dailyRemaining = panel.SingleItemOffersRemainingDurationInSeconds ?? 0;
  const costOf = (o: RawOffer) => o.Cost?.[VP_CURRENCY_ID] ?? Object.values(o.Cost ?? {})[0] ?? 0;

  let daily: StoreOffer[] = (panel.SingleItemStoreOffers ?? []).map((o) => ({ offerId: o.OfferID, cost: costOf(o) }));
  if (daily.length === 0 && panel.SingleItemOffers) {
    daily = panel.SingleItemOffers.map((id) => ({ offerId: id, cost: 0 }));
  }

  let nightMarket: StoreOffer[] | null = null;
  let nmRemaining: number | null = null;
  const bonus = raw.BonusStore;
  if (bonus?.BonusStoreOffers && bonus.BonusStoreOffers.length > 0) {
    nmRemaining = bonus.BonusStoreRemainingDurationInSeconds ?? 0;
    nightMarket = bonus.BonusStoreOffers.map((b) => ({
      offerId: b.Offer.OfferID,
      cost: costOf(b.Offer),
      discountPercent: b.DiscountPercent,
      discountedCost: b.DiscountCosts?.[VP_CURRENCY_ID] ?? Object.values(b.DiscountCosts ?? {})[0],
    }));
  }

  return {
    daily,
    dailyRemainingSeconds: dailyRemaining,
    dailyRotationKey: rotationKey('daily', now, dailyRemaining),
    nightMarket,
    nightMarketRemainingSeconds: nmRemaining,
    nightMarketRotationKey: nmRemaining === null ? null : rotationKey('nm', now, nmRemaining),
    fetchedAt: now,
  };
}

export function resolveOffer(offer: StoreOffer, kind: 'daily' | 'night_market', catalog: Catalog): ResolvedOffer {
  const skin = catalog.skins.find((s) => s.levelUuids.includes(offer.offerId) || s.uuid === offer.offerId);
  const tier = skin?.tierUuid ? catalog.tiers.find((t) => t.uuid === skin.tierUuid) : undefined;
  return {
    ...offer,
    kind,
    skinUuid: skin?.uuid ?? null,
    name: skin?.name ?? `알 수 없는 스킨 (${offer.offerId.slice(0, 8)})`,
    weapon: skin?.weapon ?? '',
    icon: skin?.icon ?? null,
    tierUuid: skin?.tierUuid ?? null,
    tierName: tier?.name ?? null,
    tierColor: tier?.color ?? null,
  };
}

export function resolveStorefront(puuid: string, sf: Storefront, catalog: Catalog, wallet: Wallet | null = null): ResolvedStorefront {
  return {
    puuid,
    fetchedAt: sf.fetchedAt,
    wallet,
    dailyRotationKey: sf.dailyRotationKey,
    dailyEndsAt: sf.fetchedAt + sf.dailyRemainingSeconds * 1000,
    daily: sf.daily.map((o) => resolveOffer(o, 'daily', catalog)),
    nightMarketRotationKey: sf.nightMarketRotationKey,
    nightMarketEndsAt: sf.nightMarketRemainingSeconds === null ? null : sf.fetchedAt + sf.nightMarketRemainingSeconds * 1000,
    nightMarket: (sf.nightMarket ?? []).map((o) => resolveOffer(o, 'night_market', catalog)),
  };
}
