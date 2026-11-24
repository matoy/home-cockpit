import { NextResponse } from 'next/server';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';
import { saveConsoApiConfig } from '@/lib/services/vendors/conso-api-sync';
import { parseSubscribedKva } from '@/lib/vendors/conso-api-client';

export async function POST(request: Request) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      prm?: unknown;
      token?: unknown;
      subscribedKva?: unknown;
    };

    const prm = typeof body.prm === 'string' ? body.prm.trim() : '';
    const token = typeof body.token === 'string' ? body.token.trim() : undefined;
    const subscribedKva = parseSubscribedKva(body.subscribedKva);

    const saved = await saveConsoApiConfig({ prm, token, subscribedKva });
    return NextResponse.json({
      ok: true,
      prm: saved.prm,
      subscribedKva: saved.subscribedKva,
    });
  } catch (err) {
    return apiErrorResponse(
      'api/vendors/conso-api/config',
      err,
      'Échec de configuration Conso API'
    );
  }
}
