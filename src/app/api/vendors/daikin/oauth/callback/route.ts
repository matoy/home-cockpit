import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { saveDaikinConnection } from '@/lib/data-service';
import { normalizeOAuthReturnTab, verifyDaikinOAuthState } from '@/lib/vendors/crypto-store';
import { exchangeDaikinCodeForTokens, getDaikinConfig } from '@/lib/vendors/daikin-client';

function getPublicOrigin(request: Request): string {
  const fwdHost = request.headers.get('x-forwarded-host');
  const fwdProto = request.headers.get('x-forwarded-proto') || 'https';
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const oauthError = searchParams.get('error');

  const signedState = verifyDaikinOAuthState(stateParam);
  const returnTab = normalizeOAuthReturnTab(signedState?.returnTab);

  const failRedirect = (message: string) => {
    const url = new URL('/', origin);
    url.searchParams.set('tab', returnTab);
    url.searchParams.set('dk_error', message);
    return NextResponse.redirect(url);
  };

  if (oauthError) {
    return failRedirect(`Autorisation refusée (${oauthError})`);
  }

  if (!code || !signedState) {
    return failRedirect('Paramètres OAuth Daikin invalides ou expirés.');
  }

  const cookieStore = await cookies();
  const cookieNonce = cookieStore.get('dk_oauth_nonce')?.value;
  if (cookieNonce && cookieNonce !== signedState.nonce) {
    return failRedirect('Vérification anti-CSRF OAuth Daikin échouée.');
  }

  try {
    const cfg = getDaikinConfig();
    const redirectUri =
      signedState.redirectUri || cfg.redirectUri || `${origin}/api/vendors/daikin/oauth/callback`;
    const tokens = await exchangeDaikinCodeForTokens({ code, redirectUri });

    await saveDaikinConnection({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSec: tokens.expiresInSec,
    });

    const okUrl = new URL('/', origin);
    okUrl.searchParams.set('tab', returnTab);
    okUrl.searchParams.set('dk', 'connected');

    const response = NextResponse.redirect(okUrl);
    response.cookies.delete('dk_oauth_nonce');
    return response;
  } catch (err) {
    return failRedirect(
      err instanceof Error ? err.message : 'Échec de connexion OAuth Daikin Onecta'
    );
  }
}
