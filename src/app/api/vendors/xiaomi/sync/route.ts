import { NextResponse } from 'next/server';
import { syncXiaomiDevices } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';

export async function POST() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const result = await syncXiaomiDevices();
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(
      'api/vendors/xiaomi/sync',
      err,
      'Échec de synchronisation Xiaomi Home'
    );
  }
}
