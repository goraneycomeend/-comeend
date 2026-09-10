/**
 * Riot 인증 관련 네트워크 호출. React Native 모듈을 import 하지 않아 Node 에서도 실행 가능.
 * (쿠키 저장소 조작은 ./cookies.ts 에서 담당)
 */
import type { RiotSession, RiotTokens, RiotUserInfo } from './types';
import { parseTokensFromUri, shardForRegion, extractCookie } from './tokens';

export const AUTHORIZATION_URL = 'https://auth.riotgames.com/api/v1/authorization';
const ENTITLEMENTS_URL = 'https://entitlements.auth.riotgames.com/api/token/v1';
const USERINFO_URL = 'https://auth.riotgames.com/userinfo';
const REGION_URL = 'https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant';
const VERSION_URL = 'https://valorant-api.com/v1/version';

export const CLIENT_PLATFORM_B64 =
  'eyJwbGF0Zm9ybVR5cGUiOiJQQyIsInBsYXRmb3JtT1MiOiJXaW5kb3dzIiwicGxhdGZvcm1PU1ZlcnNpb24iOiIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwicGxhdGZvcm1DaGlwc2V0IjoiVW5rbm93biJ9';

export class ReauthRequiredError extends Error {
  constructor(message = 'Riot 세션이 만료되었습니다. 다시 로그인해 주세요.') {
    super(message);
    this.name = 'ReauthRequiredError';
  }
}

export class RiotApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'RiotApiError';
  }
}

interface ClientVersion {
  riotClientVersion: string;
  riotClientBuild: string;
  fetchedAt: number;
}

let versionCache: ClientVersion | null = null;

export async function getClientVersion(): Promise<ClientVersion> {
  if (versionCache && Date.now() - versionCache.fetchedAt < 60 * 60 * 1000) return versionCache;
  const res = await fetch(VERSION_URL);
  if (!res.ok) {
    if (versionCache) return versionCache;
    throw new RiotApiError(`valorant-api.com 버전 조회 실패 (${res.status})`, res.status);
  }
  const json = (await res.json()) as { data: { riotClientVersion: string; riotClientBuild: string } };
  versionCache = {
    riotClientVersion: json.data.riotClientVersion,
    riotClientBuild: json.data.riotClientBuild,
    fetchedAt: Date.now(),
  };
  return versionCache;
}

async function userAgent(): Promise<string> {
  let build = '91.0.2.1870.3774';
  try {
    build = (await getClientVersion()).riotClientBuild || build;
  } catch {
    /* 기본값 사용 */
  }
  return `RiotClient/${build} rso-auth (Windows;10;;Professional, x64)`;
}

export interface ReauthResult {
  tokens: RiotTokens;
  /** 응답에 새 ssid 가 있으면 갱신된 값, 없으면 null */
  newSsid: string | null;
}

/**
 * 저장해 둔 `ssid` 쿠키로 새 access/id 토큰을 발급받는다.
 * 세션이 만료되면 ReauthRequiredError.
 */
export async function reauthWithSsid(ssid: string): Promise<ReauthResult> {
  const res = await fetch(AUTHORIZATION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': await userAgent(),
      Cookie: `ssid=${ssid}`,
    },
    body: JSON.stringify({
      client_id: 'play-valorant-web-prod',
      nonce: '1',
      redirect_uri: 'https://playvalorant.com/opt_in',
      response_type: 'token id_token',
      scope: 'account openid',
    }),
  });
  if (res.status === 403) {
    throw new RiotApiError('Riot 인증 서버가 요청을 차단했습니다 (403). 잠시 후 다시 시도하세요.', 403);
  }
  if (!res.ok) throw new RiotApiError(`Riot 인증 실패 (${res.status})`, res.status);
  const json = (await res.json()) as {
    type?: string;
    error?: string;
    response?: { parameters?: { uri?: string } };
  };
  if (json.type === 'response' && json.response?.parameters?.uri) {
    const tokens = parseTokensFromUri(json.response.parameters.uri);
    if (!tokens) throw new RiotApiError('Riot 응답에서 토큰을 찾지 못했습니다.');
    const newSsid = extractCookie(res.headers.get('set-cookie'), 'ssid');
    return { tokens, newSsid };
  }
  if (json.error === 'rate_limited') throw new RiotApiError('Riot 요청 제한(rate limit)에 걸렸습니다. 잠시 후 다시 시도하세요.', 429);
  throw new ReauthRequiredError();
}

export async function fetchEntitlementsToken(accessToken: string): Promise<string> {
  const res = await fetch(ENTITLEMENTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': await userAgent(),
    },
    body: '{}',
  });
  if (res.status === 401 || res.status === 403) throw new ReauthRequiredError();
  if (!res.ok) throw new RiotApiError(`entitlements 조회 실패 (${res.status})`, res.status);
  const json = (await res.json()) as { entitlements_token: string };
  return json.entitlements_token;
}

export async function fetchUserInfo(accessToken: string): Promise<RiotUserInfo> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': await userAgent() },
  });
  if (res.status === 401 || res.status === 403) throw new ReauthRequiredError();
  if (!res.ok) throw new RiotApiError(`userinfo 조회 실패 (${res.status})`, res.status);
  const json = (await res.json()) as { sub: string; acct?: { game_name?: string; tag_line?: string } };
  return {
    puuid: json.sub,
    gameName: json.acct?.game_name ?? '(이름 없음)',
    tagLine: json.acct?.tag_line ?? '',
  };
}

export async function fetchRegion(tokens: RiotTokens): Promise<string> {
  const res = await fetch(REGION_URL, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens.accessToken}`,
      'User-Agent': await userAgent(),
    },
    body: JSON.stringify({ id_token: tokens.idToken }),
  });
  if (!res.ok) throw new RiotApiError(`지역 조회 실패 (${res.status})`, res.status);
  const json = (await res.json()) as { affinities?: { live?: string } };
  const live = json.affinities?.live;
  if (!live) throw new RiotApiError('지역 정보를 받지 못했습니다.');
  return live;
}

/** 토큰 세트로 완전한 세션(entitlements + puuid + shard)을 구성한다. */
export async function buildSession(tokens: RiotTokens, puuid: string, region: string): Promise<RiotSession> {
  const entitlementsToken = await fetchEntitlementsToken(tokens.accessToken);
  return { ...tokens, entitlementsToken, puuid, shard: shardForRegion(region) };
}
