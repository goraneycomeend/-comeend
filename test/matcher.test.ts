import { describe, expect, it } from 'vitest';
import { matchWishlist, notifiedKey, type WishlistEntry } from '../src/matcher';
import { searchCatalog } from '../src/riot/catalog';
import type { Catalog, ResolvedOffer } from '../src/riot/types';

const offer = (over: Partial<ResolvedOffer>): ResolvedOffer => ({
  offerId: 'lvl',
  cost: 1775,
  kind: 'daily',
  skinUuid: 'skin',
  name: '스킨',
  weapon: '무기',
  icon: null,
  tierUuid: null,
  tierName: null,
  tierColor: null,
  ...over,
});

const entry = (over: Partial<WishlistEntry>): WishlistEntry => ({
  id: 'w',
  accountPuuid: null,
  kind: 'skin',
  value: '',
  label: '',
  createdAt: 0,
  ...over,
});

describe('matchWishlist', () => {
  const offers = [
    offer({ offerId: 'lvl-a', skinUuid: 'skin-a', name: '리버 밴달', weapon: '밴달' }),
    offer({ offerId: 'lvl-b', skinUuid: 'skin-b', name: 'Prime Phantom', weapon: 'Phantom' }),
    offer({ offerId: 'lvl-c', skinUuid: 'skin-c', name: '오니 팬텀', weapon: '팬텀', kind: 'night_market' }),
  ];

  it('matches by skin uuid or level uuid', () => {
    const m = matchWishlist(offers, [entry({ id: '1', value: 'skin-a' }), entry({ id: '2', value: 'lvl-c' })], 'acct');
    expect(m.map((x) => [x.offer.offerId, x.entry.id])).toEqual([
      ['lvl-a', '1'],
      ['lvl-c', '2'],
    ]);
  });

  it('matches keywords ignoring case and whitespace, across weapon and name', () => {
    const m = matchWishlist(offers, [entry({ kind: 'keyword', value: 'prime phantom' }), entry({ id: 'k2', kind: 'keyword', value: '팬텀' })], 'acct');
    expect(m.map((x) => x.offer.offerId)).toEqual(['lvl-b', 'lvl-c']);
  });

  it('respects account scope', () => {
    const wl = [entry({ id: 'other', value: 'skin-a', accountPuuid: 'someone-else' }), entry({ id: 'mine', value: 'skin-b', accountPuuid: 'acct' })];
    const m = matchWishlist(offers, wl, 'acct');
    expect(m.map((x) => x.entry.id)).toEqual(['mine']);
  });

  it('ignores empty keywords and returns one match per offer', () => {
    const m = matchWishlist(offers, [entry({ kind: 'keyword', value: '  ' }), entry({ id: 'a', value: 'skin-a' }), entry({ id: 'b', kind: 'keyword', value: '리버' })], 'acct');
    expect(m).toHaveLength(1);
    expect(m[0].entry.id).toBe('a');
  });

  it('builds stable notified keys', () => {
    expect(notifiedKey('p', 'daily:2026-09-11', 'lvl')).toBe('p|daily:2026-09-11|lvl');
  });
});

describe('searchCatalog', () => {
  const catalog: Catalog = {
    language: 'ko-KR',
    fetchedAt: 0,
    tiers: [],
    skins: [
      { uuid: '1', name: '리버 밴달', weapon: '밴달', tierUuid: 't', icon: null, levelUuids: ['l1'] },
      { uuid: '2', name: 'Reaver Operator', weapon: 'Operator', tierUuid: 't', icon: null, levelUuids: ['l2'] },
      { uuid: '3', name: '프라임 클래식', weapon: '클래식', tierUuid: 't', icon: null, levelUuids: ['l3'] },
    ],
  };

  it('finds by name or weapon, ignoring spacing and case', () => {
    expect(searchCatalog(catalog, '리버').map((s) => s.uuid)).toEqual(['1']);
    expect(searchCatalog(catalog, 'reaveroperator').map((s) => s.uuid)).toEqual(['2']);
    expect(searchCatalog(catalog, '클래식').map((s) => s.uuid)).toEqual(['3']);
    expect(searchCatalog(catalog, '')).toEqual([]);
  });
});
