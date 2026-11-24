import { NextResponse } from 'next/server';
import { saveXiaomiConnection, syncXiaomiDevices } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';
import { verifyXiaomi2faCode } from '@/lib/vendors/xiaomi-client';

export async function POST(request: Request) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      verifyStateToken?: string;
      code?: string;
    };
    const verifyStateToken = body.verifyStateToken?.trim();
    const code = body.code?.trim();

    if (!verifyStateToken || !code) {
      return NextResponse.json(
        { error: 'Le jeton de session 2FA et le code de vérification sont requis.' },
        { status: 400 }
      );
    }

    const session = await verifyXiaomi2faCode({ verifyStateToken, code });
    await saveXiaomiConnection(session);
    const syncRes = await syncXiaomiDevices();
    return NextResponse.json({
      ok: true,
      status: 'connected',
      region: session.region,
      ...syncRes,
    });
  } catch (err) {
    return apiErrorResponse(
      'api/vendors/xiaomi/auth/verify-2fa',
      err,
      'Échec de validation 2FA Xiaomi Home.',
      400
    );
  }
}
