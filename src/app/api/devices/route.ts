import { NextResponse } from 'next/server';
import { createManualDevice, deleteManualDevice, updateDevice } from '@/lib/data-service';
import { isValidVendorId } from '@/lib/vendors/registry';
import type { DeviceCategory, DpConfig, EnergyMode, VendorId } from '@/types';

const VALID_CATEGORIES = new Set<DeviceCategory>([
  'power',
  'climate',
  'contact',
  'hybrid',
  'other',
]);

function parseSystemsParam(raw: unknown): VendorId[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const filtered = raw.filter((item): item is VendorId => isValidVendorId(item));
  return filtered.length > 0 ? filtered : undefined;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Le nom de l’appareil est requis.' }, { status: 400 });
    }

    const customName =
      typeof body.customName === 'string' && body.customName.trim() ? body.customName.trim() : null;
    const productName =
      typeof body.productName === 'string' && body.productName.trim()
        ? body.productName.trim()
        : null;
    const ipAddress =
      typeof body.ipAddress === 'string' && body.ipAddress.trim() ? body.ipAddress.trim() : null;
    const macAddress =
      typeof body.macAddress === 'string' && body.macAddress.trim() ? body.macAddress.trim() : null;

    let roomId: number | null = null;
    if (body.roomId !== undefined && body.roomId !== null && body.roomId !== '') {
      const n = Number(body.roomId);
      if (!Number.isInteger(n) || n <= 0) {
        return NextResponse.json({ error: 'Identifiant de pièce invalide.' }, { status: 400 });
      }
      roomId = n;
    }

    const category: DeviceCategory =
      typeof body.category === 'string' && VALID_CATEGORIES.has(body.category as DeviceCategory)
        ? (body.category as DeviceCategory)
        : 'other';

    const primaryVendor: VendorId = isValidVendorId(body.primaryVendor)
      ? body.primaryVendor
      : 'google_home';
    const systems = parseSystemsParam(body.systems) ?? [primaryVendor];

    const device = await createManualDevice({
      name,
      customName,
      productName,
      roomId,
      category,
      primaryVendor,
      systems,
      ipAddress,
      macAddress,
      isOnline: typeof body.isOnline === 'boolean' ? body.isOnline : true,
      isMonitored: typeof body.isMonitored === 'boolean' ? body.isMonitored : true,
      excludeFromTotals:
        typeof body.excludeFromTotals === 'boolean' ? body.excludeFromTotals : false,
    });

    return NextResponse.json({ device }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur création appareil';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string;
      name?: string;
      customName?: string | null;
      productName?: string | null;
      ipAddress?: string | null;
      macAddress?: string | null;
      roomId?: number | null;
      category?: DeviceCategory;
      isOnline?: boolean;
      isMonitored?: boolean;
      excludeFromTotals?: boolean;
      energyMode?: EnergyMode;
      dpConfig?: DpConfig;
      primaryVendor?: VendorId;
      systems?: VendorId[];
    };

    if (!body.id) {
      return NextResponse.json({ error: 'Identifiant appareil requis' }, { status: 400 });
    }

    const { id, name, primaryVendor, systems, category, ...rest } = body;
    const updates: Parameters<typeof updateDevice>[1] = { ...rest };

    if (name !== undefined) {
      const trimmed = typeof name === 'string' ? name.trim() : '';
      if (!trimmed) {
        return NextResponse.json({ error: 'Le nom de l’appareil ne peut pas être vide.' }, { status: 400 });
      }
      updates.name = trimmed;
    }

    if (category !== undefined && VALID_CATEGORIES.has(category)) {
      updates.category = category;
    }

    if (primaryVendor !== undefined) {
      if (!isValidVendorId(primaryVendor)) {
        return NextResponse.json({ error: 'Système principal invalide.' }, { status: 400 });
      }
      updates.primaryVendor = primaryVendor;
    }

    if (systems !== undefined) {
      const parsedSystems = parseSystemsParam(systems);
      if (!parsedSystems) {
        return NextResponse.json({ error: 'Liste de systèmes invalide.' }, { status: 400 });
      }
      updates.systems = parsedSystems;
    }

    const updated = await updateDevice(id, updates);
    if (!updated) {
      return NextResponse.json({ error: 'Appareil introuvable' }, { status: 404 });
    }

    return NextResponse.json({ device: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur mise à jour appareil';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id')?.trim() ?? '';
    if (!id || !id.startsWith('manual_')) {
      return NextResponse.json(
        { error: 'Seuls les appareils déclarés manuellement (manual_...) peuvent être supprimés.' },
        { status: 400 }
      );
    }

    const deleted = await deleteManualDevice(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Appareil introuvable.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur suppression appareil';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
