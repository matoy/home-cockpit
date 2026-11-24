import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_CLOCK_SKEW_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_FALLBACK_SALT,
  SESSION_TOKEN_VERSION,
} from '@/lib/auth-constants';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout', '/api/schedule/collect'];

async function computeSessionSignature(
  message: string,
  appPassword: string,
  scheduleSecret: string
): Promise<string> {
  const enc = new TextEncoder();
  const secretHashBuf = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(`${appPassword}:${scheduleSecret || SESSION_FALLBACK_SALT}`)
  );
  const secretHex = Array.from(new Uint8Array(secretHashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyEdgeSessionToken(
  token: string | undefined,
  appPassword: string,
  scheduleSecret: string,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<boolean> {
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

  const expectedSig = await computeSessionSignature(
    `${SESSION_TOKEN_VERSION}.${iat}.${exp}`,
    appPassword,
    scheduleSecret
  );
  return constantTimeEqual(sig.toLowerCase(), expectedSig);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return NextResponse.next();
  }

  const appPassword = process.env.APP_PASSWORD?.trim();
  if (!appPassword) {
    if (process.env.NODE_ENV === 'production') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'APP_PASSWORD doit être configuré en production.' },
          { status: 503 }
        );
      }
      return new NextResponse(
        'Accès bloqué : configurez APP_PASSWORD dans les variables d’environnement.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }
    return NextResponse.next();
  }

  const cookieToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const isValid = await verifyEdgeSessionToken(
    cookieToken,
    appPassword,
    process.env.SCHEDULE_SECRET?.trim() ?? ''
  );

  if (isValid) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
