import { NextResponse } from 'next/server';
import { disconnectDaikin } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';

export async function POST() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    await disconnectDaikin();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(
      'api/vendors/daikin/disconnect',
      err,
      'Erreur déconnexion Daikin Onecta'
    );
  }
}
