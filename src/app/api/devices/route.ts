import { NextResponse } from 'next/server';
import { createManualDevice, deleteDevice, deleteDevices, updateDevice } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';
import { asRecord } from '@/lib/utils';
import { isValidVendorId } from '@/lib/vendors/registry';
import type { DeviceCategory, DpConfig, EnergyMode, VendorId } from '@/types';

const VALID_CATEGORIES = new Set<DeviceCategory>([
  'power',
  'climate',
  'contact',
  'hybrid',
  'other',
]);

const VALID_ENERGY_MODES = new Set<EnergyMode>(['hybrid', 'add_ele', 'integration']);

function parseSystemsParam(raw: unknown): VendorId[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const filtered = raw.filter((item): item is VendorId => isValidVendorId(item));
  return filtered.length > 0 ? filtered : undefined;
}

function validateBoundedString(
  raw: unknown,
  maxLen: number,
  fieldLabel: string
): { value: string | null; error?: string } {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  if (typeof raw !== 'string') {
    return { value: null, error: `${fieldLabel} invalide.` };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { value: null };
  if (trimmed.length > maxLen) {
    return { value: null, error: `${fieldLabel} ne doit pas dépasser ${maxLen} caractères.` };
  }
  return { value: trimmed };
}

export async function POST(request: Request) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const nameCheck = validateBoundedString(body.name, 120, 'Le nom de l’appareil');
    if (nameCheck.error) {
      return NextResponse.json({ error: nameCheck.error }, { status: 400 });
    }
    if (!nameCheck.value) {
      return NextResponse.json({ error: 'Le nom de l’appareil est requis.' }, { status: 400 });
    }

    const customNameCheck = validateBoundedString(body.customName, 120, 'Le nom personnalisé');
    if (customNameCheck.error) {
      return NextResponse.json({ error: customNameCheck.error }, { status: 400 });
    }
    const productNameCheck = validateBoundedString(body.productName, 120, 'Le nom produit');
    if (productNameCheck.error) {
      return NextResponse.json({ error: productNameCheck.error }, { status: 400 });
    }
    const ipCheck = validateBoundedString(body.ipAddress, 64, 'L’adresse IP');
    if (ipCheck.error) {
      return NextResponse.json({ error: ipCheck.error }, { status: 400 });
    }
    const macCheck = validateBoundedString(body.macAddress, 32, 'L’adresse MAC');
    if (macCheck.error) {
      return NextResponse.json({ error: macCheck.error }, { status: 400 });
    }

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
      name: nameCheck.value,
      customName: customNameCheck.value,
      productName: productNameCheck.value,
      roomId,
      category,
      primaryVendor,
      systems,
      ipAddress: ipCheck.value,
      macAddress: macCheck.value,
      isOnline: typeof body.isOnline === 'boolean' ? body.isOnline : true,
      isMonitored: typeof body.isMonitored === 'boolean' ? body.isMonitored : true,
      ignoreOfflineAlert:
        typeof body.ignoreOfflineAlert === 'boolean' ? body.ignoreOfflineAlert : false,
      excludeFromTotals:
        typeof body.excludeFromTotals === 'boolean' ? body.excludeFromTotals : false,
    });

    return NextResponse.json({ device }, { status: 201 });
  } catch (err) {
    return apiErrorResponse('api/devices POST', err, 'Erreur création appareil');
  }
}

export async function PATCH(request: Request) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const rawBody = await request.json();
    const body = asRecord(rawBody);
    if (!body) {
      return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
    }

    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) {
      return NextResponse.json({ error: 'Identifiant appareil requis' }, { status: 400 });
    }

    const updates: Parameters<typeof updateDevice>[1] = {};

    if (body.name !== undefined) {
      const nameCheck = validateBoundedString(body.name, 120, 'Le nom de l’appareil');
      if (nameCheck.error) {
        return NextResponse.json({ error: nameCheck.error }, { status: 400 });
      }
      if (!nameCheck.value) {
        return NextResponse.json(
          { error: 'Le nom de l’appareil ne peut pas être vide.' },
          { status: 400 }
        );
      }
      updates.name = nameCheck.value;
    }

    if (body.customName !== undefined) {
      const check = validateBoundedString(body.customName, 120, 'Le nom personnalisé');
      if (check.error) return NextResponse.json({ error: check.error }, { status: 400 });
      updates.customName = check.value;
    }

    if (body.productName !== undefined) {
      const check = validateBoundedString(body.productName, 120, 'Le nom produit');
      if (check.error) return NextResponse.json({ error: check.error }, { status: 400 });
      updates.productName = check.value;
    }

    if (body.ipAddress !== undefined) {
      const check = validateBoundedString(body.ipAddress, 64, 'L’adresse IP');
      if (check.error) return NextResponse.json({ error: check.error }, { status: 400 });
      updates.ipAddress = check.value;
    }

    if (body.macAddress !== undefined) {
      const check = validateBoundedString(body.macAddress, 32, 'L’adresse MAC');
      if (check.error) return NextResponse.json({ error: check.error }, { status: 400 });
      updates.macAddress = check.value;
    }

    if (body.roomId !== undefined) {
      if (body.roomId === null || body.roomId === '') {
        updates.roomId = null;
      } else {
        const roomNum = Number(body.roomId);
        if (!Number.isInteger(roomNum) || roomNum <= 0) {
          return NextResponse.json({ error: 'Identifiant de pièce invalide.' }, { status: 400 });
        }
        updates.roomId = roomNum;
      }
    }

    if (body.category !== undefined) {
      if (
        typeof body.category !== 'string' ||
        !VALID_CATEGORIES.has(body.category as DeviceCategory)
      ) {
        return NextResponse.json({ error: 'Catégorie appareil invalide.' }, { status: 400 });
      }
      updates.category = body.category as DeviceCategory;
    }

    if (body.isOnline !== undefined) {
      if (typeof body.isOnline !== 'boolean') {
        return NextResponse.json({ error: 'Champ isOnline invalide.' }, { status: 400 });
      }
      updates.isOnline = body.isOnline;
    }

    if (body.isMonitored !== undefined) {
      if (typeof body.isMonitored !== 'boolean') {
        return NextResponse.json({ error: 'Champ isMonitored invalide.' }, { status: 400 });
      }
      updates.isMonitored = body.isMonitored;
    }

    if (body.ignoreOfflineAlert !== undefined) {
      if (typeof body.ignoreOfflineAlert !== 'boolean') {
        return NextResponse.json({ error: 'Champ ignoreOfflineAlert invalide.' }, { status: 400 });
      }
      updates.ignoreOfflineAlert = body.ignoreOfflineAlert;
    }

    if (body.excludeFromTotals !== undefined) {
      if (typeof body.excludeFromTotals !== 'boolean') {
        return NextResponse.json({ error: 'Champ excludeFromTotals invalide.' }, { status: 400 });
      }
      updates.excludeFromTotals = body.excludeFromTotals;
    }

    if (body.energyMode !== undefined) {
      if (
        typeof body.energyMode !== 'string' ||
        !VALID_ENERGY_MODES.has(body.energyMode as EnergyMode)
      ) {
        return NextResponse.json({ error: 'Mode énergétique invalide.' }, { status: 400 });
      }
      updates.energyMode = body.energyMode as EnergyMode;
    }

    if (body.dpConfig !== undefined) {
      const dpObj = asRecord(body.dpConfig);
      if (!dpObj) {
        return NextResponse.json({ error: 'Configuration DP invalide.' }, { status: 400 });
      }
      updates.dpConfig = dpObj as DpConfig;
    }

    if (body.primaryVendor !== undefined) {
      if (!isValidVendorId(body.primaryVendor)) {
        return NextResponse.json({ error: 'Système principal invalide.' }, { status: 400 });
      }
      updates.primaryVendor = body.primaryVendor;
    }

    if (body.systems !== undefined) {
      const parsedSystems = parseSystemsParam(body.systems);
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
    return apiErrorResponse('api/devices PATCH', err, 'Erreur mise à jour appareil');
  }
}

export async function DELETE(request: Request) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id')?.trim() ?? '';
    if (id) {
      if (id.length > 160) {
        return NextResponse.json({ error: 'Identifiant appareil invalide.' }, { status: 400 });
      }
      const deleted = await deleteDevice(id);
      if (!deleted) {
        return NextResponse.json({ error: 'Appareil introuvable.' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, deletedCount: 1 });
    }

    const rawBody = await request.json().catch(() => null);
    const body = asRecord(rawBody);
    const rawIds = body && Array.isArray(body.ids) ? body.ids : [];
    const uniqueIds = Array.from(
      new Set(
        rawIds
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0 && item.length <= 160)
      )
    );

    if (uniqueIds.length === 0 || uniqueIds.length > 200) {
      return NextResponse.json(
        { error: 'Liste d’identifiants d’appareils invalide (1 à 200 appareils).' },
        { status: 400 }
      );
    }

    const deletedCount = await deleteDevices(uniqueIds);
    if (deletedCount === 0) {
      return NextResponse.json({ error: 'Aucun appareil correspondant trouvé.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, deletedCount });
  } catch (err) {
    return apiErrorResponse('api/devices DELETE', err, 'Erreur suppression appareil');
  }
}
