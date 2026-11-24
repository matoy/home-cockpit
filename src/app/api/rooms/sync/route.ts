import { NextResponse } from 'next/server';
import { syncRoomsFromVendor } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';
import { isValidVendorId, VENDOR_REGISTRY } from '@/lib/vendors/registry';

export async function POST(request: Request) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const body = (await request.json().catch(() => ({}))) as { vendor?: unknown };
    const rawVendor = body.vendor ?? 'all';

    if (
      rawVendor !== 'all' &&
      (!isValidVendorId(rawVendor) || !VENDOR_REGISTRY[rawVendor].capabilities.syncRooms)
    ) {
      return NextResponse.json(
        {
          error: 'Paramètre vendor invalide ou synchronisation des pièces non supportée.',
        },
        { status: 400 }
      );
    }

    const result = await syncRoomsFromVendor(rawVendor);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return apiErrorResponse('api/rooms/sync', err, 'Échec de synchronisation des pièces.');
  }
}
