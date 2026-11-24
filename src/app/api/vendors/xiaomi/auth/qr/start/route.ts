import { NextResponse } from 'next/server';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';
import { startXiaomiQrLogin } from '@/lib/vendors/xiaomi-client';

export async function POST(request: Request) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const body = (await request.json().catch(() => ({}))) as { region?: string };
    const result = await startXiaomiQrLogin(body.region);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiErrorResponse(
      'api/vendors/xiaomi/auth/qr/start',
      err,
      'Impossible de générer le QR Code Xiaomi Home.'
    );
  }
}
