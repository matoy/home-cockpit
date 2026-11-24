import { NextResponse } from 'next/server';
import { syncDaikinDevices } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';

export async function POST() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const result = await syncDaikinDevices();
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(
      'api/vendors/daikin/sync',
      err,
      'Erreur lors de la synchronisation Daikin Onecta'
    );
  }
}
