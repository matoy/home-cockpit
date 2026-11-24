import { NextResponse } from 'next/server';
import { syncHomeConnectDevices } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';

export async function POST() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const result = await syncHomeConnectDevices();
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(
      'api/vendors/home-connect/sync',
      err,
      'Échec de synchronisation Siemens Home Connect'
    );
  }
}
