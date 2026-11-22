import { NextResponse } from 'next/server';
import { disconnectHomeConnect } from '@/lib/data-service';

export async function POST() {
  try {
    await disconnectHomeConnect();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Échec de déconnexion Siemens Home Connect';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
