import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import { Badge, Body, Button, Card, Empty, Muted, Screen, SectionTitle, Title } from '../../src/components/ui';
import { SkinGrid } from '../../src/components/SkinTile';
import { runCheck } from '../../src/checker';
import { formatCountdown, formatRelative } from '../../src/format';
import { useNow } from '../../src/hooks';
import { matchWishlist } from '../../src/matcher';
import { accountLabel, useApp, type Account } from '../../src/store';
import { colors, spacing } from '../../src/theme';

function statusBadge(a: Account) {
  if (a.status === 'ok') return <Badge text="정상" color={colors.success} />;
  if (a.status === 'reauth_required') return <Badge text="재로그인 필요" color={colors.warning} />;
  if (a.status === 'error') return <Badge text="오류" color={colors.danger} />;
  return <Badge text="확인 전" />;
}

export default function StoreScreen() {
  const accounts = useApp((s) => s.accounts);
  const storeCache = useApp((s) => s.storeCache);
  const wishlist = useApp((s) => s.wishlist);
  const lastRun = useApp((s) => s.lastRun);
  const now = useNow();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await runCheck({ trigger: 'manual', force: true });
    } finally {
      setRefreshing(false);
    }
  };

  const firstStore = accounts.map((a) => storeCache[a.puuid]).find(Boolean);
  const resetIn = firstStore ? formatCountdown(firstStore.dailyEndsAt, now) : null;

  const matchedByAccount = useMemo(() => {
    const out: Record<string, Set<string>> = {};
    for (const a of accounts) {
      const sf = storeCache[a.puuid];
      if (!sf) continue;
      const m = matchWishlist([...sf.daily, ...sf.nightMarket], wishlist, a.puuid);
      out[a.puuid] = new Set(m.map((x) => x.offer.offerId));
    }
    return out;
  }, [accounts, storeCache, wishlist]);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Title sub={resetIn ? `상점 갱신까지 ${resetIn} · 마지막 확인 ${formatRelative(lastRun?.at, now)}` : '아래로 당겨 새로고침'}>
        오늘의 상점
      </Title>

      {lastRun && lastRun.errors.length > 0 ? (
        <Card style={{ borderColor: colors.danger }}>
          <Body style={{ color: colors.danger, fontWeight: '700' } as never}>확인 중 오류</Body>
          {lastRun.errors.map((e, i) => (
            <Muted key={i}>{e}</Muted>
          ))}
        </Card>
      ) : null}

      {accounts.length === 0 ? (
        <Empty
          title="연동된 계정이 없어요"
          body="계정 탭에서 라이엇 계정을 연동하면 매일 상점을 확인해 드려요."
          action={
            <Link href="/accounts" asChild>
              <Button title="계정 연동하기" onPress={() => undefined} />
            </Link>
          }
        />
      ) : null}

      {accounts.map((a) => {
        const sf = storeCache[a.puuid];
        const matched = matchedByAccount[a.puuid] ?? new Set<string>();
        return (
          <View key={a.puuid} style={{ marginBottom: spacing.lg }}>
            <SectionTitle right={statusBadge(a)}>{accountLabel(a)}</SectionTitle>
            {a.status !== 'ok' && a.lastError ? <Muted style={{ marginBottom: spacing.sm } as never}>{a.lastError}</Muted> : null}
            {sf ? (
              <>
                <SkinGrid offers={sf.daily} matchedIds={matched} />
                {sf.nightMarket.length > 0 ? (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.sm }}>
                      <Text style={{ color: colors.text, fontWeight: '700' }}>🌙 야시장</Text>
                      <Muted>{formatCountdown(sf.nightMarketEndsAt, now)} 남음</Muted>
                    </View>
                    <SkinGrid offers={sf.nightMarket} matchedIds={matched} />
                  </>
                ) : null}
              </>
            ) : (
              <Card>
                <Muted>아직 상점을 확인하지 않았어요. 아래로 당겨 새로고침하세요.</Muted>
              </Card>
            )}
          </View>
        );
      })}
    </Screen>
  );
}
