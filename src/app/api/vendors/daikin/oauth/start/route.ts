import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { signDaikinOAuthState } from '@/lib/vendors/crypto-store';
import { buildDaikinAuthorizeUrl, getDaikinConfig } from '@/lib/vendors/daikin-client';

function getPublicOrigin(request: Request): string {
  const fwdHost = request.headers.get('x-forwarded-host');
  const fwdProto = request.headers.get('x-forwarded-proto') || 'https';
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  const { searchParams } = new URL(request.url);
  const rawReturnTab = searchParams.get('returnTab');
  const returnTab: 'devices' | 'rooms' = rawReturnTab === 'rooms' ? 'rooms' : 'devices';
  const cfg = getDaikinConfig();

  try {
    const redirectUri = cfg.redirectUri || `${origin}/api/vendors/daikin/oauth/callback`;
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = signDaikinOAuthState({ nonce, returnTab, redirectUri });
    const authUrl = buildDaikinAuthorizeUrl({ redirectUri, state });

    const response = NextResponse.redirect(authUrl);
    response.cookies.set('dk_oauth_nonce', nonce, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    });
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Erreur configuration OAuth Daikin Onecta';
    const failUrl = new URL('/', origin);
    failUrl.searchParams.set('tab', returnTab);
    failUrl.searchParams.set('dk_error', message);
    return NextResponse.redirect(failUrl);
  }
}
