import { NextResponse } from 'next/server';
import { syncTuyaDevices } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';

export async function POST() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const result = await syncTuyaDevices();
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse('api/tuya/sync', err, 'Échec de synchronisation Tuya');
  }
}
