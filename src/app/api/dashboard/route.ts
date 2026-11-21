import { NextResponse } from 'next/server';
import { getDashboardData } from '@/lib/data-service';
import type { TimeRange } from '@/types';

const VALID_RANGES = new Set<TimeRange>(['24h', '7d', '30d', '365d']);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawRange = (searchParams.get('range') ?? '24h') as TimeRange;
    const range: TimeRange = VALID_RANGES.has(rawRange) ? rawRange : '24h';
    const roomId = searchParams.get('roomId') ?? 'all';

    const payload = await getDashboardData(range, roomId);
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
