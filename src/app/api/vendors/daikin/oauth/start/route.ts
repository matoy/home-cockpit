import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { buildOAuthRedirectUrl, getPublicOrigin } from '@/lib/http-utils';
import {
  normalizeOAuthReturnTab,
  signDaikinOAuthState,
  type OAuthReturnTab,
} from '@/lib/vendors/crypto-store';
import { buildDaikinAuthorizeUrl, getDaikinConfig } from '@/lib/vendors/daikin-client';

export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  const { searchParams } = new URL(request.url);
  const rawReturnTab = searchParams.get('returnTab');
  const returnTab: OAuthReturnTab = normalizeOAuthReturnTab(rawReturnTab);
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
    return NextResponse.redirect(
      buildOAuthRedirectUrl(origin, returnTab, { dk_error: message })
    );
  }
}
