import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout', '/api/schedule/collect'];

async function computeExpectedToken(appPassword: string, scheduleSecret: string): Promise<string> {
  const enc = new TextEncoder();
  const secretHashBuf = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(`${appPassword}:${scheduleSecret || 'tuya-power-temp-salt'}`)
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

  const payload = 'authenticated-v1';
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const sigHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${payload}.${sigHex}`;
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

  const cookieToken = request.cookies.get('tuya_session')?.value;
  const expectedToken = await computeExpectedToken(
    appPassword,
    process.env.SCHEDULE_SECRET?.trim() ?? ''
  );

  if (cookieToken && constantTimeEqual(cookieToken, expectedToken)) {
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
