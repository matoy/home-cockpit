import { NextResponse } from 'next/server';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';
import { getVendorServerPluginBySlug } from '@/lib/services/vendors';
import { getVendorBySlug } from '@/lib/vendors/registry';

/**
 * Route générique de déconnexion pour tout fournisseur implémentant `disconnect()`.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ vendor: string }> }
) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  const { vendor: rawVendor } = await context.params;
  const meta = getVendorBySlug(rawVendor);
  const plugin = getVendorServerPluginBySlug(rawVendor);

  if (!meta || !plugin) {
    return NextResponse.json(
      { error: `Fournisseur inconnu : ${rawVendor}` },
      { status: 404 }
    );
  }

  if (!plugin.disconnect) {
    return NextResponse.json(
      { error: `La déconnexion manuelle n'est pas applicable pour ${meta.label}.` },
      { status: 400 }
    );
  }

  try {
    await plugin.disconnect();
    return NextResponse.json({ ok: true, vendor: meta.id });
  } catch (err) {
    return apiErrorResponse(
      `api/vendors/${meta.slug}/disconnect`,
      err,
      `Échec de déconnexion ${meta.label}.`
    );
  }
}
