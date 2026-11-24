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
  disconnectVendorConnection,
  ensureUniqueDeviceId,
  loadVendorDeviceIndex,
  loadVendorExternalDeviceMap,
} from '@/lib/services/vendors/upsert-helper';
import { decryptSecret, encryptSecret } from '@/lib/vendors/crypto-store';
import { mergeDeviceSystems } from '@/lib/vendors/deduplication';
import {
  fetchGoogleHomeInventory,
  getGoogleHomeConfig,
  makeGoogleDeviceId,
  refreshGoogleAccessToken,
} from '@/lib/vendors/google-home-client';
import { isValidVendorId, normalizeSystems } from '@/lib/vendors/registry';
import type { GoogleHomeMode, VendorId } from '@/types';

async function ensureValidGoogleAccessToken(
  db: AppDatabase,
  conn: typeof vendorConnections.$inferSelect
): Promise<string> {
  const plainAccess = decryptSecret(conn.accessToken);
  const plainRefresh = decryptSecret(conn.refreshToken);

  if (
    plainAccess &&
    (!conn.tokenExpiresAt || conn.tokenExpiresAt.getTime() > Date.now() + 60_000)
  ) {
    return plainAccess;
  }

  if (!plainRefresh) {
    if (plainAccess) return plainAccess;
    throw new Error('Jeton Google Home expiré ou absent. Reconnectez Google Home.');
  }

  const refreshed = await refreshGoogleAccessToken(plainRefresh);
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
    .where(eq(vendorConnections.vendor, 'google_home'));

  return refreshed.accessToken;
}

export async function saveGoogleHomeConnection(params: {
  mode: GoogleHomeMode;
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number;
  config: Record<string, unknown>;
}): Promise<void> {
  const now = new Date();
  const db = getDb();

  if (!db) {
    const state = getDemoState();
    state.vendorConnections.google_home = {
      mode: params.mode,
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
    .where(eq(vendorConnections.vendor, 'google_home'))
    .limit(1);

  const encryptedAccess = encryptSecret(params.accessToken);
  const encryptedRefresh = params.refreshToken
    ? encryptSecret(params.refreshToken)
    : existingRows[0]?.refreshToken ?? null;
  const expiresAt = new Date(Date.now() + params.expiresInSec * 1000);

  await db
    .insert(vendorConnections)
    .values({
      vendor: 'google_home',
      mode: params.mode,
      status: 'connected',
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt: expiresAt,
      config: params.config,
      lastError: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: vendorConnections.vendor,
      set: {
        mode: params.mode,
        status: 'connected',
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt: expiresAt,
        config: params.config,
        lastError: null,
        updatedAt: now,
      },
    });
}

export async function disconnectGoogleHome(): Promise<void> {
  return disconnectVendorConnection('google_home');
}

export async function syncGoogleHomeDevices(): Promise<VendorSyncResult> {
  const db = getDb();
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    state.vendorConnections.google_home.connected = true;
    state.vendorConnections.google_home.lastSyncedAt = now.toISOString();
    state.vendorConnections.google_home.lastError = null;
    const ghCount = state.devices.filter((d) => d.systems.includes('google_home')).length;
    return {
      syncedCount: ghCount,
      newCount: 0,
      mode: 'demo',
      message: `Mode démo actif : ${ghCount} appareil(x) Google Home synchronisé(s) (hors doublons).`,
    };
  }

  await seedDefaultDataIfEmpty(db);
  if (!getGoogleHomeConfig().apiEnabled) {
    throw new Error(
      "L'intégration API Google Home (MCP/SDM) est désactivée (GOOGLE_HOME_MODE=off ou non défini)."
    );
  }
  const connRows = await db
    .select()
    .from(vendorConnections)
    .where(eq(vendorConnections.vendor, 'google_home'))
    .limit(1);

  const conn = connRows[0];
  if (!conn || conn.status !== 'connected' || (!conn.accessToken && !conn.refreshToken)) {
    throw new Error(
      'Google Home n’est pas connecté. Cliquez d’abord sur « Connecter Google Home ».'
    );
  }

  const mode: GoogleHomeMode =
    conn.mode === 'sdm' || conn.mode === 'mcp' ? conn.mode : getGoogleHomeConfig().defaultMode;

  let inventory;
  try {
    const accessToken = await ensureValidGoogleAccessToken(db, conn);
    inventory = await fetchGoogleHomeInventory({
      accessToken,
      mode,
      projectId: getGoogleHomeConfig().sdmProjectId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur synchronisation Google Home';
    await db
      .update(vendorConnections)
      .set({ lastError: msg, updatedAt: now })
      .where(eq(vendorConnections.vendor, 'google_home'));
    throw err;
  }

  const { roomNameToId } = await ensureMissingRoomsInDb(db, inventory.roomNames);
  const { deviceById, linkByExternalId } = await loadVendorDeviceIndex(db, 'google_home');
  let newCount = 0;

  for (const gh of inventory.devices) {
    const mappedRoomId = gh.roomName
      ? (roomNameToId.get(gh.roomName.trim().toLowerCase()) ?? null)
      : null;
    const existingLink = linkByExternalId.get(gh.externalId);
    const linkedDevice = existingLink ? deviceById.get(existingLink.deviceId) : undefined;

    if (linkedDevice) {
      const primaryVendor: VendorId = isValidVendorId(linkedDevice.primaryVendor)
        ? linkedDevice.primaryVendor
        : 'tuya';
      const nextSystems = mergeDeviceSystems(
        normalizeSystems(linkedDevice.systems, primaryVendor),
        'google_home',
        primaryVendor
      );

      if (
        primaryVendor === 'tuya' ||
        primaryVendor === 'kasa' ||
        primaryVendor === 'home_connect'
      ) {
        await db
          .update(devices)
          .set({
            systems: nextSystems,
            roomId: linkedDevice.roomId ?? mappedRoomId,
          })
          .where(eq(devices.id, linkedDevice.id));
      } else {
        await db
          .update(devices)
          .set({
            name: gh.name,
            systems: nextSystems,
            roomId: mappedRoomId ?? linkedDevice.roomId,
            category: gh.category,
            productName:
              [gh.manufacturer, gh.model].filter(Boolean).join(' · ') || linkedDevice.productName,
            isOnline: gh.isOnline,
            lastRawStatus: gh.rawTraits,
            lastSeenAt: now,
            lastPowerW: gh.powerW ?? linkedDevice.lastPowerW,
            lastTempC: gh.tempC ?? linkedDevice.lastTempC,
            lastHumidityPct: gh.humidityPct ?? linkedDevice.lastHumidityPct,
            lastBatteryPct: gh.batteryPct ?? linkedDevice.lastBatteryPct,
            lastContactOpen:
              gh.contactOpen !== null ? gh.contactOpen : linkedDevice.lastContactOpen,
          })
          .where(eq(devices.id, linkedDevice.id));
      }

      await db
        .update(deviceVendorLinks)
        .set({
          externalName: gh.name,
          vendorMetadata: {
            manufacturer: gh.manufacturer,
            model: gh.model,
            deviceType: gh.deviceType,
          },
        })
        .where(eq(deviceVendorLinks.id, existingLink!.id));
    } else {
      const candidateId = ensureUniqueDeviceId(
        makeGoogleDeviceId(gh.externalId),
        (id) => deviceById.has(id),
        now
      );
      const isClimateOrContact =
        gh.category === 'climate' ||
        gh.category === 'contact' ||
        gh.category === 'hybrid' ||
        gh.category === 'power';

      const [inserted] = await db
        .insert(devices)
        .values({
          id: candidateId,
          name: gh.name,
          customName: null,
          primaryVendor: 'google_home',
          systems: ['google_home'],
          roomId: mappedRoomId,
          category: gh.category,
          tuyaCategory: gh.deviceType ?? 'google_home',
          productName: [gh.manufacturer, gh.model].filter(Boolean).join(' · ') || 'Google Home',
          ipAddress: null,
          macAddress: null,
          isOnline: gh.isOnline,
          isMonitored: isClimateOrContact,
          excludeFromTotals: false,
          energyMode: 'hybrid',
          dpConfig: {},
          lastRawStatus: gh.rawTraits,
          lastSeenAt: now,
          lastPowerW: gh.powerW,
          lastVoltageV: null,
          lastAddEleKwh: null,
          lastTempC: gh.tempC,
          lastHumidityPct: gh.humidityPct,
          lastBatteryPct: gh.batteryPct,
          lastContactOpen: gh.contactOpen,
        })
        .returning();

      await db
        .insert(deviceVendorLinks)
        .values({
          deviceId: candidateId,
          vendor: 'google_home',
          externalId: gh.externalId,
          externalName: gh.name,
          vendorMetadata: {
            manufacturer: gh.manufacturer,
            model: gh.model,
            deviceType: gh.deviceType,
          },
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
    .where(eq(vendorConnections.vendor, 'google_home'));

  const baseMsg = `${inventory.devices.length} appareil(x) et ${inventory.roomNames.length} pièce(s) synchronisés depuis Google Home (${mode.toUpperCase()}, ${newCount} nouveau(x)).`;
  return {
    syncedCount: inventory.devices.length,
    newCount,
    mode: 'live',
    message: inventory.warning ? `${baseMsg} (${inventory.warning})` : baseMsg,
  };
}

export async function collectGoogleHomeReadingsInDb(
  db: AppDatabase,
  googleDevices: Array<typeof devices.$inferSelect>,
  now: Date
): Promise<VendorCollectionResult> {
  if (googleDevices.length === 0 || !getGoogleHomeConfig().apiEnabled) {
    return { devicesCount: 0, readingsInserted: 0, updatedCount: 0 };
  }
  const connRows = await db
    .select()
    .from(vendorConnections)
    .where(eq(vendorConnections.vendor, 'google_home'))
    .limit(1);
  const conn = connRows[0];
  if (!conn || conn.status !== 'connected' || (!conn.accessToken && !conn.refreshToken)) {
    return { devicesCount: googleDevices.length, readingsInserted: 0, updatedCount: 0 };
  }

  const mode: GoogleHomeMode =
    conn.mode === 'sdm' || conn.mode === 'mcp' ? conn.mode : getGoogleHomeConfig().defaultMode;
  const accessToken = await ensureValidGoogleAccessToken(db, conn);
  const inventory = await fetchGoogleHomeInventory({
    accessToken,
    mode,
    projectId: getGoogleHomeConfig().sdmProjectId,
  });

  const deviceIdByExternalId = await loadVendorExternalDeviceMap(db, 'google_home');
  const deviceById = new Map(googleDevices.map((d) => [d.id, d]));

  const readingsToInsert: Array<typeof metricReadings.$inferInsert> = [];
  let updatedCount = 0;

  for (const gh of inventory.devices) {
    const devId = deviceIdByExternalId.get(gh.externalId) ?? makeGoogleDeviceId(gh.externalId);
    const dev = deviceById.get(devId);
    if (!dev || !dev.isMonitored) continue;

    const hasMetric =
      gh.tempC !== null ||
      gh.humidityPct !== null ||
      gh.contactOpen !== null ||
      gh.powerW !== null;

    await db
      .update(devices)
      .set({
        isOnline: gh.isOnline,
        lastRawStatus: gh.rawTraits,
        lastSeenAt: now,
        ...(gh.tempC !== null ? { lastTempC: gh.tempC } : {}),
        ...(gh.humidityPct !== null ? { lastHumidityPct: gh.humidityPct } : {}),
        ...(gh.batteryPct !== null ? { lastBatteryPct: gh.batteryPct } : {}),
        ...(gh.contactOpen !== null ? { lastContactOpen: gh.contactOpen } : {}),
        ...(gh.powerW !== null ? { lastPowerW: gh.powerW } : {}),
      })
      .where(eq(devices.id, dev.id));
    updatedCount++;

    if (hasMetric) {
      readingsToInsert.push({
        deviceId: dev.id,
        roomId: dev.roomId,
        recordedAt: now,
        powerW: gh.powerW,
        voltageV: null,
        energyKwh: null,
        energySource: null,
        tempC: gh.tempC,
        humidityPct: gh.humidityPct,
        contactOpen: gh.contactOpen,
      });
    }
  }

  if (readingsToInsert.length > 0) {
    await db.insert(metricReadings).values(readingsToInsert);
  }
  return {
    devicesCount: googleDevices.length,
    readingsInserted: readingsToInsert.length,
    updatedCount,
  };
}

export async function syncRoomsFromGoogleHome(): Promise<VendorRoomSyncResult> {
  const db = getDb();
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    state.vendorConnections.google_home.lastSyncedAt = now.toISOString();
    return {
      vendor: 'google_home',
      roomsFound: state.rooms.length,
      createdCount: 0,
      assignedDevicesCount: 0,
      mode: 'demo',
      message: `Mode démo actif : ${state.rooms.length} pièce(s) Google Home simulée(s) déjà disponible(s).`,
    };
  }

  await seedDefaultDataIfEmpty(db);
  if (!getGoogleHomeConfig().apiEnabled) {
    throw new Error(
      "L'intégration API Google Home (MCP/SDM) est désactivée (GOOGLE_HOME_MODE=off ou non défini)."
    );
  }
  const connRows = await db
    .select()
    .from(vendorConnections)
    .where(eq(vendorConnections.vendor, 'google_home'))
    .limit(1);

  const conn = connRows[0];
  if (!conn || conn.status !== 'connected' || (!conn.accessToken && !conn.refreshToken)) {
    throw new Error(
      "Google Home n'est pas connecté. Cliquez d'abord sur « Connecter Google Home »."
    );
  }

  const mode: GoogleHomeMode =
    conn.mode === 'sdm' || conn.mode === 'mcp' ? conn.mode : getGoogleHomeConfig().defaultMode;

  let inventory;
  try {
    const accessToken = await ensureValidGoogleAccessToken(db, conn);
    inventory = await fetchGoogleHomeInventory({
      accessToken,
      mode,
      projectId: getGoogleHomeConfig().sdmProjectId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur synchronisation pièces Google Home';
    await db
      .update(vendorConnections)
      .set({ lastError: msg, updatedAt: now })
      .where(eq(vendorConnections.vendor, 'google_home'));
    throw err;
  }

  const { roomNameToId, createdCount } = await ensureMissingRoomsInDb(db, inventory.roomNames);

  const [existingDeviceRows, ghLinkRows] = await Promise.all([
    db
      .select({
        id: devices.id,
        primaryVendor: devices.primaryVendor,
        roomId: devices.roomId,
      })
      .from(devices),
    db.select().from(deviceVendorLinks).where(eq(deviceVendorLinks.vendor, 'google_home')),
  ]);

  const deviceById = new Map(existingDeviceRows.map((d) => [d.id, d]));
  const linkByExternalId = new Map(ghLinkRows.map((l) => [l.externalId, l]));

  let assignedDevicesCount = 0;
  const updatedDeviceIds = new Set<string>();

  for (const gh of inventory.devices) {
    if (!gh.roomName) continue;
    const mappedRoomId = roomNameToId.get(gh.roomName.trim().toLowerCase()) ?? null;
    if (mappedRoomId === null) continue;

    const existingLink = linkByExternalId.get(gh.externalId);
    const linkedDevice = existingLink ? deviceById.get(existingLink.deviceId) : undefined;
    if (!linkedDevice || updatedDeviceIds.has(linkedDevice.id)) continue;

    const primaryVendor: VendorId = isValidVendorId(linkedDevice.primaryVendor)
      ? linkedDevice.primaryVendor
      : 'tuya';

    const shouldUpdate =
      primaryVendor === 'tuya' || primaryVendor === 'kasa' || primaryVendor === 'home_connect'
        ? linkedDevice.roomId === null
        : linkedDevice.roomId !== mappedRoomId;

    if (shouldUpdate) {
      await db
        .update(devices)
        .set({ roomId: mappedRoomId })
        .where(eq(devices.id, linkedDevice.id));
      updatedDeviceIds.add(linkedDevice.id);
      assignedDevicesCount++;
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
    .where(eq(vendorConnections.vendor, 'google_home'));

  const baseMsg = `Google Home (${mode.toUpperCase()}) : ${inventory.roomNames.length} pièce(s) détectée(s) (${createdCount} créée(s), ${assignedDevicesCount} appareil(s) rattaché(s)).`;
  return {
    vendor: 'google_home',
    roomsFound: inventory.roomNames.length,
    createdCount,
    assignedDevicesCount,
    mode: 'live',
    message: inventory.warning ? `${baseMsg} (${inventory.warning})` : baseMsg,
  };
}

export const googleHomePlugin: VendorServerPlugin = {
  id: 'google_home',
  isConfigured: () => getGoogleHomeConfig().configured,
  isVisible: () => getGoogleHomeConfig().apiEnabled,
  getConnectionMode: (conn) =>
    conn?.mode === 'mcp' || conn?.mode === 'sdm'
      ? conn.mode
      : getGoogleHomeConfig().defaultMode,
  isConnectedLive: ({ conn }) =>
    getGoogleHomeConfig().apiEnabled &&
    Boolean(conn && conn.status === 'connected' && (conn.accessToken || conn.refreshToken)),
  syncDevices: syncGoogleHomeDevices,
  collectReadings: ({ db, monitoredDevices, now }) =>
    collectGoogleHomeReadingsInDb(db, monitoredDevices, now),
  syncRooms: syncRoomsFromGoogleHome,
  isReadyForRoomSync: async (db) => {
    const cfg = getGoogleHomeConfig();
    if (!cfg.apiEnabled) return false;
    if (!db) return true;
    const rows = await db
      .select({
        status: vendorConnections.status,
        accessToken: vendorConnections.accessToken,
        refreshToken: vendorConnections.refreshToken,
      })
      .from(vendorConnections)
      .where(eq(vendorConnections.vendor, 'google_home'))
      .limit(1);
    const conn = rows[0];
    return Boolean(conn && conn.status === 'connected' && (conn.accessToken || conn.refreshToken));
  },
  disconnect: disconnectGoogleHome,
};
