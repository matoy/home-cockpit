import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { saveGoogleHomeConnection } from '@/lib/data-service';
import { buildOAuthRedirectUrl, getPublicOrigin } from '@/lib/http-utils';
import {
  normalizeOAuthReturnTab,
  verifyOAuthState,
  type OAuthReturnTab,
} from '@/lib/vendors/crypto-store';
import { exchangeGoogleCodeForTokens } from '@/lib/vendors/google-home-client';

function redirectWithError(
  origin: string,
  message: string,
  returnTab: OAuthReturnTab = 'systems'
): NextResponse {
  const response = NextResponse.redirect(
    buildOAuthRedirectUrl(origin, returnTab, { gh_error: message })
  );
  response.cookies.delete('gh_oauth_nonce');
  return response;
}

export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  const { searchParams } = new URL(request.url);
  const oauthError = searchParams.get('error');
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const decodedState = verifyOAuthState(stateParam);
  const returnTab: OAuthReturnTab = normalizeOAuthReturnTab(decodedState?.returnTab);

  if (oauthError) {
    return redirectWithError(
      origin,
      `Autorisation Google annulée ou refusée (${oauthError}).`,
      returnTab
    );
  }

  if (!code || !stateParam) {
    return redirectWithError(origin, 'Paramètres OAuth Google manquants.', returnTab);
  }

  const cookieStore = await cookies();
  const expectedNonce = cookieStore.get('gh_oauth_nonce')?.value;

  if (!decodedState || !expectedNonce || decodedState.nonce !== expectedNonce) {
    return redirectWithError(origin, 'Jeton de sécurité OAuth invalide ou expiré.', returnTab);
  }

  try {
    const redirectUri = `${origin}/api/vendors/google-home/oauth/callback`;
    const tokens = await exchangeGoogleCodeForTokens({ code, redirectUri });

    await saveGoogleHomeConnection({
      mode: decodedState.mode,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSec: tokens.expiresInSec,
      config: {},
    });

    const okUrl = new URL('/', origin);
    okUrl.searchParams.set('tab', returnTab);
    okUrl.searchParams.set('gh', 'connected');
    okUrl.searchParams.set('gh_mode', decodedState.mode);

    const response = NextResponse.redirect(okUrl);
    response.cookies.delete('gh_oauth_nonce');
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Échec de connexion Google Home';
    return redirectWithError(origin, message, returnTab);
  }
}
