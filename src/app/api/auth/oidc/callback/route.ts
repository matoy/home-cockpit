import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import { OIDC_TX_COOKIE_NAME, SESSION_TTL_SECONDS } from '@/lib/auth-constants';
import {
  authorizeOidcIdentity,
  exchangeOidcCodeAndVerify,
  getOidcConfig,
  verifyOidcLoginState,
  verifyOidcTransaction,
} from '@/lib/auth-oidc';
import { getPublicOrigin, safeEqualString } from '@/lib/http-utils';

function redirectLoginError(origin: string, code: string): NextResponse {
  const url = new URL('/login', origin);
  url.searchParams.set('error', code);
  const res = NextResponse.redirect(url);
  res.cookies.delete(OIDC_TX_COOKIE_NAME);
  return res;
}

export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  const { searchParams } = new URL(request.url);
  const oauthError = searchParams.get('error');
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');

  if (oauthError) {
    return redirectLoginError(origin, 'oidc_denied');
  }

  const cfg = getOidcConfig();
  if (!cfg.configured) {
    return redirectLoginError(origin, 'oidc_config');
  }

  if (!code || !stateParam) {
    return redirectLoginError(origin, 'oidc_csrf');
  }

  const cookieStore = await cookies();
  const txToken = cookieStore.get(OIDC_TX_COOKIE_NAME)?.value;
  const decodedState = verifyOidcLoginState(stateParam);
  const decodedTx = verifyOidcTransaction(txToken);

  if (!decodedState || !decodedTx || !safeEqualString(decodedState.nonce, decodedTx.nonce)) {
    return redirectLoginError(origin, 'oidc_csrf');
  }

  try {
    const identity = await exchangeOidcCodeAndVerify({
      code,
      codeVerifier: decodedTx.codeVerifier,
      redirectUri: decodedTx.redirectUri,
      expectedNonce: decodedTx.oidcNonce,
    });

    const decision = authorizeOidcIdentity(identity, cfg);
    if (!decision.allowed) {
      return redirectLoginError(origin, decision.reason);
    }

    const sessionToken = createSessionToken(Math.floor(Date.now() / 1000), {
      email: identity.email,
      name: identity.name,
      provider: cfg.providerName,
      sub: identity.sub,
    });

    const targetUrl = new URL(decodedTx.returnTo || '/', origin);
    const response = NextResponse.redirect(targetUrl);
    response.cookies.delete(OIDC_TX_COOKIE_NAME);
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
    return response;
  } catch (err) {
    console.error('[api/auth/oidc/callback]', err);
    return redirectLoginError(origin, 'oidc_failed');
  }
}
