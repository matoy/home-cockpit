import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { signHomeConnectOAuthState } from '@/lib/vendors/crypto-store';
import {
  buildHomeConnectAuthorizeUrl,
  getHomeConnectConfig,
} from '@/lib/vendors/home-connect-client';
import type { HomeConnectEnv } from '@/types';

function getPublicOrigin(request: Request): string {
  const fwdHost = request.headers.get('x-forwarded-host');
  const fwdProto = request.headers.get('x-forwarded-proto') || 'https';
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  const { searchParams } = new URL(request.url);
  const rawEnv = searchParams.get('env');
  const rawReturnTab = searchParams.get('returnTab');
  const returnTab: 'devices' | 'rooms' = rawReturnTab === 'rooms' ? 'rooms' : 'devices';
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
    const failUrl = new URL('/', origin);
    failUrl.searchParams.set('tab', returnTab);
    failUrl.searchParams.set('hc_error', message);
    return NextResponse.redirect(failUrl);
  }
}
