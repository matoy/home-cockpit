import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionToken,
  isAppPasswordConfigured,
  verifyAppPassword,
  verifyScheduleSecret,
  verifySessionToken,
} from '@/lib/auth';
import {
  SESSION_CLOCK_SKEW_SECONDS,
  SESSION_TTL_SECONDS,
} from '@/lib/auth-constants';
import { fetchWithTimeout, getPublicOrigin, safeEqualString } from '@/lib/http-utils';

describe('security/auth & http-utils', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('creates and verifies signed v2 session tokens with expiration bounds', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_PASSWORD', 'my-strong-cockpit-secret');
    vi.stubEnv('SCHEDULE_SECRET', 'cron-secret');

    const baseNow = 1_700_000_000;
    const token = createSessionToken(baseNow);
    expect(token.startsWith('v2.')).toBe(true);
    expect(verifySessionToken(token, baseNow)).toBe(true);
    expect(verifySessionToken(token, baseNow + SESSION_TTL_SECONDS)).toBe(true);

    // Expired token must fail
    expect(verifySessionToken(token, baseNow + SESSION_TTL_SECONDS + 1)).toBe(false);

    // Token issued too far in the future must fail
    const futureToken = createSessionToken(baseNow + SESSION_CLOCK_SKEW_SECONDS + 5);
    expect(verifySessionToken(futureToken, baseNow)).toBe(false);

    // Tampered signature must fail
    const parts = token.split('.');
    parts[3] = `${parts[3].slice(0, -2)}00`;
    expect(verifySessionToken(parts.join('.'), baseNow)).toBe(false);

    // Legacy static v1 or malformed token must fail
    expect(verifySessionToken('authenticated-v1.deadbeef')).toBe(false);
    expect(verifySessionToken(undefined)).toBe(false);
  });

  it('denies verification when APP_PASSWORD is missing in production, allows in dev', () => {
    vi.stubEnv('APP_PASSWORD', '');
    expect(isAppPasswordConfigured()).toBe(false);

    vi.stubEnv('NODE_ENV', 'development');
    expect(verifySessionToken(undefined)).toBe(true);
    expect(verifyAppPassword('')).toBe(true);

    vi.stubEnv('NODE_ENV', 'production');
    expect(verifySessionToken('anything')).toBe(false);
    expect(verifyAppPassword('')).toBe(false);
  });

  it('validates APP_PASSWORD and SCHEDULE_SECRET headers safely', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_PASSWORD', 'pass-123');
    vi.stubEnv('SCHEDULE_SECRET', 'sched-xyz');

    expect(verifyAppPassword('pass-123')).toBe(true);
    expect(verifyAppPassword('wrong')).toBe(false);

    const bearerReq = new Request('https://cockpit.local/api/schedule/collect', {
      headers: { authorization: 'Bearer sched-xyz' },
    });
    expect(verifyScheduleSecret(bearerReq)).toBe(true);

    const customHeaderReq = new Request('https://cockpit.local/api/schedule/collect', {
      headers: { 'x-schedule-secret': 'sched-xyz' },
    });
    expect(verifyScheduleSecret(customHeaderReq)).toBe(true);

    const invalidReq = new Request('https://cockpit.local/api/schedule/collect', {
      headers: { authorization: 'Bearer wrong' },
    });
    expect(verifyScheduleSecret(invalidReq)).toBe(false);
  });

  it('hardens getPublicOrigin against x-forwarded-host injection and respects NEXT_PUBLIC_APP_URL', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');

    const validFwd = new Request('http://internal:3000/api/auth', {
      headers: {
        'x-forwarded-host': 'cockpit.example.com, proxy.internal',
        'x-forwarded-proto': 'https',
      },
    });
    expect(getPublicOrigin(validFwd)).toBe('https://cockpit.example.com');

    const spoofedAtHost = new Request('https://app.homecockpit.local/callback', {
      headers: {
        'x-forwarded-host': 'user@evil.com',
        'x-forwarded-proto': 'javascript',
      },
    });
    expect(getPublicOrigin(spoofedAtHost)).toBe('https://app.homecockpit.local');

    const spoofedSlashHost = new Request('https://app.homecockpit.local/callback', {
      headers: {
        'x-forwarded-host': 'evil.com/path',
        'x-forwarded-proto': 'http',
      },
    });
    expect(getPublicOrigin(spoofedSlashHost)).toBe('https://app.homecockpit.local');

    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://prod.homecockpit.org/subpath');
    expect(getPublicOrigin(validFwd)).toBe('https://prod.homecockpit.org');
  });

  it('performs constant-time equality checks and aborts slow requests via fetchWithTimeout', async () => {
    expect(safeEqualString('abc123', 'abc123')).toBe(true);
    expect(safeEqualString('abc123', 'abc124')).toBe(false);
    expect(safeEqualString('short', 'longer')).toBe(false);

    const slowFetch = vi.fn((_input: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'TimeoutError';
          reject(err);
        });
      });
    });
    vi.stubGlobal('fetch', slowFetch);

    await expect(fetchWithTimeout('https://vendor.example/api', {}, 25)).rejects.toThrow(/aborted/i);
  });
});
