import { describe, expect, it } from 'vitest';
import { expectedDailyRotationKey, parseStorefront, resolveStorefront, VP_CURRENCY_ID, type RawStorefront } from '../src/riot/store';
import type { Catalog } from '../src/riot/types';

const NOW = Date.UTC(2026, 8, 10, 13, 30, 0); // 2026-09-10 13:30 UTC
const REMAINING = (24 - 13.5) * 3600 - 7; // 다음 자정까지 (몇 초 오차 포함)

const raw: RawStorefront = {
  SkinsPanelLayout: {
    SingleItemOffers: ['lvl-a', 'lvl-b'],
    SingleItemStoreOffers: [
      { OfferID: 'lvl-a', Cost: { [VP_CURRENCY_ID]: 1775 } },
      { OfferID: 'lvl-b', Cost: { [VP_CURRENCY_ID]: 2175 } },
    ],
    SingleItemOffersRemainingDurationInSeconds: REMAINING,
  },
  BonusStore: {
    BonusStoreOffers: [
      { BonusOfferID: 'b1', Offer: { OfferID: 'lvl-c', Cost: { [VP_CURRENCY_ID]: 2175 } }, DiscountPercent: 30, DiscountCosts: { [VP_CURRENCY_ID]: 1522 } },
    ],
    BonusStoreRemainingDurationInSeconds: 5 * 24 * 3600,
  },
};

const catalog: Catalog = {
  language: 'ko-KR',
  fetchedAt: NOW,
  tiers: [{ uuid: 't-ultra', name: '울트라', devName: 'Ultra', color: '#ffd700', rank: 4 }],
  skins: [
    { uuid: 'skin-a', name: '리버 밴달', weapon: '밴달', tierUuid: 't-ultra', icon: 'https://x/a.png', levelUuids: ['lvl-a', 'lvl-a2'] },
    { uuid: 'skin-c', name: '프라임 팬텀', weapon: '팬텀', tierUuid: null, icon: null, levelUuids: ['lvl-c'] },
  ],
};

describe('parseStorefront', () => {
  it('parses daily offers, night market and rotation keys', () => {
    const sf = parseStorefront(raw, NOW);
    expect(sf.daily).toEqual([
      { offerId: 'lvl-a', cost: 1775 },
      { offerId: 'lvl-b', cost: 2175 },
    ]);
    expect(sf.dailyRotationKey).toBe('daily:2026-09-11');
    expect(sf.dailyRotationKey).toBe(expectedDailyRotationKey(NOW));
    expect(sf.nightMarket).toEqual([{ offerId: 'lvl-c', cost: 2175, discountPercent: 30, discountedCost: 1522 }]);
    expect(sf.nightMarketRotationKey).toBe('nm:2026-09-15');
  });

  it('handles a storefront with no night market', () => {
    const sf = parseStorefront({ SkinsPanelLayout: raw.SkinsPanelLayout }, NOW);
    expect(sf.nightMarket).toBeNull();
    expect(sf.nightMarketRotationKey).toBeNull();
  });

  it('falls back to SingleItemOffers when store offers are absent', () => {
    const sf = parseStorefront({ SkinsPanelLayout: { SingleItemOffers: ['x'], SingleItemOffersRemainingDurationInSeconds: 10 } }, NOW);
    expect(sf.daily).toEqual([{ offerId: 'x', cost: 0 }]);
  });
});

describe('resolveStorefront', () => {
  it('resolves offers against the catalog, tolerating unknown skins', () => {
    const resolved = resolveStorefront('puuid-1', parseStorefront(raw, NOW), catalog);
    expect(resolved.daily[0]).toMatchObject({ name: '리버 밴달', weapon: '밴달', skinUuid: 'skin-a', tierName: '울트라', tierColor: '#ffd700', kind: 'daily' });
    expect(resolved.daily[1].skinUuid).toBeNull();
    expect(resolved.daily[1].name).toContain('알 수 없는 스킨');
    expect(resolved.nightMarket[0]).toMatchObject({ name: '프라임 팬텀', kind: 'night_market', discountedCost: 1522 });
    expect(resolved.dailyEndsAt).toBe(NOW + REMAINING * 1000);
  });
});

describe('parseWallet', () => {
  it('reads VP/RP/KC balances and defaults missing ones to 0', async () => {
    const { parseWallet, RP_CURRENCY_ID } = await import('../src/riot/store');
    expect(parseWallet({ Balances: { [VP_CURRENCY_ID]: 1234, [RP_CURRENCY_ID]: 56 } })).toEqual({ vp: 1234, rp: 56, kc: 0 });
    expect(parseWallet({})).toEqual({ vp: 0, rp: 0, kc: 0 });
  });
});
