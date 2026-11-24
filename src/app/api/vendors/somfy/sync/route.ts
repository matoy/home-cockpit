import { NextResponse } from 'next/server';
import { syncSomfyDevices } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';

export async function POST() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const result = await syncSomfyDevices();
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(
      'api/vendors/somfy/sync',
      err,
      'Échec de synchronisation Somfy Cloud'
    );
  }
}
