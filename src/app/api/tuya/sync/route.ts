import { NextResponse } from 'next/server';
import { syncTuyaDevices } from '@/lib/data-service';

export async function POST() {
  try {
    const result = await syncTuyaDevices();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Échec de synchronisation Tuya';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
