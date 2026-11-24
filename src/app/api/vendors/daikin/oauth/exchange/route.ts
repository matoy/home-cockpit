import { NextResponse } from 'next/server';
import { saveDaikinConnection, syncDaikinDevices } from '@/lib/data-service';
import { apiErrorResponse, getPublicOrigin, requireApiAuth } from '@/lib/http-utils';
import { verifyDaikinOAuthState } from '@/lib/vendors/crypto-store';
import {
  exchangeDaikinCodeForTokens,
  extractCodeFromRedirectInput,
  getDaikinConfig,
} from '@/lib/vendors/daikin-client';

function isAllowedRedirectUri(
  candidateRaw: string,
  origin: string,
  configuredRedirectUri?: string,
  signedRedirectUri?: string
): string | null {
  try {
    const parsed = new URL(candidateRaw);
    const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalHost)) {
      return null;
    }

    const expectedOrigin = new URL(origin).origin;
    const allowedExact = new Set<string>(
      [configuredRedirectUri, signedRedirectUri].filter((u): u is string => Boolean(u))
    );

    if (parsed.origin === expectedOrigin || allowedExact.has(parsed.toString())) {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const origin = getPublicOrigin(request);
    const body = (await request.json()) as { input?: string; redirectUri?: string };
    const rawInput = typeof body.input === 'string' ? body.input : '';
    const { code, state } = extractCodeFromRedirectInput(rawInput);

    const cfg = getDaikinConfig();
    const signedState = state ? verifyDaikinOAuthState(state) : null;
    const defaultRedirectUri =
      signedState?.redirectUri || cfg.redirectUri || `${origin}/api/vendors/daikin/oauth/callback`;

    let redirectUri = defaultRedirectUri;
    if (typeof body.redirectUri === 'string' && body.redirectUri.trim()) {
      const validated = isAllowedRedirectUri(
        body.redirectUri.trim(),
        origin,
        cfg.redirectUri ?? undefined,
        signedState?.redirectUri
      );
      if (!validated) {
        return NextResponse.json(
          { error: 'URL de redirection OAuth Daikin non autorisée.' },
          { status: 400 }
        );
      }
      redirectUri = validated;
    }

    const tokens = await exchangeDaikinCodeForTokens({ code, redirectUri });
    await saveDaikinConnection({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSec: tokens.expiresInSec,
    });

    const syncResult = await syncDaikinDevices();
    return NextResponse.json({
      ok: true,
      message: `Daikin Onecta connecté. ${syncResult.message}`,
      sync: syncResult,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Erreur échange OAuth Daikin Onecta';
    const isClientErr = message.includes('Collez') || message.includes('introuvable');
    return apiErrorResponse(
      'vendors/daikin/oauth/exchange',
      err,
      'Erreur échange OAuth Daikin Onecta',
      isClientErr ? 400 : 500
    );
  }
}
