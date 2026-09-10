import CookieManager from '@react-native-cookies/cookies';
import { Platform } from 'react-native';

const AUTH_URL = 'https://auth.riotgames.com';

/**
 * WebView 로그인 후 네이티브 쿠키 저장소에서 `ssid` 를 읽는다.
 * iOS 는 WKWebView(useWebKit=true) 와 NSHTTPCookieStorage 둘 다 확인한다.
 */
export async function readRiotSsid(): Promise<string | null> {
  const attempts: Array<() => Promise<Record<string, { value: string }>>> = [
    () => CookieManager.get(AUTH_URL, true),
    () => CookieManager.get(AUTH_URL, false),
  ];
  for (const attempt of attempts) {
    try {
      const cookies = await attempt();
      const ssid = cookies?.ssid?.value;
      if (ssid) return ssid;
    } catch {
      /* 다음 방법 시도 */
    }
  }
  return null;
}

/**
 * Riot 쿠키를 전부 지운다.
 * - 다른 계정으로 WebView 로그인하기 전에 필요
 * - Android 에서는 fetch(OkHttp) 가 네이티브 쿠키 저장소의 쿠키로 Cookie 헤더를 덮어쓰므로,
 *   계정별 ssid 를 직접 보내기 전에 반드시 비워야 한다.
 */
export async function clearRiotCookies(): Promise<void> {
  try {
    await CookieManager.clearAll(true);
  } catch {
    /* ignore */
  }
  try {
    await CookieManager.clearAll(false);
  } catch {
    /* ignore */
  }
  if (Platform.OS === 'android') {
    try {
      await CookieManager.flush();
    } catch {
      /* ignore */
    }
  }
}
