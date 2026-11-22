import { NextResponse } from 'next/server';
import { disconnectDaikin } from '@/lib/data-service';

export async function POST() {
  try {
    await disconnectDaikin();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Erreur déconnexion Daikin Onecta',
      },
      { status: 500 }
    );
  }
}
