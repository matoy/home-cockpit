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

export async function middleware(request: NextRequest) {
  const appPassword = process.env.APP_PASSWORD?.trim();
  if (!appPassword) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return NextResponse.next();
  }

  const cookieToken = request.cookies.get('tuya_session')?.value;
  const expectedToken = await computeExpectedToken(
    appPassword,
    process.env.SCHEDULE_SECRET?.trim() ?? ''
  );

  if (cookieToken && cookieToken === expectedToken) {
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
