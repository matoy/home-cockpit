import { NextResponse } from 'next/server';
import { syncDaikinDevices } from '@/lib/data-service';

export async function POST() {
  try {
    const result = await syncDaikinDevices();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Erreur lors de la synchronisation Daikin Onecta',
      },
      { status: 500 }
    );
  }
}
