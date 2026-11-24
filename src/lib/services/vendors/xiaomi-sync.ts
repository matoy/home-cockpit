import { eq } from 'drizzle-orm';
import { getDb, type AppDatabase } from '@/db';
import { devices, deviceVendorLinks, metricReadings, vendorConnections } from '@/db/schema';
import { getDemoState } from '@/lib/demo-store';
import {
  ensureMissingRoomsInDb,
  ensureSchemaInitialized,
  seedDefaultDataIfEmpty,
} from '@/lib/services/shared';
import type {
  VendorCollectionResult,
  VendorRoomSyncResult,
  VendorServerPlugin,
  VendorSyncResult,
} from '@/lib/services/vendors/types';
import {
  backfillMissingReadingRoomId,
  disconnectVendorConnection,
  ensureUniqueDeviceId,
  loadVendorDeviceIndex,
  loadVendorExternalDeviceMap,
} from '@/lib/services/vendors/upsert-helper';
import { computeHybridEnergyKwh } from '@/lib/tariff-engine';
import { decryptSecret, encryptSecret } from '@/lib/vendors/crypto-store';
import { mergeDeviceSystems } from '@/lib/vendors/deduplication';
import { isValidVendorId, normalizeSystems } from '@/lib/vendors/registry';
import {
  fetchXiaomiInventory,
  getXiaomiConfig,
  makeXiaomiDeviceId,
  normalizeXiaomiRegion,
  type XiaomiSession,
} from '@/lib/vendors/xiaomi-client';
import type { EnergyMode, VendorId } from '@/types';

export async function loadCachedXiaomiSession(db: AppDatabase | null): Promise<XiaomiSession | null> {
  const cfg = getXiaomiConfig();
  if (db) {
    const rows = await db
      .select()
      .from(vendorConnections)
      .where(eq(vendorConnections.vendor, 'xiaomi'))
      .limit(1);
    const conn = rows[0];
    if (conn && conn.status === 'connected' && conn.accessToken) {
      const decrypted = decryptSecret(conn.accessToken);
      if (decrypted) {
        try {
          const parsed = JSON.parse(decrypted) as unknown;
          const rec = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
          if (
            rec &&
            typeof rec.userId === 'string' &&
            typeof rec.ssecurity === 'string' &&
            typeof rec.serviceToken === 'string'
          ) {
            return {
              userId: rec.userId,
              ssecurity: rec.ssecurity,
              serviceToken: rec.serviceToken,
              region: normalizeXiaomiRegion(rec.region ?? cfg.region),
            };
          }
        } catch {
          // Ignore malformed token
        }
      }
    }
  }

  if (cfg.userId && cfg.ssecurity && cfg.serviceToken) {
    return {
      userId: cfg.userId,
      ssecurity: cfg.ssecurity,
      serviceToken: cfg.serviceToken,
      region: cfg.region,
    };
  }
  return null;
}

export async function saveXiaomiConnection(session: XiaomiSession): Promise<void> {
  const db = getDb();
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    state.vendorConnections.xiaomi = {
      mode: 'cloud_account',
      connected: true,
      lastSyncedAt: now.toISOString(),
      lastError: null,
    };
    return;
  }

  await ensureSchemaInitialized(db);
  const encryptedSession = encryptSecret(JSON.stringify(session));

  await db
    .insert(vendorConnections)
    .values({
      vendor: 'xiaomi',
      mode: 'cloud_account',
      status: 'connected',
      accessToken: encryptedSession,
      refreshToken: null,
      tokenExpiresAt: null,
      config: { region: session.region },
      lastError: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: vendorConnections.vendor,
      set: {
        mode: 'cloud_account',
        status: 'connected',
        accessToken: encryptedSession,
        config: { region: session.region },
        lastError: null,
        updatedAt: now,
      },
    });
}

export async function disconnectXiaomi(): Promise<void> {
  return disconnectVendorConnection('xiaomi');
}

export async function syncXiaomiDevices(): Promise<VendorSyncResult> {
  const db = getDb();
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    state.vendorConnections.xiaomi.connected = true;
    state.vendorConnections.xiaomi.lastSyncedAt = now.toISOString();
    state.vendorConnections.xiaomi.lastError = null;
    const miCount = state.devices.filter((d) => d.systems.includes('xiaomi')).length;
    return {
      syncedCount: miCount,
      newCount: 0,
      mode: 'demo',
      message: `Mode démo actif : ${miCount} appareil(s) Xiaomi Home simulé(s) synchronisé(s).`,
    };
  }

  await seedDefaultDataIfEmpty(db);
  const session = await loadCachedXiaomiSession(db);
  if (!session) {
    throw new Error(
      'Xiaomi Home n’est pas encore connecté. Scannez le QR Code Xiaomi Home dans l’onglet Systèmes ou connectez votre compte.'
    );
  }

  let inventory;
  try {
    inventory = await fetchXiaomiInventory(session);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur synchronisation Xiaomi Home';
    await db
      .update(vendorConnections)
      .set({ lastError: msg, updatedAt: now })
      .where(eq(vendorConnections.vendor, 'xiaomi'));
    throw err;
  }

  const { roomNameToId } = await ensureMissingRoomsInDb(db, inventory.roomNames);
  const { deviceById, linkByExternalId } = await loadVendorDeviceIndex(db, 'xiaomi');
  let newCount = 0;

  for (const mi of inventory.devices) {
    const mappedRoomId = mi.roomName
      ? (roomNameToId.get(mi.roomName.trim().toLowerCase()) ?? null)
      : null;
    const existingLink = linkByExternalId.get(mi.externalId);
    const linkedDevice = existingLink ? deviceById.get(existingLink.deviceId) : undefined;
    const productName = [mi.manufacturer, mi.model].filter(Boolean).join(' · ') || 'Xiaomi Home';
    const vendorMetadata = {
      manufacturer: mi.manufacturer,
      model: mi.model,
      deviceType: mi.deviceType,
      roomName: mi.roomName,
    };

    if (linkedDevice) {
      const primaryVendor: VendorId = isValidVendorId(linkedDevice.primaryVendor)
        ? linkedDevice.primaryVendor
        : 'xiaomi';
      const nextSystems = mergeDeviceSystems(
        normalizeSystems(linkedDevice.systems, primaryVendor),
        'xiaomi',
        primaryVendor
      );

      if (primaryVendor === 'tuya' || primaryVendor === 'kasa') {
        await db
          .update(devices)
          .set({
            systems: nextSystems,
            ...(linkedDevice.roomId === null && mappedRoomId !== null
              ? { roomId: mappedRoomId }
              : {}),
          })
          .where(eq(devices.id, linkedDevice.id));
      } else {
        await db
          .update(devices)
          .set({
            name: mi.name,
            systems: nextSystems,
            ...(mappedRoomId !== null && linkedDevice.roomId === null
              ? { roomId: mappedRoomId }
              : {}),
            category: mi.category,
            tuyaCategory: mi.deviceType ?? 'xiaomi',
            productName,
            ipAddress: linkedDevice.ipAddress ?? mi.ipAddress ?? null,
            macAddress: linkedDevice.macAddress ?? mi.macAddress ?? null,
            isOnline: mi.isOnline,
            lastRawStatus: mi.rawTraits,
            lastSeenAt: now,
            ...(mi.powerW !== null ? { lastPowerW: mi.powerW } : {}),
            ...(mi.addEleKwh !== undefined && mi.addEleKwh !== null
              ? { lastAddEleKwh: mi.addEleKwh }
              : {}),
            ...(mi.tempC !== null ? { lastTempC: mi.tempC } : {}),
            ...(mi.humidityPct !== null ? { lastHumidityPct: mi.humidityPct } : {}),
            ...(mi.batteryPct !== null ? { lastBatteryPct: mi.batteryPct } : {}),
            ...(mi.contactOpen !== null ? { lastContactOpen: mi.contactOpen } : {}),
          })
          .where(eq(devices.id, linkedDevice.id));
      }

      await db
        .update(deviceVendorLinks)
        .set({ externalName: mi.name, vendorMetadata })
        .where(eq(deviceVendorLinks.id, existingLink!.id));
    } else {
      const candidateId = ensureUniqueDeviceId(
        makeXiaomiDeviceId(mi.externalId),
        (id) => deviceById.has(id),
        now
      );
      const [inserted] = await db
        .insert(devices)
        .values({
          id: candidateId,
          name: mi.name,
          customName: null,
          primaryVendor: 'xiaomi',
          systems: ['xiaomi'],
          roomId: mappedRoomId,
          category: mi.category,
          tuyaCategory: mi.deviceType ?? 'xiaomi',
          productName,
          ipAddress: mi.ipAddress ?? null,
          macAddress: mi.macAddress ?? null,
          isOnline: mi.isOnline,
          isMonitored: true,
          excludeFromTotals: false,
          energyMode: 'hybrid',
          dpConfig: {},
          lastRawStatus: mi.rawTraits,
          lastSeenAt: now,
          lastPowerW: mi.powerW,
          lastVoltageV: null,
          lastAddEleKwh: mi.addEleKwh ?? null,
          lastTempC: mi.tempC,
          lastHumidityPct: mi.humidityPct,
          lastBatteryPct: mi.batteryPct,
          lastContactOpen: mi.contactOpen,
        })
        .returning();

      await db
        .insert(deviceVendorLinks)
        .values({
          deviceId: candidateId,
          vendor: 'xiaomi',
          externalId: mi.externalId,
          externalName: mi.name,
          vendorMetadata,
          isPrimaryTelemetry: true,
          linkedAt: now,
        })
        .onConflictDoNothing();

      deviceById.set(candidateId, inserted);
      newCount++;
    }
  }

  await db
    .update(vendorConnections)
    .set({
      status: 'connected',
      lastSyncedAt: now,
      lastError: inventory.warning ?? null,
      updatedAt: now,
    })
    .where(eq(vendorConnections.vendor, 'xiaomi'));

  return {
    syncedCount: inventory.devices.length,
    newCount,
    mode: 'live',
    message: `${inventory.devices.length} équipement(s) Xiaomi Home synchronisé(s) (${newCount} nouveau(x)).`,
  };
}

export async function collectXiaomiReadingsInDb(
  db: AppDatabase,
  xiaomiDevices: Array<typeof devices.$inferSelect>,
  now: Date
): Promise<VendorCollectionResult> {
  if (xiaomiDevices.length === 0) {
    return { devicesCount: 0, updatedCount: 0, readingsInserted: 0 };
  }

  const session = await loadCachedXiaomiSession(db);
  if (!session) {
    return { devicesCount: xiaomiDevices.length, updatedCount: 0, readingsInserted: 0 };
  }

  let inventory;
  try {
    inventory = await fetchXiaomiInventory(session);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur collecte Xiaomi Home';
    await db
      .update(vendorConnections)
      .set({ lastError: msg, updatedAt: now })
      .where(eq(vendorConnections.vendor, 'xiaomi'));
    throw err;
  }

  await db
    .update(vendorConnections)
    .set({
      lastSyncedAt: now,
      lastError: inventory.warning ?? null,
      updatedAt: now,
    })
    .where(eq(vendorConnections.vendor, 'xiaomi'));

  const deviceIdByExternalId = await loadVendorExternalDeviceMap(db, 'xiaomi');
  const deviceById = new Map(xiaomiDevices.map((d) => [d.id, d]));

  const readingsToInsert: Array<typeof metricReadings.$inferInsert> = [];
  let updatedCount = 0;

  for (const mi of inventory.devices) {
    const devId = deviceIdByExternalId.get(mi.externalId) ?? makeXiaomiDeviceId(mi.externalId);
    const dev = deviceById.get(devId);
    if (!dev || !dev.isMonitored) continue;

    const hasPower = mi.powerW !== null || (mi.addEleKwh !== undefined && mi.addEleKwh !== null);
    const hasClimate = mi.tempC !== null || mi.humidityPct !== null;
    const hasContact = mi.contactOpen !== null;

    const energyRes = hasPower
      ? computeHybridEnergyKwh({
          energyMode: (dev.energyMode as EnergyMode) || 'hybrid',
          powerW: mi.powerW,
          currentAddEleKwh: mi.addEleKwh ?? null,
          previousAddEleKwh: dev.lastAddEleKwh,
          previousSeenAt: dev.lastSeenAt,
          now,
        })
      : null;

    await db
      .update(devices)
      .set({
        isOnline: mi.isOnline,
        lastRawStatus: mi.rawTraits,
        lastSeenAt: now,
        ...(mi.ipAddress ? { ipAddress: mi.ipAddress } : {}),
        ...(mi.macAddress ? { macAddress: mi.macAddress } : {}),
        ...(mi.powerW !== null ? { lastPowerW: mi.powerW } : {}),
        ...(mi.addEleKwh !== undefined && mi.addEleKwh !== null
          ? { lastAddEleKwh: mi.addEleKwh }
          : {}),
        ...(mi.tempC !== null ? { lastTempC: mi.tempC } : {}),
        ...(mi.humidityPct !== null ? { lastHumidityPct: mi.humidityPct } : {}),
        ...(mi.batteryPct !== null ? { lastBatteryPct: mi.batteryPct } : {}),
        ...(mi.contactOpen !== null ? { lastContactOpen: mi.contactOpen } : {}),
      })
      .where(eq(devices.id, dev.id));
    updatedCount++;

    if (hasPower || hasClimate || hasContact) {
      readingsToInsert.push({
        deviceId: dev.id,
        roomId: dev.roomId,
        recordedAt: now,
        powerW: mi.powerW,
        voltageV: null,
        energyKwh: energyRes ? energyRes.energyKwh : null,
        energySource: energyRes ? energyRes.source : null,
        tempC: mi.tempC,
        humidityPct: mi.humidityPct,
        contactOpen: mi.contactOpen,
      });
    }
  }

  if (readingsToInsert.length > 0) {
    await db.insert(metricReadings).values(readingsToInsert);
  }

  return {
    devicesCount: xiaomiDevices.length,
    updatedCount,
    readingsInserted: readingsToInsert.length,
  };
}

export async function syncRoomsFromXiaomi(): Promise<VendorRoomSyncResult> {
  const db = getDb();
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    state.vendorConnections.xiaomi.lastSyncedAt = now.toISOString();
    state.vendorConnections.xiaomi.lastError = null;
    return {
      vendor: 'xiaomi',
      roomsFound: state.rooms.length,
      createdCount: 0,
      assignedDevicesCount: 0,
      mode: 'demo',
      message: `Mode démo actif : ${state.rooms.length} pièce(s) Xiaomi Home simulée(s) déjà disponible(s).`,
    };
  }

  await seedDefaultDataIfEmpty(db);
  const session = await loadCachedXiaomiSession(db);
  if (!session) {
    throw new Error(
      'Xiaomi Home n’est pas connecté. Scannez d’abord le QR Code Xiaomi Home dans l’onglet Systèmes.'
    );
  }

  const inventory = await fetchXiaomiInventory(session);
  const { roomNameToId, createdCount } = await ensureMissingRoomsInDb(db, inventory.roomNames);
  const [existingDeviceRows, miLinkRows] = await Promise.all([
    db
      .select({
        id: devices.id,
        primaryVendor: devices.primaryVendor,
        roomId: devices.roomId,
      })
      .from(devices),
    db.select().from(deviceVendorLinks).where(eq(deviceVendorLinks.vendor, 'xiaomi')),
  ]);

  const deviceById = new Map(existingDeviceRows.map((d) => [d.id, d]));
  const linkByExternalId = new Map(miLinkRows.map((l) => [l.externalId, l]));

  let assignedDevicesCount = 0;
  const updatedDeviceIds = new Set<string>();

  for (const mi of inventory.devices) {
    if (!mi.roomName) continue;
    const mappedRoomId = roomNameToId.get(mi.roomName.trim().toLowerCase()) ?? null;
    if (mappedRoomId === null) continue;

    const existingLink = linkByExternalId.get(mi.externalId);
    const linkedDevice = existingLink ? deviceById.get(existingLink.deviceId) : undefined;
    if (!linkedDevice || updatedDeviceIds.has(linkedDevice.id)) continue;

    const primaryVendor: VendorId = isValidVendorId(linkedDevice.primaryVendor)
      ? linkedDevice.primaryVendor
      : 'xiaomi';
    const shouldUpdate =
      primaryVendor === 'tuya'
        ? linkedDevice.roomId === null
        : linkedDevice.roomId !== mappedRoomId;

    if (shouldUpdate) {
      await db
        .update(devices)
        .set({ roomId: mappedRoomId })
        .where(eq(devices.id, linkedDevice.id));
      await backfillMissingReadingRoomId(db, linkedDevice.id, mappedRoomId, linkedDevice.roomId);
      updatedDeviceIds.add(linkedDevice.id);
      assignedDevicesCount++;
    }
  }

  await db
    .update(vendorConnections)
    .set({
      status: 'connected',
      lastSyncedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(vendorConnections.vendor, 'xiaomi'));

  return {
    vendor: 'xiaomi',
    roomsFound: inventory.roomNames.length,
    createdCount,
    assignedDevicesCount,
    mode: 'live',
    message: `Xiaomi Home : ${inventory.roomNames.length} pièce(s) détectée(s) (${createdCount} créée(s), ${assignedDevicesCount} équipement(s) rattaché(s)).`,
  };
}

export const xiaomiPlugin: VendorServerPlugin = {
  id: 'xiaomi',
  isConfigured: () => getXiaomiConfig().configured,
  getConnectionMode: () => 'cloud_account',
  isConnectedLive: ({ conn }) => {
    const cfg = getXiaomiConfig();
    const envTokenReady = Boolean(cfg.userId && cfg.ssecurity && cfg.serviceToken);
    return Boolean(
      envTokenReady || (conn && conn.status === 'connected' && Boolean(conn.accessToken))
    );
  },
  isConfiguredLive: ({ conn }) => {
    const cfg = getXiaomiConfig();
    const envTokenReady = Boolean(cfg.userId && cfg.ssecurity && cfg.serviceToken);
    const connected = Boolean(
      envTokenReady || (conn && conn.status === 'connected' && Boolean(conn.accessToken))
    );
    return cfg.configured || connected;
  },
  syncDevices: syncXiaomiDevices,
  collectReadings: ({ db, monitoredDevices, now }) =>
    collectXiaomiReadingsInDb(db, monitoredDevices, now),
  syncRooms: syncRoomsFromXiaomi,
  isReadyForRoomSync: async (db) => {
    if (!db) return true;
    const session = await loadCachedXiaomiSession(db);
    return Boolean(session);
  },
  disconnect: disconnectXiaomi,
};
