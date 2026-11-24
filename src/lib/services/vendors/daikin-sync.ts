import { eq } from 'drizzle-orm';
import { getDb, type AppDatabase } from '@/db';
import { devices, deviceVendorLinks, metricReadings, vendorConnections } from '@/db/schema';
import { getDemoState } from '@/lib/demo-store';
import { ensureSchemaInitialized, seedDefaultDataIfEmpty } from '@/lib/services/shared';
import type {
  VendorCollectionResult,
  VendorServerPlugin,
  VendorSyncResult,
} from '@/lib/services/vendors/types';
import {
  disconnectVendorConnection,
  ensureUniqueDeviceId,
  loadVendorDeviceIndex,
  loadVendorExternalDeviceMap,
} from '@/lib/services/vendors/upsert-helper';
import { computeHybridEnergyKwh } from '@/lib/tariff-engine';
import { decryptSecret, encryptSecret } from '@/lib/vendors/crypto-store';
import {
  DaikinApiError,
  fetchDaikinInventory,
  getDaikinConfig,
  makeDaikinDeviceId,
  refreshDaikinAccessToken,
} from '@/lib/vendors/daikin-client';
import { mergeDeviceSystems } from '@/lib/vendors/deduplication';
import { isValidVendorId, normalizeSystems } from '@/lib/vendors/registry';
import type { VendorId } from '@/types';

async function ensureValidDaikinAccessToken(
  db: AppDatabase,
  conn: typeof vendorConnections.$inferSelect,
  forceRefresh = false
): Promise<string> {
  const plainAccess = decryptSecret(conn.accessToken);
  const plainRefresh = decryptSecret(conn.refreshToken);

  if (
    !forceRefresh &&
    plainAccess &&
    (!conn.tokenExpiresAt || conn.tokenExpiresAt.getTime() > Date.now() + 180_000)
  ) {
    return plainAccess;
  }

  if (!plainRefresh) {
    if (!forceRefresh && plainAccess) return plainAccess;
    throw new Error('Jeton Daikin Onecta expiré ou absent. Reconnectez Daikin Onecta.');
  }

  const refreshed = await refreshDaikinAccessToken({ refreshToken: plainRefresh });
  const expiresAt = new Date(Date.now() + refreshed.expiresInSec * 1000);

  await db
    .update(vendorConnections)
    .set({
      accessToken: encryptSecret(refreshed.accessToken),
      refreshToken: refreshed.refreshToken ? encryptSecret(refreshed.refreshToken) : conn.refreshToken,
      tokenExpiresAt: expiresAt,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(vendorConnections.vendor, 'daikin'));

  return refreshed.accessToken;
}

export async function saveDaikinConnection(params: {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number;
}): Promise<void> {
  const now = new Date();
  const db = getDb();

  if (!db) {
    const state = getDemoState();
    state.vendorConnections.daikin = {
      mode: 'oauth_prod',
      connected: true,
      lastSyncedAt: now.toISOString(),
      lastError: null,
    };
    return;
  }

  await ensureSchemaInitialized(db);
  const existingRows = await db
    .select()
    .from(vendorConnections)
    .where(eq(vendorConnections.vendor, 'daikin'))
    .limit(1);

  const encryptedAccess = encryptSecret(params.accessToken);
  const encryptedRefresh = params.refreshToken
    ? encryptSecret(params.refreshToken)
    : existingRows[0]?.refreshToken ?? null;
  const expiresAt = new Date(Date.now() + params.expiresInSec * 1000);

  await db
    .insert(vendorConnections)
    .values({
      vendor: 'daikin',
      mode: 'oauth_prod',
      status: 'connected',
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt: expiresAt,
      config: {},
      lastError: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: vendorConnections.vendor,
      set: {
        mode: 'oauth_prod',
        status: 'connected',
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt: expiresAt,
        lastError: null,
        updatedAt: now,
      },
    });
}

export async function disconnectDaikin(): Promise<void> {
  return disconnectVendorConnection('daikin');
}

export async function syncDaikinDevices(): Promise<VendorSyncResult> {
  const db = getDb();
  const dkCfg = getDaikinConfig();
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    state.vendorConnections.daikin.connected = true;
    state.vendorConnections.daikin.lastSyncedAt = now.toISOString();
    state.vendorConnections.daikin.lastError = null;
    const dkCount = state.devices.filter((d) => d.systems.includes('daikin')).length;
    return {
      syncedCount: dkCount,
      newCount: 0,
      mode: 'demo',
      message: `Mode démo actif : ${dkCount} unité(s) Daikin Onecta simulée(s) synchronisée(s).`,
    };
  }

  await seedDefaultDataIfEmpty(db);
  if (!dkCfg.configured) {
    throw new Error(
      'Identifiants Daikin Onecta manquants (DAIKIN_CLIENT_ID et DAIKIN_CLIENT_SECRET).'
    );
  }

  const connRows = await db
    .select()
    .from(vendorConnections)
    .where(eq(vendorConnections.vendor, 'daikin'))
    .limit(1);

  const conn = connRows[0];
  if (!conn || conn.status !== 'connected' || (!conn.accessToken && !conn.refreshToken)) {
    throw new Error(
      'Daikin Onecta n’est pas connecté. Cliquez d’abord sur « Connecter Daikin (OAuth) ».'
    );
  }

  let inventory;
  try {
    const accessToken = await ensureValidDaikinAccessToken(db, conn);
    try {
      inventory = await fetchDaikinInventory({ accessToken });
    } catch (err) {
      if (err instanceof DaikinApiError && err.status === 401 && conn.refreshToken) {
        const refreshedToken = await ensureValidDaikinAccessToken(db, conn, true);
        inventory = await fetchDaikinInventory({ accessToken: refreshedToken });
      } else {
        throw err;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur synchronisation Daikin Onecta';
    await db
      .update(vendorConnections)
      .set({ lastError: msg, updatedAt: now })
      .where(eq(vendorConnections.vendor, 'daikin'));
    throw err;
  }

  const { deviceById, linkByExternalId } = await loadVendorDeviceIndex(db, 'daikin');
  let newCount = 0;

  for (const dk of inventory.devices) {
    const existingLink = linkByExternalId.get(dk.externalId);
    const linkedDevice = existingLink ? deviceById.get(existingLink.deviceId) : undefined;
    const productName =
      [dk.manufacturer, dk.model].filter(Boolean).join(' · ') || 'Daikin Onecta';
    const vendorMetadata = {
      manufacturer: dk.manufacturer,
      model: dk.model,
      deviceType: dk.deviceType,
      macAddress: dk.macAddress ?? null,
    };

    if (linkedDevice) {
      const primaryVendor: VendorId = isValidVendorId(linkedDevice.primaryVendor)
        ? linkedDevice.primaryVendor
        : 'daikin';
      const nextSystems = mergeDeviceSystems(
        normalizeSystems(linkedDevice.systems, primaryVendor),
        'daikin',
        primaryVendor
      );

      if (primaryVendor === 'tuya' || primaryVendor === 'kasa') {
        await db
          .update(devices)
          .set({ systems: nextSystems })
          .where(eq(devices.id, linkedDevice.id));
      } else {
        await db
          .update(devices)
          .set({
            name: dk.name,
            systems: nextSystems,
            category: dk.category,
            tuyaCategory: dk.deviceType ?? 'climateControl',
            productName,
            ipAddress: linkedDevice.ipAddress ?? dk.ipAddress ?? null,
            macAddress: linkedDevice.macAddress ?? dk.macAddress ?? null,
            isOnline: dk.isOnline,
            lastRawStatus: dk.rawTraits,
            lastSeenAt: now,
            ...(dk.tempC !== null ? { lastTempC: dk.tempC } : {}),
            ...(dk.humidityPct !== null ? { lastHumidityPct: dk.humidityPct } : {}),
            ...(dk.addEleKwh !== undefined && dk.addEleKwh !== null
              ? { lastAddEleKwh: dk.addEleKwh }
              : {}),
          })
          .where(eq(devices.id, linkedDevice.id));
      }

      await db
        .update(deviceVendorLinks)
        .set({
          externalName: dk.name,
          vendorMetadata,
        })
        .where(eq(deviceVendorLinks.id, existingLink!.id));
    } else {
      const candidateId = ensureUniqueDeviceId(
        makeDaikinDeviceId(dk.externalId),
        (id) => deviceById.has(id),
        now
      );

      const [inserted] = await db
        .insert(devices)
        .values({
          id: candidateId,
          name: dk.name,
          customName: null,
          primaryVendor: 'daikin',
          systems: ['daikin'],
          roomId: null,
          category: dk.category,
          tuyaCategory: dk.deviceType ?? 'climateControl',
          productName,
          ipAddress: dk.ipAddress ?? null,
          macAddress: dk.macAddress ?? null,
          isOnline: dk.isOnline,
          isMonitored: true,
          excludeFromTotals: false,
          energyMode: 'add_ele',
          dpConfig: {},
          lastRawStatus: dk.rawTraits,
          lastSeenAt: now,
          lastPowerW: null,
          lastVoltageV: null,
          lastAddEleKwh: dk.addEleKwh ?? null,
          lastTempC: dk.tempC,
          lastHumidityPct: dk.humidityPct,
          lastBatteryPct: null,
          lastContactOpen: null,
        })
        .returning();

      await db
        .insert(deviceVendorLinks)
        .values({
          deviceId: candidateId,
          vendor: 'daikin',
          externalId: dk.externalId,
          externalName: dk.name,
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
    .where(eq(vendorConnections.vendor, 'daikin'));

  const baseMsg = `${inventory.devices.length} unité(s) Daikin Onecta synchronisée(s) (${newCount} nouvelle(s)).`;
  return {
    syncedCount: inventory.devices.length,
    newCount,
    mode: 'live',
    message: inventory.warning ? `${baseMsg} (${inventory.warning})` : baseMsg,
  };
}

export async function collectDaikinReadingsInDb(
  db: AppDatabase,
  daikinDevices: Array<typeof devices.$inferSelect>,
  now: Date
): Promise<VendorCollectionResult> {
  const daikinCfg = getDaikinConfig();
  if (daikinDevices.length === 0 || !daikinCfg.configured) {
    return { devicesCount: 0, updatedCount: 0, readingsInserted: 0 };
  }

  const connRows = await db
    .select()
    .from(vendorConnections)
    .where(eq(vendorConnections.vendor, 'daikin'))
    .limit(1);
  const conn = connRows[0];
  if (!conn || conn.status !== 'connected' || (!conn.accessToken && !conn.refreshToken)) {
    return { devicesCount: daikinDevices.length, updatedCount: 0, readingsInserted: 0 };
  }

  let inventory;
  try {
    const accessToken = await ensureValidDaikinAccessToken(db, conn);
    try {
      inventory = await fetchDaikinInventory({ accessToken });
    } catch (err) {
      if (err instanceof DaikinApiError && err.status === 401 && conn.refreshToken) {
        const refreshedToken = await ensureValidDaikinAccessToken(db, conn, true);
        inventory = await fetchDaikinInventory({ accessToken: refreshedToken });
      } else {
        throw err;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur collecte Daikin Onecta';
    await db
      .update(vendorConnections)
      .set({ lastError: msg, updatedAt: now })
      .where(eq(vendorConnections.vendor, 'daikin'));
    throw err;
  }

  await db
    .update(vendorConnections)
    .set({
      lastSyncedAt: now,
      lastError: inventory.warning ?? null,
      updatedAt: now,
    })
    .where(eq(vendorConnections.vendor, 'daikin'));

  const deviceIdByExternalId = await loadVendorExternalDeviceMap(db, 'daikin');
  const deviceById = new Map(daikinDevices.map((d) => [d.id, d]));

  const readingsToInsert: Array<typeof metricReadings.$inferInsert> = [];
  let updatedCount = 0;

  for (const dk of inventory.devices) {
    const devId = deviceIdByExternalId.get(dk.externalId) ?? makeDaikinDeviceId(dk.externalId);
    const dev = deviceById.get(devId);
    if (!dev || !dev.isMonitored) continue;

    const hasEnergy = dk.addEleKwh !== undefined && dk.addEleKwh !== null;
    const hasClimate = dk.tempC !== null || dk.humidityPct !== null;

    const energyRes = hasEnergy
      ? computeHybridEnergyKwh({
          energyMode: 'add_ele',
          powerW: dk.powerW,
          currentAddEleKwh: dk.addEleKwh ?? null,
          previousAddEleKwh: dev.lastAddEleKwh,
          previousSeenAt: dev.lastSeenAt,
          now,
        })
      : null;

    await db
      .update(devices)
      .set({
        isOnline: dk.isOnline,
        lastRawStatus: dk.rawTraits,
        lastSeenAt: now,
        ...(dk.ipAddress ? { ipAddress: dk.ipAddress } : {}),
        ...(dk.macAddress ? { macAddress: dk.macAddress } : {}),
        ...(dk.tempC !== null ? { lastTempC: dk.tempC } : {}),
        ...(dk.humidityPct !== null ? { lastHumidityPct: dk.humidityPct } : {}),
        ...(hasEnergy ? { lastAddEleKwh: dk.addEleKwh } : {}),
      })
      .where(eq(devices.id, dev.id));
    updatedCount++;

    if (hasEnergy || hasClimate) {
      readingsToInsert.push({
        deviceId: dev.id,
        roomId: dev.roomId,
        recordedAt: now,
        powerW: dk.powerW,
        voltageV: dk.voltageV ?? null,
        energyKwh: energyRes ? energyRes.energyKwh : null,
        energySource: energyRes ? energyRes.source : null,
        tempC: dk.tempC,
        humidityPct: dk.humidityPct,
        contactOpen: null,
      });
    }
  }

  if (readingsToInsert.length > 0) {
    await db.insert(metricReadings).values(readingsToInsert);
  }

  return {
    devicesCount: daikinDevices.length,
    updatedCount,
    readingsInserted: readingsToInsert.length,
  };
}

export const daikinPlugin: VendorServerPlugin = {
  id: 'daikin',
  isConfigured: () => getDaikinConfig().configured,
  getConnectionMode: () => 'oauth_prod',
  isConnectedLive: ({ conn }) =>
    getDaikinConfig().configured &&
    Boolean(conn && conn.status === 'connected' && (conn.accessToken || conn.refreshToken)),
  syncDevices: syncDaikinDevices,
  collectReadings: ({ db, monitoredDevices, now }) =>
    collectDaikinReadingsInDb(db, monitoredDevices, now),
  disconnect: disconnectDaikin,
};
