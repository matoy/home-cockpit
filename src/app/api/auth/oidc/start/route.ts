import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { OIDC_TX_COOKIE_NAME } from '@/lib/auth-constants';
import {
  discoverOidcProvider,
  generatePkcePair,
  getOidcConfig,
  sanitizeReturnTo,
  signOidcLoginState,
  signOidcTransaction,
} from '@/lib/auth-oidc';
import { getPublicOrigin } from '@/lib/http-utils';

export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  const { searchParams } = new URL(request.url);
  const returnTo = sanitizeReturnTo(searchParams.get('returnTo'));
  const cfg = getOidcConfig();

  if (!cfg.configured) {
    return NextResponse.redirect(new URL('/login?error=oidc_config', origin));
  }

  try {
    const discovery = await discoverOidcProvider(cfg.issuer);
    const redirectUri = cfg.redirectUri || `${origin}/api/auth/oidc/callback`;
    const nonce = crypto.randomBytes(16).toString('hex');
    const oidcNonce = crypto.randomBytes(16).toString('hex');
    const { codeVerifier, codeChallenge } = generatePkcePair();

    const state = signOidcLoginState({ nonce, returnTo });
    const txCookieValue = signOidcTransaction({
      nonce,
      oidcNonce,
      codeVerifier,
      redirectUri,
      returnTo,
    });

    const authorizeUrl = new URL(discovery.authorization_endpoint);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', cfg.clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', cfg.scopes);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('nonce', oidcNonce);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('prompt', 'select_account');

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(OIDC_TX_COOKIE_NAME, txCookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    });
    return response;
  } catch (err) {
    console.error('[api/auth/oidc/start]', err);
    return NextResponse.redirect(new URL('/login?error=oidc_failed', origin));
  }
}
