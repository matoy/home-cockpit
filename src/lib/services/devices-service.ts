import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, type AppDatabase } from '@/db';
import { devices, deviceVendorLinks } from '@/db/schema';
import { getDemoState } from '@/lib/demo-store';
import { inferDeviceCategory } from '@/lib/device-utils';
import {
  computeDeviceMetricsForDpConfig,
  ensureSchemaInitialized,
  mapDbDevice,
  mapDbVendorLink,
} from '@/lib/services/shared';
import { formatMacAddress } from '@/lib/tuya-client';
import { isValidVendorId, normalizeSystems } from '@/lib/vendors/registry';
import type {
  DeviceCategory,
  DeviceRecord,
  DeviceVendorLinkRecord,
  DpConfig,
  EnergyMode,
  VendorId,
} from '@/types';

export interface CreateManualDeviceInput {
  name: string;
  customName?: string | null;
  productName?: string | null;
  roomId?: number | null;
  category?: DeviceCategory;
  primaryVendor?: VendorId;
  systems?: VendorId[];
  ipAddress?: string | null;
  macAddress?: string | null;
  isOnline?: boolean;
  isMonitored?: boolean;
  ignoreOfflineAlert?: boolean;
  excludeFromTotals?: boolean;
}

function sanitizeManualMac(rawMac: string | null | undefined): string | null {
  const trimmed = rawMac?.trim();
  if (!trimmed) return null;
  return formatMacAddress(trimmed) ?? trimmed;
}

function syncManualLinksInDemo(params: {
  deviceId: string;
  systems: VendorId[];
  primaryVendor: VendorId;
  externalName: string;
  nowIso: string;
}): DeviceVendorLinkRecord[] {
  const state = getDemoState();
  state.vendorLinks = state.vendorLinks.filter(
    (l) =>
      l.deviceId !== params.deviceId ||
      !l.externalId.startsWith('manual:') ||
      params.systems.includes(l.vendor)
  );

  for (const link of state.vendorLinks) {
    if (link.deviceId === params.deviceId) {
      link.isPrimaryTelemetry = link.vendor === params.primaryVendor;
      if (link.externalId.startsWith('manual:')) {
        link.externalName = params.externalName;
      }
    }
  }

  for (const vendor of params.systems) {
    const exists = state.vendorLinks.some(
      (l) => l.deviceId === params.deviceId && l.vendor === vendor
    );
    if (!exists) {
      state.vendorLinks.push({
        id: state.nextLinkId++,
        deviceId: params.deviceId,
        vendor,
        externalId: `manual:${vendor}:${params.deviceId}`,
        externalName: params.externalName,
        isPrimaryTelemetry: vendor === params.primaryVendor,
        linkedAt: params.nowIso,
      });
    }
  }

  return state.vendorLinks.filter((l) => l.deviceId === params.deviceId);
}

async function syncManualLinksInDb(params: {
  db: AppDatabase;
  deviceId: string;
  systems: VendorId[];
  primaryVendor: VendorId;
  externalName: string;
  now: Date;
}): Promise<DeviceVendorLinkRecord[]> {
  const existingLinks = await params.db
    .select()
    .from(deviceVendorLinks)
    .where(eq(deviceVendorLinks.deviceId, params.deviceId));

  for (const link of existingLinks) {
    const vendorId: VendorId = isValidVendorId(link.vendor) ? link.vendor : 'tuya';
    if (link.externalId.startsWith('manual:') && !params.systems.includes(vendorId)) {
      await params.db.delete(deviceVendorLinks).where(eq(deviceVendorLinks.id, link.id));
      continue;
    }
    await params.db
      .update(deviceVendorLinks)
      .set({
        isPrimaryTelemetry: vendorId === params.primaryVendor,
        ...(link.externalId.startsWith('manual:') ? { externalName: params.externalName } : {}),
      })
      .where(eq(deviceVendorLinks.id, link.id));
  }

  for (const vendor of params.systems) {
    const hasLink = existingLinks.some((l) => l.vendor === vendor);
    if (!hasLink) {
      await params.db
        .insert(deviceVendorLinks)
        .values({
          deviceId: params.deviceId,
          vendor,
          externalId: `manual:${vendor}:${params.deviceId}`,
          externalName: params.externalName,
          isPrimaryTelemetry: vendor === params.primaryVendor,
          linkedAt: params.now,
        })
        .onConflictDoNothing();
    }
  }

  const finalLinks = await params.db
    .select()
    .from(deviceVendorLinks)
    .where(eq(deviceVendorLinks.deviceId, params.deviceId));
  return finalLinks.map(mapDbVendorLink);
}

export async function createManualDevice(
  input: CreateManualDeviceInput
): Promise<DeviceRecord> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Le nom de l'appareil est requis.");
  }

  const primaryVendor: VendorId = isValidVendorId(input.primaryVendor)
    ? input.primaryVendor
    : 'google_home';
  const systems = normalizeSystems(input.systems, primaryVendor);
  const customName = input.customName?.trim() || null;
  const productName = input.productName?.trim() || null;
  const ipAddress = input.ipAddress?.trim() || null;
  const macAddress = sanitizeManualMac(input.macAddress);
  const category: DeviceCategory = input.category ?? 'other';
  const roomId = input.roomId ?? null;
  const isOnline = input.isOnline ?? true;
  const isMonitored = input.isMonitored ?? true;
  const ignoreOfflineAlert = input.ignoreOfflineAlert ?? false;
  const excludeFromTotals = input.excludeFromTotals ?? false;
  const id = `manual_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date();
  const externalName = customName || name;

  const db = getDb();
  if (!db) {
    const state = getDemoState();
    const record: DeviceRecord = {
      id,
      name,
      customName,
      primaryVendor,
      systems,
      roomId,
      category,
      tuyaCategory: 'manual',
      productName,
      ipAddress,
      macAddress,
      isOnline,
      isMonitored,
      ignoreOfflineAlert,
      excludeFromTotals,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: null,
      lastSeenAt: null,
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: null,
      lastContactOpen: null,
    };
    state.devices.push(record);
    const links = syncManualLinksInDemo({
      deviceId: id,
      systems,
      primaryVendor,
      externalName,
      nowIso: now.toISOString(),
    });
    return { ...record, vendorLinks: links };
  }

  await ensureSchemaInitialized(db);
  const [inserted] = await db
    .insert(devices)
    .values({
      id,
      name,
      customName,
      primaryVendor,
      systems,
      roomId,
      category,
      tuyaCategory: 'manual',
      productName,
      ipAddress,
      macAddress,
      isOnline,
      isMonitored,
      ignoreOfflineAlert,
      excludeFromTotals,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: null,
      lastSeenAt: null,
    })
    .returning();

  const links = await syncManualLinksInDb({
    db,
    deviceId: id,
    systems,
    primaryVendor,
    externalName,
    now,
  });
  return mapDbDevice(inserted, links);
}

export async function updateDevice(
  id: string,
  input: Partial<{
    name: string;
    customName: string | null;
    productName: string | null;
    ipAddress: string | null;
    macAddress: string | null;
    roomId: number | null;
    category: DeviceCategory;
    isOnline: boolean;
    isMonitored: boolean;
    ignoreOfflineAlert: boolean;
    excludeFromTotals: boolean;
    energyMode: EnergyMode;
    dpConfig: DpConfig;
    primaryVendor: VendorId;
    systems: VendorId[];
  }>
): Promise<DeviceRecord | null> {
  const db = getDb();
  const now = new Date();
  const sanitizedInput = {
    ...input,
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.customName !== undefined
      ? { customName: input.customName ? input.customName.trim() : null }
      : {}),
    ...(input.productName !== undefined
      ? { productName: input.productName ? input.productName.trim() : null }
      : {}),
    ...(input.ipAddress !== undefined
      ? { ipAddress: input.ipAddress ? input.ipAddress.trim() : null }
      : {}),
    ...(input.macAddress !== undefined
      ? { macAddress: sanitizeManualMac(input.macAddress) }
      : {}),
  };

  if (!db) {
    const state = getDemoState();
    const dev = state.devices.find((d) => d.id === id);
    if (!dev) return null;

    const currentPrimary: VendorId = isValidVendorId(dev.primaryVendor)
      ? dev.primaryVendor
      : 'tuya';
    const nextPrimary: VendorId =
      sanitizedInput.primaryVendor && isValidVendorId(sanitizedInput.primaryVendor)
        ? sanitizedInput.primaryVendor
        : currentPrimary;
    const nextSystems =
      sanitizedInput.systems !== undefined || sanitizedInput.primaryVendor !== undefined
        ? normalizeSystems(sanitizedInput.systems ?? dev.systems, nextPrimary)
        : dev.systems;

    Object.assign(dev, sanitizedInput, {
      primaryVendor: nextPrimary,
      systems: nextSystems,
    });

    if (sanitizedInput.dpConfig) {
      dev.category =
        sanitizedInput.category ?? inferDeviceCategory(sanitizedInput.dpConfig, dev.tuyaCategory);
      Object.assign(dev, computeDeviceMetricsForDpConfig(dev.lastRawStatus, sanitizedInput.dpConfig));
    }

    const links =
      sanitizedInput.systems !== undefined ||
      sanitizedInput.primaryVendor !== undefined ||
      sanitizedInput.name !== undefined ||
      sanitizedInput.customName !== undefined
        ? syncManualLinksInDemo({
            deviceId: id,
            systems: nextSystems,
            primaryVendor: nextPrimary,
            externalName: dev.customName || dev.name,
            nowIso: now.toISOString(),
          })
        : state.vendorLinks.filter((l) => l.deviceId === id);

    return { ...dev, vendorLinks: links };
  }

  await ensureSchemaInitialized(db);
  const existing = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
  if (existing.length === 0) return null;

  const currentPrimary: VendorId = isValidVendorId(existing[0].primaryVendor)
    ? existing[0].primaryVendor
    : 'tuya';
  const nextPrimary: VendorId =
    sanitizedInput.primaryVendor && isValidVendorId(sanitizedInput.primaryVendor)
      ? sanitizedInput.primaryVendor
      : currentPrimary;
  const hasSystemUpdate =
    sanitizedInput.systems !== undefined || sanitizedInput.primaryVendor !== undefined;
  const nextSystems = hasSystemUpdate
    ? normalizeSystems(sanitizedInput.systems ?? existing[0].systems, nextPrimary)
    : undefined;

  const updates: Partial<typeof devices.$inferInsert> = {
    ...sanitizedInput,
    ...(hasSystemUpdate ? { primaryVendor: nextPrimary, systems: nextSystems } : {}),
  };
  if (sanitizedInput.dpConfig) {
    updates.category =
      sanitizedInput.category ??
      inferDeviceCategory(sanitizedInput.dpConfig, existing[0].tuyaCategory);
    Object.assign(
      updates,
      computeDeviceMetricsForDpConfig(existing[0].lastRawStatus, sanitizedInput.dpConfig)
    );
  }

  const [updated] = await db
    .update(devices)
    .set(updates)
    .where(eq(devices.id, id))
    .returning();
  if (!updated) return null;

  const externalName = updated.customName || updated.name;
  const links = hasSystemUpdate
    ? await syncManualLinksInDb({
        db,
        deviceId: id,
        systems: nextSystems!,
        primaryVendor: nextPrimary,
        externalName,
        now,
      })
    : (
        await db.select().from(deviceVendorLinks).where(eq(deviceVendorLinks.deviceId, id))
      ).map(mapDbVendorLink);

  return mapDbDevice(updated, links);
}

export async function deleteManualDevice(id: string): Promise<boolean> {
  if (!id.startsWith('manual_')) {
    throw new Error('Seuls les appareils déclarés manuellement peuvent être supprimés.');
  }

  const db = getDb();
  if (!db) {
    const state = getDemoState();
    const beforeLen = state.devices.length;
    state.devices = state.devices.filter((d) => d.id !== id);
    if (state.devices.length === beforeLen) return false;
    state.vendorLinks = state.vendorLinks.filter((l) => l.deviceId !== id);
    state.readings = state.readings.filter((r) => r.deviceId !== id);
    return true;
  }

  await ensureSchemaInitialized(db);
  const deleted = await db
    .delete(devices)
    .where(eq(devices.id, id))
    .returning({ id: devices.id });
  return deleted.length > 0;
}
