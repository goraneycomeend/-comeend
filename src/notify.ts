import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ResolvedOffer } from './riot/types';
import type { Match } from './matcher';
import { useApp, accountLabel, type Account } from './store';

export const CHANNEL_ID = 'skin-alerts';
const REMINDER_ID = 'daily-store-reminder';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: '스킨 알림',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#ff4655',
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const res = await Notifications.requestPermissionsAsync();
  return res.granted;
}

export async function hasNotificationPermission(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).granted;
}

async function sendLocal(title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data, sound: 'default' },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } as never : null,
  });
}

async function sendDiscord(title: string, description: string, offers: ResolvedOffer[]): Promise<void> {
  const url = useApp.getState().settings.discordWebhookUrl.trim();
  if (!url) return;
  const first = offers[0];
  const embed = {
    title,
    description,
    color: 0xff4655,
    thumbnail: first?.icon ? { url: first.icon } : undefined,
    fields: offers.slice(0, 8).map((o) => ({
      name: `${o.weapon} · ${o.name}`,
      value: o.discountedCost != null ? `~~${o.cost}~~ **${o.discountedCost} VP** (-${o.discountPercent}%)` : `${o.cost} VP`,
      inline: true,
    })),
    footer: { text: '발로 스킨 알리미' },
    timestamp: new Date().toISOString(),
  };
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch {
    /* Discord 실패는 앱 알림에 영향 주지 않음 */
  }
}

export function formatOffer(o: ResolvedOffer): string {
  const price = o.discountedCost != null ? `${o.discountedCost} VP (-${o.discountPercent}%)` : `${o.cost} VP`;
  const tag = o.kind === 'night_market' ? ' [야시장]' : '';
  return `${o.weapon} ${o.name} · ${price}${tag}`;
}

export async function notifyMatches(account: Account, matches: Match[]): Promise<void> {
  const label = accountLabel(account);
  const offers = matches.map((m) => m.offer);
  const title = matches.length === 1
    ? `🎯 ${label} 상점에 ${offers[0].name} 등장!`
    : `🎯 ${label} 상점에 위시 스킨 ${matches.length}개 등장!`;
  const body = offers.map(formatOffer).join('\n');
  await sendLocal(title, body, { puuid: account.puuid });
  await sendDiscord(title, body, offers);
  useApp.getState().addHistory({
    puuid: account.puuid,
    accountName: label,
    title,
    body,
    kind: 'match',
    icon: offers[0]?.icon,
  });
}

export async function notifySummary(account: Account, offers: ResolvedOffer[]): Promise<void> {
  const label = accountLabel(account);
  const title = `🛒 ${label} 오늘의 상점`;
  const body = offers.map(formatOffer).join('\n');
  await sendLocal(title, body, { puuid: account.puuid });
  await sendDiscord(title, body, offers);
  useApp.getState().addHistory({ puuid: account.puuid, accountName: label, title, body, kind: 'summary', icon: offers[0]?.icon });
}

export async function notifyReauth(account: Account): Promise<void> {
  const label = accountLabel(account);
  const title = `🔑 ${label} 다시 로그인 필요`;
  const body = 'Riot 세션이 만료되어 상점을 확인할 수 없어요. 앱에서 다시 로그인해 주세요.';
  await sendLocal(title, body, { puuid: account.puuid });
  await sendDiscord(title, body, []);
  useApp.getState().addHistory({ puuid: account.puuid, accountName: label, title, body, kind: 'reauth' });
}

export async function sendTestNotification(): Promise<void> {
  const title = '🔔 테스트 알림';
  const body = '알림이 정상적으로 도착했어요. 위시리스트 스킨이 뜨면 이렇게 알려드릴게요.';
  await sendLocal(title, body);
  await sendDiscord(title, body, []);
  useApp.getState().addHistory({ puuid: '', accountName: '-', title, body, kind: 'test' });
}

/** 상점 갱신(UTC 00:00 = KST 09:00) 5분 뒤 로컬 시간 */
export function reminderLocalTime(): { hour: number; minute: number } {
  const d = new Date();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5));
  return { hour: next.getHours(), minute: next.getMinutes() };
}

export async function setDailyReminder(enabled: boolean): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => undefined);
  if (!enabled) return;
  await ensureChannel();
  const { hour, minute } = reminderLocalTime();
  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID,
    content: {
      title: '🛒 발로란트 상점이 갱신됐어요',
      body: '앱을 열어 오늘의 상점을 확인해 보세요.',
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: CHANNEL_ID,
    },
  });
}
