import { and, asc, desc, gte, lte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  automations,
  collectionLogs,
  devices,
  deviceVendorLinks,
  meterReadings,
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
  mapDbMeterReading,
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
import { loadEffectiveConsoApiConfig } from '@/lib/services/vendors/conso-api-sync';
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

const HOURLY_DOWNSAMPLE_THRESHOLD_HOURS = 45 * 24;

async function loadMetricReadingsForWindow(
  db: NonNullable<ReturnType<typeof getDb>>,
  range: TimeRange,
  startDate: Date,
  endDate: Date,
  effectiveHours: number
) {
  if (effectiveHours <= HOURLY_DOWNSAMPLE_THRESHOLD_HOURS) {
    const rows = await db
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
      .orderBy(asc(metricReadings.recordedAt));
    return rows.map(mapDbReading);
  }

  const dateFilter =
    range === 'custom'
      ? sql`recorded_at >= ${startDate} AND recorded_at <= ${endDate}`
      : sql`recorded_at >= ${startDate}`;

  const rawResult = await db.execute(sql`
    SELECT
      MIN(id)::int AS id,
      device_id AS "deviceId",
      room_id AS "roomId",
      date_trunc('hour', recorded_at) AS "bucketTs",
      AVG(power_w)::real AS "powerW",
      AVG(voltage_v)::real AS "voltageV",
      SUM(energy_kwh)::real AS "energyKwh",
      MAX(energy_source) AS "energySource",
      AVG(temp_c)::real AS "tempC",
      AVG(humidity_pct)::real AS "humidityPct",
      BOOL_OR(contact_open) AS "contactOpen",
      MAX(cover_state) AS "coverState",
      AVG(cover_open_pct)::real AS "coverOpenPct"
    FROM metric_readings
    WHERE ${dateFilter}
    GROUP BY device_id, room_id, date_trunc('hour', recorded_at)
    ORDER BY "bucketTs" ASC
  `);

  const rows = Array.isArray(rawResult)
    ? rawResult
    : ((rawResult as { rows?: Array<Record<string, unknown>> }).rows ?? []);

  return (rows as Array<Record<string, unknown>>).map((r, idx) => ({
    id: typeof r.id === 'number' ? r.id : idx + 1,
    deviceId: String(r.deviceId),
    roomId: r.roomId === null || r.roomId === undefined ? null : Number(r.roomId),
    recordedAt:
      r.bucketTs instanceof Date
        ? r.bucketTs.toISOString()
        : new Date(String(r.bucketTs)).toISOString(),
    powerW: r.powerW === null || r.powerW === undefined ? null : Number(r.powerW),
    voltageV: r.voltageV === null || r.voltageV === undefined ? null : Number(r.voltageV),
    energyKwh: r.energyKwh === null || r.energyKwh === undefined ? null : Number(r.energyKwh),
    energySource:
      r.energySource === 'add_ele' || r.energySource === 'integration'
        ? (r.energySource as 'add_ele' | 'integration')
        : null,
    tempC: r.tempC === null || r.tempC === undefined ? null : Number(r.tempC),
    humidityPct:
      r.humidityPct === null || r.humidityPct === undefined ? null : Number(r.humidityPct),
    contactOpen: typeof r.contactOpen === 'boolean' ? r.contactOpen : null,
    coverState:
      r.coverState === 'open' ||
      r.coverState === 'closed' ||
      r.coverState === 'partial' ||
      r.coverState === 'unknown'
        ? (r.coverState as 'open' | 'closed' | 'partial' | 'unknown')
        : null,
    coverOpenPct:
      r.coverOpenPct === null || r.coverOpenPct === undefined ? null : Number(r.coverOpenPct),
  }));
}

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
        xiaomiState.connected,
        {
          configured: Boolean(state.consoApiConfig?.prm && state.consoApiConfig?.token),
          connected: state.vendorConnections.conso_api.connected,
          prm: state.consoApiConfig?.prm ?? null,
          subscribedKva: state.consoApiConfig?.subscribedKva ?? null,
        }
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
      meterReadings: state.meterReadings,
      subscribedPowerKva: state.consoApiConfig?.subscribedKva ?? null,
      tariffs: state.tariffs,
      automations: state.automations,
      logs: state.logs,
    });
  }

  await seedDefaultDataIfEmpty(db);

  const now = new Date();
  const { startMs, endMs, effectiveHours } = resolveTimeWindow(range, customFrom, customTo, now);
  const prevStartDate = new Date(startMs - (endMs - startMs));
  const endDate = new Date(endMs);

  const [
    roomRows,
    deviceRows,
    linkRows,
    connRows,
    mappedReadings,
    meterRows,
    tariffRows,
    automationRows,
    logRows,
  ] = await Promise.all([
    db.select().from(rooms).orderBy(asc(rooms.id)),
    db.select().from(devices).orderBy(asc(devices.name)),
    db.select().from(deviceVendorLinks).orderBy(asc(deviceVendorLinks.id)),
    db.select().from(vendorConnections),
    loadMetricReadingsForWindow(db, range, prevStartDate, endDate, effectiveHours * 2),
    db
      .select()
      .from(meterReadings)
      .where(
        range === 'custom'
          ? and(
              gte(meterReadings.recordedAt, prevStartDate),
              lte(meterReadings.recordedAt, endDate)
            )
          : gte(meterReadings.recordedAt, prevStartDate)
      )
      .orderBy(asc(meterReadings.recordedAt)),
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

  const consoConn = connByVendor.get('conso_api');
  const consoCfg = await loadEffectiveConsoApiConfig(db, consoConn);
  const consoConnected = VENDOR_SERVER_PLUGINS.conso_api.isConnectedLive({
    conn: consoConn,
    devices: mappedDevices,
  });

  const env: EnvStatus = {
    ...getEnvStatus(ghConnected, hcConnected, daikinConnected, xiaomiConnected, {
      configured: consoCfg.config.configured,
      connected: consoConnected,
      prm: consoCfg.config.prm || null,
      subscribedKva: consoCfg.config.subscribedKva,
    }),
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
    readings: mappedReadings,
    meterReadings: meterRows.map(mapDbMeterReading),
    subscribedPowerKva: consoCfg.config.subscribedKva,
    tariffs: normalizeTariffTimeline(tariffRows.map(mapDbTariff)),
    automations: automationRows.map(mapDbAutomation),
    logs: logRows.map(mapDbLog),
    now,
  });
}
