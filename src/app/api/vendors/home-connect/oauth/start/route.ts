import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { buildOAuthRedirectUrl, getPublicOrigin, requireApiAuth } from '@/lib/http-utils';
import {
  normalizeOAuthReturnTab,
  signHomeConnectOAuthState,
  type OAuthReturnTab,
} from '@/lib/vendors/crypto-store';
import {
  buildHomeConnectAuthorizeUrl,
  getHomeConnectConfig,
} from '@/lib/vendors/home-connect-client';
import type { HomeConnectEnv } from '@/types';

export async function GET(request: Request) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  const origin = getPublicOrigin(request);
  const { searchParams } = new URL(request.url);
  const rawEnv = searchParams.get('env');
  const rawReturnTab = searchParams.get('returnTab');
  const returnTab: OAuthReturnTab = normalizeOAuthReturnTab(rawReturnTab);
  const cfg = getHomeConnectConfig();
  const env: HomeConnectEnv =
    rawEnv === 'prod' || rawEnv === 'simulator' || rawEnv === 'cn' ? rawEnv : cfg.defaultEnv;

  try {
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = signHomeConnectOAuthState({ nonce, env, returnTab });
    const redirectUri = `${origin}/api/vendors/home-connect/oauth/callback`;
    const authUrl = buildHomeConnectAuthorizeUrl({ env, redirectUri, state });

    const response = NextResponse.redirect(authUrl);
    response.cookies.set('hc_oauth_nonce', nonce, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    });
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Erreur configuration OAuth Siemens Home Connect';
    return NextResponse.redirect(
      buildOAuthRedirectUrl(origin, returnTab, { hc_error: message })
    );
  }
}
