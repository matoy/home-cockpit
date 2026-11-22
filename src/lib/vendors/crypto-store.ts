import crypto from 'node:crypto';
import type { GoogleHomeMode } from '@/types';

const SECRET_PREFIX = 'v1:';

function deriveAesKey(): Buffer {
  const rawSecret =
    process.env.TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.APP_PASSWORD?.trim() ||
    process.env.SCHEDULE_SECRET?.trim() ||
    process.env.TUYA_ACCESS_SECRET?.trim() ||
    'cockpit-dev-token-key';

  return crypto.createHash('sha256').update(rawSecret).digest();
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

export interface SignedOAuthState {
  nonce: string;
  mode: GoogleHomeMode;
}

/**
 * Signe un paramètre OAuth `state` anti-CSRF par HMAC-SHA256.
 */
export function signOAuthState(payload: SignedOAuthState): string {
  const key = deriveAesKey();
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

/**
 * Vérifie et décode un paramètre OAuth `state` signé.
 */
export function verifyOAuthState(token: string | null | undefined): SignedOAuthState | null {
  if (!token) return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;

  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!encoded || !sig) return null;

  const key = deriveAesKey();
  const expectedSig = crypto.createHmac('sha256', key).update(encoded).digest('base64url');
  const bufSig = Buffer.from(sig, 'utf8');
  const bufExpected = Buffer.from(expectedSig, 'utf8');
  if (bufSig.length !== bufExpected.length || !crypto.timingSafeEqual(bufSig, bufExpected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      nonce?: unknown;
      mode?: unknown;
    };
    if (
      typeof parsed.nonce === 'string' &&
      parsed.nonce.length >= 8 &&
      (parsed.mode === 'mcp' || parsed.mode === 'sdm')
    ) {
      return { nonce: parsed.nonce, mode: parsed.mode };
    }
    return null;
  } catch {
    return null;
  }
}
