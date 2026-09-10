import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, extractCookie, isExpired, isRiotRedirect, parseTokensFromUri, shardForRegion } from '../src/riot/tokens';

describe('parseTokensFromUri', () => {
  it('extracts tokens from the Riot redirect fragment', () => {
    const uri = 'https://playvalorant.com/opt_in#access_token=AAA.BBB.CCC&scope=account%20openid&id_token=III.JJJ.KKK&token_type=Bearer&expires_in=3600';
    const t = parseTokensFromUri(uri, 1_000_000);
    expect(t).toEqual({ accessToken: 'AAA.BBB.CCC', idToken: 'III.JJJ.KKK', expiresAt: 1_000_000 + 3600 * 1000 });
  });

  it('returns null when tokens are missing', () => {
    expect(parseTokensFromUri('https://playvalorant.com/opt_in')).toBeNull();
    expect(parseTokensFromUri('https://playvalorant.com/opt_in#error=access_denied')).toBeNull();
  });

  it('detects redirect urls', () => {
    expect(isRiotRedirect('https://playvalorant.com/opt_in#access_token=x&id_token=y')).toBe(true);
    expect(isRiotRedirect('https://auth.riotgames.com/login')).toBe(false);
    expect(isRiotRedirect('https://playvalorant.com/opt_in')).toBe(false);
  });
});

describe('helpers', () => {
  it('treats tokens near expiry as expired', () => {
    expect(isExpired({ expiresAt: 10_000 }, 0)).toBe(true);
    expect(isExpired({ expiresAt: 60 * 60 * 1000 }, 0)).toBe(false);
  });

  it('maps regions to shards', () => {
    expect(shardForRegion('kr')).toBe('kr');
    expect(shardForRegion('latam')).toBe('na');
    expect(shardForRegion('BR')).toBe('na');
    expect(shardForRegion('eu')).toBe('eu');
    expect(shardForRegion('unknown')).toBe('ap');
  });

  it('extracts a cookie from a combined set-cookie header', () => {
    const header = 'tdid=abc; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT, ssid=eyJhbGci.xyz; Path=/; Secure; HttpOnly, clid=kr1; Path=/';
    expect(extractCookie(header, 'ssid')).toBe('eyJhbGci.xyz');
    expect(extractCookie(header, 'clid')).toBe('kr1');
    expect(extractCookie(header, 'nope')).toBeNull();
    expect(extractCookie(null, 'ssid')).toBeNull();
  });

  it('decodes a jwt payload', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'p-1', exp: 123 })).toString('base64url');
    expect(decodeJwtPayload(`h.${payload}.s`)).toEqual({ sub: 'p-1', exp: 123 });
    expect(decodeJwtPayload('garbage')).toBeNull();
  });
});
