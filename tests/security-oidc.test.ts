import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCookiesMap = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mockCookiesMap.get(name);
      return value !== undefined ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      mockCookiesMap.set(name, value);
    },
    delete: (name: string) => {
      mockCookiesMap.delete(name);
    },
  }),
}));

import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  isAnyAuthConfigured,
  isOidcConfigured,
  parseSessionToken,
} from '@/lib/auth';
import { OIDC_TX_COOKIE_NAME } from '@/lib/auth-constants';
import {
  authorizeOidcIdentity,
  clearOidcCaches,
  generatePkcePair,
  getOidcConfig,
  sanitizeReturnTo,
  verifyIdTokenJwt,
} from '@/lib/auth-oidc';
import { GET as providersGet } from '@/app/api/auth/providers/route';
import { GET as oidcCallbackGet } from '@/app/api/auth/oidc/callback/route';
import { GET as oidcStartGet } from '@/app/api/auth/oidc/start/route';

function signJwt(params: {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  privateKey: crypto.KeyObject;
  alg: 'RS256' | 'ES256';
}): string {
  const h = Buffer.from(JSON.stringify(params.header), 'utf8').toString('base64url');
  const p = Buffer.from(JSON.stringify(params.payload), 'utf8').toString('base64url');
  const signingInput = Buffer.from(`${h}.${p}`, 'utf8');

  const sig =
    params.alg === 'ES256'
      ? crypto.sign('SHA256', signingInput, { key: params.privateKey, dsaEncoding: 'ieee-p1363' })
      : crypto.sign('RSA-SHA256', signingInput, params.privateKey);

  return `${h}.${p}.${sig.toString('base64url')}`;
}

describe('security/oidc IdP authentication & v3 sessions', () => {
  beforeEach(() => {
    mockCookiesMap.clear();
    clearOidcCaches();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('APP_PASSWORD', '');
    vi.stubEnv('SCHEDULE_SECRET', '');
    vi.stubEnv('AUTH_SESSION_SECRET', 'super-oidc-session-secret-0123456789');
    vi.stubEnv('AUTH_OIDC_ISSUER', 'https://accounts.google.com');
    vi.stubEnv('AUTH_OIDC_CLIENT_ID', 'google-client-id.apps.googleusercontent.com');
    vi.stubEnv('AUTH_OIDC_CLIENT_SECRET', 'google-client-secret');
    vi.stubEnv('AUTH_OIDC_PROVIDER_NAME', '');
    vi.stubEnv('AUTH_ALLOWED_EMAILS', 'alice@gmail.com');
    vi.stubEnv('AUTH_ALLOWED_DOMAINS', '');
    vi.stubEnv('AUTH_ALLOW_ANY_AUTHENTICATED', 'false');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearOidcCaches();
    mockCookiesMap.clear();
  });

  it('creates and parses v3 user-bound session tokens in OIDC-only mode while preserving v2', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(isOidcConfigured()).toBe(true);
    expect(isAnyAuthConfigured()).toBe(true);

    const now = 1_700_000_000;
    const v3Token = createSessionToken(now, {
      email: 'alice@gmail.com',
      name: 'Alice',
      provider: 'Google',
      sub: 'sub-123',
    });
    expect(v3Token.startsWith('v3.')).toBe(true);

    const parsedV3 = parseSessionToken(v3Token, now);
    expect(parsedV3?.user).toEqual({
      email: 'alice@gmail.com',
      name: 'Alice',
      provider: 'Google',
      sub: 'sub-123',
      method: 'oidc',
    });

    // Tampered user payload must fail signature verification
    const parts = v3Token.split('.');
    parts[3] = Buffer.from(JSON.stringify({ e: 'evil@gmail.com' }), 'utf8').toString('base64url');
    expect(parseSessionToken(parts.join('.'), now)).toBeNull();

    // v2 token still works
    const v2Token = createSessionToken(now);
    expect(v2Token.startsWith('v2.')).toBe(true);
    expect(parseSessionToken(v2Token, now)?.user.method).toBe('password');
  });

  it('generates PKCE S256 pairs and guards returnTo against open redirects', () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const expected = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    expect(codeChallenge).toBe(expected);

    expect(sanitizeReturnTo('/?tab=systems')).toBe('/?tab=systems');
    expect(sanitizeReturnTo('//evil.com')).toBe('/');
    expect(sanitizeReturnTo('https://evil.com')).toBe('/');
    expect(sanitizeReturnTo('/\\evil')).toBe('/');
  });

  it('verifies RS256 and ES256 id_tokens cryptographically against JWKS and rejects bad claims', async () => {
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaJwk = {
      ...(rsa.publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
      kid: 'rsa-key-1',
      use: 'sig',
      alg: 'RS256',
    };

    const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const ecJwk = {
      ...(ec.publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
      kid: 'ec-key-1',
      use: 'sig',
      alg: 'ES256',
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ keys: [rsaJwk, ecJwk] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const nowSec = 1_700_000_000;
    const validRsaJwt = signJwt({
      header: { alg: 'RS256', kid: 'rsa-key-1', typ: 'JWT' },
      payload: {
        iss: 'https://accounts.google.com',
        aud: 'google-client-id.apps.googleusercontent.com',
        sub: 'google-sub-1',
        email: 'alice@gmail.com',
        email_verified: true,
        nonce: 'nonce-abc',
        iat: nowSec - 10,
        exp: nowSec + 300,
      },
      privateKey: rsa.privateKey,
      alg: 'RS256',
    });

    const rsaClaims = await verifyIdTokenJwt({
      idToken: validRsaJwt,
      expectedIssuer: 'https://accounts.google.com',
      expectedAudience: 'google-client-id.apps.googleusercontent.com',
      expectedNonce: 'nonce-abc',
      jwksUri: 'https://accounts.google.com/jwks',
      nowSec,
    });
    expect(rsaClaims.email).toBe('alice@gmail.com');

    const validEcJwt = signJwt({
      header: { alg: 'ES256', kid: 'ec-key-1', typ: 'JWT' },
      payload: {
        iss: 'https://accounts.google.com',
        aud: 'google-client-id.apps.googleusercontent.com',
        sub: 'ec-sub-1',
        nonce: 'nonce-ec',
        iat: nowSec - 10,
        exp: nowSec + 300,
      },
      privateKey: ec.privateKey,
      alg: 'ES256',
    });

    const ecClaims = await verifyIdTokenJwt({
      idToken: validEcJwt,
      expectedIssuer: 'https://accounts.google.com',
      expectedAudience: 'google-client-id.apps.googleusercontent.com',
      expectedNonce: 'nonce-ec',
      jwksUri: 'https://accounts.google.com/jwks',
      nowSec,
    });
    expect(ecClaims.sub).toBe('ec-sub-1');

    // Wrong audience
    await expect(
      verifyIdTokenJwt({
        idToken: validRsaJwt,
        expectedIssuer: 'https://accounts.google.com',
        expectedAudience: 'wrong-client-id',
        expectedNonce: 'nonce-abc',
        jwksUri: 'https://accounts.google.com/jwks',
        nowSec,
      })
    ).rejects.toThrow(/aud/i);

    // Expired token
    await expect(
      verifyIdTokenJwt({
        idToken: validRsaJwt,
        expectedIssuer: 'https://accounts.google.com',
        expectedAudience: 'google-client-id.apps.googleusercontent.com',
        expectedNonce: 'nonce-abc',
        jwksUri: 'https://accounts.google.com/jwks',
        nowSec: nowSec + 500,
      })
    ).rejects.toThrow(/expiré/i);

    // Wrong nonce
    await expect(
      verifyIdTokenJwt({
        idToken: validRsaJwt,
        expectedIssuer: 'https://accounts.google.com',
        expectedAudience: 'google-client-id.apps.googleusercontent.com',
        expectedNonce: 'wrong-nonce',
        jwksUri: 'https://accounts.google.com/jwks',
        nowSec,
      })
    ).rejects.toThrow(/nonce/i);
  });

  it('enforces fail-closed email/domain allow-list authorization policies', () => {
    const cfg = getOidcConfig();
    expect(cfg.providerName).toBe('Google');

    expect(
      authorizeOidcIdentity(
        { sub: '1', email: 'alice@gmail.com', emailVerified: true },
        cfg
      ).allowed
    ).toBe(true);

    // Unverified email rejected
    expect(
      authorizeOidcIdentity(
        { sub: '1', email: 'alice@gmail.com', emailVerified: false },
        cfg
      )
    ).toEqual({ allowed: false, reason: 'oidc_unauthorized' });

    // Unknown user rejected
    expect(
      authorizeOidcIdentity(
        { sub: '2', email: 'intruder@gmail.com', emailVerified: true },
        cfg
      )
    ).toEqual({ allowed: false, reason: 'oidc_unauthorized' });

    // Production without allow-list fails closed unless AUTH_ALLOW_ANY_AUTHENTICATED=true
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_ALLOWED_EMAILS', '');
    vi.stubEnv('AUTH_ALLOWED_DOMAINS', '');
    expect(
      authorizeOidcIdentity(
        { sub: '1', email: 'anyone@gmail.com', emailVerified: true },
        getOidcConfig()
      )
    ).toEqual({ allowed: false, reason: 'oidc_config' });

    vi.stubEnv('AUTH_ALLOWED_DOMAINS', 'example.org');
    expect(
      authorizeOidcIdentity(
        { sub: '1', email: 'bob@example.org', emailVerified: true },
        getOidcConfig()
      ).allowed
    ).toBe(true);
  });

  it('handles /api/auth/providers, /api/auth/oidc/start, and /api/auth/oidc/callback end-to-end', async () => {
    const providersRes = await providersGet();
    expect(providersRes.status).toBe(200);
    expect(await providersRes.json()).toEqual({
      passwordEnabled: false,
      oidcEnabled: true,
      oidcProviderName: 'Google',
    });

    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaJwk = {
      ...(rsa.publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
      kid: 'google-kid-1',
      use: 'sig',
      alg: 'RS256',
    };

    const discoveryDoc = {
      issuer: 'https://accounts.google.com',
      authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_endpoint: 'https://oauth2.googleapis.com/token',
      jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
    };

    let capturedOidcNonce = '';

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes('/.well-known/openid-configuration')) {
          return new Response(JSON.stringify(discoveryDoc), { status: 200 });
        }
        if (url === discoveryDoc.token_endpoint) {
          const nowSec = Math.floor(Date.now() / 1000);
          const idToken = signJwt({
            header: { alg: 'RS256', kid: 'google-kid-1', typ: 'JWT' },
            payload: {
              iss: discoveryDoc.issuer,
              aud: 'google-client-id.apps.googleusercontent.com',
              sub: 'sub-alice',
              email: 'alice@gmail.com',
              email_verified: true,
              name: 'Alice',
              nonce: capturedOidcNonce,
              iat: nowSec - 5,
              exp: nowSec + 300,
            },
            privateKey: rsa.privateKey,
            alg: 'RS256',
          });
          return new Response(JSON.stringify({ id_token: idToken, access_token: 'at' }), {
            status: 200,
          });
        }
        if (url === discoveryDoc.jwks_uri) {
          return new Response(JSON.stringify({ keys: [rsaJwk] }), { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      })
    );

    const startRes = await oidcStartGet(
      new Request('https://cockpit.local/api/auth/oidc/start?returnTo=/?tab=energy')
    );
    expect(startRes.status).toBe(307);
    const authLocation = new URL(startRes.headers.get('location')!);
    expect(authLocation.origin + authLocation.pathname).toBe(discoveryDoc.authorization_endpoint);
    const stateParam = authLocation.searchParams.get('state')!;
    capturedOidcNonce = authLocation.searchParams.get('nonce')!;

    // Extract tx cookie from Set-Cookie
    const setCookieHeader = startRes.headers.get('set-cookie') ?? '';
    const txMatch = setCookieHeader.match(new RegExp(`${OIDC_TX_COOKIE_NAME}=([^;]+)`));
    expect(txMatch?.[1]).toBeTruthy();

    // Missing tx cookie -> CSRF error redirect
    const csrfRes = await oidcCallbackGet(
      new Request(`https://cockpit.local/api/auth/oidc/callback?code=c1&state=${encodeURIComponent(stateParam)}`)
    );
    expect(csrfRes.status).toBe(307);
    expect(csrfRes.headers.get('location')).toContain('/login?error=oidc_csrf');

    // Valid tx cookie -> mints v3 hc_session and redirects to returnTo
    mockCookiesMap.set(OIDC_TX_COOKIE_NAME, decodeURIComponent(txMatch![1]));
    const cbRes = await oidcCallbackGet(
      new Request(`https://cockpit.local/api/auth/oidc/callback?code=c1&state=${encodeURIComponent(stateParam)}`)
    );
    expect(cbRes.status).toBe(307);
    expect(cbRes.headers.get('location')).toBe('https://cockpit.local/?tab=energy');

    const cbCookies = cbRes.headers.get('set-cookie') ?? '';
    const sessionMatch = cbCookies.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    expect(sessionMatch?.[1]).toBeTruthy();
    const sessionToken = decodeURIComponent(sessionMatch![1]);
    expect(sessionToken.startsWith('v3.')).toBe(true);
    expect(parseSessionToken(sessionToken)?.user).toMatchObject({
      email: 'alice@gmail.com',
      name: 'Alice',
      provider: 'Google',
      method: 'oidc',
    });
  });
});
