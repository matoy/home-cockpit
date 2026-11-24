import { NextResponse } from 'next/server';
import { disconnectHomeConnect } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';

export async function POST() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    await disconnectHomeConnect();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(
      'api/vendors/home-connect/disconnect',
      err,
      'Échec de déconnexion Siemens Home Connect'
    );
  }
}
