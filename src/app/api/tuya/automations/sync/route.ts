import { NextResponse } from 'next/server';
import { syncTuyaAutomations } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';

export async function POST() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const result = await syncTuyaAutomations();
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(
      'api/tuya/automations/sync',
      err,
      'Échec de synchronisation des scénarios'
    );
  }
}
