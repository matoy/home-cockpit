import crypto from 'node:crypto';
import { cookies } from 'next/headers';

export const SESSION_COOKIE_NAME = 'tuya_session';

export function isAppPasswordConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD?.trim());
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function getSessionSecret(): string {
  const pwd = process.env.APP_PASSWORD?.trim() ?? '';
  const extra = process.env.SCHEDULE_SECRET?.trim() ?? 'tuya-power-temp-salt';
  return crypto.createHash('sha256').update(`${pwd}:${extra}`).digest('hex');
}

export function createSessionToken(): string {
  const secret = getSessionSecret();
  const payload = 'authenticated-v1';
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!isAppPasswordConfigured()) {
    return !isProduction();
  }
  if (!token) return false;
  const expected = createSessionToken();
  return safeCompare(token, expected);
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
