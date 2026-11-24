import { NextResponse } from 'next/server';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';
import { disconnectConsoApi } from '@/lib/services/vendors/conso-api-sync';

export async function POST() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    await disconnectConsoApi();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(
      'api/vendors/conso-api/disconnect',
      err,
      'Échec de déconnexion Conso API'
    );
  }
}
