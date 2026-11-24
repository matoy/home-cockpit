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
  VendorServerPlugin,
  VendorSyncResult,
} from '@/lib/services/vendors/types';
import {
  ensureUniqueDeviceId,
  loadVendorDeviceIndex,
  loadVendorExternalDeviceMap,
} from '@/lib/services/vendors/upsert-helper';
import { decryptSecret, encryptSecret } from '@/lib/vendors/crypto-store';
import { mergeDeviceSystems } from '@/lib/vendors/deduplication';
import { isValidVendorId, normalizeSystems } from '@/lib/vendors/registry';
import {
  fetchXSenseInventoryWithSession,
  getXSenseConfig,
  makeXSenseDeviceId,
  type XSenseSession,
} from '@/lib/vendors/xsense-client';
import type { VendorId } from '@/types';

async function loadCachedXSenseSession(db: AppDatabase): Promise<XSenseSession | null> {
  const rows = await db
    .select()
    .from(vendorConnections)
    .where(eq(vendorConnections.vendor, 'xsense'))
    .limit(1);
  const conn = rows[0];
  if (!conn || !conn.accessToken) return null;
  const decrypted = decryptSecret(conn.accessToken);
  if (!decrypted) return null;
  try {
    const parsed = JSON.parse(decrypted) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as XSenseSession) : null;
  } catch {
    return null;
  }
}

async function persistXSenseConnectionInDb(
  db: AppDatabase,
  params: {
    status: 'connected' | 'error' | 'disconnected';
    session?: XSenseSession | null;
    lastSyncedAt?: Date;
    lastError: string | null;
  }
): Promise<void> {
  const now = new Date();
  const encryptedSession = params.session
    ? encryptSecret(JSON.stringify(params.session))
    : undefined;
  const encryptedRefresh = params.session?.refreshToken
    ? encryptSecret(params.session.refreshToken)
    : undefined;

  await db
    .insert(vendorConnections)
    .values({
      vendor: 'xsense',
      mode: 'cloud_account',
      status: params.status,
      ...(encryptedSession ? { accessToken: encryptedSession } : {}),
      ...(encryptedRefresh ? { refreshToken: encryptedRefresh } : {}),
      config: {},
      ...(params.lastSyncedAt ? { lastSyncedAt: params.lastSyncedAt } : {}),
      lastError: params.lastError,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: vendorConnections.vendor,
      set: {
        mode: 'cloud_account',
        status: params.status,
        ...(encryptedSession ? { accessToken: encryptedSession } : {}),
        ...(encryptedRefresh ? { refreshToken: encryptedRefresh } : {}),
        ...(params.lastSyncedAt ? { lastSyncedAt: params.lastSyncedAt } : {}),
        lastError: params.lastError,
        updatedAt: now,
      },
    });
}

export async function syncXSenseDevices(): Promise<VendorSyncResult> {
  const db = getDb();
  const xsenseCfg = getXSenseConfig();
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    if (!xsenseCfg.configured) {
      state.vendorConnections.xsense.connected = true;
      state.vendorConnections.xsense.lastSyncedAt = now.toISOString();
      state.vendorConnections.xsense.lastError = null;
      const xsCount = state.devices.filter((d) => d.systems.includes('xsense')).length;
      return {
        syncedCount: xsCount,
        newCount: 0,
        mode: 'demo',
        message: `Mode démo actif : ${xsCount} équipement(s) X-Sense Security simulé(s) synchronisé(s).`,
      };
    }

    const { inventory } = await fetchXSenseInventoryWithSession(null);
    const { roomNameToId } = ensureMissingRoomsInDemo(inventory.roomNames);
    let newCount = 0;

    for (const xs of inventory.devices) {
      const mappedRoomId = xs.roomName
        ? (roomNameToId.get(xs.roomName.trim().toLowerCase()) ?? null)
        : null;
      const existingLink = state.vendorLinks.find(
        (l) => l.vendor === 'xsense' && l.externalId === xs.externalId
      );
      const existing = existingLink
        ? state.devices.find((d) => d.id === existingLink.deviceId)
        : undefined;

      if (existing) {
        existing.systems = mergeDeviceSystems(
          normalizeSystems(existing.systems, existing.primaryVendor),
          'xsense',
          existing.primaryVendor
        );
        if (existing.primaryVendor !== 'tuya') {
          existing.name = xs.name;
          if (mappedRoomId !== null) existing.roomId = mappedRoomId;
          existing.category = xs.category;
          existing.tuyaCategory = xs.deviceType ?? 'xsense';
          existing.productName =
            [xs.manufacturer, xs.model].filter(Boolean).join(' · ') || existing.productName;
          existing.ipAddress = xs.ipAddress ?? existing.ipAddress;
          existing.macAddress = xs.macAddress ?? existing.macAddress;
          existing.isOnline = xs.isOnline;
          existing.lastRawStatus = xs.rawTraits;
          existing.lastSeenAt = now.toISOString();
          if (xs.tempC !== null) existing.lastTempC = xs.tempC;
          if (xs.humidityPct !== null) existing.lastHumidityPct = xs.humidityPct;
          if (xs.batteryPct !== null) existing.lastBatteryPct = xs.batteryPct;
        }
        if (existingLink) existingLink.externalName = xs.name;
      } else {
        const candidateId = ensureUniqueDeviceId(
          makeXSenseDeviceId(xs.externalId),
          (id) => state.devices.some((d) => d.id === id),
          now
        );
        state.devices.push({
          id: candidateId,
          name: xs.name,
          customName: null,
          primaryVendor: 'xsense',
          systems: ['xsense'],
          roomId: mappedRoomId,
          category: xs.category,
          tuyaCategory: xs.deviceType ?? 'xsense',
          productName: [xs.manufacturer, xs.model].filter(Boolean).join(' · ') || 'X-Sense',
          ipAddress: xs.ipAddress ?? null,
          macAddress: xs.macAddress ?? null,
          isOnline: xs.isOnline,
          isMonitored: true,
          excludeFromTotals: false,
          energyMode: 'hybrid',
          dpConfig: {},
          lastRawStatus: xs.rawTraits,
          lastSeenAt: now.toISOString(),
          lastPowerW: null,
          lastVoltageV: null,
          lastAddEleKwh: null,
          lastTempC: xs.tempC,
          lastHumidityPct: xs.humidityPct,
          lastBatteryPct: xs.batteryPct,
          lastContactOpen: null,
        });
        state.vendorLinks.push({
          id: state.nextLinkId++,
          deviceId: candidateId,
          vendor: 'xsense',
          externalId: xs.externalId,
          externalName: xs.name,
          isPrimaryTelemetry: true,
          linkedAt: now.toISOString(),
        });
        newCount++;
      }
    }

    state.vendorConnections.xsense = {
      mode: 'cloud_account',
      connected: true,
      lastSyncedAt: now.toISOString(),
      lastError: inventory.warning ?? null,
    };
    return {
      syncedCount: inventory.devices.length,
      newCount,
      mode: 'demo',
      message: `${inventory.devices.length} équipement(s) X-Sense synchronisé(s) (${newCount} nouveau(x)).`,
    };
  }

  await seedDefaultDataIfEmpty(db);
  if (!xsenseCfg.configured) {
    throw new Error(
      'Identifiants X-Sense manquants dans .env.local (XSENSE_EMAIL et XSENSE_PASSWORD).'
    );
  }

  const cachedSession = await loadCachedXSenseSession(db);
  let res;
  try {
    res = await fetchXSenseInventoryWithSession(cachedSession);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur synchronisation X-Sense Security';
    await persistXSenseConnectionInDb(db, {
      status: 'error',
      lastError: msg,
    });
    throw err;
  }

  const { inventory } = res;
  const { roomNameToId } = await ensureMissingRoomsInDb(db, inventory.roomNames);
  const { deviceById, linkByExternalId } = await loadVendorDeviceIndex(db, 'xsense');
  let newCount = 0;

  for (const xs of inventory.devices) {
    const mappedRoomId = xs.roomName
      ? (roomNameToId.get(xs.roomName.trim().toLowerCase()) ?? null)
      : null;
    const existingLink = linkByExternalId.get(xs.externalId);
    const linkedDevice = existingLink ? deviceById.get(existingLink.deviceId) : undefined;
    const productName = [xs.manufacturer, xs.model].filter(Boolean).join(' · ') || 'X-Sense';
    const vendorMetadata = {
      manufacturer: xs.manufacturer,
      model: xs.model,
      deviceType: xs.deviceType,
      roomName: xs.roomName,
    };

    if (linkedDevice) {
      const primaryVendor: VendorId = isValidVendorId(linkedDevice.primaryVendor)
        ? linkedDevice.primaryVendor
        : 'xsense';
      const nextSystems = mergeDeviceSystems(
        normalizeSystems(linkedDevice.systems, primaryVendor),
        'xsense',
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
            name: xs.name,
            systems: nextSystems,
            ...(linkedDevice.roomId === null && mappedRoomId !== null
              ? { roomId: mappedRoomId }
              : {}),
            category: xs.category,
            tuyaCategory: xs.deviceType ?? 'xsense',
            productName,
            ipAddress: linkedDevice.ipAddress ?? xs.ipAddress ?? null,
            macAddress: linkedDevice.macAddress ?? xs.macAddress ?? null,
            isOnline: xs.isOnline,
            lastRawStatus: xs.rawTraits,
            lastSeenAt: now,
            ...(xs.tempC !== null ? { lastTempC: xs.tempC } : {}),
            ...(xs.humidityPct !== null ? { lastHumidityPct: xs.humidityPct } : {}),
            ...(xs.batteryPct !== null ? { lastBatteryPct: xs.batteryPct } : {}),
          })
          .where(eq(devices.id, linkedDevice.id));
      }

      await db
        .update(deviceVendorLinks)
        .set({ externalName: xs.name, vendorMetadata })
        .where(eq(deviceVendorLinks.id, existingLink!.id));
    } else {
      const candidateId = ensureUniqueDeviceId(
        makeXSenseDeviceId(xs.externalId),
        (id) => deviceById.has(id),
        now
      );
      const [inserted] = await db
        .insert(devices)
        .values({
          id: candidateId,
          name: xs.name,
          customName: null,
          primaryVendor: 'xsense',
          systems: ['xsense'],
          roomId: mappedRoomId,
          category: xs.category,
          tuyaCategory: xs.deviceType ?? 'xsense',
          productName,
          ipAddress: xs.ipAddress ?? null,
          macAddress: xs.macAddress ?? null,
          isOnline: xs.isOnline,
          isMonitored: true,
          excludeFromTotals: false,
          energyMode: 'hybrid',
          dpConfig: {},
          lastRawStatus: xs.rawTraits,
          lastSeenAt: now,
          lastPowerW: null,
          lastVoltageV: null,
          lastAddEleKwh: null,
          lastTempC: xs.tempC,
          lastHumidityPct: xs.humidityPct,
          lastBatteryPct: xs.batteryPct,
          lastContactOpen: null,
        })
        .returning();

      await db
        .insert(deviceVendorLinks)
        .values({
          deviceId: candidateId,
          vendor: 'xsense',
          externalId: xs.externalId,
          externalName: xs.name,
          vendorMetadata,
          isPrimaryTelemetry: true,
          linkedAt: now,
        })
        .onConflictDoNothing();

      deviceById.set(candidateId, inserted);
      newCount++;
    }
  }

  await persistXSenseConnectionInDb(db, {
    status: 'connected',
    session: res.sessionRenewed || !cachedSession ? res.session : undefined,
    lastSyncedAt: now,
    lastError: inventory.warning ?? null,
  });

  return {
    syncedCount: inventory.devices.length,
    newCount,
    mode: 'live',
    message: `${inventory.devices.length} équipement(s) X-Sense Security synchronisé(s) (${newCount} nouveau(x)).`,
  };
}

export async function collectXSenseReadingsInDb(
  db: AppDatabase,
  xsenseDevices: Array<typeof devices.$inferSelect>,
  now: Date
): Promise<VendorCollectionResult> {
  const xsenseCfg = getXSenseConfig();
  if (xsenseDevices.length === 0 || !xsenseCfg.configured) {
    return { devicesCount: 0, updatedCount: 0, readingsInserted: 0 };
  }

  const cachedSession = await loadCachedXSenseSession(db);
  let res;
  try {
    res = await fetchXSenseInventoryWithSession(cachedSession);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur collecte X-Sense';
    await persistXSenseConnectionInDb(db, {
      status: 'error',
      lastError: msg,
    });
    throw err;
  }

  await persistXSenseConnectionInDb(db, {
    status: 'connected',
    session: res.sessionRenewed || !cachedSession ? res.session : undefined,
    lastSyncedAt: now,
    lastError: res.inventory.warning ?? null,
  });

  const deviceIdByExternalId = await loadVendorExternalDeviceMap(db, 'xsense');
  const deviceById = new Map(xsenseDevices.map((d) => [d.id, d]));
  const readingsToInsert: Array<typeof metricReadings.$inferInsert> = [];
  let updatedCount = 0;

  for (const xs of res.inventory.devices) {
    const devId = deviceIdByExternalId.get(xs.externalId) ?? makeXSenseDeviceId(xs.externalId);
    const dev = deviceById.get(devId);
    if (!dev || !dev.isMonitored) continue;

    await db
      .update(devices)
      .set({
        isOnline: xs.isOnline,
        lastRawStatus: xs.rawTraits,
        lastSeenAt: now,
        ...(xs.ipAddress ? { ipAddress: xs.ipAddress } : {}),
        ...(xs.macAddress ? { macAddress: xs.macAddress } : {}),
        ...(xs.tempC !== null ? { lastTempC: xs.tempC } : {}),
        ...(xs.humidityPct !== null ? { lastHumidityPct: xs.humidityPct } : {}),
        ...(xs.batteryPct !== null ? { lastBatteryPct: xs.batteryPct } : {}),
      })
      .where(eq(devices.id, dev.id));
    updatedCount++;

    if (xs.tempC !== null || xs.humidityPct !== null) {
      readingsToInsert.push({
        deviceId: dev.id,
        roomId: dev.roomId,
        recordedAt: now,
        powerW: null,
        voltageV: null,
        energyKwh: null,
        energySource: null,
        tempC: xs.tempC,
        humidityPct: xs.humidityPct,
        contactOpen: null,
      });
    }
  }

  if (readingsToInsert.length > 0) {
    await db.insert(metricReadings).values(readingsToInsert);
  }

  return {
    devicesCount: xsenseDevices.length,
    updatedCount,
    readingsInserted: readingsToInsert.length,
  };
}

export const xsensePlugin: VendorServerPlugin = {
  id: 'xsense',
  isConfigured: () => getXSenseConfig().configured,
  getConnectionMode: () => 'cloud_account',
  isConnectedLive: ({ conn, devices: mappedDevices }) =>
    getXSenseConfig().configured ||
    conn?.status === 'connected' ||
    mappedDevices.some((d) => d.systems.includes('xsense')),
  syncDevices: syncXSenseDevices,
  collectReadings: ({ db, monitoredDevices, now }) =>
    collectXSenseReadingsInDb(db, monitoredDevices, now),
};
