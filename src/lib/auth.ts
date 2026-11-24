import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import {
  SESSION_CLOCK_SKEW_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_FALLBACK_SALT,
  SESSION_TOKEN_VERSION,
  SESSION_TTL_SECONDS,
} from '@/lib/auth-constants';

export { SESSION_COOKIE_NAME };

export function isAppPasswordConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD?.trim());
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function getSessionSecret(): string {
  const pwd = process.env.APP_PASSWORD?.trim() ?? '';
  const extra = process.env.SCHEDULE_SECRET?.trim() || SESSION_FALLBACK_SALT;
  return crypto.createHash('sha256').update(`${pwd}:${extra}`).digest('hex');
}

function signSessionMessage(message: string): string {
  const secret = getSessionSecret();
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

export function createSessionToken(nowSec = Math.floor(Date.now() / 1000)): string {
  const iat = Math.floor(nowSec);
  const exp = iat + SESSION_TTL_SECONDS;
  const payload = `${SESSION_TOKEN_VERSION}.${iat}.${exp}`;
  const sig = signSessionMessage(payload);
  return `${payload}.${sig}`;
}

export function verifySessionToken(
  token: string | undefined,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  if (!isAppPasswordConfigured()) {
    return !isProduction();
  }
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== SESSION_TOKEN_VERSION) {
    return false;
  }

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
    return false;
  }

  if (iat > nowSec + SESSION_CLOCK_SKEW_SECONDS || nowSec > exp) {
    return false;
  }

  const expectedSig = signSessionMessage(`${SESSION_TOKEN_VERSION}.${iat}.${exp}`);
  return safeCompare(sig.toLowerCase(), expectedSig);
}

export function verifyAppPassword(candidate: string): boolean {
  const configured = process.env.APP_PASSWORD?.trim();
  if (!configured) {
    return !isProduction();
  }
  return safeCompare(candidate, configured);
}

export async function isRequestAuthenticated(): Promise<boolean> {
  if (!isAppPasswordConfigured()) {
    return !isProduction();
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
