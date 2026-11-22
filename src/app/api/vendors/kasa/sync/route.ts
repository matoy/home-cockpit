import { NextResponse } from 'next/server';
import { syncKasaDevices } from '@/lib/data-service';

export async function POST() {
  try {
    const result = await syncKasaDevices();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Échec de synchronisation Kasa Cloud';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
