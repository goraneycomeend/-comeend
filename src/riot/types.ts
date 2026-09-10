/** 로그인/재인증으로 얻는 짧은 수명(1시간)의 세션 토큰 */
export interface RiotTokens {
  accessToken: string;
  idToken: string;
  /** epoch ms */
  expiresAt: number;
}

export interface RiotSession extends RiotTokens {
  entitlementsToken: string;
  puuid: string;
  shard: Shard;
}

export type Region = 'na' | 'eu' | 'ap' | 'kr' | 'latam' | 'br';
export type Shard = 'na' | 'eu' | 'ap' | 'kr';

export interface RiotUserInfo {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export interface StoreOffer {
  /** 스킨 레벨 UUID (상점 OfferID) */
  offerId: string;
  /** VP 가격 */
  cost: number;
  /** 야시장 할인율 (0~100). 일반 상점은 undefined */
  discountPercent?: number;
  /** 야시장 할인가 */
  discountedCost?: number;
}

export interface Storefront {
  daily: StoreOffer[];
  dailyRemainingSeconds: number;
  /** `daily:YYYY-MM-DD` — 이 로테이션이 끝나는 UTC 날짜 */
  dailyRotationKey: string;
  nightMarket: StoreOffer[] | null;
  nightMarketRemainingSeconds: number | null;
  nightMarketRotationKey: string | null;
  fetchedAt: number;
}

export interface CatalogSkin {
  /** 스킨 UUID (weapons/skins) */
  uuid: string;
  name: string;
  weapon: string;
  tierUuid: string | null;
  icon: string | null;
  /** 스킨의 모든 레벨 UUID. 상점 OfferID 는 보통 levels[0] */
  levelUuids: string[];
}

export interface ContentTier {
  uuid: string;
  name: string;
  devName: string;
  /** #RRGGBB */
  color: string;
  rank: number;
}

export interface Catalog {
  skins: CatalogSkin[];
  tiers: ContentTier[];
  language: string;
  fetchedAt: number;
}

export interface ResolvedOffer extends StoreOffer {
  kind: 'daily' | 'night_market';
  skinUuid: string | null;
  name: string;
  weapon: string;
  icon: string | null;
  tierUuid: string | null;
  tierName: string | null;
  tierColor: string | null;
}

export interface Wallet {
  vp: number;
  rp: number;
  kc: number;
}

export interface ResolvedStorefront {
  puuid: string;
  fetchedAt: number;
  /** VP/RP/KC 잔액. 조회 실패 시 null */
  wallet: Wallet | null;
  dailyRotationKey: string;
  dailyEndsAt: number;
  daily: ResolvedOffer[];
  nightMarketRotationKey: string | null;
  nightMarketEndsAt: number | null;
  nightMarket: ResolvedOffer[];
}
