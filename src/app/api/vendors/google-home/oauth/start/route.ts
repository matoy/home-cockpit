import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { buildOAuthRedirectUrl, getPublicOrigin } from '@/lib/http-utils';
import {
  normalizeOAuthReturnTab,
  signOAuthState,
  type OAuthReturnTab,
} from '@/lib/vendors/crypto-store';
import {
  buildGoogleOAuthAuthorizeUrl,
  getGoogleHomeConfig,
} from '@/lib/vendors/google-home-client';
import type { GoogleHomeMode } from '@/types';

export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  const { searchParams } = new URL(request.url);
  const rawMode = searchParams.get('mode');
  const rawReturnTab = searchParams.get('returnTab');
  const returnTab: OAuthReturnTab = normalizeOAuthReturnTab(rawReturnTab);
  const cfg = getGoogleHomeConfig();
  const mode: GoogleHomeMode =
    rawMode === 'mcp' || rawMode === 'sdm' ? rawMode : cfg.defaultMode;

  try {
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = signOAuthState({ nonce, mode, returnTab });
    const redirectUri = `${origin}/api/vendors/google-home/oauth/callback`;
    const authUrl = buildGoogleOAuthAuthorizeUrl({ mode, redirectUri, state });

    const response = NextResponse.redirect(authUrl);
    response.cookies.set('gh_oauth_nonce', nonce, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur configuration OAuth Google Home';
    return NextResponse.redirect(
      buildOAuthRedirectUrl(origin, returnTab, { gh_error: message })
    );
  }
}
