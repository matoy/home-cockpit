import { NextResponse } from 'next/server';
import { saveDaikinConnection, syncDaikinDevices } from '@/lib/data-service';
import { getPublicOrigin } from '@/lib/http-utils';
import { verifyDaikinOAuthState } from '@/lib/vendors/crypto-store';
import {
  exchangeDaikinCodeForTokens,
  extractCodeFromRedirectInput,
  getDaikinConfig,
} from '@/lib/vendors/daikin-client';

export async function POST(request: Request) {
  try {
    const origin = getPublicOrigin(request);
    const body = (await request.json()) as { input?: string; redirectUri?: string };
    const rawInput = body.input ?? '';
    const { code, state } = extractCodeFromRedirectInput(rawInput);

    const cfg = getDaikinConfig();
    const signedState = state ? verifyDaikinOAuthState(state) : null;
    const redirectUri =
      body.redirectUri?.trim() ||
      signedState?.redirectUri ||
      cfg.redirectUri ||
      `${origin}/api/vendors/daikin/oauth/callback`;

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
    const status = message.includes('Collez') || message.includes('introuvable') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
