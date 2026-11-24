import { NextResponse } from 'next/server';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';
import { syncConsoApi } from '@/lib/services/vendors/conso-api-sync';

export async function POST() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const result = await syncConsoApi({ trigger: 'manual' });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(
      'api/vendors/conso-api/sync',
      err,
      'Échec de synchronisation Conso API'
    );
  }
}
