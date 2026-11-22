import { NextResponse } from 'next/server';
import { syncSomfyDevices } from '@/lib/data-service';

export async function POST() {
  try {
    const result = await syncSomfyDevices();
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Échec de synchronisation Somfy Cloud';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
