import { eq } from 'drizzle-orm';
import { getDb, type AppDatabase } from '@/db';
import { devices, deviceVendorLinks, metricReadings, vendorConnections } from '@/db/schema';
import { extractCoverSummary, isSomfyCoverUiClass } from '@/lib/covers-utils';
import { getDemoState } from '@/lib/demo-store';
import {
  ensureMissingRoomsInDb,
  ensureMissingRoomsInDemo,
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
  ensureUniqueDeviceId,
  loadVendorDeviceIndex,
  loadVendorExternalDeviceMap,
} from '@/lib/services/vendors/upsert-helper';
import { decryptSecret, encryptSecret } from '@/lib/vendors/crypto-store';
import { mergeDeviceSystems } from '@/lib/vendors/deduplication';
import { isValidVendorId, normalizeSystems } from '@/lib/vendors/registry';
import {
  fetchSomfyInventoryWithSession,
  getSomfyConfig,
  makeSomfyDeviceId,
} from '@/lib/vendors/somfy-client';
import type { VendorId } from '@/types';

async function loadCachedSomfySession(db: AppDatabase): Promise<{ cachedCookie: string | null }> {
  const rows = await db
    .select()
    .from(vendorConnections)
    .where(eq(vendorConnections.vendor, 'somfy'))
    .limit(1);
  const conn = rows[0];
  if (!conn) return { cachedCookie: null };
  return { cachedCookie: decryptSecret(conn.accessToken) };
}

async function persistSomfyConnectionInDb(
  db: AppDatabase,
  params: {
    status: 'connected' | 'error' | 'disconnected';
    sessionCookie?: string | null;
    region: string;
    baseUrl?: string | null;
    lastSyncedAt?: Date;
    lastError: string | null;
  }
): Promise<void> {
  const now = new Date();
  const encryptedCookie = params.sessionCookie ? encryptSecret(params.sessionCookie) : undefined;
  const config = {
    region: params.region,
    ...(params.baseUrl ? { baseUrl: params.baseUrl } : {}),
  };

  await db
    .insert(vendorConnections)
    .values({
      vendor: 'somfy',
      mode: 'cloud_account',
      status: params.status,
      ...(encryptedCookie ? { accessToken: encryptedCookie } : {}),
      config,
      ...(params.lastSyncedAt ? { lastSyncedAt: params.lastSyncedAt } : {}),
      lastError: params.lastError,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: vendorConnections.vendor,
      set: {
        mode: 'cloud_account',
        status: params.status,
        ...(encryptedCookie ? { accessToken: encryptedCookie } : {}),
        config,
        ...(params.lastSyncedAt ? { lastSyncedAt: params.lastSyncedAt } : {}),
        lastError: params.lastError,
        updatedAt: now,
      },
    });
}

export async function syncSomfyDevices(): Promise<VendorSyncResult> {
  const db = getDb();
  const somfyCfg = getSomfyConfig();
  const now = new Date();

  if (!somfyCfg.configured) {
    if (!db) {
      const state = getDemoState();
      state.vendorConnections.somfy.lastSyncedAt = now.toISOString();
      state.vendorConnections.somfy.lastError = null;
      const somfyCount = state.devices.filter((d) => d.systems.includes('somfy')).length;
      return {
        syncedCount: somfyCount,
        newCount: 0,
        mode: 'demo',
        message: `Mode démo actif : ${somfyCount} équipement(s) Somfy simulé(s) déjà synchronisé(s).`,
      };
    }
    throw new Error(
      'Identifiants Somfy manquants. Configurez SOMFY_EMAIL et SOMFY_PASSWORD dans Vercel / .env.local.'
    );
  }

  if (!db) {
    const res = await fetchSomfyInventoryWithSession(null);
    const inventory = res.inventory;
    const state = getDemoState();
    const { roomNameToId } = ensureMissingRoomsInDemo(inventory.roomNames);
    let newCount = 0;

    for (const sf of inventory.devices) {
      const mappedRoomId = sf.roomName
        ? (roomNameToId.get(sf.roomName.trim().toLowerCase()) ?? null)
        : null;
      const existingLink = state.vendorLinks.find(
        (l) => l.vendor === 'somfy' && l.externalId === sf.externalId
      );
      const existing = existingLink
        ? state.devices.find((d) => d.id === existingLink.deviceId)
        : undefined;
      const isCover = isSomfyCoverUiClass(sf.deviceType);

      if (existing) {
        existing.systems = mergeDeviceSystems(
          normalizeSystems(existing.systems, existing.primaryVendor),
          'somfy',
          existing.primaryVendor
        );
        if (existing.primaryVendor === 'tuya') {
          if (existing.roomId === null && mappedRoomId !== null) existing.roomId = mappedRoomId;
        } else {
          existing.name = sf.name;
          if (mappedRoomId !== null) existing.roomId = mappedRoomId;
          existing.category = sf.category;
          existing.tuyaCategory = sf.deviceType ?? 'somfy';
          existing.productName =
            [sf.manufacturer, sf.deviceType].filter(Boolean).join(' · ') || existing.productName;
          existing.ipAddress = sf.ipAddress ?? existing.ipAddress;
          existing.macAddress = sf.macAddress ?? existing.macAddress;
          existing.isOnline = sf.isOnline;
          existing.lastRawStatus = sf.rawTraits;
          existing.lastSeenAt = now.toISOString();
          if (sf.tempC !== null) existing.lastTempC = sf.tempC;
          if (sf.humidityPct !== null) existing.lastHumidityPct = sf.humidityPct;
          if (sf.batteryPct !== null) existing.lastBatteryPct = sf.batteryPct;
          if (sf.contactOpen !== null) existing.lastContactOpen = sf.contactOpen;
        }
        if (existingLink) {
          existingLink.externalName = sf.name;
        }
      } else {
        const candidateId = ensureUniqueDeviceId(
          makeSomfyDeviceId(sf.externalId),
          (id) => state.devices.some((d) => d.id === id),
          now
        );
        state.devices.push({
          id: candidateId,
          name: sf.name,
          customName: null,
          primaryVendor: 'somfy',
          systems: ['somfy'],
          roomId: mappedRoomId,
          category: sf.category,
          tuyaCategory: sf.deviceType ?? 'somfy',
          productName: [sf.manufacturer, sf.deviceType].filter(Boolean).join(' · ') || 'Somfy Overkiz',
          ipAddress: sf.ipAddress ?? null,
          macAddress: sf.macAddress ?? null,
          isOnline: sf.isOnline,
          isMonitored: isCover || sf.category !== 'other',
          excludeFromTotals: false,
          energyMode: 'hybrid',
          dpConfig: {},
          lastRawStatus: sf.rawTraits,
          lastSeenAt: now.toISOString(),
          lastPowerW: null,
          lastVoltageV: null,
          lastAddEleKwh: null,
          lastTempC: sf.tempC,
          lastHumidityPct: sf.humidityPct,
          lastBatteryPct: sf.batteryPct,
          lastContactOpen: sf.contactOpen,
        });
        state.vendorLinks.push({
          id: state.nextLinkId++,
          deviceId: candidateId,
          vendor: 'somfy',
          externalId: sf.externalId,
          externalName: sf.name,
          isPrimaryTelemetry: true,
          linkedAt: now.toISOString(),
        });
        newCount++;
      }
    }

    state.vendorConnections.somfy = {
      mode: 'cloud_account',
      connected: true,
      lastSyncedAt: now.toISOString(),
      lastError: inventory.warning ?? null,
    };

    const baseMsg = `${inventory.devices.length} équipement(s) et ${inventory.roomNames.length} pièce(s) synchronisés depuis Somfy Cloud (${newCount} nouveau(x)).`;
    return {
      syncedCount: inventory.devices.length,
      newCount,
      mode: 'demo',
      message: inventory.warning ? `${baseMsg} (${inventory.warning})` : baseMsg,
    };
  }

  await seedDefaultDataIfEmpty(db);
  const { cachedCookie } = await loadCachedSomfySession(db);
  let res;
  try {
    res = await fetchSomfyInventoryWithSession(cachedCookie);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur synchronisation Somfy Cloud';
    await persistSomfyConnectionInDb(db, {
      status: 'error',
      region: somfyCfg.region,
      baseUrl: somfyCfg.baseUrl,
      lastError: msg,
    });
    throw err;
  }

  const inventory = res.inventory;
  const { roomNameToId } = await ensureMissingRoomsInDb(db, inventory.roomNames);
  const { deviceById, linkByExternalId } = await loadVendorDeviceIndex(db, 'somfy');
  let newCount = 0;

  for (const sf of inventory.devices) {
    const mappedRoomId = sf.roomName
      ? (roomNameToId.get(sf.roomName.trim().toLowerCase()) ?? null)
      : null;
    const existingLink = linkByExternalId.get(sf.externalId);
    const linkedDevice = existingLink ? deviceById.get(existingLink.deviceId) : undefined;
    const isCover = isSomfyCoverUiClass(sf.deviceType);
    const productName =
      [sf.manufacturer, sf.deviceType].filter(Boolean).join(' · ') || 'Somfy Overkiz';
    const vendorMetadata = {
      manufacturer: sf.manufacturer,
      model: sf.model,
      deviceType: sf.deviceType,
      ipAddress: sf.ipAddress ?? null,
      macAddress: sf.macAddress ?? null,
    };

    if (linkedDevice) {
      const primaryVendor: VendorId = isValidVendorId(linkedDevice.primaryVendor)
        ? linkedDevice.primaryVendor
        : 'somfy';
      const nextSystems = mergeDeviceSystems(
        normalizeSystems(linkedDevice.systems, primaryVendor),
        'somfy',
        primaryVendor
      );

      if (primaryVendor === 'tuya') {
        await db
          .update(devices)
          .set({
            systems: nextSystems,
            roomId: linkedDevice.roomId ?? mappedRoomId,
          })
          .where(eq(devices.id, linkedDevice.id));
      } else {
        const nextRoomId = mappedRoomId ?? linkedDevice.roomId;
        await db
          .update(devices)
          .set({
            name: sf.name,
            systems: nextSystems,
            roomId: nextRoomId,
            category: sf.category,
            tuyaCategory: sf.deviceType ?? 'somfy',
            productName,
            ipAddress: sf.ipAddress ?? linkedDevice.ipAddress,
            macAddress: sf.macAddress ?? linkedDevice.macAddress,
            isOnline: sf.isOnline,
            lastRawStatus: sf.rawTraits,
            lastSeenAt: now,
            ...(sf.tempC !== null ? { lastTempC: sf.tempC } : {}),
            ...(sf.humidityPct !== null ? { lastHumidityPct: sf.humidityPct } : {}),
            ...(sf.batteryPct !== null ? { lastBatteryPct: sf.batteryPct } : {}),
            ...(sf.contactOpen !== null ? { lastContactOpen: sf.contactOpen } : {}),
          })
          .where(eq(devices.id, linkedDevice.id));

        await backfillMissingReadingRoomId(db, linkedDevice.id, nextRoomId, linkedDevice.roomId);
      }

      await db
        .update(deviceVendorLinks)
        .set({
          externalName: sf.name,
          vendorMetadata,
        })
        .where(eq(deviceVendorLinks.id, existingLink!.id));
    } else {
      const candidateId = ensureUniqueDeviceId(
        makeSomfyDeviceId(sf.externalId),
        (id) => deviceById.has(id),
        now
      );
      const isMonitored = isCover || sf.category !== 'other';

      const [inserted] = await db
        .insert(devices)
        .values({
          id: candidateId,
          name: sf.name,
          customName: null,
          primaryVendor: 'somfy',
          systems: ['somfy'],
          roomId: mappedRoomId,
          category: sf.category,
          tuyaCategory: sf.deviceType ?? 'somfy',
          productName,
          ipAddress: sf.ipAddress ?? null,
          macAddress: sf.macAddress ?? null,
          isOnline: sf.isOnline,
          isMonitored,
          excludeFromTotals: false,
          energyMode: 'hybrid',
          dpConfig: {},
          lastRawStatus: sf.rawTraits,
          lastSeenAt: now,
          lastPowerW: null,
          lastVoltageV: null,
          lastAddEleKwh: null,
          lastTempC: sf.tempC,
          lastHumidityPct: sf.humidityPct,
          lastBatteryPct: sf.batteryPct,
          lastContactOpen: sf.contactOpen,
        })
        .returning();

      await db
        .insert(deviceVendorLinks)
        .values({
          deviceId: candidateId,
          vendor: 'somfy',
          externalId: sf.externalId,
          externalName: sf.name,
          vendorMetadata,
          isPrimaryTelemetry: true,
          linkedAt: now,
        })
        .onConflictDoNothing();

      deviceById.set(candidateId, inserted);
      newCount++;
    }
  }

  await persistSomfyConnectionInDb(db, {
    status: 'connected',
    sessionCookie: res.sessionRenewed || !cachedCookie ? res.sessionCookie : undefined,
    region: res.region,
    baseUrl: res.baseUrl,
    lastSyncedAt: now,
    lastError: inventory.warning ?? null,
  });

  const baseMsg = `${inventory.devices.length} équipement(s) et ${inventory.roomNames.length} pièce(s) synchronisés depuis Somfy Cloud (${newCount} nouveau(x)).`;
  return {
    syncedCount: inventory.devices.length,
    newCount,
    mode: 'live',
    message: inventory.warning ? `${baseMsg} (${inventory.warning})` : baseMsg,
  };
}

export async function collectSomfyReadingsInDb(
  db: AppDatabase,
  somfyDevices: Array<typeof devices.$inferSelect>,
  now: Date
): Promise<VendorCollectionResult> {
  const somfyCfg = getSomfyConfig();
  if (somfyDevices.length === 0 || !somfyCfg.configured) {
    return { devicesCount: 0, updatedCount: 0, readingsInserted: 0 };
  }

  const { cachedCookie } = await loadCachedSomfySession(db);
  let res;
  try {
    res = await fetchSomfyInventoryWithSession(cachedCookie);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur collecte Somfy Cloud';
    await persistSomfyConnectionInDb(db, {
      status: 'error',
      region: somfyCfg.region,
      baseUrl: somfyCfg.baseUrl,
      lastError: msg,
    });
    throw err;
  }

  await persistSomfyConnectionInDb(db, {
    status: 'connected',
    sessionCookie: res.sessionRenewed || !cachedCookie ? res.sessionCookie : undefined,
    region: res.region,
    baseUrl: res.baseUrl,
    lastError: res.inventory.warning ?? null,
  });

  const deviceIdByExternalId = await loadVendorExternalDeviceMap(db, 'somfy');
  const deviceById = new Map(somfyDevices.map((d) => [d.id, d]));

  const readingsToInsert: Array<typeof metricReadings.$inferInsert> = [];
  let updatedCount = 0;

  for (const sf of res.inventory.devices) {
    const devId = deviceIdByExternalId.get(sf.externalId) ?? makeSomfyDeviceId(sf.externalId);
    const dev = deviceById.get(devId);
    if (!dev || !dev.isMonitored) continue;

    await db
      .update(devices)
      .set({
        isOnline: sf.isOnline,
        lastRawStatus: sf.rawTraits,
        lastSeenAt: now,
        ...(sf.ipAddress ? { ipAddress: sf.ipAddress } : {}),
        ...(sf.macAddress ? { macAddress: sf.macAddress } : {}),
        ...(sf.tempC !== null ? { lastTempC: sf.tempC } : {}),
        ...(sf.humidityPct !== null ? { lastHumidityPct: sf.humidityPct } : {}),
        ...(sf.batteryPct !== null ? { lastBatteryPct: sf.batteryPct } : {}),
        ...(sf.contactOpen !== null ? { lastContactOpen: sf.contactOpen } : {}),
      })
      .where(eq(devices.id, dev.id));
    updatedCount++;

    const hasClimate = sf.tempC !== null || sf.humidityPct !== null;
    const hasContact = sf.contactOpen !== null;
    const coverSummary = extractCoverSummary({
      name: sf.name,
      primaryVendor: 'somfy',
      tuyaCategory: sf.deviceType,
      category: sf.category,
      lastRawStatus: sf.rawTraits,
      lastBatteryPct: sf.batteryPct,
    });
    const hasCover = coverSummary !== null;

    if (hasClimate || hasContact || hasCover) {
      readingsToInsert.push({
        deviceId: dev.id,
        roomId: dev.roomId,
        recordedAt: now,
        powerW: null,
        voltageV: null,
        energyKwh: null,
        energySource: null,
        tempC: sf.tempC,
        humidityPct: sf.humidityPct,
        contactOpen: sf.contactOpen,
        coverState: coverSummary?.state ?? null,
        coverOpenPct: coverSummary?.openPct ?? null,
      });
    }
  }

  if (readingsToInsert.length > 0) {
    await db.insert(metricReadings).values(readingsToInsert);
  }

  return {
    devicesCount: somfyDevices.length,
    updatedCount,
    readingsInserted: readingsToInsert.length,
  };
}

export async function syncRoomsFromSomfy(): Promise<VendorRoomSyncResult> {
  const db = getDb();
  const somfyCfg = getSomfyConfig();
  const now = new Date();

  if (!somfyCfg.configured) {
    if (!db) {
      const state = getDemoState();
      state.vendorConnections.somfy.lastSyncedAt = now.toISOString();
      state.vendorConnections.somfy.lastError = null;
      return {
        vendor: 'somfy',
        roomsFound: state.rooms.length,
        createdCount: 0,
        assignedDevicesCount: 0,
        mode: 'demo',
        message: `Mode démo actif : ${state.rooms.length} pièce(s) Somfy Cloud simulée(s) déjà disponible(s).`,
      };
    }
    throw new Error(
      'Identifiants Somfy manquants. Configurez SOMFY_EMAIL et SOMFY_PASSWORD dans Vercel / .env.local.'
    );
  }

  if (!db) {
    const res = await fetchSomfyInventoryWithSession(null);
    const inventory = res.inventory;
    const state = getDemoState();
    const { roomNameToId, createdCount } = ensureMissingRoomsInDemo(inventory.roomNames);
    let assignedDevicesCount = 0;

    for (const sf of inventory.devices) {
      if (!sf.roomName) continue;
      const mappedRoomId = roomNameToId.get(sf.roomName.trim().toLowerCase()) ?? null;
      if (mappedRoomId === null) continue;
      const existingLink = state.vendorLinks.find(
        (l) => l.vendor === 'somfy' && l.externalId === sf.externalId
      );
      const linkedDevice = existingLink
        ? state.devices.find((d) => d.id === existingLink.deviceId)
        : undefined;
      if (!linkedDevice) continue;
      const shouldUpdate =
        linkedDevice.primaryVendor === 'tuya'
          ? linkedDevice.roomId === null
          : linkedDevice.roomId !== mappedRoomId;
      if (shouldUpdate) {
        linkedDevice.roomId = mappedRoomId;
        assignedDevicesCount++;
      }
    }

    state.vendorConnections.somfy = {
      mode: 'cloud_account',
      connected: true,
      lastSyncedAt: now.toISOString(),
      lastError: inventory.warning ?? null,
    };

    const baseMsg = `Somfy Cloud : ${inventory.roomNames.length} pièce(s) détectée(s) (${createdCount} créée(s), ${assignedDevicesCount} équipement(s) rattaché(s)).`;
    return {
      vendor: 'somfy',
      roomsFound: inventory.roomNames.length,
      createdCount,
      assignedDevicesCount,
      mode: 'demo',
      message: inventory.warning ? `${baseMsg} (${inventory.warning})` : baseMsg,
    };
  }

  await seedDefaultDataIfEmpty(db);
  const { cachedCookie } = await loadCachedSomfySession(db);
  let res;
  try {
    res = await fetchSomfyInventoryWithSession(cachedCookie);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur synchronisation pièces Somfy Cloud';
    await persistSomfyConnectionInDb(db, {
      status: 'error',
      region: somfyCfg.region,
      baseUrl: somfyCfg.baseUrl,
      lastError: msg,
    });
    throw err;
  }

  const inventory = res.inventory;
  const { roomNameToId, createdCount } = await ensureMissingRoomsInDb(db, inventory.roomNames);
  const [existingDeviceRows, somfyLinkRows] = await Promise.all([
    db
      .select({
        id: devices.id,
        primaryVendor: devices.primaryVendor,
        roomId: devices.roomId,
      })
      .from(devices),
    db.select().from(deviceVendorLinks).where(eq(deviceVendorLinks.vendor, 'somfy')),
  ]);

  const deviceById = new Map(existingDeviceRows.map((d) => [d.id, d]));
  const linkByExternalId = new Map(somfyLinkRows.map((l) => [l.externalId, l]));

  let assignedDevicesCount = 0;
  const updatedDeviceIds = new Set<string>();

  for (const sf of inventory.devices) {
    if (!sf.roomName) continue;
    const mappedRoomId = roomNameToId.get(sf.roomName.trim().toLowerCase()) ?? null;
    if (mappedRoomId === null) continue;

    const existingLink = linkByExternalId.get(sf.externalId);
    const linkedDevice = existingLink ? deviceById.get(existingLink.deviceId) : undefined;
    if (!linkedDevice || updatedDeviceIds.has(linkedDevice.id)) continue;

    const primaryVendor: VendorId = isValidVendorId(linkedDevice.primaryVendor)
      ? linkedDevice.primaryVendor
      : 'somfy';
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

  await persistSomfyConnectionInDb(db, {
    status: 'connected',
    sessionCookie: res.sessionRenewed || !cachedCookie ? res.sessionCookie : undefined,
    region: res.region,
    baseUrl: res.baseUrl,
    lastSyncedAt: now,
    lastError: inventory.warning ?? null,
  });

  const baseMsg = `Somfy Cloud : ${inventory.roomNames.length} pièce(s) détectée(s) (${createdCount} créée(s), ${assignedDevicesCount} équipement(s) rattaché(s)).`;
  return {
    vendor: 'somfy',
    roomsFound: inventory.roomNames.length,
    createdCount,
    assignedDevicesCount,
    mode: 'live',
    message: inventory.warning ? `${baseMsg} (${inventory.warning})` : baseMsg,
  };
}

export const somfyPlugin: VendorServerPlugin = {
  id: 'somfy',
  isConfigured: () => getSomfyConfig().configured,
  getConnectionMode: () => 'cloud_account',
  isConnectedLive: ({ conn, devices: mappedDevices }) =>
    getSomfyConfig().configured ||
    conn?.status === 'connected' ||
    mappedDevices.some((d) => d.systems.includes('somfy')),
  syncDevices: syncSomfyDevices,
  collectReadings: ({ db, monitoredDevices, now }) =>
    collectSomfyReadingsInDb(db, monitoredDevices, now),
  syncRooms: syncRoomsFromSomfy,
  isReadyForRoomSync: async (db) => (!db ? true : getSomfyConfig().configured),
};
