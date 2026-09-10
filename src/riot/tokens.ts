import type { RiotTokens, Region, Shard } from './types';

export const RIOT_AUTHORIZE_URL =
  'https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid';

export const RIOT_REDIRECT_PREFIX = 'https://playvalorant.com/opt_in';

/**
 * Riot 로그인 리다이렉트 URL(`https://playvalorant.com/opt_in#access_token=...`)에서 토큰을 추출한다.
 * 토큰이 없으면 null.
 */
export function parseTokensFromUri(uri: string, now: number = Date.now()): RiotTokens | null {
  const hashIndex = uri.indexOf('#');
  if (hashIndex < 0) return null;
  const params = new URLSearchParams(uri.slice(hashIndex + 1));
  const accessToken = params.get('access_token');
  const idToken = params.get('id_token');
  if (!accessToken || !idToken) return null;
  const expiresIn = Number(params.get('expires_in') ?? 3600);
  return {
    accessToken,
    idToken,
    expiresAt: now + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
  };
}

export function isRiotRedirect(url: string): boolean {
  return url.startsWith(RIOT_REDIRECT_PREFIX) && url.includes('access_token=');
}

/** 토큰 만료까지 `marginMs` 미만이면 만료로 간주 */
export function isExpired(tokens: { expiresAt: number }, now = Date.now(), marginMs = 5 * 60 * 1000): boolean {
  return tokens.expiresAt - now < marginMs;
}

const SHARD_BY_REGION: Record<Region, Shard> = {
  na: 'na',
  latam: 'na',
  br: 'na',
  eu: 'eu',
  ap: 'ap',
  kr: 'kr',
};

export function shardForRegion(region: string): Shard {
  const r = region.toLowerCase() as Region;
  return SHARD_BY_REGION[r] ?? 'ap';
}

/** "Set-Cookie" 헤더(여러 개가 콤마로 합쳐진 경우 포함)에서 특정 쿠키 값을 찾는다. */
export function extractCookie(setCookieHeader: string | null | undefined, name: string): string | null {
  if (!setCookieHeader) return null;
  const re = new RegExp(`(?:^|[\\s,;])${name}=([^;,\\s]+)`);
  const m = re.exec(setCookieHeader);
  return m ? m[1] : null;
}

/** JWT payload 를 검증 없이 디코드한다 (만료 시각 확인용). */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}
