import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  normalizeOAuthReturnTab,
  OAUTH_STATE_TTL_SECONDS,
  signDaikinOAuthState,
  signHomeConnectOAuthState,
  signOAuthState,
  verifyDaikinOAuthState,
  verifyHomeConnectOAuthState,
  verifyOAuthState,
} from '@/lib/vendors/crypto-store';

describe('security/crypto-store & OAuth state', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('encrypts and decrypts secrets in AES-256-GCM and rejects tampered payloads', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

    const cipher = encryptSecret('oauth-refresh-token-xyz');
    expect(cipher.startsWith('v1:')).toBe(true);
    expect(decryptSecret(cipher)).toBe('oauth-refresh-token-xyz');

    const segments = cipher.split(':');
    const lastHex = segments[3].slice(-1).toLowerCase();
    segments[3] = `${segments[3].slice(0, -1)}${lastHex === '0' ? '1' : '0'}`;
    expect(decryptSecret(segments.join(':'))).toBeNull();
    expect(decryptSecret('plain-unencrypted-token')).toBeNull();
  });

  it('refuses missing encryption secret in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
    vi.stubEnv('APP_PASSWORD', '');
    vi.stubEnv('SCHEDULE_SECRET', '');
    vi.stubEnv('TUYA_ACCESS_SECRET', '');

    expect(() => encryptSecret('secret')).toThrow(/TOKEN_ENCRYPTION_KEY/i);
  });

  it('signs and verifies OAuth states with expiration and domain separation', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const rawSecret = 'secret-for-oauth-tests';
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', rawSecret);

    const nowSec = 1_700_000_000;
    const ghToken = signOAuthState(
      { nonce: 'nonce-12345678', mode: 'mcp', returnTab: 'rooms' },
      nowSec
    );
    expect(verifyOAuthState(ghToken, nowSec)).toEqual({
      nonce: 'nonce-12345678',
      mode: 'mcp',
      returnTab: 'rooms',
    });
    expect(verifyOAuthState(ghToken, nowSec + OAUTH_STATE_TTL_SECONDS + 1)).toBeNull();

    const hcToken = signHomeConnectOAuthState(
      { nonce: 'hc-nonce-1234', env: 'simulator', returnTab: 'devices' },
      nowSec
    );
    expect(verifyHomeConnectOAuthState(hcToken, nowSec)).toEqual({
      nonce: 'hc-nonce-1234',
      env: 'simulator',
      returnTab: 'devices',
    });
    expect(verifyHomeConnectOAuthState(hcToken, nowSec + OAUTH_STATE_TTL_SECONDS + 5)).toBeNull();

    const dkToken = signDaikinOAuthState(
      { nonce: 'dk-nonce-1234', returnTab: 'systems', redirectUri: 'https://app.example/cb' },
      nowSec
    );
    expect(verifyDaikinOAuthState(dkToken, nowSec)).toEqual({
      nonce: 'dk-nonce-1234',
      returnTab: 'systems',
      redirectUri: 'https://app.example/cb',
    });

    // Domain separation: an HMAC signed directly with the AES encryption key must not validate
    const aesKey = crypto.createHash('sha256').update(rawSecret).digest();
    const forgedPayload = Buffer.from(
      JSON.stringify({ nonce: 'forged-nonce-1234', mode: 'mcp', iat: nowSec, exp: nowSec + 900 }),
      'utf8'
    ).toString('base64url');
    const forgedSig = crypto.createHmac('sha256', aesKey).update(forgedPayload).digest('base64url');
    expect(verifyOAuthState(`${forgedPayload}.${forgedSig}`, nowSec)).toBeNull();
  });

  it('normalizes returnTab strictly', () => {
    expect(normalizeOAuthReturnTab('rooms')).toBe('rooms');
    expect(normalizeOAuthReturnTab('devices')).toBe('devices');
    expect(normalizeOAuthReturnTab('systems')).toBe('systems');
    expect(normalizeOAuthReturnTab('evil')).toBe('systems');
    expect(normalizeOAuthReturnTab(undefined)).toBe('systems');
  });
});
