import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_CLOCK_SKEW_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_FALLBACK_SALT,
  SESSION_TOKEN_VERSION,
  SESSION_TOKEN_VERSION_V3,
} from '@/lib/auth-constants';

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/providers',
  '/api/auth/oidc/start',
  '/api/auth/oidc/callback',
  '/api/schedule/collect',
];

function isOidcConfiguredEdge(): boolean {
  const issuer = process.env.AUTH_OIDC_ISSUER?.trim();
  const clientId = process.env.AUTH_OIDC_CLIENT_ID?.trim();
  if (!issuer || !clientId) return false;
  try {
    const parsed = new URL(issuer);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    return (
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && isLocal && process.env.NODE_ENV !== 'production')
    );
  } catch {
    return false;
  }
}

async function computeSessionSignature(
  message: string,
  primarySecret: string,
  scheduleSecret: string
): Promise<string> {
  const enc = new TextEncoder();
  const secretHashBuf = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(`${primarySecret}:${scheduleSecret || SESSION_FALLBACK_SALT}`)
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
  primarySecret: string,
  scheduleSecret: string,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!token) return false;
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
      return false;
    }

    if (iat > nowSec + SESSION_CLOCK_SKEW_SECONDS || nowSec > exp) {
      return false;
    }

    const expectedSig = await computeSessionSignature(
      `${SESSION_TOKEN_VERSION}.${iat}.${exp}`,
      primarySecret,
      scheduleSecret
    );
    return constantTimeEqual(sig.toLowerCase(), expectedSig);
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
      !userB64 ||
      userB64.length > 1024 ||
      !/^[A-Za-z0-9_-]+$/.test(userB64) ||
      !sig ||
      !/^[0-9a-f]+$/i.test(sig)
    ) {
      return false;
    }

    if (iat > nowSec + SESSION_CLOCK_SKEW_SECONDS || nowSec > exp) {
      return false;
    }

    const expectedSig = await computeSessionSignature(
      `${SESSION_TOKEN_VERSION_V3}.${iat}.${exp}.${userB64}`,
      primarySecret,
      scheduleSecret
    );
    return constantTimeEqual(sig.toLowerCase(), expectedSig);
  }

  return false;
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

  const appPassword = process.env.APP_PASSWORD?.trim() ?? '';
  const oidcConfigured = isOidcConfiguredEdge();
  const anyAuthConfigured = Boolean(appPassword) || oidcConfigured;
  const primarySecret =
    process.env.AUTH_SESSION_SECRET?.trim() ||
    appPassword ||
    process.env.TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.SCHEDULE_SECRET?.trim() ||
    '';

  if (!anyAuthConfigured || (process.env.NODE_ENV === 'production' && !primarySecret)) {
    if (process.env.NODE_ENV === 'production') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'APP_PASSWORD ou AUTH_OIDC_* (+ AUTH_SESSION_SECRET) doit être configuré en production.' },
          { status: 503 }
        );
      }
      return new NextResponse(
        'Accès bloqué : configurez APP_PASSWORD ou AUTH_OIDC_* (+ AUTH_SESSION_SECRET) dans les variables d’environnement.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }
    return NextResponse.next();
  }

  const cookieToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const isValid = await verifyEdgeSessionToken(
    cookieToken,
    primarySecret,
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
