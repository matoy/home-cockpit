import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { saveHomeConnectConnection } from '@/lib/data-service';
import { buildOAuthRedirectUrl, getPublicOrigin } from '@/lib/http-utils';
import {
  normalizeOAuthReturnTab,
  verifyHomeConnectOAuthState,
  type OAuthReturnTab,
} from '@/lib/vendors/crypto-store';
import { exchangeHomeConnectCodeForTokens } from '@/lib/vendors/home-connect-client';

function redirectWithError(
  origin: string,
  message: string,
  returnTab: OAuthReturnTab = 'systems'
): NextResponse {
  const response = NextResponse.redirect(
    buildOAuthRedirectUrl(origin, returnTab, { hc_error: message })
  );
  response.cookies.delete('hc_oauth_nonce');
  return response;
}

export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  const { searchParams } = new URL(request.url);
  const oauthError = searchParams.get('error');
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const decodedState = verifyHomeConnectOAuthState(stateParam);
  const returnTab: OAuthReturnTab = normalizeOAuthReturnTab(decodedState?.returnTab);

  if (oauthError) {
    return redirectWithError(
      origin,
      `Autorisation Home Connect annulée ou refusée (${oauthError}).`,
      returnTab
    );
  }

  if (!code || !stateParam) {
    return redirectWithError(
      origin,
      'Paramètres OAuth Siemens Home Connect manquants.',
      returnTab
    );
  }

  const cookieStore = await cookies();
  const expectedNonce = cookieStore.get('hc_oauth_nonce')?.value;

  if (!decodedState || !expectedNonce || decodedState.nonce !== expectedNonce) {
    return redirectWithError(
      origin,
      'Jeton de sécurité OAuth Home Connect invalide ou expiré.',
      returnTab
    );
  }

  try {
    const redirectUri = `${origin}/api/vendors/home-connect/oauth/callback`;
    const tokens = await exchangeHomeConnectCodeForTokens({
      code,
      redirectUri,
      env: decodedState.env,
    });

    await saveHomeConnectConnection({
      env: decodedState.env,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSec: tokens.expiresInSec,
    });

    const okUrl = new URL('/', origin);
    okUrl.searchParams.set('tab', returnTab);
    okUrl.searchParams.set('hc', 'connected');
    okUrl.searchParams.set('hc_env', decodedState.env);

    const response = NextResponse.redirect(okUrl);
    response.cookies.delete('hc_oauth_nonce');
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Échec de connexion Siemens Home Connect';
    return redirectWithError(origin, message, returnTab);
  }
}
