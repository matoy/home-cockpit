import { NextResponse } from 'next/server';
import { disconnectGoogleHome } from '@/lib/data-service';

export async function POST() {
  try {
    await disconnectGoogleHome();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Échec de déconnexion Google Home';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
