import { NextResponse } from 'next/server';
import { syncRoomsFromVendor } from '@/lib/data-service';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { vendor?: unknown };
    const rawVendor = body.vendor ?? 'all';

    if (
      rawVendor !== 'tuya' &&
      rawVendor !== 'kasa' &&
      rawVendor !== 'somfy' &&
      rawVendor !== 'xiaomi' &&
      rawVendor !== 'google_home' &&
      rawVendor !== 'all'
    ) {
      return NextResponse.json(
        {
          error:
            'Paramètre vendor invalide (attendu : tuya, kasa, somfy, xiaomi, google_home ou all).',
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
