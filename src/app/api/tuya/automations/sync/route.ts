import { NextResponse } from 'next/server';
import { syncTuyaAutomations } from '@/lib/data-service';

export async function POST() {
  try {
    const result = await syncTuyaAutomations();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Échec de synchronisation des scénarios';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
