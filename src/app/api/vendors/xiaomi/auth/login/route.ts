import { NextResponse } from 'next/server';
import { saveXiaomiConnection, syncXiaomiDevices } from '@/lib/data-service';
import { loginXiaomiWithCredentials } from '@/lib/vendors/xiaomi-client';

export async function POST(request: Request) {
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
    const message =
      err instanceof Error ? err.message : 'Échec de connexion Xiaomi Home.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
