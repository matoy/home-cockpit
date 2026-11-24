import { eq } from 'drizzle-orm';
import { getDb, type AppDatabase } from '@/db';
import { devices, deviceVendorLinks, vendorConnections } from '@/db/schema';
import { getDemoState } from '@/lib/demo-store';
import {
  type DemoVendorMode,
  ensureSchemaInitialized,
  seedDefaultDataIfEmpty,
} from '@/lib/services/shared';
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
import { decryptSecret, encryptSecret } from '@/lib/vendors/crypto-store';
import { mergeDeviceSystems } from '@/lib/vendors/deduplication';
import {
  fetchHomeConnectInventory,
  getHomeConnectConfig,
  HomeConnectApiError,
  makeHomeConnectDeviceId,
  refreshHomeConnectAccessToken,
} from '@/lib/vendors/home-connect-client';
import { isValidVendorId, normalizeSystems } from '@/lib/vendors/registry';
import type { HomeConnectEnv, VendorId } from '@/types';

export function parseHomeConnectEnvFromMode(
  mode: string | null | undefined,
  fallback: HomeConnectEnv
): HomeConnectEnv {
  if (mode === 'oauth_simulator') return 'simulator';
  if (mode === 'oauth_cn') return 'cn';
  if (mode === 'oauth_prod') return 'prod';
  return fallback;
}

async function ensureValidHomeConnectAccessToken(
  db: AppDatabase,
  conn: typeof vendorConnections.$inferSelect,
  env: HomeConnectEnv,
  forceRefresh = false
): Promise<string> {
  const plainAccess = decryptSecret(conn.accessToken);
  const plainRefresh = decryptSecret(conn.refreshToken);

  if (
    !forceRefresh &&
    plainAccess &&
    (!conn.tokenExpiresAt || conn.tokenExpiresAt.getTime() > Date.now() + 300_000)
  ) {
    return plainAccess;
  }

  if (!plainRefresh) {
    if (!forceRefresh && plainAccess) return plainAccess;
    throw new Error('Jeton Siemens Home Connect expiré ou absent. Reconnectez Home Connect.');
  }

  const refreshed = await refreshHomeConnectAccessToken({ refreshToken: plainRefresh, env });
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
    .where(eq(vendorConnections.vendor, 'home_connect'));

  return refreshed.accessToken;
}

export async function saveHomeConnectConnection(params: {
  env: HomeConnectEnv;
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number;
}): Promise<void> {
  const now = new Date();
  const mode = `oauth_${params.env}`;
  const db = getDb();

  if (!db) {
    const state = getDemoState();
    state.vendorConnections.home_connect = {
      mode: mode as DemoVendorMode,
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
    .where(eq(vendorConnections.vendor, 'home_connect'))
    .limit(1);

  const encryptedAccess = encryptSecret(params.accessToken);
  const encryptedRefresh = params.refreshToken
    ? encryptSecret(params.refreshToken)
    : existingRows[0]?.refreshToken ?? null;
  const expiresAt = new Date(Date.now() + params.expiresInSec * 1000);

  await db
    .insert(vendorConnections)
    .values({
      vendor: 'home_connect',
      mode,
      status: 'connected',
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt: expiresAt,
      config: { env: params.env },
      lastError: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: vendorConnections.vendor,
      set: {
        mode,
        status: 'connected',
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt: expiresAt,
        config: { env: params.env },
        lastError: null,
        updatedAt: now,
      },
    });
}

export async function disconnectHomeConnect(): Promise<void> {
  return disconnectVendorConnection('home_connect');
}

export async function syncHomeConnectDevices(): Promise<VendorSyncResult> {
  const db = getDb();
  const hcCfg = getHomeConnectConfig();
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    state.vendorConnections.home_connect.connected = true;
    state.vendorConnections.home_connect.lastSyncedAt = now.toISOString();
    state.vendorConnections.home_connect.lastError = null;
    const hcCount = state.devices.filter((d) => d.systems.includes('home_connect')).length;
    return {
      syncedCount: hcCount,
      newCount: 0,
      mode: 'demo',
      message: `Mode démo actif : ${hcCount} appareil(s) Siemens Home Connect simulé(s) synchronisé(s).`,
    };
  }

  await seedDefaultDataIfEmpty(db);
  if (!hcCfg.configured) {
    throw new Error(
      'Identifiants Siemens Home Connect manquants (SIEMENS_HOME_CONNECT_CLIENT_ID et SECRET).'
    );
  }

  const connRows = await db
    .select()
    .from(vendorConnections)
    .where(eq(vendorConnections.vendor, 'home_connect'))
    .limit(1);

  const conn = connRows[0];
  if (!conn || conn.status !== 'connected' || (!conn.accessToken && !conn.refreshToken)) {
    throw new Error(
      'Siemens Home Connect n’est pas connecté. Cliquez d’abord sur « Connecter Home Connect ».'
    );
  }

  const hcEnv = parseHomeConnectEnvFromMode(conn.mode, hcCfg.defaultEnv);
  let inventory;
  try {
    const accessToken = await ensureValidHomeConnectAccessToken(db, conn, hcEnv);
    try {
      inventory = await fetchHomeConnectInventory({
        accessToken,
        env: hcEnv,
        mode: 'full',
      });
    } catch (err) {
      if (err instanceof HomeConnectApiError && err.status === 401 && conn.refreshToken) {
        const refreshedToken = await ensureValidHomeConnectAccessToken(db, conn, hcEnv, true);
        inventory = await fetchHomeConnectInventory({
          accessToken: refreshedToken,
          env: hcEnv,
          mode: 'full',
        });
      } else {
        throw err;
      }
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Erreur synchronisation Siemens Home Connect';
    await db
      .update(vendorConnections)
      .set({ lastError: msg, updatedAt: now })
      .where(eq(vendorConnections.vendor, 'home_connect'));
    throw err;
  }

  const { deviceById, linkByExternalId } = await loadVendorDeviceIndex(db, 'home_connect');
  let newCount = 0;

  for (const hc of inventory.devices) {
    const existingLink = linkByExternalId.get(hc.externalId);
    const linkedDevice = existingLink ? deviceById.get(existingLink.deviceId) : undefined;
    const productName =
      [hc.manufacturer, hc.model].filter(Boolean).join(' · ') || 'Siemens Home Connect';
    const vendorMetadata = {
      manufacturer: hc.manufacturer,
      model: hc.model,
      deviceType: hc.deviceType,
      macAddress: hc.macAddress ?? null,
    };

    if (linkedDevice) {
      const primaryVendor: VendorId = isValidVendorId(linkedDevice.primaryVendor)
        ? linkedDevice.primaryVendor
        : 'home_connect';
      const nextSystems = mergeDeviceSystems(
        normalizeSystems(linkedDevice.systems, primaryVendor),
        'home_connect',
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
            name: hc.name,
            systems: nextSystems,
            tuyaCategory: hc.deviceType ?? 'home_connect',
            productName,
            ipAddress: linkedDevice.ipAddress ?? hc.ipAddress ?? null,
            macAddress: linkedDevice.macAddress ?? hc.macAddress ?? null,
            isOnline: hc.isOnline,
            lastRawStatus: hc.rawTraits,
            lastSeenAt: now,
          })
          .where(eq(devices.id, linkedDevice.id));
      }

      await db
        .update(deviceVendorLinks)
        .set({
          externalName: hc.name,
          vendorMetadata,
        })
        .where(eq(deviceVendorLinks.id, existingLink!.id));
    } else {
      const candidateId = ensureUniqueDeviceId(
        makeHomeConnectDeviceId(hc.externalId),
        (id) => deviceById.has(id),
        now
      );

      const [inserted] = await db
        .insert(devices)
        .values({
          id: candidateId,
          name: hc.name,
          customName: null,
          primaryVendor: 'home_connect',
          systems: ['home_connect'],
          roomId: null,
          category: 'other',
          tuyaCategory: hc.deviceType ?? 'home_connect',
          productName,
          ipAddress: hc.ipAddress ?? null,
          macAddress: hc.macAddress ?? null,
          isOnline: hc.isOnline,
          isMonitored: true,
          excludeFromTotals: false,
          energyMode: 'hybrid',
          dpConfig: {},
          lastRawStatus: hc.rawTraits,
          lastSeenAt: now,
          lastPowerW: null,
          lastVoltageV: null,
          lastAddEleKwh: null,
          lastTempC: null,
          lastHumidityPct: null,
          lastBatteryPct: null,
          lastContactOpen: null,
        })
        .returning();

      await db
        .insert(deviceVendorLinks)
        .values({
          deviceId: candidateId,
          vendor: 'home_connect',
          externalId: hc.externalId,
          externalName: hc.name,
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
    .where(eq(vendorConnections.vendor, 'home_connect'));

  const baseMsg = `${inventory.devices.length} appareil(s) Siemens Home Connect synchronisé(s) (${hcEnv.toUpperCase()}, ${newCount} nouveau(x)).`;
  return {
    syncedCount: inventory.devices.length,
    newCount,
    mode: 'live',
    message: inventory.warning ? `${baseMsg} (${inventory.warning})` : baseMsg,
  };
}

export async function collectHomeConnectStatusInDb(
  db: AppDatabase,
  hcDevices: Array<typeof devices.$inferSelect>,
  now: Date
): Promise<VendorCollectionResult> {
  const hcCfg = getHomeConnectConfig();
  if (hcDevices.length === 0 || !hcCfg.configured) {
    return { devicesCount: 0, readingsInserted: 0, updatedCount: 0 };
  }

  const connRows = await db
    .select()
    .from(vendorConnections)
    .where(eq(vendorConnections.vendor, 'home_connect'))
    .limit(1);
  const conn = connRows[0];
  if (!conn || conn.status !== 'connected' || (!conn.accessToken && !conn.refreshToken)) {
    return { devicesCount: hcDevices.length, readingsInserted: 0, updatedCount: 0 };
  }

  const hcEnv = parseHomeConnectEnvFromMode(conn.mode, hcCfg.defaultEnv);
  let inventory;
  try {
    const accessToken = await ensureValidHomeConnectAccessToken(db, conn, hcEnv);
    try {
      inventory = await fetchHomeConnectInventory({
        accessToken,
        env: hcEnv,
        mode: 'poll',
      });
    } catch (err) {
      if (err instanceof HomeConnectApiError && err.status === 401 && conn.refreshToken) {
        const refreshed = await ensureValidHomeConnectAccessToken(db, conn, hcEnv, true);
        inventory = await fetchHomeConnectInventory({
          accessToken: refreshed,
          env: hcEnv,
          mode: 'poll',
        });
      } else {
        throw err;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur collecte Siemens Home Connect';
    await db
      .update(vendorConnections)
      .set({ lastError: msg, updatedAt: now })
      .where(eq(vendorConnections.vendor, 'home_connect'));
    throw err;
  }

  const deviceIdByExternalId = await loadVendorExternalDeviceMap(db, 'home_connect');
  const deviceById = new Map(hcDevices.map((d) => [d.id, d]));

  let updatedCount = 0;
  for (const hc of inventory.devices) {
    const devId = deviceIdByExternalId.get(hc.externalId) ?? makeHomeConnectDeviceId(hc.externalId);
    const dev = deviceById.get(devId);
    if (!dev || !dev.isMonitored) continue;

    await db
      .update(devices)
      .set({
        isOnline: hc.isOnline,
        lastRawStatus: hc.rawTraits,
        lastSeenAt: now,
        ...(!dev.macAddress && hc.macAddress ? { macAddress: hc.macAddress } : {}),
      })
      .where(eq(devices.id, dev.id));
    updatedCount++;
  }

  await db
    .update(vendorConnections)
    .set({
      status: 'connected',
      lastError: inventory.warning ?? null,
      updatedAt: now,
    })
    .where(eq(vendorConnections.vendor, 'home_connect'));

  return {
    devicesCount: hcDevices.length,
    readingsInserted: 0,
    updatedCount,
  };
}

export const homeConnectPlugin: VendorServerPlugin = {
  id: 'home_connect',
  isConfigured: () => getHomeConnectConfig().configured,
  getConnectionMode: (conn) =>
    `oauth_${parseHomeConnectEnvFromMode(conn?.mode, getHomeConnectConfig().defaultEnv)}` as DemoVendorMode,
  isConnectedLive: ({ conn }) =>
    getHomeConnectConfig().configured &&
    Boolean(conn && conn.status === 'connected' && (conn.accessToken || conn.refreshToken)),
  syncDevices: syncHomeConnectDevices,
  collectReadings: ({ db, monitoredDevices, now }) =>
    collectHomeConnectStatusInDb(db, monitoredDevices, now),
  disconnect: disconnectHomeConnect,
};
