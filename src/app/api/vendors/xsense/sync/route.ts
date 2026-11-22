import { NextResponse } from 'next/server';
import { syncXSenseDevices } from '@/lib/data-service';

export async function POST() {
  try {
    const result = await syncXSenseDevices();
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Échec de synchronisation X-Sense Security';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
