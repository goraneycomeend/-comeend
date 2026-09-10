import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { Button } from '../src/components/ui';
import { linkAccountFromTokens } from '../src/checker';
import { runCheck } from '../src/checker';
import { clearRiotCookies } from '../src/riot/cookies';
import { isRiotRedirect, parseTokensFromUri, RIOT_AUTHORIZE_URL } from '../src/riot/tokens';
import { requestNotificationPermission } from '../src/notify';
import { accountLabel } from '../src/store';
import { colors, spacing } from '../src/theme';

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

export default function LoginScreen() {
  const router = useRouter();
  const { puuid } = useLocalSearchParams<{ puuid?: string }>();
  const [ready, setReady] = useState(false);
  const [linking, setLinking] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const handled = useRef(false);

  useEffect(() => {
    // 이전 계정 세션이 남아 있으면 자동 로그인되므로 항상 비우고 시작한다.
    clearRiotCookies().finally(() => setReady(true));
  }, [reloadKey]);

  const handleUrl = useCallback(
    (url: string): boolean => {
      if (!isRiotRedirect(url) || handled.current) return false;
      handled.current = true;
      const tokens = parseTokensFromUri(url);
      if (!tokens) {
        handled.current = false;
        return false;
      }
      setLinking(true);
      (async () => {
        try {
          const account = await linkAccountFromTokens(tokens);
          if (puuid && account.puuid !== puuid) {
            Alert.alert('다른 계정으로 로그인됨', `${accountLabel(account)} 계정이 연동됐어요. 원래 계정은 다시 로그인이 필요해요.`);
          }
          await requestNotificationPermission().catch(() => undefined);
          router.back();
          runCheck({ trigger: 'manual', force: true }).catch(() => undefined);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          Alert.alert('연동 실패', msg, [
            { text: '다시 시도', onPress: () => { handled.current = false; setLinking(false); setReady(false); setReloadKey((k) => k + 1); } },
            { text: '닫기', style: 'cancel', onPress: () => router.back() },
          ]);
        }
      })();
      return true;
    },
    [puuid, router],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.bar}>
        <Text style={styles.barTitle}>{puuid ? '다시 로그인' : '라이엇 계정 로그인'}</Text>
        <Button title="취소" small variant="ghost" onPress={() => router.back()} />
      </View>
      {ready ? (
        <WebView
          key={reloadKey}
          source={{ uri: RIOT_AUTHORIZE_URL }}
          userAgent={MOBILE_UA}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          incognito={false}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={(req) => !handleUrl(req.url)}
          onNavigationStateChange={(nav: WebViewNavigation) => {
            handleUrl(nav.url);
          }}
          style={styles.web}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.accent} />
            </View>
          )}
        />
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
      {linking ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.overlayText}>계정 정보를 불러오는 중…</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  barTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  web: { flex: 1, backgroundColor: colors.bg },
  loading: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(15,25,35,0.9)', alignItems: 'center', justifyContent: 'center', gap: 12 },
  overlayText: { color: colors.text, fontSize: 15 },
});
