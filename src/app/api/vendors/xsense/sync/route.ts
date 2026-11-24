import { NextResponse } from 'next/server';
import { syncXSenseDevices } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';

export async function POST() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const result = await syncXSenseDevices();
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(
      'api/vendors/xsense/sync',
      err,
      'Échec de synchronisation X-Sense Security'
    );
  }
}
