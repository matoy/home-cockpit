import { NextResponse } from 'next/server';
import { syncHomeConnectDevices } from '@/lib/data-service';

export async function POST() {
  try {
    const result = await syncHomeConnectDevices();
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Échec de synchronisation Siemens Home Connect';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
