import '../src/background';
import React, { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { registerBackgroundCheck } from '../src/background';
import { runCheck } from '../src/checker';
import { ensureChannel } from '../src/notify';
import { useApp } from '../src/store';
import { useHydrated } from '../src/hooks';
import { colors } from '../src/theme';

const FOREGROUND_RECHECK_MS = 10 * 60 * 1000;

export default function RootLayout() {
  const hydrated = useHydrated();
  const accountCount = useApp((s) => s.accounts.length);
  const lastCheckedRef = useRef(0);
  const router = useRouter();

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      router.navigate('/(tabs)');
    });
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    ensureChannel().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (accountCount > 0) registerBackgroundCheck().catch(() => undefined);
  }, [hydrated, accountCount]);

  useEffect(() => {
    if (!hydrated || accountCount === 0) return;
    const maybeCheck = () => {
      if (Date.now() - lastCheckedRef.current < FOREGROUND_RECHECK_MS) return;
      lastCheckedRef.current = Date.now();
      runCheck({ trigger: 'foreground' }).catch(() => undefined);
    };
    maybeCheck();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') maybeCheck();
    });
    return () => sub.remove();
  }, [hydrated, accountCount]);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" options={{ presentation: 'modal', headerShown: false }} />
      </Stack>
    </>
  );
}
