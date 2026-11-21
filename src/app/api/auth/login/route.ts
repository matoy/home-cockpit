import { NextResponse } from 'next/server';
import {
  createSessionToken,
  isAppPasswordConfigured,
  SESSION_COOKIE_NAME,
  verifyAppPassword,
} from '@/lib/auth';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60_000;
const WINDOW_MS = 15 * 60_000;

interface AttemptRecord {
  count: number;
  lastAttemptAt: number;
  lockedUntil: number;
}

const failedAttempts = new Map<string, AttemptRecord>();

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

function pruneExpiredAttempts(now: number) {
  if (failedAttempts.size <= 500) return;
  for (const [ip, rec] of failedAttempts.entries()) {
    if (rec.lockedUntil < now && now - rec.lastAttemptAt > WINDOW_MS) {
      failedAttempts.delete(ip);
    }
  }
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && !isAppPasswordConfigured()) {
    return NextResponse.json(
      { error: 'APP_PASSWORD doit être configuré en production.' },
      { status: 503 }
    );
  }

  const now = Date.now();
  pruneExpiredAttempts(now);
  const ip = getClientIp(request);
  const current = failedAttempts.get(ip);

  if (current && current.lockedUntil > now) {
    const retryAfterSec = Math.max(1, Math.ceil((current.lockedUntil - now) / 1000));
    return NextResponse.json(
      { error: `Trop de tentatives échouées. Réessayez dans ${Math.ceil(retryAfterSec / 60)} min.` },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
    );
  }

  try {
    const body = (await request.json()) as { password?: string };
    const password = typeof body.password === 'string' ? body.password : '';

    if (!verifyAppPassword(password)) {
      await new Promise((resolve) => setTimeout(resolve, 400));

      const resetWindow = !current || now - current.lastAttemptAt > WINDOW_MS;
      const nextCount = resetWindow ? 1 : current.count + 1;
      const lockedUntil = nextCount >= MAX_FAILED_ATTEMPTS ? now + LOCK_DURATION_MS : 0;

      failedAttempts.set(ip, {
        count: nextCount,
        lastAttemptAt: now,
        lockedUntil,
      });

      if (lockedUntil > 0) {
        return NextResponse.json(
          { error: 'Trop de tentatives échouées. Compte temporairement bloqué (15 min).' },
          { status: 429, headers: { 'Retry-After': String(Math.ceil(LOCK_DURATION_MS / 1000)) } }
        );
      }

      return NextResponse.json({ error: 'Mot de passe incorrect' }, { status: 401 });
    }

    failedAttempts.delete(ip);

    const token = createSessionToken();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 14, // 14 jours
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }
}
