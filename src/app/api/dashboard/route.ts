import { NextResponse } from 'next/server';
import { getDashboardData } from '@/lib/data-service';
import type { TimeRange } from '@/types';

const VALID_RANGES = new Set<TimeRange>(['24h', '7d', '30d', '365d', 'custom']);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawRange = (searchParams.get('range') ?? '24h') as TimeRange;
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const hasValidCustom =
      rawRange === 'custom' &&
      Boolean(fromParam) &&
      Boolean(toParam) &&
      !Number.isNaN(new Date(fromParam!).getTime()) &&
      !Number.isNaN(new Date(toParam!).getTime());

    const range: TimeRange =
      rawRange === 'custom'
        ? hasValidCustom
          ? 'custom'
          : '24h'
        : VALID_RANGES.has(rawRange)
          ? rawRange
          : '24h';
    const roomId = searchParams.get('roomId') ?? 'all';

    const payload = await getDashboardData(
      range,
      roomId,
      hasValidCustom ? fromParam : null,
      hasValidCustom ? toParam : null
    );
    return NextResponse.json(payload);
  } catch (err) {
    console.error('[api/dashboard]', err);
    const message =
      process.env.NODE_ENV === 'production'
        ? 'Erreur serveur'
        : err instanceof Error
          ? err.message
          : 'Erreur serveur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
