import { NextResponse } from 'next/server';
import { syncXiaomiDevices } from '@/lib/data-service';

export async function POST() {
  try {
    const result = await syncXiaomiDevices();
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Échec de synchronisation Xiaomi Home';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
