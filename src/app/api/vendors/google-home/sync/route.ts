import { NextResponse } from 'next/server';
import { syncGoogleHomeDevices } from '@/lib/data-service';

export async function POST() {
  try {
    const result = await syncGoogleHomeDevices();
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Échec de synchronisation Google Home';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
