import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Badge, Body, Button, Card, Chip, Empty, Muted, Screen, SectionTitle, Title, styles as ui } from '../../src/components/ui';
import { matchWishlist } from '../../src/matcher';
import { refreshCatalog } from '../../src/checker';
import { searchCatalog } from '../../src/riot/catalog';
import { accountLabel, useApp } from '../../src/store';
import { colors, spacing } from '../../src/theme';

export default function WishlistScreen() {
  const catalog = useApp((s) => s.catalog);
  const wishlist = useApp((s) => s.wishlist);
  const accounts = useApp((s) => s.accounts);
  const addWish = useApp((s) => s.addWish);
  const removeWish = useApp((s) => s.removeWish);
  const storeCache = useApp((s) => s.storeCache);

  /** 위시 항목별로 지금 상점에 떠 있는 계정 이름 목록 */
  const inStore = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const a of accounts) {
      const sf = storeCache[a.puuid];
      if (!sf) continue;
      for (const m of matchWishlist([...sf.daily, ...sf.nightMarket], wishlist, a.puuid)) {
        (out[m.entry.id] ??= []).push(accountLabel(a));
      }
    }
    return out;
  }, [accounts, storeCache, wishlist]);

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (catalog) return;
    setLoading(true);
    refreshCatalog()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [catalog]);

  const results = useMemo(() => (catalog ? searchCatalog(catalog, query, 20) : []), [catalog, query]);
  const tierOf = (uuid: string | null) => catalog?.tiers.find((t) => t.uuid === uuid);
  const scopeLabel = (puuid: string | null) => (puuid ? accountLabel(accounts.find((a) => a.puuid === puuid) ?? { gameName: '삭제된 계정', tagLine: '' }) : '모든 계정');

  return (
    <Screen>
      <Title sub="여기 등록한 스킨이 상점에 뜨면 알려드려요">위시리스트</Title>

      <SectionTitle>적용 계정</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Chip text="모든 계정" active={scope === null} onPress={() => setScope(null)} />
        {accounts.map((a) => (
          <Chip key={a.puuid} text={accountLabel(a)} active={scope === a.puuid} onPress={() => setScope(a.puuid)} />
        ))}
      </View>

      <SectionTitle>스킨 검색</SectionTitle>
      <TextInput
        style={ui.input}
        placeholder="예: 리버, 프라임 밴달, Reaver"
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {loading ? (
        <View style={{ padding: spacing.lg, alignItems: 'center' }}>
          <ActivityIndicator color={colors.accent} />
          <Muted style={{ marginTop: spacing.sm } as never}>스킨 목록 불러오는 중…</Muted>
        </View>
      ) : null}
      {error ? (
        <Card style={{ marginTop: spacing.md, borderColor: colors.danger }}>
          <Muted>{error}</Muted>
          <Button title="다시 시도" small variant="secondary" style={{ marginTop: spacing.sm }} onPress={() => useApp.getState().setCatalog(null)} />
        </Card>
      ) : null}

      {query.trim().length > 0 ? (
        <Card style={{ marginTop: spacing.md, padding: spacing.sm }}>
          <Pressable
            onPress={() => {
              addWish({ accountPuuid: scope, kind: 'keyword', value: query.trim(), label: query.trim() });
              setQuery('');
            }}
            style={{ padding: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 10 }}
          >
            <Text style={{ color: colors.accent, fontSize: 18 }}>＋</Text>
            <View style={{ flex: 1 }}>
              <Body>“{query.trim()}” 키워드로 추가</Body>
              <Muted>이름에 이 단어가 들어간 모든 스킨에 알림</Muted>
            </View>
          </Pressable>
          {results.map((s) => {
            const tier = tierOf(s.tierUuid);
            return (
              <Pressable
                key={s.uuid}
                onPress={() => {
                  addWish({ accountPuuid: scope, kind: 'skin', value: s.uuid, label: s.name, weapon: s.weapon, icon: s.icon });
                  setQuery('');
                }}
                style={{ padding: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: colors.border }}
              >
                {s.icon ? <Image source={{ uri: s.icon }} style={{ width: 64, height: 28 }} contentFit="contain" /> : <View style={{ width: 64 }} />}
                <View style={{ flex: 1 }}>
                  <Body>{s.name}</Body>
                  <Muted>
                    {s.weapon}
                    {tier ? ` · ${tier.name}` : ''}
                  </Muted>
                </View>
                {tier ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tier.color }} /> : null}
              </Pressable>
            );
          })}
        </Card>
      ) : null}

      <SectionTitle right={<Muted>{wishlist.length}개</Muted>}>등록된 스킨</SectionTitle>
      {wishlist.length === 0 ? <Empty title="아직 비어 있어요" body="위에서 스킨을 검색해 추가하거나 키워드를 등록하세요." /> : null}
      {wishlist.map((w) => (
        <Card key={w.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md }}>
          {w.icon ? (
            <Image source={{ uri: w.icon }} style={{ width: 72, height: 32 }} contentFit="contain" />
          ) : (
            <View style={{ width: 72, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 18 }}>#</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Body>{w.kind === 'keyword' ? `키워드 “${w.label}”` : w.label}</Body>
            <Muted>
              {w.weapon ? `${w.weapon} · ` : ''}
              {scopeLabel(w.accountPuuid)}
            </Muted>
            {inStore[w.id] ? (
              <View style={{ marginTop: 4, alignSelf: 'flex-start' }}>
                <Badge text={`지금 상점에 있음 · ${inStore[w.id].join(', ')}`} color={colors.success} />
              </View>
            ) : null}
          </View>
          <Button title="삭제" small variant="danger" onPress={() => removeWish(w.id)} />
        </Card>
      ))}
    </Screen>
  );
}
