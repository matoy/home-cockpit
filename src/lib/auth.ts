import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import {
  SESSION_CLOCK_SKEW_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_FALLBACK_SALT,
  SESSION_TOKEN_VERSION,
  SESSION_TOKEN_VERSION_V3,
  SESSION_TTL_SECONDS,
} from '@/lib/auth-constants';

export { SESSION_COOKIE_NAME };

export interface SessionUser {
  email?: string;
  name?: string;
  provider?: string;
  sub?: string;
  method: 'password' | 'oidc';
}

interface CompactSessionUserPayload {
  e?: string;
  n?: string;
  p?: string;
  s?: string;
}

export function isAppPasswordConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD?.trim());
}

export function isOidcConfigured(): boolean {
  const issuer = process.env.AUTH_OIDC_ISSUER?.trim();
  const clientId = process.env.AUTH_OIDC_CLIENT_ID?.trim();
  if (!issuer || !clientId) return false;
  try {
    const parsed = new URL(issuer);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocal && !isProduction());
  } catch {
    return false;
  }
}

export function isAnyAuthConfigured(): boolean {
  return isAppPasswordConfigured() || isOidcConfigured();
}

export function hasSessionSecretConfigured(): boolean {
  return Boolean(
    process.env.AUTH_SESSION_SECRET?.trim() ||
      process.env.APP_PASSWORD?.trim() ||
      process.env.TOKEN_ENCRYPTION_KEY?.trim() ||
      process.env.SCHEDULE_SECRET?.trim()
  );
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function getSessionSecret(): string {
  const primary =
    process.env.AUTH_SESSION_SECRET?.trim() ||
    process.env.APP_PASSWORD?.trim() ||
    process.env.TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.SCHEDULE_SECRET?.trim() ||
    '';
  const extra = process.env.SCHEDULE_SECRET?.trim() || SESSION_FALLBACK_SALT;
  return crypto.createHash('sha256').update(`${primary}:${extra}`).digest('hex');
}

function signSessionMessage(message: string): string {
  const secret = getSessionSecret();
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function compactUserPayload(user: Omit<SessionUser, 'method'>): string {
  const compact: CompactSessionUserPayload = {};
  if (user.email) compact.e = user.email.trim().slice(0, 120);
  if (user.name) compact.n = user.name.trim().slice(0, 80);
  if (user.provider) compact.p = user.provider.trim().slice(0, 40);
  if (user.sub) compact.s = user.sub.trim().slice(0, 120);
  return Buffer.from(JSON.stringify(compact), 'utf8').toString('base64url');
}

function decodeCompactUserPayload(userB64: string): SessionUser | null {
  if (!userB64 || userB64.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(userB64)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(userB64, 'base64url').toString('utf8')
    ) as CompactSessionUserPayload;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return {
      email: typeof parsed.e === 'string' && parsed.e ? parsed.e : undefined,
      name: typeof parsed.n === 'string' && parsed.n ? parsed.n : undefined,
      provider: typeof parsed.p === 'string' && parsed.p ? parsed.p : undefined,
      sub: typeof parsed.s === 'string' && parsed.s ? parsed.s : undefined,
      method: 'oidc',
    };
  } catch {
    return null;
  }
}

export function createSessionToken(
  nowSec = Math.floor(Date.now() / 1000),
  user?: Omit<SessionUser, 'method'>
): string {
  const iat = Math.floor(nowSec);
  const exp = iat + SESSION_TTL_SECONDS;
  if (user) {
    const userB64 = compactUserPayload(user);
    const payload = `${SESSION_TOKEN_VERSION_V3}.${iat}.${exp}.${userB64}`;
    const sig = signSessionMessage(payload);
    return `${payload}.${sig}`;
  }

  const payload = `${SESSION_TOKEN_VERSION}.${iat}.${exp}`;
  const sig = signSessionMessage(payload);
  return `${payload}.${sig}`;
}

export function parseSessionToken(
  token: string | undefined,
  nowSec = Math.floor(Date.now() / 1000)
): { valid: true; user: SessionUser } | null {
  if (!isAnyAuthConfigured()) {
    return !isProduction() ? { valid: true, user: { method: 'password' } } : null;
  }
  if (isProduction() && !hasSessionSecretConfigured()) {
    return null;
  }
  if (!token) return null;

  const parts = token.split('.');
  const version = parts[0];

  if (version === SESSION_TOKEN_VERSION && parts.length === 4) {
    const iat = Number(parts[1]);
    const exp = Number(parts[2]);
    const sig = parts[3];

    if (
      !Number.isInteger(iat) ||
      !Number.isInteger(exp) ||
      iat <= 0 ||
      exp <= iat ||
      !sig ||
      !/^[0-9a-f]+$/i.test(sig)
    ) {
      return null;
    }

    if (iat > nowSec + SESSION_CLOCK_SKEW_SECONDS || nowSec > exp) {
      return null;
    }

    const expectedSig = signSessionMessage(`${SESSION_TOKEN_VERSION}.${iat}.${exp}`);
    return safeCompare(sig.toLowerCase(), expectedSig)
      ? { valid: true, user: { method: 'password' } }
      : null;
  }

  if (version === SESSION_TOKEN_VERSION_V3 && parts.length === 5) {
    const iat = Number(parts[1]);
    const exp = Number(parts[2]);
    const userB64 = parts[3];
    const sig = parts[4];

    if (
      !Number.isInteger(iat) ||
      !Number.isInteger(exp) ||
      iat <= 0 ||
      exp <= iat ||
      !sig ||
      !/^[0-9a-f]+$/i.test(sig)
    ) {
      return null;
    }

    if (iat > nowSec + SESSION_CLOCK_SKEW_SECONDS || nowSec > exp) {
      return null;
    }

    const user = decodeCompactUserPayload(userB64);
    if (!user) return null;

    const expectedSig = signSessionMessage(`${SESSION_TOKEN_VERSION_V3}.${iat}.${exp}.${userB64}`);
    return safeCompare(sig.toLowerCase(), expectedSig) ? { valid: true, user } : null;
  }

  return null;
}

export function verifySessionToken(
  token: string | undefined,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  return Boolean(parseSessionToken(token, nowSec));
}

export function verifyAppPassword(candidate: string): boolean {
  const configured = process.env.APP_PASSWORD?.trim();
  if (!configured) {
    return !isProduction() && !isOidcConfigured();
  }
  return safeCompare(candidate, configured);
}

export async function getCurrentSessionUser(): Promise<SessionUser | null> {
  if (!isAnyAuthConfigured()) {
    return null;
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return parseSessionToken(token)?.user ?? null;
}

export async function isRequestAuthenticated(): Promise<boolean> {
  if (!isAnyAuthConfigured()) {
    return !isProduction();
  }
  if (isProduction() && !hasSessionSecretConfigured()) {
    return false;
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export function verifyScheduleSecret(request: Request): boolean {
  const secret = process.env.SCHEDULE_SECRET?.trim();
  if (!secret) {
    return !isProduction();
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.slice(0, 7).toLowerCase() === 'bearer ') {
    const token = authHeader.slice(7).trim();
    if (safeCompare(token, secret)) return true;
  }

  const headerSecret = request.headers.get('x-schedule-secret');
  if (headerSecret && safeCompare(headerSecret.trim(), secret)) {
    return true;
  }

  return false;
}

function safeCompare(aStr: string, bStr: string): boolean {
  const a = Buffer.from(aStr);
  const b = Buffer.from(bStr);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
