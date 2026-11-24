import { NextResponse } from 'next/server';
import { saveXiaomiConnection, syncXiaomiDevices } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';
import { loginXiaomiWithCredentials } from '@/lib/vendors/xiaomi-client';

export async function POST(request: Request) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      username?: string;
      password?: string;
      region?: string;
    };

    const res = await loginXiaomiWithCredentials({
      username: body.username,
      password: body.password,
      region: body.region,
    });

    if (res.status === 'requires_2fa') {
      return NextResponse.json({
        ok: true,
        status: 'requires_2fa',
        verifyStateToken: res.verifyStateToken,
        message: res.message,
      });
    }

    await saveXiaomiConnection(res.session);
    const syncRes = await syncXiaomiDevices();
    return NextResponse.json({
      ok: true,
      status: 'connected',
      region: res.session.region,
      ...syncRes,
    });
  } catch (err) {
    return apiErrorResponse(
      'api/vendors/xiaomi/auth/login',
      err,
      'Échec de connexion Xiaomi Home.',
      400
    );
  }
}
