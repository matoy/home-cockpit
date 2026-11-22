import { NextResponse } from 'next/server';
import { startXiaomiQrLogin } from '@/lib/vendors/xiaomi-client';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { region?: string };
    const result = await startXiaomiQrLogin(body.region);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Impossible de générer le QR Code Xiaomi Home.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
