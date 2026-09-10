import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, Switch, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import { Badge, Body, Button, Card, Muted, Screen, SectionTitle, Title, styles as ui } from '../../src/components/ui';
import { getBackgroundStatus, registerBackgroundCheck, triggerBackgroundForTesting, type BackgroundStatus } from '../../src/background';
import { refreshCatalog } from '../../src/checker';
import { hasNotificationPermission, reminderLocalTime, requestNotificationPermission, sendTestNotification, setDailyReminder } from '../../src/notify';
import { useApp } from '../../src/store';
import { colors, spacing } from '../../src/theme';

function Row({ label, sub, right }: { label: string; sub?: string; right: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm, gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Body>{label}</Body>
        {sub ? <Muted>{sub}</Muted> : null}
      </View>
      {right}
    </View>
  );
}

export default function SettingsScreen() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const catalog = useApp((s) => s.catalog);
  const [perm, setPerm] = useState<boolean | null>(null);
  const [bg, setBg] = useState<BackgroundStatus | null>(null);
  const [webhook, setWebhook] = useState(settings.discordWebhookUrl);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    hasNotificationPermission().then(setPerm).catch(() => setPerm(false));
    getBackgroundStatus().then(setBg).catch(() => setBg({ available: false, registered: false }));
  }, []);
  useFocusEffect(reload);
  useEffect(() => setWebhook(settings.discordWebhookUrl), [settings.discordWebhookUrl]);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) Alert.alert(done);
    } catch (e) {
      Alert.alert('실패', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      reload();
    }
  };

  const reminder = reminderLocalTime();
  const isDev = __DEV__;

  return (
    <Screen>
      <Title sub="알림과 백그라운드 확인 설정">설정</Title>

      <SectionTitle>알림</SectionTitle>
      <Card>
        <Row
          label="알림 권한"
          sub={perm ? '허용됨' : '알림을 받으려면 권한이 필요해요'}
          right={
            perm ? (
              <Badge text="허용" color={colors.success} />
            ) : (
              <Button title="허용하기" small onPress={() => run('perm', async () => {
                const ok = await requestNotificationPermission();
                if (!ok) Linking.openSettings();
              })} />
            )
          }
        />
        <Row
          label="테스트 알림 보내기"
          sub="Discord 웹훅이 설정돼 있으면 그쪽으로도 보내요"
          right={<Button title="보내기" small variant="secondary" loading={busy === 'test'} onPress={() => run('test', sendTestNotification)} />}
        />
        <Row
          label="매일 상점 요약 알림"
          sub="위시리스트와 안 맞아도 매일 상점 4개를 알림으로 보내요"
          right={<Switch value={settings.dailySummary} onValueChange={(v) => setSettings({ dailySummary: v })} trackColor={{ true: colors.accent }} />}
        />
        <Row
          label="상점 갱신 리마인더"
          sub={`매일 ${reminder.hour}:${String(reminder.minute).padStart(2, '0')}에 앱 열기 알림 (백그라운드 확인이 안 될 때 대비)`}
          right={
            <Switch
              value={settings.dailyReminder}
              onValueChange={(v) => {
                setSettings({ dailyReminder: v });
                setDailyReminder(v).catch((e) => Alert.alert('실패', String(e)));
              }}
              trackColor={{ true: colors.accent }}
            />
          }
        />
      </Card>

      <SectionTitle>백그라운드 확인</SectionTitle>
      <Card>
        <Row
          label="자동 상점 확인"
          sub={
            bg === null
              ? '확인 중…'
              : !bg.available
                ? '이 기기에서는 백그라운드 실행이 제한돼 있어요 (설정 > 배터리/백그라운드 새로고침 확인)'
                : bg.registered
                  ? '등록됨 · OS 가 허용하는 시점에 상점 갱신(UTC 00:00) 후 자동 확인'
                  : '등록되지 않음'
          }
          right={
            bg?.registered ? (
              <Badge text="켜짐" color={colors.success} />
            ) : (
              <Button title="등록" small loading={busy === 'bg'} onPress={() => run('bg', registerBackgroundCheck)} />
            )
          }
        />
        {isDev ? (
          <Row
            label="백그라운드 태스크 즉시 실행 (개발용)"
            right={<Button title="실행" small variant="secondary" loading={busy === 'bgtest'} onPress={() => run('bgtest', triggerBackgroundForTesting, '실행 요청됨')} />}
          />
        ) : null}
        {Platform.OS === 'ios' ? (
          <Muted style={{ marginTop: spacing.sm } as never}>
            iOS 는 백그라운드 실행 시점을 시스템이 정하기 때문에 정확한 시각을 보장하지 않아요. 상점 갱신 리마인더를 함께 켜 두는 걸 추천해요.
          </Muted>
        ) : (
          <Muted style={{ marginTop: spacing.sm } as never}>
            Android 배터리 최적화 대상에서 이 앱을 제외하면 더 안정적으로 동작해요.
          </Muted>
        )}
      </Card>

      <SectionTitle>Discord 웹훅 (선택)</SectionTitle>
      <Card>
        <Muted style={{ marginBottom: spacing.sm } as never}>설정하면 휴대폰 알림과 함께 Discord 채널에도 같은 내용을 보내요.</Muted>
        <TextInput
          style={ui.input}
          placeholder="https://discord.com/api/webhooks/…"
          placeholderTextColor={colors.muted}
          value={webhook}
          onChangeText={setWebhook}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Button
          title="저장"
          small
          variant="secondary"
          style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}
          onPress={() => {
            const v = webhook.trim();
            if (v && !v.startsWith('https://discord.com/api/webhooks/') && !v.startsWith('https://discordapp.com/api/webhooks/')) {
              Alert.alert('웹훅 URL 형식이 올바르지 않아요');
              return;
            }
            setSettings({ discordWebhookUrl: v });
            Alert.alert('저장됨');
          }}
        />
      </Card>

      <SectionTitle>데이터</SectionTitle>
      <Card>
        <Row
          label="스킨 목록 새로고침"
          sub={catalog ? `${catalog.skins.length}개 스킨 · ${new Date(catalog.fetchedAt).toLocaleDateString()} 기준` : '아직 불러오지 않음'}
          right={<Button title="새로고침" small variant="secondary" loading={busy === 'catalog'} onPress={() => run('catalog', refreshCatalog, '스킨 목록을 갱신했어요')} />}
        />
      </Card>

      <SectionTitle>정보</SectionTitle>
      <Card>
        <Muted>
          발로 스킨 알리미 v{Constants.expoConfig?.version ?? '1.0.0'}{'\n'}
          이 앱은 Riot Games 와 무관한 비공식 앱이며, 비공식 API 를 사용해요. 스킨 데이터는 valorant-api.com 을 이용해요.
          상점 갱신은 매일 UTC 00:00 (한국 시간 09:00) 이에요.
        </Muted>
      </Card>
    </Screen>
  );
}
