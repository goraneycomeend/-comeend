import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Body, Button, Card, Empty, Muted, Screen, Title } from '../../src/components/ui';
import { runCheck, unlinkAccount } from '../../src/checker';
import { formatRelative } from '../../src/format';
import { accountLabel, MAX_ACCOUNTS, useApp, type Account } from '../../src/store';
import { colors, spacing } from '../../src/theme';

function StatusBadge({ a }: { a: Account }) {
  if (a.status === 'ok') return <Badge text="정상" color={colors.success} />;
  if (a.status === 'reauth_required') return <Badge text="재로그인 필요" color={colors.warning} />;
  if (a.status === 'error') return <Badge text="오류" color={colors.danger} />;
  return <Badge text="확인 전" />;
}

export default function AccountsScreen() {
  const router = useRouter();
  const accounts = useApp((s) => s.accounts);
  const [busy, setBusy] = useState<string | null>(null);

  const confirmRemove = (a: Account) =>
    Alert.alert('계정 삭제', `${accountLabel(a)} 연동을 해제할까요? 이 계정 전용 위시리스트도 함께 삭제돼요.`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => unlinkAccount(a.puuid) },
    ]);

  const checkNow = async (a: Account) => {
    setBusy(a.puuid);
    try {
      const run = await runCheck({ trigger: 'manual', force: true });
      const err = run.errors.find((e) => e.startsWith(`${a.gameName}:`));
      if (err) Alert.alert('확인 실패', err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Title sub={`최대 ${MAX_ACCOUNTS}개까지 연동할 수 있어요 (${accounts.length}/${MAX_ACCOUNTS})`}>계정</Title>

      {accounts.length === 0 ? (
        <Empty title="연동된 계정이 없어요" body="라이엇 로그인 화면에서 로그인하면 계정이 연동돼요. 비밀번호는 앱에 저장되지 않아요." />
      ) : null}

      {accounts.map((a) => (
        <Card key={a.puuid}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Body style={{ fontWeight: '700', fontSize: 17 } as never}>{accountLabel(a)}</Body>
            <StatusBadge a={a} />
          </View>
          <Muted style={{ marginTop: 4 } as never}>
            지역 {a.region.toUpperCase()} · 마지막 확인 {formatRelative(a.lastCheckedAt)}
          </Muted>
          {a.lastError ? <Muted style={{ color: colors.danger, marginTop: 4 } as never}>{a.lastError}</Muted> : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: spacing.md }}>
            {a.status === 'reauth_required' ? (
              <Button title="다시 로그인" small onPress={() => router.push({ pathname: '/login', params: { puuid: a.puuid } })} />
            ) : (
              <Button title="지금 확인" small variant="secondary" loading={busy === a.puuid} onPress={() => checkNow(a)} />
            )}
            <Button title="삭제" small variant="danger" onPress={() => confirmRemove(a)} />
          </View>
        </Card>
      ))}

      <Button
        title={accounts.length >= MAX_ACCOUNTS ? `최대 ${MAX_ACCOUNTS}개까지 연동 가능` : '＋ 라이엇 계정 연동'}
        disabled={accounts.length >= MAX_ACCOUNTS}
        onPress={() => router.push('/login')}
        style={{ marginTop: spacing.sm }}
      />
      <Muted style={{ marginTop: spacing.md } as never}>
        로그인은 라이엇 공식 페이지(auth.riotgames.com)에서 진행되며, 앱은 로그인 세션 쿠키만 기기의 보안 저장소에 보관해요.
        여러 계정을 연동하려면 계정마다 한 번씩 로그인하면 돼요.
      </Muted>
    </Screen>
  );
}
