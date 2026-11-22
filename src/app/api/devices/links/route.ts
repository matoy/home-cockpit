import { NextResponse } from 'next/server';
import {
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
      vendor?: string;
      enabled?: boolean;
      targetDeviceId?: string;
      sourceDeviceId?: string;
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
