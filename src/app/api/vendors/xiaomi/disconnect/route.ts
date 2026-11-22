import { NextResponse } from 'next/server';
import { disconnectXiaomi } from '@/lib/data-service';

export async function POST() {
  try {
    await disconnectXiaomi();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Échec de déconnexion Xiaomi Home';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
