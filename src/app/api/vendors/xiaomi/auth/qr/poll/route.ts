import { NextResponse } from 'next/server';
import { saveXiaomiConnection, syncXiaomiDevices } from '@/lib/data-service';
import { pollXiaomiQrLogin } from '@/lib/vendors/xiaomi-client';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { qrStateToken?: string };
    const qrStateToken = body.qrStateToken?.trim();
    if (!qrStateToken) {
      return NextResponse.json(
        { error: 'Paramètre qrStateToken manquant.' },
        { status: 400 }
      );
    }

    const res = await pollXiaomiQrLogin(qrStateToken);
    if (res.status !== 'connected') {
      return NextResponse.json({ ok: true, ...res });
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
      err instanceof Error ? err.message : 'Erreur lors de la vérification du QR Code Xiaomi.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
