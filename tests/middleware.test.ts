import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import { middleware } from '@/middleware';

describe('Edge middleware authentication & route protection', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows public paths without session cookie even in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_PASSWORD', 'prod-secret');

    for (const path of [
      '/login',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/providers',
      '/api/auth/oidc/start',
      '/api/auth/oidc/callback',
      '/api/schedule/collect',
    ]) {
      const res = await middleware(new NextRequest(`https://cockpit.local${path}`));
      expect(res.status).toBe(200);
      expect(res.headers.get('x-middleware-next')).toBe('1');
    }
  });

  it('fails closed with 503 in production when neither APP_PASSWORD nor OIDC is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_PASSWORD', '');
    vi.stubEnv('AUTH_OIDC_ISSUER', '');
    vi.stubEnv('AUTH_OIDC_CLIENT_ID', '');
    vi.stubEnv('AUTH_SESSION_SECRET', '');

    const apiRes = await middleware(new NextRequest('https://cockpit.local/api/dashboard'));
    expect(apiRes.status).toBe(503);

    const pageRes = await middleware(new NextRequest('https://cockpit.local/'));
    expect(pageRes.status).toBe(503);
  });

  it('blocks unauthenticated API and page requests and validates v2 + v3 session cookies', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_PASSWORD', '');
    vi.stubEnv('AUTH_OIDC_ISSUER', 'https://accounts.google.com');
    vi.stubEnv('AUTH_OIDC_CLIENT_ID', 'oidc-client-id');
    vi.stubEnv('AUTH_SESSION_SECRET', 'super-secret-signing-key-0123456789');

    const unauthApi = await middleware(new NextRequest('https://cockpit.local/api/dashboard'));
    expect(unauthApi.status).toBe(401);

    const unauthPage = await middleware(new NextRequest('https://cockpit.local/'));
    expect(unauthPage.status).toBe(307);
    expect(unauthPage.headers.get('location')).toBe('https://cockpit.local/login');

    const nowSec = Math.floor(Date.now() / 1000);
    const v2Token = createSessionToken(nowSec);
    const validV2Res = await middleware(
      new NextRequest('https://cockpit.local/api/dashboard', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${v2Token}` },
      })
    );
    expect(validV2Res.status).toBe(200);
    expect(validV2Res.headers.get('x-middleware-next')).toBe('1');

    const v3Token = createSessionToken(nowSec, {
      email: 'alice@gmail.com',
      name: 'Alice',
      provider: 'Google',
      sub: 'sub-1',
    });
    const validV3Res = await middleware(
      new NextRequest('https://cockpit.local/', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${v3Token}` },
      })
    );
    expect(validV3Res.status).toBe(200);
    expect(validV3Res.headers.get('x-middleware-next')).toBe('1');

    const expiredV3Token = createSessionToken(nowSec - 60 * 60 * 24 * 30, {
      email: 'alice@gmail.com',
    });
    const expiredRes = await middleware(
      new NextRequest('https://cockpit.local/api/dashboard', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${expiredV3Token}` },
      })
    );
    expect(expiredRes.status).toBe(401);
  });
});
