import { NextResponse } from 'next/server';
import { disconnectGoogleHome } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';

export async function POST() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    await disconnectGoogleHome();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(
      'api/vendors/google-home/disconnect',
      err,
      'Échec de déconnexion Google Home'
    );
  }
}
