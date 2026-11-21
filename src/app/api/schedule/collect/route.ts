import { NextResponse } from 'next/server';
import { isRequestAuthenticated, verifyScheduleSecret } from '@/lib/auth';
import { runCollection } from '@/lib/data-service';

async function handleScheduleCollect(request: Request, trigger: 'schedule' | 'manual') {
  const hasSecret = verifyScheduleSecret(request);
  const hasSession = await isRequestAuthenticated();

  if (!hasSecret && !hasSession) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  try {
    const log = await runCollection(trigger);
    return NextResponse.json({ ok: log.status === 'success', log }, { status: log.status === 'success' ? 200 : 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur de collecte';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleScheduleCollect(request, 'schedule');
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const trigger = searchParams.get('trigger') === 'manual' ? 'manual' : 'schedule';
  return handleScheduleCollect(request, trigger);
}
