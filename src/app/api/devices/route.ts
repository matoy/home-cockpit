import { NextResponse } from 'next/server';
import { updateDevice } from '@/lib/data-service';
import type { DeviceCategory, DpConfig, EnergyMode } from '@/types';

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string;
      customName?: string | null;
      roomId?: number | null;
      category?: DeviceCategory;
      isMonitored?: boolean;
      excludeFromTotals?: boolean;
      energyMode?: EnergyMode;
      dpConfig?: DpConfig;
    };

    if (!body.id) {
      return NextResponse.json({ error: 'Identifiant appareil requis' }, { status: 400 });
    }

    const { id, ...rest } = body;
    const updated = await updateDevice(id, rest);
    if (!updated) {
      return NextResponse.json({ error: 'Appareil introuvable' }, { status: 404 });
    }

    return NextResponse.json({ device: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur mise à jour appareil';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
