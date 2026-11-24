import { NextResponse } from 'next/server';
import { syncRoomsFromVendor } from '@/lib/data-service';
import { isValidVendorId, VENDOR_REGISTRY } from '@/lib/vendors/registry';

export async function POST(request: Request) {
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
    const message =
      err instanceof Error ? err.message : 'Échec de synchronisation des pièces.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
