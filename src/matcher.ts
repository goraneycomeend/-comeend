import type { ResolvedOffer } from './riot/types';
import { normalizeName } from './riot/catalog';

export interface WishlistEntry {
  id: string;
  /** null 이면 모든 계정에 적용 */
  accountPuuid: string | null;
  kind: 'skin' | 'keyword';
  /** kind=skin: 스킨 UUID, kind=keyword: 검색어 */
  value: string;
  /** 화면 표시용 이름 */
  label: string;
  weapon?: string;
  icon?: string | null;
  createdAt: number;
}

export interface Match {
  offer: ResolvedOffer;
  entry: WishlistEntry;
}

/**
 * 상점 오퍼와 위시리스트를 대조한다.
 * - skin: 스킨 UUID 또는 레벨 UUID 일치
 * - keyword: 스킨 이름/무기 이름에 검색어 포함 (공백·대소문자 무시)
 * 한 오퍼가 여러 항목과 맞으면 첫 항목만 반환한다.
 */
export function matchWishlist(offers: ResolvedOffer[], wishlist: WishlistEntry[], accountPuuid: string): Match[] {
  const applicable = wishlist.filter((w) => w.accountPuuid === null || w.accountPuuid === accountPuuid);
  const matches: Match[] = [];
  for (const offer of offers) {
    const hay = normalizeName(`${offer.weapon} ${offer.name}`);
    const entry = applicable.find((w) => {
      if (w.kind === 'skin') return w.value === offer.skinUuid || w.value === offer.offerId;
      const q = normalizeName(w.value);
      return q.length > 0 && hay.includes(q);
    });
    if (entry) matches.push({ offer, entry });
  }
  return matches;
}

export function notifiedKey(puuid: string, rotationKey: string, offerId: string): string {
  return `${puuid}|${rotationKey}|${offerId}`;
}
