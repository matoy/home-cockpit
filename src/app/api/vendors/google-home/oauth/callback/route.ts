import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { saveGoogleHomeConnection } from '@/lib/data-service';
import { verifyOAuthState } from '@/lib/vendors/crypto-store';
import { exchangeGoogleCodeForTokens } from '@/lib/vendors/google-home-client';

function getPublicOrigin(request: Request): string {
  const fwdHost = request.headers.get('x-forwarded-host');
  const fwdProto = request.headers.get('x-forwarded-proto') || 'https';
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  return new URL(request.url).origin;
}

function redirectWithError(origin: string, message: string): NextResponse {
  const url = new URL('/', origin);
  url.searchParams.set('tab', 'devices');
  url.searchParams.set('gh_error', message);
  const response = NextResponse.redirect(url);
  response.cookies.delete('gh_oauth_nonce');
  return response;
}

export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  const { searchParams } = new URL(request.url);
  const oauthError = searchParams.get('error');
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');

  if (oauthError) {
    return redirectWithError(origin, `Autorisation Google annulée ou refusée (${oauthError}).`);
  }

  if (!code || !stateParam) {
    return redirectWithError(origin, 'Paramètres OAuth Google manquants.');
  }

  const decodedState = verifyOAuthState(stateParam);
  const cookieStore = await cookies();
  const expectedNonce = cookieStore.get('gh_oauth_nonce')?.value;

  if (!decodedState || !expectedNonce || decodedState.nonce !== expectedNonce) {
    return redirectWithError(origin, 'Jeton de sécurité OAuth invalide ou expiré.');
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
    okUrl.searchParams.set('tab', 'devices');
    okUrl.searchParams.set('gh', 'connected');
    okUrl.searchParams.set('gh_mode', decodedState.mode);

    const response = NextResponse.redirect(okUrl);
    response.cookies.delete('gh_oauth_nonce');
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Échec de connexion Google Home';
    return redirectWithError(origin, message);
  }
}
