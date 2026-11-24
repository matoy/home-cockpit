import crypto from 'node:crypto';
import type { GoogleHomeMode, HomeConnectEnv } from '@/types';

const SECRET_PREFIX = 'v1:';
export const OAUTH_STATE_TTL_SECONDS = 900; // 15 minutes
const OAUTH_CLOCK_SKEW_SECONDS = 60;

function getRawEncryptionSecret(): string {
  const configured =
    process.env.TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.APP_PASSWORD?.trim() ||
    process.env.SCHEDULE_SECRET?.trim() ||
    process.env.TUYA_ACCESS_SECRET?.trim();

  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Aucun secret serveur configuré pour le chiffrement OAuth en production (TOKEN_ENCRYPTION_KEY requis).'
    );
  }

  return 'cockpit-dev-token-key';
}

function deriveAesKey(): Buffer {
  return crypto.createHash('sha256').update(getRawEncryptionSecret()).digest();
}

function deriveOAuthStateKey(): Buffer {
  return crypto
    .createHash('sha256')
    .update(`oauth-state-v1:${getRawEncryptionSecret()}`)
    .digest();
}

/**
 * Chiffre un token OAuth (access_token / refresh_token) en AES-256-GCM avant stockage en base.
 */
export function encryptSecret(plain: string): string {
  const key = deriveAesKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SECRET_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Déchiffre un token OAuth stocké en base ; retourne null si absent ou invalide.
 */
export function decryptSecret(encoded: string | null | undefined): string | null {
  if (!encoded || !encoded.startsWith(SECRET_PREFIX)) {
    return null;
  }
  const body = encoded.slice(SECRET_PREFIX.length);
  const parts = body.split(':');
  if (parts.length !== 3) return null;

  try {
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const ciphertext = Buffer.from(parts[2], 'hex');
    const key = deriveAesKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export type OAuthReturnTab = 'systems' | 'devices' | 'rooms';

export function normalizeOAuthReturnTab(raw: unknown): OAuthReturnTab {
  if (raw === 'rooms') return 'rooms';
  if (raw === 'devices') return 'devices';
  return 'systems';
}

export interface SignedOAuthState {
  nonce: string;
  mode: GoogleHomeMode;
  returnTab?: OAuthReturnTab;
}

function signHmacPayload(
  payload: object,
  nowSec = Math.floor(Date.now() / 1000)
): string {
  const key = deriveOAuthStateKey();
  const iat = Math.floor(nowSec);
  const envelope = {
    ...payload,
    iat,
    exp: iat + OAUTH_STATE_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyHmacPayload(
  token: string | null | undefined,
  nowSec = Math.floor(Date.now() / 1000)
): Record<string, unknown> | null {
  if (!token) return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;

  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!encoded || !sig) return null;

  const key = deriveOAuthStateKey();
  const expectedSig = crypto.createHmac('sha256', key).update(encoded).digest('base64url');
  const bufSig = Buffer.from(sig, 'utf8');
  const bufExpected = Buffer.from(expectedSig, 'utf8');
  if (bufSig.length !== bufExpected.length || !crypto.timingSafeEqual(bufSig, bufExpected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.iat !== 'number' || typeof rec.exp !== 'number') {
      return null;
    }
    if (
      !Number.isFinite(rec.iat) ||
      !Number.isFinite(rec.exp) ||
      rec.exp < rec.iat ||
      rec.iat > nowSec + OAUTH_CLOCK_SKEW_SECONDS ||
      nowSec > rec.exp
    ) {
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

/**
 * Signe un paramètre OAuth `state` anti-CSRF par HMAC-SHA256.
 */
export function signOAuthState(payload: SignedOAuthState, nowSec?: number): string {
  return signHmacPayload(payload, nowSec);
}

/**
 * Vérifie et décode un paramètre OAuth `state` signé.
 */
export function verifyOAuthState(
  token: string | null | undefined,
  nowSec?: number
): SignedOAuthState | null {
  const parsed = verifyHmacPayload(token, nowSec);
  if (!parsed) return null;
  if (
    typeof parsed.nonce === 'string' &&
    parsed.nonce.length >= 8 &&
    (parsed.mode === 'mcp' || parsed.mode === 'sdm')
  ) {
    return {
      nonce: parsed.nonce,
      mode: parsed.mode,
      returnTab: normalizeOAuthReturnTab(parsed.returnTab),
    };
  }
  return null;
}

export interface SignedHomeConnectOAuthState {
  nonce: string;
  env: HomeConnectEnv;
  returnTab?: OAuthReturnTab;
}

/**
 * Signe un paramètre OAuth `state` Siemens Home Connect anti-CSRF par HMAC-SHA256.
 */
export function signHomeConnectOAuthState(
  payload: SignedHomeConnectOAuthState,
  nowSec?: number
): string {
  return signHmacPayload(payload, nowSec);
}

/**
 * Vérifie et décode un paramètre OAuth `state` Siemens Home Connect signé.
 */
export function verifyHomeConnectOAuthState(
  token: string | null | undefined,
  nowSec?: number
): SignedHomeConnectOAuthState | null {
  const parsed = verifyHmacPayload(token, nowSec);
  if (!parsed) return null;
  if (
    typeof parsed.nonce === 'string' &&
    parsed.nonce.length >= 8 &&
    (parsed.env === 'prod' || parsed.env === 'simulator' || parsed.env === 'cn')
  ) {
    return {
      nonce: parsed.nonce,
      env: parsed.env,
      returnTab: normalizeOAuthReturnTab(parsed.returnTab),
    };
  }
  return null;
}

export interface SignedDaikinOAuthState {
  nonce: string;
  returnTab?: OAuthReturnTab;
  redirectUri?: string;
}

/**
 * Signe un paramètre OAuth `state` Daikin Onecta anti-CSRF par HMAC-SHA256.
 */
export function signDaikinOAuthState(payload: SignedDaikinOAuthState, nowSec?: number): string {
  return signHmacPayload(payload, nowSec);
}

/**
 * Vérifie et décode un paramètre OAuth `state` Daikin Onecta signé.
 */
export function verifyDaikinOAuthState(
  token: string | null | undefined,
  nowSec?: number
): SignedDaikinOAuthState | null {
  const parsed = verifyHmacPayload(token, nowSec);
  if (!parsed) return null;
  if (typeof parsed.nonce === 'string' && parsed.nonce.length >= 8) {
    return {
      nonce: parsed.nonce,
      returnTab: normalizeOAuthReturnTab(parsed.returnTab),
      redirectUri: typeof parsed.redirectUri === 'string' ? parsed.redirectUri : undefined,
    };
  }
  return null;
}

export interface SignedXiaomiAuthState {
  nonce: string;
  region: string;
  flow: 'qr' | '2fa';
  longPollingUrl?: string;
  notificationUrl?: string;
  identitySessionCookie?: string;
  username?: string;
  issuedAt: number;
}

/**
 * Signe un état temporaire d'authentification Xiaomi Home (QR Code / 2FA) par HMAC-SHA256.
 */
export function signXiaomiAuthState(payload: SignedXiaomiAuthState): string {
  return signHmacPayload(payload);
}

/**
 * Vérifie et décode un état temporaire Xiaomi Home signé (valide 15 minutes).
 */
export function verifyXiaomiAuthState(
  token: string | null | undefined,
  maxAgeMs = 15 * 60 * 1000
): SignedXiaomiAuthState | null {
  const parsed = verifyHmacPayload(token);
  if (!parsed) return null;
  if (
    typeof parsed.nonce === 'string' &&
    parsed.nonce.length >= 6 &&
    typeof parsed.region === 'string' &&
    (parsed.flow === 'qr' || parsed.flow === '2fa') &&
    typeof parsed.issuedAt === 'number' &&
    Date.now() - parsed.issuedAt <= maxAgeMs
  ) {
    return {
      nonce: parsed.nonce,
      region: parsed.region,
      flow: parsed.flow,
      longPollingUrl:
        typeof parsed.longPollingUrl === 'string' ? parsed.longPollingUrl : undefined,
      notificationUrl:
        typeof parsed.notificationUrl === 'string' ? parsed.notificationUrl : undefined,
      identitySessionCookie:
        typeof parsed.identitySessionCookie === 'string'
          ? parsed.identitySessionCookie
          : undefined,
      username: typeof parsed.username === 'string' ? parsed.username : undefined,
      issuedAt: parsed.issuedAt,
    };
  }
  return null;
}
