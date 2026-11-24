import { eq } from 'drizzle-orm';
import { getDb, type AppDatabase } from '@/db';
import { devices, deviceVendorLinks, metricReadings, vendorConnections } from '@/db/schema';
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
import { computeHybridEnergyKwh } from '@/lib/tariff-engine';
import { decryptSecret, encryptSecret } from '@/lib/vendors/crypto-store';
import { mergeDeviceSystems } from '@/lib/vendors/deduplication';
import { fetchKasaInventory, getKasaConfig, makeKasaDeviceId } from '@/lib/vendors/kasa-client';
import { isValidVendorId, normalizeSystems, type NormalizedVendorDevice } from '@/lib/vendors/registry';
import type { DpConfig, EnergyMode, VendorId } from '@/types';

function buildKasaDpConfig(kd: NormalizedVendorDevice): DpConfig {
  if (kd.powerW !== null || kd.addEleKwh !== null || kd.category === 'power') {
    return {
      power: { code: 'power_w', scale: 1 },
      voltage: { code: 'voltage_v', scale: 1 },
      addEle: { code: 'total_kwh', scale: 1 },
    };
  }
  return {};
}

async function loadCachedKasaSession(
  db: AppDatabase
): Promise<{ cachedToken: string | null; cachedCloudUrl: string | null }> {
  const rows = await db
    .select()
    .from(vendorConnections)
    .where(eq(vendorConnections.vendor, 'kasa'))
    .limit(1);
  const conn = rows[0];
  if (!conn) return { cachedToken: null, cachedCloudUrl: null };
  const cachedToken = decryptSecret(conn.accessToken);
  const rawUrl = conn.config && typeof conn.config.cloudUrl === 'string' ? conn.config.cloudUrl : null;
  return { cachedToken, cachedCloudUrl: rawUrl };
}

async function persistKasaConnectionInDb(
  db: AppDatabase,
  params: {
    status: 'connected' | 'error' | 'disconnected';
    sessionToken?: string | null;
    cloudUrl?: string | null;
    region: string;
    lastSyncedAt?: Date;
    lastError: string | null;
  }
): Promise<void> {
  const now = new Date();
  const encryptedToken = params.sessionToken ? encryptSecret(params.sessionToken) : undefined;
  const config = {
    region: params.region,
    ...(params.cloudUrl ? { cloudUrl: params.cloudUrl } : {}),
  };

  await db
    .insert(vendorConnections)
    .values({
      vendor: 'kasa',
      mode: 'cloud_account',
      status: params.status,
      ...(encryptedToken ? { accessToken: encryptedToken } : {}),
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
        ...(encryptedToken ? { accessToken: encryptedToken } : {}),
        config,
        ...(params.lastSyncedAt ? { lastSyncedAt: params.lastSyncedAt } : {}),
        lastError: params.lastError,
        updatedAt: now,
      },
    });
}

export async function syncKasaDevices(): Promise<VendorSyncResult> {
  const db = getDb();
  const kasaCfg = getKasaConfig();
  const now = new Date();

  if (!kasaCfg.configured) {
    if (!db) {
      const state = getDemoState();
      state.vendorConnections.kasa.lastSyncedAt = now.toISOString();
      state.vendorConnections.kasa.lastError = null;
      const kasaCount = state.devices.filter((d) => d.systems.includes('kasa')).length;
      return {
        syncedCount: kasaCount,
        newCount: 0,
        mode: 'demo',
        message: `Mode démo actif : ${kasaCount} appareil(s) Kasa Cloud simulé(s) déjà synchronisé(s).`,
      };
    }
    throw new Error(
      'Identifiants Kasa manquants. Configurez KASA_EMAIL et KASA_PASSWORD dans Vercel / .env.local.'
    );
  }

  let inventory;
  if (!db) {
    inventory = await fetchKasaInventory({ includeTelemetry: true });
    const state = getDemoState();
    const { roomNameToId } = ensureMissingRoomsInDemo(inventory.roomNames);
    let newCount = 0;

    for (const kd of inventory.devices) {
      const mappedRoomId = kd.roomName
        ? (roomNameToId.get(kd.roomName.trim().toLowerCase()) ?? null)
        : null;
      const existingLink = state.vendorLinks.find(
        (l) => l.vendor === 'kasa' && l.externalId === kd.externalId
      );
      const existing = existingLink
        ? state.devices.find((d) => d.id === existingLink.deviceId)
        : undefined;

      if (existing) {
        existing.systems = mergeDeviceSystems(
          normalizeSystems(existing.systems, existing.primaryVendor),
          'kasa',
          existing.primaryVendor
        );
        if (existing.primaryVendor === 'tuya') {
          if (existing.roomId === null && mappedRoomId !== null) existing.roomId = mappedRoomId;
        } else {
          existing.name = kd.name;
          if (mappedRoomId !== null) existing.roomId = mappedRoomId;
          existing.category = kd.category;
          existing.tuyaCategory = kd.deviceType ?? 'kasa';
          existing.productName =
            [kd.manufacturer, kd.model].filter(Boolean).join(' · ') || existing.productName;
          existing.macAddress = kd.macAddress ?? existing.macAddress;
          existing.isOnline = kd.isOnline;
          if (Object.keys(existing.dpConfig ?? {}).length === 0) {
            existing.dpConfig = buildKasaDpConfig(kd);
          }
          existing.lastRawStatus = kd.rawTraits;
          existing.lastSeenAt = now.toISOString();
          if (kd.powerW !== null) existing.lastPowerW = kd.powerW;
          if (kd.voltageV !== undefined && kd.voltageV !== null) existing.lastVoltageV = kd.voltageV;
          if (kd.addEleKwh !== undefined && kd.addEleKwh !== null) existing.lastAddEleKwh = kd.addEleKwh;
        }
        if (existingLink) {
          existingLink.externalName = kd.name;
        }
      } else {
        const candidateId = ensureUniqueDeviceId(
          makeKasaDeviceId(kd.externalId),
          (id) => state.devices.some((d) => d.id === id),
          now
        );
        state.devices.push({
          id: candidateId,
          name: kd.name,
          customName: null,
          primaryVendor: 'kasa',
          systems: ['kasa'],
          roomId: mappedRoomId,
          category: kd.category,
          tuyaCategory: kd.deviceType ?? 'kasa',
          productName: [kd.manufacturer, kd.model].filter(Boolean).join(' · ') || 'TP-Link Kasa',
          ipAddress: kd.ipAddress ?? null,
          macAddress: kd.macAddress ?? null,
          isOnline: kd.isOnline,
          isMonitored: kd.category !== 'other',
          excludeFromTotals: false,
          energyMode: 'hybrid',
          dpConfig: buildKasaDpConfig(kd),
          lastRawStatus: kd.rawTraits,
          lastSeenAt: now.toISOString(),
          lastPowerW: kd.powerW,
          lastVoltageV: kd.voltageV ?? null,
          lastAddEleKwh: kd.addEleKwh ?? null,
          lastTempC: kd.tempC,
          lastHumidityPct: kd.humidityPct,
          lastBatteryPct: kd.batteryPct,
          lastContactOpen: kd.contactOpen,
        });
        state.vendorLinks.push({
          id: state.nextLinkId++,
          deviceId: candidateId,
          vendor: 'kasa',
          externalId: kd.externalId,
          externalName: kd.name,
          isPrimaryTelemetry: true,
          linkedAt: now.toISOString(),
        });
        newCount++;
      }
    }

    state.vendorConnections.kasa = {
      mode: 'cloud_account',
      connected: true,
      lastSyncedAt: now.toISOString(),
      lastError: inventory.warning ?? null,
    };

    const baseMsg = `${inventory.devices.length} appareil(s) et ${inventory.roomNames.length} pièce(s)/groupe(s) synchronisés depuis Kasa Cloud (${newCount} nouveau(x)).`;
    return {
      syncedCount: inventory.devices.length,
      newCount,
      mode: 'demo',
      message: inventory.warning ? `${baseMsg} (${inventory.warning})` : baseMsg,
    };
  }

  await seedDefaultDataIfEmpty(db);
  const { cachedToken, cachedCloudUrl } = await loadCachedKasaSession(db);

  try {
    inventory = await fetchKasaInventory({
      cachedToken,
      cachedCloudUrl,
      includeTelemetry: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur synchronisation Kasa Cloud';
    await persistKasaConnectionInDb(db, {
      status: 'error',
      region: kasaCfg.region,
      lastError: msg,
    });
    throw err;
  }

  const { roomNameToId } = await ensureMissingRoomsInDb(db, inventory.roomNames);
  const { deviceById, linkByExternalId } = await loadVendorDeviceIndex(db, 'kasa');
  let newCount = 0;

  for (const kd of inventory.devices) {
    const mappedRoomId = kd.roomName
      ? (roomNameToId.get(kd.roomName.trim().toLowerCase()) ?? null)
      : null;
    const existingLink = linkByExternalId.get(kd.externalId);
    const linkedDevice = existingLink ? deviceById.get(existingLink.deviceId) : undefined;
    const productName =
      [kd.manufacturer, kd.model].filter(Boolean).join(' · ') || 'TP-Link Kasa';
    const vendorMetadata = {
      manufacturer: kd.manufacturer,
      model: kd.model,
      deviceType: kd.deviceType,
      macAddress: kd.macAddress ?? null,
    };

    if (linkedDevice) {
      const primaryVendor: VendorId = isValidVendorId(linkedDevice.primaryVendor)
        ? linkedDevice.primaryVendor
        : 'kasa';
      const nextSystems = mergeDeviceSystems(
        normalizeSystems(linkedDevice.systems, primaryVendor),
        'kasa',
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
        const nextDpConfig =
          linkedDevice.dpConfig && Object.keys(linkedDevice.dpConfig).length > 0
            ? linkedDevice.dpConfig
            : buildKasaDpConfig(kd);

        await db
          .update(devices)
          .set({
            name: kd.name,
            systems: nextSystems,
            roomId: nextRoomId,
            category: kd.category,
            tuyaCategory: kd.deviceType ?? 'kasa',
            productName,
            macAddress: kd.macAddress ?? linkedDevice.macAddress,
            isOnline: kd.isOnline,
            dpConfig: nextDpConfig,
            lastRawStatus: kd.rawTraits,
            lastSeenAt: now,
            lastPowerW: kd.powerW ?? linkedDevice.lastPowerW,
            lastVoltageV: kd.voltageV ?? linkedDevice.lastVoltageV,
            lastAddEleKwh: kd.addEleKwh ?? linkedDevice.lastAddEleKwh,
            lastTempC: kd.tempC ?? linkedDevice.lastTempC,
            lastHumidityPct: kd.humidityPct ?? linkedDevice.lastHumidityPct,
            lastBatteryPct: kd.batteryPct ?? linkedDevice.lastBatteryPct,
            lastContactOpen:
              kd.contactOpen !== null ? kd.contactOpen : linkedDevice.lastContactOpen,
          })
          .where(eq(devices.id, linkedDevice.id));

        await backfillMissingReadingRoomId(db, linkedDevice.id, nextRoomId, linkedDevice.roomId);
      }

      await db
        .update(deviceVendorLinks)
        .set({
          externalName: kd.name,
          vendorMetadata,
        })
        .where(eq(deviceVendorLinks.id, existingLink!.id));
    } else {
      const candidateId = ensureUniqueDeviceId(
        makeKasaDeviceId(kd.externalId),
        (id) => deviceById.has(id),
        now
      );
      const isMonitored = kd.category !== 'other';

      const [inserted] = await db
        .insert(devices)
        .values({
          id: candidateId,
          name: kd.name,
          customName: null,
          primaryVendor: 'kasa',
          systems: ['kasa'],
          roomId: mappedRoomId,
          category: kd.category,
          tuyaCategory: kd.deviceType ?? 'kasa',
          productName,
          ipAddress: kd.ipAddress ?? null,
          macAddress: kd.macAddress ?? null,
          isOnline: kd.isOnline,
          isMonitored,
          excludeFromTotals: false,
          energyMode: 'hybrid',
          dpConfig: buildKasaDpConfig(kd),
          lastRawStatus: kd.rawTraits,
          lastSeenAt: now,
          lastPowerW: kd.powerW,
          lastVoltageV: kd.voltageV ?? null,
          lastAddEleKwh: kd.addEleKwh ?? null,
          lastTempC: kd.tempC,
          lastHumidityPct: kd.humidityPct,
          lastBatteryPct: kd.batteryPct,
          lastContactOpen: kd.contactOpen,
        })
        .returning();

      await db
        .insert(deviceVendorLinks)
        .values({
          deviceId: candidateId,
          vendor: 'kasa',
          externalId: kd.externalId,
          externalName: kd.name,
          vendorMetadata,
          isPrimaryTelemetry: true,
          linkedAt: now,
        })
        .onConflictDoNothing();

      deviceById.set(candidateId, inserted);
      newCount++;
    }
  }

  await persistKasaConnectionInDb(db, {
    status: 'connected',
    sessionToken: inventory.sessionToken,
    cloudUrl: inventory.cloudUrl,
    region: kasaCfg.region,
    lastSyncedAt: now,
    lastError: inventory.warning ?? null,
  });

  const baseMsg = `${inventory.devices.length} appareil(s) et ${inventory.roomNames.length} pièce(s)/groupe(s) synchronisés depuis Kasa Cloud (${newCount} nouveau(x)).`;
  return {
    syncedCount: inventory.devices.length,
    newCount,
    mode: 'live',
    message: inventory.warning ? `${baseMsg} (${inventory.warning})` : baseMsg,
  };
}

export async function collectKasaReadingsInDb(
  db: AppDatabase,
  kasaDevices: Array<typeof devices.$inferSelect>,
  now: Date
): Promise<VendorCollectionResult> {
  const kasaCfg = getKasaConfig();
  if (kasaDevices.length === 0 || !kasaCfg.configured) {
    return { devicesCount: 0, readingsInserted: 0, updatedCount: 0 };
  }

  const { cachedToken, cachedCloudUrl } = await loadCachedKasaSession(db);
  let inventory;
  try {
    inventory = await fetchKasaInventory({
      cachedToken,
      cachedCloudUrl,
      includeTelemetry: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur collecte Kasa Cloud';
    await persistKasaConnectionInDb(db, {
      status: 'error',
      region: kasaCfg.region,
      lastError: msg,
    });
    throw err;
  }

  await persistKasaConnectionInDb(db, {
    status: 'connected',
    sessionToken: inventory.sessionToken,
    cloudUrl: inventory.cloudUrl,
    region: kasaCfg.region,
    lastError: inventory.warning ?? null,
  });

  const deviceIdByExternalId = await loadVendorExternalDeviceMap(db, 'kasa');
  const deviceById = new Map(kasaDevices.map((d) => [d.id, d]));

  const readingsToInsert: Array<typeof metricReadings.$inferInsert> = [];
  let updatedCount = 0;

  for (const kd of inventory.devices) {
    const devId = deviceIdByExternalId.get(kd.externalId) ?? makeKasaDeviceId(kd.externalId);
    const dev = deviceById.get(devId);
    if (!dev || !dev.isMonitored) continue;

    const hasPower = kd.powerW !== null || (kd.addEleKwh !== undefined && kd.addEleKwh !== null);
    const hasClimate = kd.tempC !== null || kd.humidityPct !== null;
    const hasContact = kd.contactOpen !== null;

    const energyRes = hasPower
      ? computeHybridEnergyKwh({
          energyMode: (dev.energyMode as EnergyMode) || 'hybrid',
          powerW: kd.powerW,
          currentAddEleKwh: kd.addEleKwh ?? null,
          previousAddEleKwh: dev.lastAddEleKwh,
          previousSeenAt: dev.lastSeenAt,
          now,
        })
      : null;

    await db
      .update(devices)
      .set({
        isOnline: kd.isOnline,
        lastRawStatus: kd.rawTraits,
        lastSeenAt: now,
        ...(kd.macAddress ? { macAddress: kd.macAddress } : {}),
        ...(kd.powerW !== null ? { lastPowerW: kd.powerW } : {}),
        ...(kd.voltageV !== undefined && kd.voltageV !== null
          ? { lastVoltageV: kd.voltageV }
          : {}),
        ...(kd.addEleKwh !== undefined && kd.addEleKwh !== null
          ? { lastAddEleKwh: kd.addEleKwh }
          : {}),
        ...(kd.tempC !== null ? { lastTempC: kd.tempC } : {}),
        ...(kd.humidityPct !== null ? { lastHumidityPct: kd.humidityPct } : {}),
        ...(kd.batteryPct !== null ? { lastBatteryPct: kd.batteryPct } : {}),
        ...(kd.contactOpen !== null ? { lastContactOpen: kd.contactOpen } : {}),
      })
      .where(eq(devices.id, dev.id));
    updatedCount++;

    if (hasPower || hasClimate || hasContact) {
      readingsToInsert.push({
        deviceId: dev.id,
        roomId: dev.roomId,
        recordedAt: now,
        powerW: kd.powerW,
        voltageV: kd.voltageV ?? null,
        energyKwh: energyRes ? energyRes.energyKwh : null,
        energySource: energyRes ? energyRes.source : null,
        tempC: kd.tempC,
        humidityPct: kd.humidityPct,
        contactOpen: kd.contactOpen,
      });
    }
  }

  if (readingsToInsert.length > 0) {
    await db.insert(metricReadings).values(readingsToInsert);
  }
  return {
    devicesCount: kasaDevices.length,
    readingsInserted: readingsToInsert.length,
    updatedCount,
  };
}

export async function syncRoomsFromKasa(): Promise<VendorRoomSyncResult> {
  const db = getDb();
  const kasaCfg = getKasaConfig();
  const now = new Date();

  if (!kasaCfg.configured) {
    if (!db) {
      const state = getDemoState();
      state.vendorConnections.kasa.lastSyncedAt = now.toISOString();
      state.vendorConnections.kasa.lastError = null;
      return {
        vendor: 'kasa',
        roomsFound: state.rooms.length,
        createdCount: 0,
        assignedDevicesCount: 0,
        mode: 'demo',
        message: `Mode démo actif : ${state.rooms.length} pièce(s) Kasa Cloud simulée(s) déjà disponible(s).`,
      };
    }
    throw new Error(
      'Identifiants Kasa manquants. Configurez KASA_EMAIL et KASA_PASSWORD dans Vercel / .env.local.'
    );
  }

  if (!db) {
    const inventory = await fetchKasaInventory({ includeTelemetry: true });
    const state = getDemoState();
    const { roomNameToId, createdCount } = ensureMissingRoomsInDemo(inventory.roomNames);
    let assignedDevicesCount = 0;

    for (const kd of inventory.devices) {
      if (!kd.roomName) continue;
      const mappedRoomId = roomNameToId.get(kd.roomName.trim().toLowerCase()) ?? null;
      if (mappedRoomId === null) continue;
      const existingLink = state.vendorLinks.find(
        (l) => l.vendor === 'kasa' && l.externalId === kd.externalId
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

    state.vendorConnections.kasa = {
      mode: 'cloud_account',
      connected: true,
      lastSyncedAt: now.toISOString(),
      lastError: inventory.warning ?? null,
    };

    const baseMsg = `Kasa Cloud : ${inventory.roomNames.length} pièce(s)/groupe(s) détecté(s) (${createdCount} créée(s), ${assignedDevicesCount} appareil(s) rattaché(s)).`;
    return {
      vendor: 'kasa',
      roomsFound: inventory.roomNames.length,
      createdCount,
      assignedDevicesCount,
      mode: 'demo',
      message: inventory.warning ? `${baseMsg} (${inventory.warning})` : baseMsg,
    };
  }

  await seedDefaultDataIfEmpty(db);
  const { cachedToken, cachedCloudUrl } = await loadCachedKasaSession(db);
  let inventory;
  try {
    inventory = await fetchKasaInventory({
      cachedToken,
      cachedCloudUrl,
      includeTelemetry: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur synchronisation pièces Kasa Cloud';
    await persistKasaConnectionInDb(db, {
      status: 'error',
      region: kasaCfg.region,
      lastError: msg,
    });
    throw err;
  }

  const { roomNameToId, createdCount } = await ensureMissingRoomsInDb(db, inventory.roomNames);
  const [existingDeviceRows, kasaLinkRows] = await Promise.all([
    db
      .select({
        id: devices.id,
        primaryVendor: devices.primaryVendor,
        roomId: devices.roomId,
      })
      .from(devices),
    db.select().from(deviceVendorLinks).where(eq(deviceVendorLinks.vendor, 'kasa')),
  ]);

  const deviceById = new Map(existingDeviceRows.map((d) => [d.id, d]));
  const linkByExternalId = new Map(kasaLinkRows.map((l) => [l.externalId, l]));

  let assignedDevicesCount = 0;
  const updatedDeviceIds = new Set<string>();

  for (const kd of inventory.devices) {
    if (!kd.roomName) continue;
    const mappedRoomId = roomNameToId.get(kd.roomName.trim().toLowerCase()) ?? null;
    if (mappedRoomId === null) continue;

    const existingLink = linkByExternalId.get(kd.externalId);
    const linkedDevice = existingLink ? deviceById.get(existingLink.deviceId) : undefined;
    if (!linkedDevice || updatedDeviceIds.has(linkedDevice.id)) continue;

    const primaryVendor: VendorId = isValidVendorId(linkedDevice.primaryVendor)
      ? linkedDevice.primaryVendor
      : 'kasa';
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

  await persistKasaConnectionInDb(db, {
    status: 'connected',
    sessionToken: inventory.sessionToken,
    cloudUrl: inventory.cloudUrl,
    region: kasaCfg.region,
    lastSyncedAt: now,
    lastError: inventory.warning ?? null,
  });

  const baseMsg = `Kasa Cloud : ${inventory.roomNames.length} pièce(s)/groupe(s) détecté(s) (${createdCount} créée(s), ${assignedDevicesCount} appareil(s) rattaché(s)).`;
  return {
    vendor: 'kasa',
    roomsFound: inventory.roomNames.length,
    createdCount,
    assignedDevicesCount,
    mode: 'live',
    message: inventory.warning ? `${baseMsg} (${inventory.warning})` : baseMsg,
  };
}

export const kasaPlugin: VendorServerPlugin = {
  id: 'kasa',
  isConfigured: () => getKasaConfig().configured,
  getConnectionMode: () => 'cloud_account',
  isConnectedLive: ({ conn, devices: mappedDevices }) =>
    getKasaConfig().configured ||
    conn?.status === 'connected' ||
    mappedDevices.some((d) => d.systems.includes('kasa')),
  syncDevices: syncKasaDevices,
  collectReadings: ({ db, monitoredDevices, now }) =>
    collectKasaReadingsInDb(db, monitoredDevices, now),
  syncRooms: syncRoomsFromKasa,
  isReadyForRoomSync: async (db) => (!db ? true : getKasaConfig().configured),
};
