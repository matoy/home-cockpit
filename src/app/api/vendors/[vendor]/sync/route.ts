import { NextResponse } from 'next/server';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';
import { getVendorServerPluginBySlug } from '@/lib/services/vendors';
import { getVendorBySlug } from '@/lib/vendors/registry';

/**
 * Route générique permettant de synchroniser n'importe quel fournisseur déclaré
 * dans `VENDOR_REGISTRY` et `VENDOR_SERVER_PLUGINS` sans route dédiée.
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

  try {
    const result = await plugin.syncDevices();
    return NextResponse.json({ ok: true, vendor: meta.id, ...result });
  } catch (err) {
    return apiErrorResponse(
      `api/vendors/${meta.slug}/sync`,
      err,
      `Échec de synchronisation ${meta.label}.`
    );
  }
}
