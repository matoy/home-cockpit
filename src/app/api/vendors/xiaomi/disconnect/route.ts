import { NextResponse } from 'next/server';
import { disconnectXiaomi } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';

export async function POST() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    await disconnectXiaomi();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(
      'api/vendors/xiaomi/disconnect',
      err,
      'Échec de déconnexion Xiaomi Home'
    );
  }
}
