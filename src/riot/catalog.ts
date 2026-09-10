import type { Catalog, CatalogSkin, ContentTier } from './types';

const API = 'https://valorant-api.com/v1';

interface RawWeapon {
  uuid: string;
  displayName: string;
  skins: Array<{
    uuid: string;
    displayName: string;
    contentTierUuid: string | null;
    displayIcon: string | null;
    levels: Array<{ uuid: string; displayName: string | null; displayIcon: string | null }>;
    chromas: Array<{ uuid: string; fullRender: string | null; displayIcon: string | null }>;
  }>;
}

interface RawTier {
  uuid: string;
  devName: string;
  displayName: string;
  rank: number;
  highlightColor: string;
}

const TIER_RANK: Record<string, number> = { Select: 1, Deluxe: 2, Premium: 3, Ultra: 4, Exclusive: 5 };

export async function fetchCatalog(language = 'ko-KR'): Promise<Catalog> {
  const [wRes, tRes] = await Promise.all([
    fetch(`${API}/weapons?language=${encodeURIComponent(language)}`),
    fetch(`${API}/contenttiers?language=${encodeURIComponent(language)}`),
  ]);
  if (!wRes.ok) throw new Error(`스킨 목록 조회 실패 (${wRes.status})`);
  if (!tRes.ok) throw new Error(`등급 목록 조회 실패 (${tRes.status})`);
  const weapons = ((await wRes.json()) as { data: RawWeapon[] }).data;
  const rawTiers = ((await tRes.json()) as { data: RawTier[] }).data;

  const tiers: ContentTier[] = rawTiers.map((t) => ({
    uuid: t.uuid,
    name: t.displayName,
    devName: t.devName,
    color: `#${t.highlightColor.slice(0, 6)}`,
    rank: t.rank ?? TIER_RANK[t.devName] ?? 0,
  }));

  const skins: CatalogSkin[] = [];
  for (const w of weapons) {
    for (const s of w.skins) {
      // 기본 스킨/랜덤 상자(contentTier 없음)는 상점에 뜨지 않으므로 제외
      if (!s.contentTierUuid) continue;
      const icon =
        s.levels[0]?.displayIcon ?? s.displayIcon ?? s.chromas[0]?.fullRender ?? s.chromas[0]?.displayIcon ?? null;
      skins.push({
        uuid: s.uuid,
        name: s.displayName,
        weapon: w.displayName,
        tierUuid: s.contentTierUuid,
        icon,
        levelUuids: s.levels.map((l) => l.uuid),
      });
    }
  }
  return { skins, tiers, language, fetchedAt: Date.now() };
}

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[\s_\-·.:]/g, '');
}

export function searchCatalog(catalog: Catalog, query: string, limit = 30): CatalogSkin[] {
  const q = normalizeName(query);
  if (!q) return [];
  const out: CatalogSkin[] = [];
  for (const s of catalog.skins) {
    if (normalizeName(s.name).includes(q) || normalizeName(s.weapon).includes(q)) {
      out.push(s);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function catalogHasOffer(catalog: Catalog, offerId: string): boolean {
  return catalog.skins.some((s) => s.levelUuids.includes(offerId) || s.uuid === offerId);
}
