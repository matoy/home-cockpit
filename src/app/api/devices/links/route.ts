import { NextResponse } from 'next/server';
import {
  bulkMergeDevices,
  bulkToggleDeviceSystemTag,
  mergeDevices,
  toggleDeviceSystemTag,
  unlinkDeviceVendor,
} from '@/lib/data-service';
import { isValidVendorId } from '@/lib/vendors/registry';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      deviceId?: string;
      deviceIds?: unknown;
      vendor?: string;
      enabled?: boolean;
      targetDeviceId?: string;
      sourceDeviceId?: string;
      pairs?: unknown;
    };

    if (body.action === 'toggle_system') {
      if (!body.deviceId || !isValidVendorId(body.vendor) || typeof body.enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'Paramètres invalides pour toggle_system.' },
          { status: 400 }
        );
      }
      const device = await toggleDeviceSystemTag({
        deviceId: body.deviceId,
        vendor: body.vendor,
        enabled: body.enabled,
      });
      if (!device) {
        return NextResponse.json({ error: 'Appareil introuvable' }, { status: 404 });
      }
      return NextResponse.json({ device });
    }

    if (body.action === 'bulk_toggle_system') {
      const deviceIds = Array.isArray(body.deviceIds)
        ? body.deviceIds
            .filter((id): id is string => typeof id === 'string')
            .map((id) => id.trim())
            .filter(Boolean)
        : [];
      if (
        deviceIds.length === 0 ||
        !isValidVendorId(body.vendor) ||
        typeof body.enabled !== 'boolean'
      ) {
        return NextResponse.json(
          {
            error:
              'Paramètres invalides pour bulk_toggle_system (deviceIds, vendor et enabled requis).',
          },
          { status: 400 }
        );
      }
      const result = await bulkToggleDeviceSystemTag({
        deviceIds,
        vendor: body.vendor,
        enabled: body.enabled,
      });
      return NextResponse.json(result);
    }

    if (body.action === 'merge') {
      if (!body.targetDeviceId || !body.sourceDeviceId) {
        return NextResponse.json(
          { error: 'targetDeviceId et sourceDeviceId sont requis.' },
          { status: 400 }
        );
      }
      const device = await mergeDevices({
        targetDeviceId: body.targetDeviceId,
        sourceDeviceId: body.sourceDeviceId,
      });
      if (!device) {
        return NextResponse.json(
          { error: 'Appareil cible ou source introuvable.' },
          { status: 404 }
        );
      }
      return NextResponse.json({ device });
    }

    if (body.action === 'bulk_merge') {
      const pairs = Array.isArray(body.pairs)
        ? body.pairs
            .filter(
              (item): item is { targetDeviceId: string; sourceDeviceId: string } =>
                Boolean(
                  item &&
                    typeof item === 'object' &&
                    typeof (item as { targetDeviceId?: unknown }).targetDeviceId === 'string' &&
                    typeof (item as { sourceDeviceId?: unknown }).sourceDeviceId === 'string'
                )
            )
            .map((item) => ({
              targetDeviceId: item.targetDeviceId.trim(),
              sourceDeviceId: item.sourceDeviceId.trim(),
            }))
            .filter((item) => item.targetDeviceId && item.sourceDeviceId)
        : [];
      if (pairs.length === 0) {
        return NextResponse.json(
          { error: 'La liste pairs (targetDeviceId, sourceDeviceId) est requise.' },
          { status: 400 }
        );
      }
      const result = await bulkMergeDevices({ pairs });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Action non reconnue.' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur liaison multi-systèmes';
    const status = message.includes('principal') || message.includes('même') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get('deviceId');
    const vendor = searchParams.get('vendor');

    if (!deviceId || !isValidVendorId(vendor)) {
      return NextResponse.json(
        { error: 'deviceId et vendor valide requis.' },
        { status: 400 }
      );
    }

    const device = await unlinkDeviceVendor({ deviceId, vendor });
    if (!device) {
      return NextResponse.json({ error: 'Appareil introuvable' }, { status: 404 });
    }
    return NextResponse.json({ device });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur dissociation système';
    const status = message.includes('principal') || message.includes('dernier') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
