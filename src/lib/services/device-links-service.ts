import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { devices, deviceVendorLinks } from '@/db/schema';
import { getDemoState } from '@/lib/demo-store';
import {
  ensureSchemaInitialized,
  mapDbDevice,
  mapDbVendorLink,
} from '@/lib/services/shared';
import { mergeDeviceSystems } from '@/lib/vendors/deduplication';
import { isValidVendorId, normalizeSystems, VENDOR_REGISTRY } from '@/lib/vendors/registry';
import type { DeviceRecord, VendorId } from '@/types';

export interface BulkToggleSystemResult {
  vendor: VendorId;
  enabled: boolean;
  requestedCount: number;
  updatedCount: number;
  alreadySetCount: number;
  skippedPrimaryCount: number;
  notFoundCount: number;
  message: string;
}

export interface BulkMergeDevicesResult {
  mergedCount: number;
  skippedCount: number;
  errors: string[];
  message: string;
}

function formatBulkToggleMessage(params: {
  vendorLabel: string;
  enabled: boolean;
  updatedCount: number;
  alreadySetCount: number;
  skippedPrimaryCount: number;
}): string {
  const { vendorLabel, enabled, updatedCount, alreadySetCount, skippedPrimaryCount } = params;
  if (enabled) {
    if (updatedCount > 0) {
      return `${updatedCount} appareil(s) lié(s) à ${vendorLabel}${
        alreadySetCount > 0 ? ` (${alreadySetCount} déjà lié(s))` : ''
      }.`;
    }
    if (alreadySetCount > 0) {
      return `Les ${alreadySetCount} appareil(s) sélectionné(s) étaient déjà lié(s) à ${vendorLabel}.`;
    }
    return 'Aucun appareil trouvé à lier.';
  }

  if (updatedCount === 0 && skippedPrimaryCount > 0 && alreadySetCount === 0) {
    return `Impossible de dissocier : ${vendorLabel} est le système principal des ${skippedPrimaryCount} appareil(s) sélectionné(s).`;
  }
  if (updatedCount === 0 && skippedPrimaryCount === 0 && alreadySetCount === 0) {
    return 'Aucun appareil trouvé à dissocier.';
  }

  const notes: string[] = [];
  if (skippedPrimaryCount > 0) {
    notes.push(`${skippedPrimaryCount} ignoré(s) car système principal`);
  }
  if (alreadySetCount > 0) {
    notes.push(`${alreadySetCount} non lié(s)`);
  }
  return `${updatedCount} appareil(s) dissocié(s) de ${vendorLabel}${
    notes.length > 0 ? ` (${notes.join(', ')})` : ''
  }.`;
}

export async function toggleDeviceSystemTag(params: {
  deviceId: string;
  vendor: VendorId;
  enabled: boolean;
}): Promise<DeviceRecord | null> {
  const db = getDb();
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    const dev = state.devices.find((d) => d.id === params.deviceId);
    if (!dev) return null;

    if (!params.enabled && dev.primaryVendor === params.vendor) {
      throw new Error('Impossible de retirer le système principal de cet appareil.');
    }

    if (params.enabled) {
      dev.systems = mergeDeviceSystems(dev.systems, params.vendor, dev.primaryVendor);
      const hasLink = state.vendorLinks.some(
        (l) => l.deviceId === dev.id && l.vendor === params.vendor
      );
      if (!hasLink) {
        state.vendorLinks.push({
          id: state.nextLinkId++,
          deviceId: dev.id,
          vendor: params.vendor,
          externalId: `manual:${params.vendor}:${dev.id}`,
          externalName: dev.customName || dev.name,
          isPrimaryTelemetry: false,
          linkedAt: now.toISOString(),
        });
      }
    } else {
      dev.systems = normalizeSystems(
        dev.systems.filter((s) => s !== params.vendor),
        dev.primaryVendor
      );
      state.vendorLinks = state.vendorLinks.filter(
        (l) => !(l.deviceId === dev.id && l.vendor === params.vendor)
      );
    }

    return {
      ...dev,
      vendorLinks: state.vendorLinks.filter((l) => l.deviceId === dev.id),
    };
  }

  await ensureSchemaInitialized(db);
  const existingRows = await db.select().from(devices).where(eq(devices.id, params.deviceId)).limit(1);
  const row = existingRows[0];
  if (!row) return null;

  const primaryVendor: VendorId = isValidVendorId(row.primaryVendor) ? row.primaryVendor : 'tuya';
  if (!params.enabled && primaryVendor === params.vendor) {
    throw new Error('Impossible de retirer le système principal de cet appareil.');
  }

  const currentSystems = normalizeSystems(row.systems, primaryVendor);
  let nextSystems: VendorId[];

  if (params.enabled) {
    nextSystems = mergeDeviceSystems(currentSystems, params.vendor, primaryVendor);
    const existingVendorLinks = await db
      .select()
      .from(deviceVendorLinks)
      .where(and(eq(deviceVendorLinks.deviceId, row.id), eq(deviceVendorLinks.vendor, params.vendor)));
    if (existingVendorLinks.length === 0) {
      await db
        .insert(deviceVendorLinks)
        .values({
          deviceId: row.id,
          vendor: params.vendor,
          externalId: `manual:${params.vendor}:${row.id}`,
          externalName: row.customName || row.name,
          isPrimaryTelemetry: false,
          linkedAt: now,
        })
        .onConflictDoNothing();
    }
  } else {
    nextSystems = normalizeSystems(
      currentSystems.filter((s) => s !== params.vendor),
      primaryVendor
    );
    await db
      .delete(deviceVendorLinks)
      .where(and(eq(deviceVendorLinks.deviceId, row.id), eq(deviceVendorLinks.vendor, params.vendor)));
  }

  const [updated] = await db
    .update(devices)
    .set({ systems: nextSystems })
    .where(eq(devices.id, row.id))
    .returning();

  const updatedLinks = await db
    .select()
    .from(deviceVendorLinks)
    .where(eq(deviceVendorLinks.deviceId, row.id));
  return mapDbDevice(updated, updatedLinks.map(mapDbVendorLink));
}

export async function mergeDevices(params: {
  targetDeviceId: string;
  sourceDeviceId: string;
}): Promise<DeviceRecord | null> {
  if (params.targetDeviceId === params.sourceDeviceId) {
    throw new Error('Impossible de fusionner un appareil avec lui-même.');
  }

  const db = getDb();
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    const target = state.devices.find((d) => d.id === params.targetDeviceId);
    const source = state.devices.find((d) => d.id === params.sourceDeviceId);
    if (!target || !source) return null;

    const mergedSystems = normalizeSystems(
      [...target.systems, ...source.systems, source.primaryVendor],
      target.primaryVendor
    );
    target.systems = mergedSystems;
    if (target.roomId === null && source.roomId !== null) {
      target.roomId = source.roomId;
    }

    const sourceLinks = state.vendorLinks.filter((l) => l.deviceId === source.id);
    if (sourceLinks.length === 0) {
      state.vendorLinks.push({
        id: state.nextLinkId++,
        deviceId: target.id,
        vendor: source.primaryVendor,
        externalId: source.id,
        externalName: source.name,
        isPrimaryTelemetry: false,
        linkedAt: now.toISOString(),
      });
    } else {
      for (const l of sourceLinks) {
        l.deviceId = target.id;
        l.isPrimaryTelemetry = false;
      }
    }

    state.devices = state.devices.filter((d) => d.id !== source.id);
    return {
      ...target,
      vendorLinks: state.vendorLinks.filter((l) => l.deviceId === target.id),
    };
  }

  await ensureSchemaInitialized(db);
  const [targetRows, sourceRows] = await Promise.all([
    db.select().from(devices).where(eq(devices.id, params.targetDeviceId)).limit(1),
    db.select().from(devices).where(eq(devices.id, params.sourceDeviceId)).limit(1),
  ]);

  const target = targetRows[0];
  const source = sourceRows[0];
  if (!target || !source) return null;

  const targetPrimary: VendorId = isValidVendorId(target.primaryVendor)
    ? target.primaryVendor
    : 'tuya';
  const sourcePrimary: VendorId = isValidVendorId(source.primaryVendor)
    ? source.primaryVendor
    : 'google_home';

  const mergedSystems = normalizeSystems(
    [
      ...normalizeSystems(target.systems, targetPrimary),
      ...normalizeSystems(source.systems, sourcePrimary),
    ],
    targetPrimary
  );

  const sourceLinks = await db
    .select()
    .from(deviceVendorLinks)
    .where(eq(deviceVendorLinks.deviceId, source.id));

  if (sourceLinks.length === 0) {
    await db
      .insert(deviceVendorLinks)
      .values({
        deviceId: target.id,
        vendor: sourcePrimary,
        externalId: source.id,
        externalName: source.name,
        isPrimaryTelemetry: false,
        linkedAt: now,
      })
      .onConflictDoNothing();
  } else {
    await db
      .update(deviceVendorLinks)
      .set({ deviceId: target.id, isPrimaryTelemetry: false })
      .where(eq(deviceVendorLinks.deviceId, source.id));
  }

  const [updatedTarget] = await db
    .update(devices)
    .set({
      systems: mergedSystems,
      roomId: target.roomId ?? source.roomId,
    })
    .where(eq(devices.id, target.id))
    .returning();

  await db.delete(devices).where(eq(devices.id, source.id));

  const targetLinks = await db
    .select()
    .from(deviceVendorLinks)
    .where(eq(deviceVendorLinks.deviceId, target.id));
  return mapDbDevice(updatedTarget, targetLinks.map(mapDbVendorLink));
}

export async function unlinkDeviceVendor(params: {
  deviceId: string;
  vendor: VendorId;
}): Promise<DeviceRecord | null> {
  return toggleDeviceSystemTag({
    deviceId: params.deviceId,
    vendor: params.vendor,
    enabled: false,
  });
}

export async function bulkToggleDeviceSystemTag(params: {
  deviceIds: string[];
  vendor: VendorId;
  enabled: boolean;
}): Promise<BulkToggleSystemResult> {
  const uniqueIds = Array.from(
    new Set(params.deviceIds.map((id) => id.trim()).filter(Boolean))
  );
  const vendorLabel = VENDOR_REGISTRY[params.vendor].label;

  if (uniqueIds.length === 0) {
    return {
      vendor: params.vendor,
      enabled: params.enabled,
      requestedCount: 0,
      updatedCount: 0,
      alreadySetCount: 0,
      skippedPrimaryCount: 0,
      notFoundCount: 0,
      message: 'Aucun appareil sélectionné.',
    };
  }

  const db = getDb();
  const now = new Date();
  let updatedCount = 0;
  let alreadySetCount = 0;
  let skippedPrimaryCount = 0;
  let notFoundCount = 0;

  if (!db) {
    const state = getDemoState();
    for (const id of uniqueIds) {
      const dev = state.devices.find((d) => d.id === id);
      if (!dev) {
        notFoundCount++;
        continue;
      }

      if (!params.enabled && dev.primaryVendor === params.vendor) {
        skippedPrimaryCount++;
        continue;
      }

      const hasSystem = dev.systems.includes(params.vendor);
      const hasLink = state.vendorLinks.some(
        (l) => l.deviceId === dev.id && l.vendor === params.vendor
      );

      if (params.enabled) {
        if (hasSystem && hasLink) {
          alreadySetCount++;
          continue;
        }
        dev.systems = mergeDeviceSystems(dev.systems, params.vendor, dev.primaryVendor);
        if (!hasLink) {
          state.vendorLinks.push({
            id: state.nextLinkId++,
            deviceId: dev.id,
            vendor: params.vendor,
            externalId: `manual:${params.vendor}:${dev.id}`,
            externalName: dev.customName || dev.name,
            isPrimaryTelemetry: false,
            linkedAt: now.toISOString(),
          });
        }
        updatedCount++;
      } else {
        if (!hasSystem && !hasLink) {
          alreadySetCount++;
          continue;
        }
        dev.systems = normalizeSystems(
          dev.systems.filter((s) => s !== params.vendor),
          dev.primaryVendor
        );
        state.vendorLinks = state.vendorLinks.filter(
          (l) => !(l.deviceId === dev.id && l.vendor === params.vendor)
        );
        updatedCount++;
      }
    }

    return {
      vendor: params.vendor,
      enabled: params.enabled,
      requestedCount: uniqueIds.length,
      updatedCount,
      alreadySetCount,
      skippedPrimaryCount,
      notFoundCount,
      message: formatBulkToggleMessage({
        vendorLabel,
        enabled: params.enabled,
        updatedCount,
        alreadySetCount,
        skippedPrimaryCount,
      }),
    };
  }

  await ensureSchemaInitialized(db);
  const rows = await db.select().from(devices).where(inArray(devices.id, uniqueIds));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const foundIds = rows.map((r) => r.id);

  const existingLinks =
    foundIds.length > 0
      ? await db
          .select()
          .from(deviceVendorLinks)
          .where(
            and(
              inArray(deviceVendorLinks.deviceId, foundIds),
              eq(deviceVendorLinks.vendor, params.vendor)
            )
          )
      : [];
  const linkedDeviceIds = new Set(existingLinks.map((l) => l.deviceId));

  const linksToInsert: Array<typeof deviceVendorLinks.$inferInsert> = [];
  const unlinkDeviceIds: string[] = [];

  for (const id of uniqueIds) {
    const row = rowById.get(id);
    if (!row) {
      notFoundCount++;
      continue;
    }

    const primaryVendor: VendorId = isValidVendorId(row.primaryVendor)
      ? row.primaryVendor
      : 'tuya';
    if (!params.enabled && primaryVendor === params.vendor) {
      skippedPrimaryCount++;
      continue;
    }

    const currentSystems = normalizeSystems(row.systems, primaryVendor);
    const hasSystem = currentSystems.includes(params.vendor);
    const hasLink = linkedDeviceIds.has(row.id);

    if (params.enabled) {
      if (hasSystem && hasLink) {
        alreadySetCount++;
        continue;
      }
      const nextSystems = mergeDeviceSystems(currentSystems, params.vendor, primaryVendor);
      const systemsChanged =
        nextSystems.length !== currentSystems.length ||
        nextSystems.some((s, idx) => s !== currentSystems[idx]);
      if (systemsChanged) {
        await db
          .update(devices)
          .set({ systems: nextSystems })
          .where(eq(devices.id, row.id));
      }
      if (!hasLink) {
        linksToInsert.push({
          deviceId: row.id,
          vendor: params.vendor,
          externalId: `manual:${params.vendor}:${row.id}`,
          externalName: row.customName || row.name,
          isPrimaryTelemetry: false,
          linkedAt: now,
        });
      }
      updatedCount++;
    } else {
      if (!hasSystem && !hasLink) {
        alreadySetCount++;
        continue;
      }
      const nextSystems = normalizeSystems(
        currentSystems.filter((s) => s !== params.vendor),
        primaryVendor
      );
      const systemsChanged =
        nextSystems.length !== currentSystems.length ||
        nextSystems.some((s, idx) => s !== currentSystems[idx]);
      if (systemsChanged) {
        await db
          .update(devices)
          .set({ systems: nextSystems })
          .where(eq(devices.id, row.id));
      }
      if (hasLink) {
        unlinkDeviceIds.push(row.id);
      }
      updatedCount++;
    }
  }

  if (linksToInsert.length > 0) {
    await db.insert(deviceVendorLinks).values(linksToInsert).onConflictDoNothing();
  }
  if (unlinkDeviceIds.length > 0) {
    await db
      .delete(deviceVendorLinks)
      .where(
        and(
          inArray(deviceVendorLinks.deviceId, unlinkDeviceIds),
          eq(deviceVendorLinks.vendor, params.vendor)
        )
      );
  }

  return {
    vendor: params.vendor,
    enabled: params.enabled,
    requestedCount: uniqueIds.length,
    updatedCount,
    alreadySetCount,
    skippedPrimaryCount,
    notFoundCount,
    message: formatBulkToggleMessage({
      vendorLabel,
      enabled: params.enabled,
      updatedCount,
      alreadySetCount,
      skippedPrimaryCount,
    }),
  };
}

export async function bulkMergeDevices(params: {
  pairs: Array<{ targetDeviceId: string; sourceDeviceId: string }>;
}): Promise<BulkMergeDevicesResult> {
  const consumedIds = new Set<string>();
  const errors: string[] = [];
  let mergedCount = 0;
  let skippedCount = 0;

  for (const rawPair of params.pairs) {
    const targetDeviceId = rawPair.targetDeviceId.trim();
    const sourceDeviceId = rawPair.sourceDeviceId.trim();

    if (
      !targetDeviceId ||
      !sourceDeviceId ||
      targetDeviceId === sourceDeviceId ||
      consumedIds.has(sourceDeviceId) ||
      consumedIds.has(targetDeviceId)
    ) {
      skippedCount++;
      continue;
    }

    try {
      const merged = await mergeDevices({ targetDeviceId, sourceDeviceId });
      if (!merged) {
        skippedCount++;
        continue;
      }
      consumedIds.add(sourceDeviceId);
      mergedCount++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Erreur fusion');
      skippedCount++;
    }
  }

  const message =
    mergedCount > 0
      ? `${mergedCount} doublon(s) fusionné(s) sans perte de mesures${
          skippedCount > 0 ? ` (${skippedCount} ignoré(s))` : ''
        }.`
      : 'Aucun doublon fusionné.';

  return {
    mergedCount,
    skippedCount,
    errors,
    message,
  };
}
