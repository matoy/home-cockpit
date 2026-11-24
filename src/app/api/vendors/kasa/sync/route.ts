import { NextResponse } from 'next/server';
import { syncKasaDevices } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';

export async function POST() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const result = await syncKasaDevices();
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse('api/vendors/kasa/sync', err, 'Échec de synchronisation Kasa Cloud');
  }
}
