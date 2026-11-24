import { and, asc, desc, gte, lte } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  automations,
  collectionLogs,
  devices,
  deviceVendorLinks,
  metricReadings,
  rooms,
  tariffPeriods,
  vendorConnections,
} from '@/db/schema';
import { buildDashboardPayload, resolveTimeWindow } from '@/lib/aggregator';
import { getDemoState } from '@/lib/demo-store';
import {
  getEnvStatus,
  mapDbAutomation,
  mapDbDevice,
  mapDbLog,
  mapDbReading,
  mapDbRoom,
  mapDbTariff,
  mapDbVendorLink,
  seedDefaultDataIfEmpty,
} from '@/lib/services/shared';
import {
  buildVendorConnectionSummariesFromState,
  VENDOR_SERVER_PLUGINS,
} from '@/lib/services/vendors';
import { parseHomeConnectEnvFromMode } from '@/lib/services/vendors/home-connect-sync';
import { normalizeTariffTimeline } from '@/lib/tariff-engine';
import { getGoogleHomeConfig } from '@/lib/vendors/google-home-client';
import { getHomeConnectConfig } from '@/lib/vendors/home-connect-client';
import { isValidVendorId, normalizeSystems } from '@/lib/vendors/registry';
import { getXiaomiConfig, normalizeXiaomiRegion } from '@/lib/vendors/xiaomi-client';
import type {
  DashboardPayload,
  DeviceRecord,
  DeviceVendorLinkRecord,
  EnvStatus,
  GoogleHomeMode,
  HomeConnectEnv,
  SystemFilter,
  TimeRange,
  VendorId,
} from '@/types';
import type { XiaomiRegion } from '@/lib/vendors/xiaomi-client';

export async function getDashboardData(
  range: TimeRange = '24h',
  selectedRoomId = 'all',
  customFrom: string | null = null,
  customTo: string | null = null,
  selectedSystem: SystemFilter = 'all'
): Promise<DashboardPayload> {
  const db = getDb();

  if (!db) {
    const state = getDemoState();
    const ghState = state.vendorConnections.google_home;
    const hcState = state.vendorConnections.home_connect;
    const daikinState = state.vendorConnections.daikin;
    const xiaomiState = state.vendorConnections.xiaomi;
    const hcEnv: HomeConnectEnv =
      hcState.mode === 'oauth_simulator'
        ? 'simulator'
        : hcState.mode === 'oauth_cn'
          ? 'cn'
          : getHomeConnectConfig().defaultEnv;
    const env: EnvStatus = {
      ...getEnvStatus(
        ghState.connected,
        hcState.connected,
        daikinState.connected,
        xiaomiState.connected
      ),
      googleHomeMode:
        ghState.mode === 'mcp' || ghState.mode === 'sdm'
          ? ghState.mode
          : getGoogleHomeConfig().defaultMode,
      homeConnectEnv: hcEnv,
    };
    const devicesWithLinks: DeviceRecord[] = state.devices.map((d) => ({
      ...d,
      primaryVendor: d.primaryVendor ?? 'tuya',
      systems: normalizeSystems(d.systems, d.primaryVendor ?? 'tuya'),
      vendorLinks: state.vendorLinks.filter((l) => l.deviceId === d.id),
    }));
    const vendors = buildVendorConnectionSummariesFromState({
      devices: devicesWithLinks,
      demoConnections: state.vendorConnections,
    });

    return buildDashboardPayload({
      env,
      range,
      customFrom,
      customTo,
      selectedRoomId,
      selectedSystem,
      rooms: state.rooms,
      devices: devicesWithLinks,
      vendors,
      readings: state.readings,
      tariffs: state.tariffs,
      automations: state.automations,
      logs: state.logs,
    });
  }

  await seedDefaultDataIfEmpty(db);

  const now = new Date();
  const { startMs, endMs } = resolveTimeWindow(range, customFrom, customTo, now);
  const startDate = new Date(startMs);
  const endDate = new Date(endMs);

  const [roomRows, deviceRows, linkRows, connRows, readingRows, tariffRows, automationRows, logRows] =
    await Promise.all([
      db.select().from(rooms).orderBy(asc(rooms.id)),
      db.select().from(devices).orderBy(asc(devices.name)),
      db.select().from(deviceVendorLinks).orderBy(asc(deviceVendorLinks.id)),
      db.select().from(vendorConnections),
      db
        .select()
        .from(metricReadings)
        .where(
          range === 'custom'
            ? and(
                gte(metricReadings.recordedAt, startDate),
                lte(metricReadings.recordedAt, endDate)
              )
            : gte(metricReadings.recordedAt, startDate)
        )
        .orderBy(asc(metricReadings.recordedAt)),
      db.select().from(tariffPeriods).orderBy(asc(tariffPeriods.startDate)),
      db.select().from(automations).orderBy(asc(automations.name)),
      db.select().from(collectionLogs).orderBy(desc(collectionLogs.executedAt)).limit(20),
    ]);

  const linksByDeviceId = new Map<string, DeviceVendorLinkRecord[]>();
  for (const row of linkRows) {
    const mapped = mapDbVendorLink(row);
    const list = linksByDeviceId.get(mapped.deviceId) ?? [];
    list.push(mapped);
    linksByDeviceId.set(mapped.deviceId, list);
  }

  const mappedDevices = deviceRows.map((row) =>
    mapDbDevice(row, linksByDeviceId.get(row.id) ?? [])
  );

  const connByVendor = new Map<VendorId, typeof vendorConnections.$inferSelect>();
  for (const conn of connRows) {
    if (isValidVendorId(conn.vendor)) {
      connByVendor.set(conn.vendor, conn);
    }
  }

  const hcConn = connByVendor.get('home_connect');
  const daikinConn = connByVendor.get('daikin');
  const xiaomiConn = connByVendor.get('xiaomi');
  const ghConn = connByVendor.get('google_home');

  const googleCfg = getGoogleHomeConfig();
  const hcCfg = getHomeConnectConfig();
  const xiaomiCfg = getXiaomiConfig();

  const ghMode: GoogleHomeMode =
    ghConn?.mode === 'mcp' || ghConn?.mode === 'sdm' ? ghConn.mode : googleCfg.defaultMode;
  const ghConnected = VENDOR_SERVER_PLUGINS.google_home.isConnectedLive({
    conn: ghConn,
    devices: mappedDevices,
  });
  const hcEnv = parseHomeConnectEnvFromMode(hcConn?.mode, hcCfg.defaultEnv);
  const hcConnected = VENDOR_SERVER_PLUGINS.home_connect.isConnectedLive({
    conn: hcConn,
    devices: mappedDevices,
  });
  const daikinConnected = VENDOR_SERVER_PLUGINS.daikin.isConnectedLive({
    conn: daikinConn,
    devices: mappedDevices,
  });
  const xiaomiConnected = VENDOR_SERVER_PLUGINS.xiaomi.isConnectedLive({
    conn: xiaomiConn,
    devices: mappedDevices,
  });

  const xiaomiConnConfig = (xiaomiConn?.config ?? {}) as Record<string, unknown>;
  const xiaomiRegion: XiaomiRegion =
    typeof xiaomiConnConfig.region === 'string'
      ? normalizeXiaomiRegion(xiaomiConnConfig.region)
      : xiaomiCfg.region;

  const env: EnvStatus = {
    ...getEnvStatus(ghConnected, hcConnected, daikinConnected, xiaomiConnected),
    xiaomiRegion,
    googleHomeMode: ghMode,
    homeConnectEnv: hcEnv,
  };

  const vendors = buildVendorConnectionSummariesFromState({
    devices: mappedDevices,
    connByVendor,
  });

  return buildDashboardPayload({
    env,
    range,
    customFrom,
    customTo,
    selectedRoomId,
    selectedSystem,
    rooms: roomRows.map(mapDbRoom),
    devices: mappedDevices,
    vendors,
    readings: readingRows.map(mapDbReading),
    tariffs: normalizeTariffTimeline(tariffRows.map(mapDbTariff)),
    automations: automationRows.map(mapDbAutomation),
    logs: logRows.map(mapDbLog),
    now,
  });
}
