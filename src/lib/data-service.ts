import crypto from 'node:crypto';
import { and, asc, desc, eq, gte, isNull, lte, notInArray, sql } from 'drizzle-orm';
import { getDb, isDatabaseConfigured, type AppDatabase } from '@/db';
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
import { buildDashboardPayload, resolveTimeWindow } from './aggregator';
import { isAppPasswordConfigured } from './auth';
import { getDemoState, simulateDemoCollection } from './demo-store';
import { inferDeviceCategory, sanitizeDeviceDpConfig } from './device-utils';
import { computeHybridEnergyKwh, normalizeTariffTimeline } from './tariff-engine';
import { decryptSecret, encryptSecret } from './vendors/crypto-store';
import { mergeDeviceSystems } from './vendors/deduplication';
import {
  fetchGoogleHomeInventory,
  getGoogleHomeConfig,
  makeGoogleDeviceId,
  refreshGoogleAccessToken,
} from './vendors/google-home-client';
import { isValidVendorId, normalizeSystems, VENDOR_IDS, VENDOR_REGISTRY } from './vendors/registry';
import {
  autoDetectDpConfig,
  extractMetricsFromStatus,
  fetchBatchFactoryInfos,
  fetchBatchStatuses,
  fetchDeviceSpecification,
  fetchTuyaAutomations,
  fetchTuyaDevices,
  fetchTuyaRoomMapping,
  formatMacAddress,
  getTuyaConfig,
  normalizeTuyaRule,
  type TuyaRawDevice,
} from './tuya-client';
import type {
  AutomationMatchType,
  AutomationRecord,
  AutomationRuleType,
  CollectionLogRecord,
  DashboardPayload,
  DeviceCategory,
  DeviceRecord,
  DeviceVendorLinkRecord,
  DpConfig,
  EnergyMode,
  EnergySource,
  EnvStatus,
  GoogleHomeMode,
  HcSlot,
  MetricReadingRecord,
  RawDpStatus,
  RoomRecord,
  SystemFilter,
  TariffMode,
  TariffPeriodRecord,
  TimeRange,
  VendorConnectionSummary,
  VendorId,
} from '@/types';

const RANGE_HOURS: Record<Exclude<TimeRange, 'custom'>, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
  '365d': 24 * 365,
};

export function getEnvStatus(googleHomeConnected = false): EnvStatus {
  const tuya = getTuyaConfig();
  const google = getGoogleHomeConfig();
  const databaseConfigured = isDatabaseConfigured();
  return {
    mode: databaseConfigured ? 'live' : 'demo',
    databaseConfigured,
    tuyaConfigured: tuya.configured,
    tuyaRegion: tuya.region,
    tuyaUserUidConfigured: Boolean(tuya.userUid),
    appPasswordConfigured: isAppPasswordConfigured(),
    scheduleSecretConfigured: Boolean(process.env.SCHEDULE_SECRET?.trim()),
    googleHomeApiEnabled: google.apiEnabled,
    googleHomeConfigured: google.configured,
    googleHomeMode: google.defaultMode,
    googleHomeConnected: google.apiEnabled && googleHomeConnected,
    googleSdmProjectConfigured: Boolean(google.sdmProjectId),
  };
}

function mapDbRoom(row: typeof rooms.$inferSelect): RoomRecord {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    targetTempMin: row.targetTempMin,
    targetTempMax: row.targetTempMax,
    targetHumidityMin: row.targetHumidityMin,
    targetHumidityMax: row.targetHumidityMax,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapDbVendorLink(row: typeof deviceVendorLinks.$inferSelect): DeviceVendorLinkRecord {
  return {
    id: row.id,
    deviceId: row.deviceId,
    vendor: isValidVendorId(row.vendor) ? row.vendor : 'tuya',
    externalId: row.externalId,
    externalName: row.externalName,
    isPrimaryTelemetry: row.isPrimaryTelemetry,
    linkedAt: row.linkedAt.toISOString(),
  };
}

function mapDbDevice(
  row: typeof devices.$inferSelect,
  vendorLinks: DeviceVendorLinkRecord[] = []
): DeviceRecord {
  const primaryVendor: VendorId = isValidVendorId(row.primaryVendor) ? row.primaryVendor : 'tuya';
  return {
    id: row.id,
    name: row.name,
    customName: row.customName,
    primaryVendor,
    systems: normalizeSystems(row.systems, primaryVendor),
    vendorLinks,
    roomId: row.roomId,
    category: (row.category as DeviceCategory) || 'power',
    tuyaCategory: row.tuyaCategory,
    productName: row.productName,
    ipAddress: row.ipAddress,
    macAddress: row.macAddress,
    isOnline: row.isOnline,
    isMonitored: row.isMonitored,
    excludeFromTotals: row.excludeFromTotals,
    energyMode: (row.energyMode as EnergyMode) || 'hybrid',
    dpConfig: row.dpConfig ?? {},
    lastRawStatus: row.lastRawStatus ?? null,
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    lastPowerW: row.lastPowerW,
    lastVoltageV: row.lastVoltageV,
    lastAddEleKwh: row.lastAddEleKwh,
    lastTempC: row.lastTempC,
    lastHumidityPct: row.lastHumidityPct,
    lastBatteryPct: row.lastBatteryPct,
    lastContactOpen: row.lastContactOpen,
  };
}

function mapDbReading(row: typeof metricReadings.$inferSelect): MetricReadingRecord {
  return {
    id: row.id,
    deviceId: row.deviceId,
    roomId: row.roomId,
    recordedAt: row.recordedAt.toISOString(),
    powerW: row.powerW,
    voltageV: row.voltageV,
    energyKwh: row.energyKwh,
    energySource: (row.energySource as EnergySource | null) ?? null,
    tempC: row.tempC,
    humidityPct: row.humidityPct,
    contactOpen: row.contactOpen,
  };
}

function mapDbTariff(row: typeof tariffPeriods.$inferSelect): TariffPeriodRecord {
  return {
    id: row.id,
    label: row.label,
    startDate: row.startDate,
    endDate: row.endDate,
    mode: (row.mode as TariffMode) || 'BASE',
    baseRateEur: row.baseRateEur,
    hpRateEur: row.hpRateEur,
    hcRateEur: row.hcRateEur,
    hcSlots: row.hcSlots ?? [],
    monthlySubscriptionEur: row.monthlySubscriptionEur,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapDbLog(row: typeof collectionLogs.$inferSelect): CollectionLogRecord {
  return {
    id: row.id,
    executedAt: row.executedAt.toISOString(),
    trigger: row.trigger === 'manual' ? 'manual' : 'schedule',
    devicesCount: row.devicesCount,
    readingsInserted: row.readingsInserted,
    status: row.status === 'error' ? 'error' : 'success',
    errorMessage: row.errorMessage,
    durationMs: row.durationMs,
  };
}

function mapDbAutomation(row: typeof automations.$inferSelect): AutomationRecord {
  const ruleType: AutomationRuleType = row.ruleType === 'scene' ? 'scene' : 'automation';
  const vendor: VendorId = isValidVendorId(row.vendor) ? row.vendor : 'tuya';
  const syncedAtIso = row.syncedAt.toISOString();

  if (row.rawPayload && typeof row.rawPayload === 'object' && !Array.isArray(row.rawPayload)) {
    const normalized = normalizeTuyaRule(
      row.rawPayload as Record<string, unknown>,
      row.homeId ?? '',
      ruleType,
      syncedAtIso
    );
    if (normalized) {
      return {
        ...normalized,
        id: row.id,
        homeId: row.homeId,
        vendor,
        name: normalized.name || row.name,
        conditions: normalized.conditions.length > 0 ? normalized.conditions : (row.conditions ?? []),
        actions: normalized.actions.length > 0 ? normalized.actions : (row.actions ?? []),
        rawPayload: row.rawPayload,
        syncedAt: syncedAtIso,
      };
    }
  }

  return {
    id: row.id,
    homeId: row.homeId,
    vendor,
    name: row.name,
    ruleType,
    enabled: row.enabled,
    matchType: (row.matchType as AutomationMatchType) || 'any',
    effectiveTime: row.effectiveTime ?? null,
    conditions: row.conditions ?? [],
    actions: row.actions ?? [],
    rawPayload: row.rawPayload ?? null,
    syncedAt: syncedAtIso,
  };
}

let schemaInitPromise: Promise<void> | null = null;

async function ensureSchemaInitialized(db: AppDatabase): Promise<void> {
  if (!schemaInitPromise) {
    schemaInitPromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "rooms" (
          "id" serial PRIMARY KEY NOT NULL,
          "name" text NOT NULL,
          "icon" text DEFAULT 'Home' NOT NULL,
          "color" text DEFAULT '#3b82f6' NOT NULL,
          "target_temp_min" real DEFAULT 19 NOT NULL,
          "target_temp_max" real DEFAULT 22 NOT NULL,
          "target_humidity_min" real DEFAULT 40 NOT NULL,
          "target_humidity_max" real DEFAULT 60 NOT NULL,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "devices" (
          "id" text PRIMARY KEY NOT NULL,
          "name" text NOT NULL,
          "custom_name" text,
          "room_id" integer REFERENCES "rooms"("id") ON DELETE SET NULL,
          "category" text DEFAULT 'power' NOT NULL,
          "tuya_category" text,
          "product_name" text,
          "ip_address" text,
          "mac_address" text,
          "is_online" boolean DEFAULT true NOT NULL,
          "is_monitored" boolean DEFAULT true NOT NULL,
          "exclude_from_totals" boolean DEFAULT false NOT NULL,
          "energy_mode" text DEFAULT 'hybrid' NOT NULL,
          "dp_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
          "last_raw_status" jsonb,
          "last_seen_at" timestamp with time zone,
          "last_power_w" real,
          "last_voltage_v" real,
          "last_add_ele_kwh" real,
          "last_temp_c" real,
          "last_humidity_pct" real,
          "last_battery_pct" real,
          "last_contact_open" boolean
        )
      `);
      await db.execute(sql`
        ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "last_contact_open" boolean
      `);
      await db.execute(sql`
        ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "ip_address" text
      `);
      await db.execute(sql`
        ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "mac_address" text
      `);
      await db.execute(sql`
        ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "exclude_from_totals" boolean DEFAULT false NOT NULL
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "metric_readings" (
          "id" serial PRIMARY KEY NOT NULL,
          "device_id" text NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
          "room_id" integer REFERENCES "rooms"("id") ON DELETE SET NULL,
          "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
          "power_w" real,
          "voltage_v" real,
          "energy_kwh" real,
          "energy_source" text,
          "temp_c" real,
          "humidity_pct" real,
          "contact_open" boolean
        )
      `);
      await db.execute(sql`
        ALTER TABLE "metric_readings" ADD COLUMN IF NOT EXISTS "contact_open" boolean
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "idx_readings_device_time" ON "metric_readings" ("device_id", "recorded_at")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "idx_readings_room_time" ON "metric_readings" ("room_id", "recorded_at")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "idx_readings_time" ON "metric_readings" ("recorded_at")
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "tariff_periods" (
          "id" serial PRIMARY KEY NOT NULL,
          "label" text NOT NULL,
          "start_date" text NOT NULL,
          "end_date" text,
          "mode" text DEFAULT 'BASE' NOT NULL,
          "base_rate_eur" real,
          "hp_rate_eur" real,
          "hc_rate_eur" real,
          "hc_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
          "monthly_subscription_eur" real DEFAULT 0 NOT NULL,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "collection_logs" (
          "id" serial PRIMARY KEY NOT NULL,
          "executed_at" timestamp with time zone DEFAULT now() NOT NULL,
          "trigger" text NOT NULL,
          "devices_count" integer NOT NULL,
          "readings_inserted" integer NOT NULL,
          "status" text NOT NULL,
          "error_message" text,
          "duration_ms" integer
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "automations" (
          "id" text PRIMARY KEY NOT NULL,
          "home_id" text,
          "name" text NOT NULL,
          "rule_type" text DEFAULT 'automation' NOT NULL,
          "enabled" boolean DEFAULT true NOT NULL,
          "match_type" text DEFAULT 'any' NOT NULL,
          "effective_time" jsonb,
          "conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
          "actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
          "raw_payload" jsonb,
          "synced_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`
        ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "primary_vendor" text DEFAULT 'tuya' NOT NULL
      `);
      await db.execute(sql`
        ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "systems" jsonb DEFAULT '["tuya"]'::jsonb NOT NULL
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "device_vendor_links" (
          "id" serial PRIMARY KEY NOT NULL,
          "device_id" text NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
          "vendor" text NOT NULL,
          "external_id" text NOT NULL,
          "external_name" text,
          "vendor_metadata" jsonb,
          "is_primary_telemetry" boolean DEFAULT false NOT NULL,
          "linked_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "idx_vendor_links_unique" ON "device_vendor_links" ("vendor", "external_id")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "idx_vendor_links_device" ON "device_vendor_links" ("device_id")
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "vendor_connections" (
          "vendor" text PRIMARY KEY NOT NULL,
          "mode" text DEFAULT 'mcp' NOT NULL,
          "status" text DEFAULT 'disconnected' NOT NULL,
          "access_token" text,
          "refresh_token" text,
          "token_expires_at" timestamp with time zone,
          "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
          "last_synced_at" timestamp with time zone,
          "last_error" text,
          "updated_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`
        ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "vendor" text DEFAULT 'tuya' NOT NULL
      `);
      await db.execute(sql`
        INSERT INTO "device_vendor_links" ("device_id", "vendor", "external_id", "external_name", "is_primary_telemetry")
        SELECT d."id", d."primary_vendor", d."id", d."name", true
        FROM "devices" d
        WHERE d."primary_vendor" = 'tuya'
        ON CONFLICT ("vendor", "external_id") DO NOTHING
      `);
    })().catch((err) => {
      schemaInitPromise = null;
      throw err;
    });
  }
  await schemaInitPromise;
}

const ROOM_PALETTE = [
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#10b981',
  '#ec4899',
  '#06b6d4',
  '#f43f5e',
  '#14b8a6',
];

function inferRoomStyle(name: string, index: number): {
  color: string;
  icon: string;
  targetTempMin: number;
  targetTempMax: number;
  targetHumidityMin: number;
  targetHumidityMax: number;
} {
  const lower = name.toLowerCase();
  if (lower.includes('salon') || lower.includes('séjour') || lower.includes('living')) {
    return { color: '#3b82f6', icon: 'Sofa', targetTempMin: 19.5, targetTempMax: 22.5, targetHumidityMin: 40, targetHumidityMax: 60 };
  }
  if (lower.includes('bureau') || lower.includes('office')) {
    return { color: '#8b5cf6', icon: 'Monitor', targetTempMin: 19, targetTempMax: 22, targetHumidityMin: 40, targetHumidityMax: 60 };
  }
  if (lower.includes('cuisine') || lower.includes('kitchen')) {
    return { color: '#f59e0b', icon: 'Utensils', targetTempMin: 18.5, targetTempMax: 23, targetHumidityMin: 40, targetHumidityMax: 65 };
  }
  if (lower.includes('chambre') || lower.includes('bed')) {
    return { color: '#10b981', icon: 'Bed', targetTempMin: 17, targetTempMax: 20, targetHumidityMin: 40, targetHumidityMax: 60 };
  }
  if (lower.includes('bain') || lower.includes('sdb') || lower.includes('douche') || lower.includes('bath')) {
    return { color: '#ec4899', icon: 'Bath', targetTempMin: 20, targetTempMax: 24, targetHumidityMin: 45, targetHumidityMax: 65 };
  }
  return {
    color: ROOM_PALETTE[index % ROOM_PALETTE.length],
    icon: 'Home',
    targetTempMin: 19,
    targetTempMax: 22,
    targetHumidityMin: 40,
    targetHumidityMax: 60,
  };
}

async function seedDefaultDataIfEmpty(db: AppDatabase): Promise<void> {
  await ensureSchemaInitialized(db);

  // Ne crée des pièces d'exemple que si Tuya n'est pas configuré et la base est vierge
  if (!getTuyaConfig().configured) {
    const [existingRooms, existingDevices] = await Promise.all([
      db.select().from(rooms).limit(1),
      db.select().from(devices).limit(1),
    ]);
    if (existingRooms.length === 0 && existingDevices.length === 0) {
      await db.insert(rooms).values([
        {
          name: 'Salon',
          icon: 'Sofa',
          color: '#3b82f6',
          targetTempMin: 19.5,
          targetTempMax: 22.5,
          targetHumidityMin: 40,
          targetHumidityMax: 60,
        },
        {
          name: 'Bureau',
          icon: 'Monitor',
          color: '#8b5cf6',
          targetTempMin: 19,
          targetTempMax: 22,
          targetHumidityMin: 40,
          targetHumidityMax: 60,
        },
        {
          name: 'Cuisine',
          icon: 'Utensils',
          color: '#f59e0b',
          targetTempMin: 18.5,
          targetTempMax: 23,
          targetHumidityMin: 40,
          targetHumidityMax: 65,
        },
        {
          name: 'Chambre',
          icon: 'Bed',
          color: '#10b981',
          targetTempMin: 17,
          targetTempMax: 20,
          targetHumidityMin: 40,
          targetHumidityMax: 60,
        },
      ]);
    }
  }

  const existingTariffs = await db.select().from(tariffPeriods).limit(1);
  if (existingTariffs.length === 0) {
    const year = new Date().getUTCFullYear();
    await db.insert(tariffPeriods).values({
      label: `Tarif Base ${year}`,
      startDate: `${year}-01-01`,
      endDate: null,
      mode: 'BASE',
      baseRateEur: 0.2016,
      hpRateEur: 0.2146,
      hcRateEur: 0.1696,
      hcSlots: [{ start: '22:00', end: '06:00' }],
      monthlySubscriptionEur: 14.18,
    });
  }
}

function buildVendorConnectionSummaries(params: {
  devices: DeviceRecord[];
  tuyaConnected: boolean;
  tuyaLastSyncedAt: string | null;
  tuyaLastError: string | null;
  ghConnected: boolean;
  ghMode: GoogleHomeMode;
  ghLastSyncedAt: string | null;
  ghLastError: string | null;
}): VendorConnectionSummary[] {
  const tuyaCfg = getTuyaConfig();
  const googleCfg = getGoogleHomeConfig();

  const countFor = (vendor: VendorId) =>
    params.devices.filter((d) => normalizeSystems(d.systems, d.primaryVendor).includes(vendor)).length;

  return [
    {
      vendor: 'tuya',
      label: VENDOR_REGISTRY.tuya.label,
      mode: 'cloud_key',
      configured: tuyaCfg.configured,
      connected: params.tuyaConnected,
      devicesCount: countFor('tuya'),
      lastSyncedAt: params.tuyaLastSyncedAt,
      lastError: params.tuyaLastError,
    },
    {
      vendor: 'google_home',
      label: VENDOR_REGISTRY.google_home.label,
      mode: params.ghMode,
      configured: googleCfg.configured,
      connected: params.ghConnected,
      devicesCount: countFor('google_home'),
      lastSyncedAt: params.ghLastSyncedAt,
      lastError: params.ghLastError,
    },
  ];
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
    const tuyaState = state.vendorConnections.tuya;
    const env = {
      ...getEnvStatus(ghState.connected),
      googleHomeMode:
        ghState.mode === 'mcp' || ghState.mode === 'sdm'
          ? ghState.mode
          : getGoogleHomeConfig().defaultMode,
    };
    const devicesWithLinks: DeviceRecord[] = state.devices.map((d) => ({
      ...d,
      primaryVendor: d.primaryVendor ?? 'tuya',
      systems: normalizeSystems(d.systems, d.primaryVendor ?? 'tuya'),
      vendorLinks: state.vendorLinks.filter((l) => l.deviceId === d.id),
    }));
    const vendors = buildVendorConnectionSummaries({
      devices: devicesWithLinks,
      tuyaConnected: tuyaState.connected,
      tuyaLastSyncedAt: tuyaState.lastSyncedAt,
      tuyaLastError: tuyaState.lastError,
      ghConnected: ghState.connected,
      ghMode: env.googleHomeMode,
      ghLastSyncedAt: ghState.lastSyncedAt,
      ghLastError: ghState.lastError,
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

  const tuyaConn = connRows.find((c) => c.vendor === 'tuya');
  const ghConn = connRows.find((c) => c.vendor === 'google_home');
  const googleCfg = getGoogleHomeConfig();
  const tuyaCfg = getTuyaConfig();

  const ghMode: GoogleHomeMode =
    ghConn?.mode === 'mcp' || ghConn?.mode === 'sdm' ? ghConn.mode : googleCfg.defaultMode;
  const ghConnected =
    googleCfg.apiEnabled &&
    Boolean(ghConn && ghConn.status === 'connected' && (ghConn.accessToken || ghConn.refreshToken));
  const tuyaConnected = tuyaCfg.configured || mappedDevices.some((d) => d.systems.includes('tuya'));

  const env: EnvStatus = {
    ...getEnvStatus(ghConnected),
    googleHomeMode: ghMode,
  };

  const vendors = buildVendorConnectionSummaries({
    devices: mappedDevices,
    tuyaConnected,
    tuyaLastSyncedAt: tuyaConn?.lastSyncedAt ? tuyaConn.lastSyncedAt.toISOString() : null,
    tuyaLastError: tuyaConn?.lastError ?? null,
    ghConnected,
    ghMode,
    ghLastSyncedAt: ghConn?.lastSyncedAt ? ghConn.lastSyncedAt.toISOString() : null,
    ghLastError: ghConn?.lastError ?? null,
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

async function ensureMissingRoomsInDb(
  db: AppDatabase,
  roomNames: string[]
): Promise<{
  existingRoomsRows: Array<typeof rooms.$inferSelect>;
  roomNameToId: Map<string, number>;
  processedCount: number;
  createdCount: number;
}> {
  const existingRoomsRows = await db.select().from(rooms).orderBy(asc(rooms.id));
  const roomNameToId = new Map<string, number>();
  for (const r of existingRoomsRows) {
    roomNameToId.set(r.name.trim().toLowerCase(), r.id);
  }

  let processedCount = 0;
  let createdCount = 0;
  let styleIndex = existingRoomsRows.length;
  for (const rawRoomName of roomNames) {
    const trimmed = rawRoomName.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!roomNameToId.has(key)) {
      const style = inferRoomStyle(trimmed, styleIndex++);
      const [insertedRoom] = await db
        .insert(rooms)
        .values({
          name: trimmed,
          icon: style.icon,
          color: style.color,
          targetTempMin: style.targetTempMin,
          targetTempMax: style.targetTempMax,
          targetHumidityMin: style.targetHumidityMin,
          targetHumidityMax: style.targetHumidityMax,
        })
        .returning();
      roomNameToId.set(key, insertedRoom.id);
      createdCount++;
    }
    processedCount++;
  }

  return { existingRoomsRows, roomNameToId, processedCount, createdCount };
}

function ensureMissingRoomsInDemo(roomNames: string[]): {
  roomNameToId: Map<string, number>;
  processedCount: number;
  createdCount: number;
} {
  const state = getDemoState();
  const nowIso = new Date().toISOString();
  const roomNameToId = new Map<string, number>();
  for (const r of state.rooms) {
    roomNameToId.set(r.name.trim().toLowerCase(), r.id);
  }

  let processedCount = 0;
  let createdCount = 0;
  for (const rawRoomName of roomNames) {
    const trimmed = rawRoomName.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!roomNameToId.has(key)) {
      const style = inferRoomStyle(trimmed, state.rooms.length);
      const created: RoomRecord = {
        id: state.nextRoomId++,
        name: trimmed,
        icon: style.icon,
        color: style.color,
        targetTempMin: style.targetTempMin,
        targetTempMax: style.targetTempMax,
        targetHumidityMin: style.targetHumidityMin,
        targetHumidityMax: style.targetHumidityMax,
        createdAt: nowIso,
      };
      state.rooms.push(created);
      roomNameToId.set(key, created.id);
      createdCount++;
    }
    processedCount++;
  }

  return { roomNameToId, processedCount, createdCount };
}

async function cleanupDefaultSeededRoomsInDb(
  db: AppDatabase,
  roomNames: string[],
  existingRoomsRows: Array<typeof rooms.$inferSelect>
): Promise<void> {
  if (roomNames.length === 0) return;

  const importedNamesLower = new Set(roomNames.map((n) => n.trim().toLowerCase()));
  const allAssignedDevices = await db.select({ roomId: devices.roomId }).from(devices);
  const usedRoomIds = new Set(
    allAssignedDevices.map((d) => d.roomId).filter((id): id is number => id !== null)
  );
  const DEFAULT_SEEDED_NAMES = new Set(['salon', 'bureau', 'cuisine', 'chambre']);
  for (const r of existingRoomsRows) {
    const lower = r.name.trim().toLowerCase();
    if (DEFAULT_SEEDED_NAMES.has(lower) && !importedNamesLower.has(lower) && !usedRoomIds.has(r.id)) {
      const refReadings = await db
        .select({ id: metricReadings.id })
        .from(metricReadings)
        .where(eq(metricReadings.roomId, r.id))
        .limit(1);
      if (refReadings.length === 0) {
        await db.delete(rooms).where(eq(rooms.id, r.id));
      }
    }
  }
}

export async function syncTuyaDevices(): Promise<{
  syncedCount: number;
  newCount: number;
  mode: 'live' | 'demo';
  message: string;
}> {
  const db = getDb();
  const tuya = getTuyaConfig();

  if (!tuya.configured) {
    if (!db) {
      const state = getDemoState();
      state.vendorConnections.tuya.lastSyncedAt = new Date().toISOString();
      const tuyaCount = state.devices.filter((d) => d.systems.includes('tuya')).length;
      return {
        syncedCount: tuyaCount,
        newCount: 0,
        mode: 'demo',
        message: `Mode démo actif : ${tuyaCount} appareils Tuya simulés déjà synchronisés.`,
      };
    }
    throw new Error(
      'Identifiants Tuya manquants. Configurez TUYA_ACCESS_ID et TUYA_ACCESS_SECRET dans Vercel / .env.local.'
    );
  }

  const rawDevices = await fetchTuyaDevices();
  const deviceIds = rawDevices.map((d) => d.id);
  const [statusMap, roomMapping, factoryInfoMap] = await Promise.all([
    fetchBatchStatuses(deviceIds).catch(() => new Map<string, RawDpStatus[]>()),
    fetchTuyaRoomMapping(rawDevices),
    fetchBatchFactoryInfos(deviceIds),
  ]);
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    const { roomNameToId, processedCount: syncedRoomsCount } = ensureMissingRoomsInDemo(
      roomMapping.roomNames
    );

    let newCount = 0;
    for (const raw of rawDevices) {
      const rawStatus = statusMap.get(raw.id) ?? raw.status ?? [];
      const tuyaRoomName = roomMapping.deviceRoomMap.get(raw.id);
      const mappedRoomId = tuyaRoomName
        ? (roomNameToId.get(tuyaRoomName.trim().toLowerCase()) ?? null)
        : null;
      const existing = state.devices.find((d) => d.id === raw.id);
      const nextIp = raw.ip?.trim() || null;
      const nextMac =
        factoryInfoMap.get(raw.id)?.mac ?? formatMacAddress(raw.mac) ?? existing?.macAddress ?? null;
      if (existing) {
        existing.name = raw.name;
        existing.primaryVendor = existing.primaryVendor ?? 'tuya';
        existing.systems = normalizeSystems(existing.systems, existing.primaryVendor);
        if (mappedRoomId !== null) existing.roomId = mappedRoomId;
        existing.isOnline = raw.online ?? true;
        existing.tuyaCategory = raw.category;
        existing.productName = raw.product_name ?? null;
        existing.ipAddress = nextIp ?? existing.ipAddress;
        existing.macAddress = nextMac;
        existing.lastRawStatus = rawStatus;
        if (!existing.dpConfig?.contact || !existing.dpConfig?.battery) {
          const detected = autoDetectDpConfig(rawStatus, {}, raw.category);
          existing.dpConfig = {
            ...detected.dpConfig,
            ...existing.dpConfig,
          };
          if (existing.category === 'other' && detected.category !== 'other') {
            existing.category = detected.category;
          }
        }
        const sanitized = sanitizeDeviceDpConfig(existing.dpConfig ?? {}, raw.category);
        if (sanitized.changed) {
          existing.dpConfig = sanitized.dpConfig;
          existing.category = inferDeviceCategory(existing.dpConfig, raw.category);
        }
        const metrics = extractMetricsFromStatus(rawStatus, existing.dpConfig);
        existing.lastPowerW = metrics.powerW;
        existing.lastVoltageV = metrics.voltageV;
        existing.lastAddEleKwh = metrics.addEleKwh;
        existing.lastTempC = metrics.tempC;
        existing.lastHumidityPct = metrics.humidityPct;
        existing.lastBatteryPct = metrics.batteryPct;
        existing.lastContactOpen = metrics.contactOpen;
        existing.lastSeenAt = now.toISOString();
      } else {
        const spec = await fetchDeviceSpecification(raw.id);
        const { dpConfig, category } = autoDetectDpConfig(rawStatus, spec, raw.category);
        const metrics = extractMetricsFromStatus(rawStatus, dpConfig);
        state.devices.push({
          id: raw.id,
          name: raw.name,
          customName: null,
          primaryVendor: 'tuya',
          systems: ['tuya'],
          roomId: mappedRoomId,
          category,
          tuyaCategory: raw.category,
          productName: raw.product_name ?? null,
          ipAddress: nextIp,
          macAddress: nextMac,
          isOnline: raw.online ?? true,
          isMonitored: true,
          excludeFromTotals: false,
          energyMode: 'hybrid',
          dpConfig,
          lastRawStatus: rawStatus,
          lastSeenAt: now.toISOString(),
          lastPowerW: metrics.powerW,
          lastVoltageV: metrics.voltageV,
          lastAddEleKwh: metrics.addEleKwh,
          lastTempC: metrics.tempC,
          lastHumidityPct: metrics.humidityPct,
          lastBatteryPct: metrics.batteryPct,
          lastContactOpen: metrics.contactOpen,
        });
        state.vendorLinks.push({
          id: state.nextLinkId++,
          deviceId: raw.id,
          vendor: 'tuya',
          externalId: raw.id,
          externalName: raw.name,
          isPrimaryTelemetry: true,
          linkedAt: now.toISOString(),
        });
        newCount++;
      }
    }
    state.vendorConnections.tuya.connected = true;
    state.vendorConnections.tuya.lastSyncedAt = now.toISOString();
    state.vendorConnections.tuya.lastError = null;
    const baseMsg =
      syncedRoomsCount > 0
        ? `${rawDevices.length} appareils et ${syncedRoomsCount} pièces synchronisés depuis Tuya Cloud (${newCount} nouveaux).`
        : `${rawDevices.length} appareils récupérés depuis Tuya Cloud (${newCount} nouveaux).`;
    return {
      syncedCount: rawDevices.length,
      newCount,
      mode: 'demo',
      message: roomMapping.warning ? `${baseMsg} (${roomMapping.warning})` : baseMsg,
    };
  }

  await seedDefaultDataIfEmpty(db);

  // Synchronisation automatique des pièces depuis Tuya Smart Home
  const { existingRoomsRows, roomNameToId, processedCount: syncedRoomsCount } =
    await ensureMissingRoomsInDb(db, roomMapping.roomNames);

  const existingRows = await db.select().from(devices);
  const existingMap = new Map(existingRows.map((d) => [d.id, d]));

  let newCount = 0;

  for (const raw of rawDevices) {
    const rawStatus = statusMap.get(raw.id) ?? raw.status ?? [];
    const existing = existingMap.get(raw.id);
    const nextIp = raw.ip?.trim() || existing?.ipAddress || null;
    const nextMac =
      factoryInfoMap.get(raw.id)?.mac ?? formatMacAddress(raw.mac) ?? existing?.macAddress ?? null;
    const tuyaRoomName = roomMapping.deviceRoomMap.get(raw.id);
    const tuyaRoomId = tuyaRoomName
      ? (roomNameToId.get(tuyaRoomName.trim().toLowerCase()) ?? null)
      : null;

    if (existing) {
      const targetRoomId = tuyaRoomId ?? existing.roomId;
      let dpConfig = existing.dpConfig ?? {};
      let nextCategory = existing.category;

      if (Object.keys(dpConfig).length === 0) {
        const detected = autoDetectDpConfig(
          rawStatus,
          await fetchDeviceSpecification(raw.id),
          raw.category
        );
        dpConfig = detected.dpConfig;
        nextCategory = detected.category;
      } else if (!dpConfig.contact || !dpConfig.battery) {
        const detected = autoDetectDpConfig(rawStatus, {}, raw.category);
        dpConfig = { ...detected.dpConfig, ...dpConfig };
        if (nextCategory === 'other' && detected.category !== 'other') {
          nextCategory = detected.category;
        }
      }

      const sanitized = sanitizeDeviceDpConfig(dpConfig, raw.category);
      if (sanitized.changed) {
        dpConfig = sanitized.dpConfig;
        nextCategory = inferDeviceCategory(dpConfig, raw.category);
      }

      const metrics = extractMetricsFromStatus(rawStatus, dpConfig);
      const primaryVendor: VendorId = isValidVendorId(existing.primaryVendor)
        ? existing.primaryVendor
        : 'tuya';
      const nextSystems = normalizeSystems(existing.systems, primaryVendor);

      await db
        .update(devices)
        .set({
          name: raw.name,
          systems: nextSystems,
          roomId: targetRoomId,
          category: nextCategory,
          tuyaCategory: raw.category,
          productName: raw.product_name ?? null,
          ipAddress: nextIp,
          macAddress: nextMac,
          isOnline: raw.online ?? true,
          dpConfig,
          lastRawStatus: rawStatus,
          lastSeenAt: now,
          lastPowerW: metrics.powerW,
          lastVoltageV: metrics.voltageV,
          lastAddEleKwh: metrics.addEleKwh,
          lastTempC: metrics.tempC,
          lastHumidityPct: metrics.humidityPct,
          lastBatteryPct: metrics.batteryPct,
          lastContactOpen: metrics.contactOpen,
        })
        .where(eq(devices.id, raw.id));

      await db
        .insert(deviceVendorLinks)
        .values({
          deviceId: raw.id,
          vendor: 'tuya',
          externalId: raw.id,
          externalName: raw.name,
          isPrimaryTelemetry: primaryVendor === 'tuya',
          linkedAt: now,
        })
        .onConflictDoUpdate({
          target: [deviceVendorLinks.vendor, deviceVendorLinks.externalId],
          set: { externalName: raw.name },
        });

      if (targetRoomId !== null && targetRoomId !== existing.roomId) {
        await db
          .update(metricReadings)
          .set({ roomId: targetRoomId })
          .where(and(eq(metricReadings.deviceId, raw.id), isNull(metricReadings.roomId)));
      }
    } else {
      const spec = await fetchDeviceSpecification(raw.id);
      const { dpConfig, category } = autoDetectDpConfig(rawStatus, spec, raw.category);
      const metrics = extractMetricsFromStatus(rawStatus, dpConfig);

      await db.insert(devices).values({
        id: raw.id,
        name: raw.name,
        customName: null,
        primaryVendor: 'tuya',
        systems: ['tuya'],
        roomId: tuyaRoomId,
        category,
        tuyaCategory: raw.category,
        productName: raw.product_name ?? null,
        ipAddress: nextIp,
        macAddress: nextMac,
        isOnline: raw.online ?? true,
        isMonitored: true,
        excludeFromTotals: false,
        energyMode: 'hybrid',
        dpConfig,
        lastRawStatus: rawStatus,
        lastSeenAt: now,
        lastPowerW: metrics.powerW,
        lastVoltageV: metrics.voltageV,
        lastAddEleKwh: metrics.addEleKwh,
        lastTempC: metrics.tempC,
        lastHumidityPct: metrics.humidityPct,
        lastBatteryPct: metrics.batteryPct,
        lastContactOpen: metrics.contactOpen,
      });

      await db
        .insert(deviceVendorLinks)
        .values({
          deviceId: raw.id,
          vendor: 'tuya',
          externalId: raw.id,
          externalName: raw.name,
          isPrimaryTelemetry: true,
          linkedAt: now,
        })
        .onConflictDoNothing();

      newCount++;
    }
  }

  await db
    .insert(vendorConnections)
    .values({
      vendor: 'tuya',
      mode: 'cloud_key',
      status: 'connected',
      lastSyncedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: vendorConnections.vendor,
      set: {
        status: 'connected',
        lastSyncedAt: now,
        lastError: null,
        updatedAt: now,
      },
    });

  // Nettoie d'éventuelles pièces par défaut vides qui n'existent pas dans Tuya
  await cleanupDefaultSeededRoomsInDb(db, roomMapping.roomNames, existingRoomsRows);

  // Synchronise les scénarios en arrière-plan lors de la synchro globale sans bloquer
  await syncTuyaAutomations(rawDevices).catch(() => null);

  const baseMsg =
    syncedRoomsCount > 0
      ? `${rawDevices.length} appareils et ${syncedRoomsCount} pièces synchronisés avec Tuya Cloud (${newCount} nouveaux).`
      : `${rawDevices.length} appareils synchronisés avec Tuya Cloud (${newCount} nouveaux).`;

  return {
    syncedCount: rawDevices.length,
    newCount,
    mode: 'live',
    message: roomMapping.warning ? `${baseMsg} (${roomMapping.warning})` : baseMsg,
  };
}

export async function syncTuyaAutomations(rawDevicesArg?: TuyaRawDevice[]): Promise<{
  syncedCount: number;
  mode: 'live' | 'demo';
  message: string;
}> {
  const db = getDb();
  const tuya = getTuyaConfig();

  if (!tuya.configured) {
    if (!db) {
      const state = getDemoState();
      return {
        syncedCount: state.automations.length,
        mode: 'demo',
        message: `Mode démo actif : ${state.automations.length} scénarios simulés disponibles.`,
      };
    }
    throw new Error(
      'Identifiants Tuya manquants. Configurez TUYA_ACCESS_ID et TUYA_ACCESS_SECRET.'
    );
  }

  const res = await fetchTuyaAutomations(rawDevicesArg);
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    if (res.automations.length > 0) {
      state.automations = res.automations;
    }
    const baseMsg = `${res.automations.length} scénario(x) et automatisation(s) récupérés depuis Tuya Cloud.`;
    return {
      syncedCount: res.automations.length,
      mode: 'demo',
      message: res.warning ? `${baseMsg} (${res.warning})` : baseMsg,
    };
  }

  await ensureSchemaInitialized(db);

  for (const item of res.automations) {
    await db
      .insert(automations)
      .values({
        id: item.id,
        homeId: item.homeId,
        name: item.name,
        ruleType: item.ruleType as AutomationRuleType,
        enabled: item.enabled,
        matchType: item.matchType,
        effectiveTime: item.effectiveTime,
        conditions: item.conditions,
        actions: item.actions,
        rawPayload: item.rawPayload,
        syncedAt: now,
      })
      .onConflictDoUpdate({
        target: automations.id,
        set: {
          homeId: item.homeId,
          name: item.name,
          ruleType: item.ruleType as AutomationRuleType,
          enabled: item.enabled,
          matchType: item.matchType,
          effectiveTime: item.effectiveTime,
          conditions: item.conditions,
          actions: item.actions,
          rawPayload: item.rawPayload,
          syncedAt: now,
        },
      });
  }

  if (res.automations.length > 0) {
    const syncedIds = res.automations.map((a) => a.id);
    await db.delete(automations).where(notInArray(automations.id, syncedIds));
  }

  const baseMsg = `${res.automations.length} scénario(x) et automatisation(s) synchronisés avec Tuya Cloud.`;
  return {
    syncedCount: res.automations.length,
    mode: 'live',
    message: res.warning ? `${baseMsg} (${res.warning})` : baseMsg,
  };
}

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
  const db = getDb();
  if (!db) {
    const state = getDemoState();
    state.vendorConnections.google_home.connected = false;
    state.vendorConnections.google_home.lastError = null;
    return;
  }

  await ensureSchemaInitialized(db);
  await db
    .update(vendorConnections)
    .set({
      status: 'disconnected',
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(vendorConnections.vendor, 'google_home'));
}

export async function syncGoogleHomeDevices(): Promise<{
  syncedCount: number;
  newCount: number;
  mode: 'live' | 'demo';
  message: string;
}> {
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

  const [existingDeviceRows, ghLinkRows] = await Promise.all([
    db.select().from(devices),
    db.select().from(deviceVendorLinks).where(eq(deviceVendorLinks.vendor, 'google_home')),
  ]);

  const deviceById = new Map(existingDeviceRows.map((d) => [d.id, d]));
  const linkByExternalId = new Map(ghLinkRows.map((l) => [l.externalId, l]));

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

      if (primaryVendor === 'tuya') {
        // Priorité télémétrique Tuya : on conserve les mesures W / kWh / DP / IP / MAC de Tuya
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
      let candidateId = makeGoogleDeviceId(gh.externalId);
      if (deviceById.has(candidateId)) {
        candidateId = `${candidateId}_${now.getTime().toString(36).slice(-4)}`;
      }
      const isClimateOrContact = gh.category === 'climate' || gh.category === 'contact' || gh.category === 'hybrid' || gh.category === 'power';

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

export async function toggleDeviceSystemTag(params: {
  deviceId: string;
  vendor: VendorId;
  enabled: boolean;
}): Promise<DeviceRecord | null> {
  const db = getDb();
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    const dev = state.devices.find((d) => d.id === params.deviceId);
    if (!dev) return null;

    if (!params.enabled && dev.primaryVendor === params.vendor) {
      throw new Error('Impossible de retirer le système principal de cet appareil.');
    }

    if (params.enabled) {
      dev.systems = mergeDeviceSystems(dev.systems, params.vendor, dev.primaryVendor);
      const hasLink = state.vendorLinks.some(
        (l) => l.deviceId === dev.id && l.vendor === params.vendor
      );
      if (!hasLink) {
        state.vendorLinks.push({
          id: state.nextLinkId++,
          deviceId: dev.id,
          vendor: params.vendor,
          externalId: `manual:${params.vendor}:${dev.id}`,
          externalName: dev.customName || dev.name,
          isPrimaryTelemetry: false,
          linkedAt: now.toISOString(),
        });
      }
    } else {
      dev.systems = normalizeSystems(
        dev.systems.filter((s) => s !== params.vendor),
        dev.primaryVendor
      );
      state.vendorLinks = state.vendorLinks.filter(
        (l) => !(l.deviceId === dev.id && l.vendor === params.vendor)
      );
    }

    return {
      ...dev,
      vendorLinks: state.vendorLinks.filter((l) => l.deviceId === dev.id),
    };
  }

  await ensureSchemaInitialized(db);
  const existingRows = await db.select().from(devices).where(eq(devices.id, params.deviceId)).limit(1);
  const row = existingRows[0];
  if (!row) return null;

  const primaryVendor: VendorId = isValidVendorId(row.primaryVendor) ? row.primaryVendor : 'tuya';
  if (!params.enabled && primaryVendor === params.vendor) {
    throw new Error('Impossible de retirer le système principal de cet appareil.');
  }

  const currentSystems = normalizeSystems(row.systems, primaryVendor);
  let nextSystems: VendorId[];

  if (params.enabled) {
    nextSystems = mergeDeviceSystems(currentSystems, params.vendor, primaryVendor);
    const existingVendorLinks = await db
      .select()
      .from(deviceVendorLinks)
      .where(and(eq(deviceVendorLinks.deviceId, row.id), eq(deviceVendorLinks.vendor, params.vendor)));
    if (existingVendorLinks.length === 0) {
      await db
        .insert(deviceVendorLinks)
        .values({
          deviceId: row.id,
          vendor: params.vendor,
          externalId: `manual:${params.vendor}:${row.id}`,
          externalName: row.customName || row.name,
          isPrimaryTelemetry: false,
          linkedAt: now,
        })
        .onConflictDoNothing();
    }
  } else {
    nextSystems = normalizeSystems(
      currentSystems.filter((s) => s !== params.vendor),
      primaryVendor
    );
    await db
      .delete(deviceVendorLinks)
      .where(and(eq(deviceVendorLinks.deviceId, row.id), eq(deviceVendorLinks.vendor, params.vendor)));
  }

  const [updated] = await db
    .update(devices)
    .set({ systems: nextSystems })
    .where(eq(devices.id, row.id))
    .returning();

  const updatedLinks = await db
    .select()
    .from(deviceVendorLinks)
    .where(eq(deviceVendorLinks.deviceId, row.id));
  return mapDbDevice(updated, updatedLinks.map(mapDbVendorLink));
}

export async function mergeDevices(params: {
  targetDeviceId: string;
  sourceDeviceId: string;
}): Promise<DeviceRecord | null> {
  if (params.targetDeviceId === params.sourceDeviceId) {
    throw new Error('Impossible de fusionner un appareil avec lui-même.');
  }

  const db = getDb();
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    const target = state.devices.find((d) => d.id === params.targetDeviceId);
    const source = state.devices.find((d) => d.id === params.sourceDeviceId);
    if (!target || !source) return null;

    const mergedSystems = normalizeSystems(
      [...target.systems, ...source.systems, source.primaryVendor],
      target.primaryVendor
    );
    target.systems = mergedSystems;
    if (target.roomId === null && source.roomId !== null) {
      target.roomId = source.roomId;
    }

    const sourceLinks = state.vendorLinks.filter((l) => l.deviceId === source.id);
    if (sourceLinks.length === 0) {
      state.vendorLinks.push({
        id: state.nextLinkId++,
        deviceId: target.id,
        vendor: source.primaryVendor,
        externalId: source.id,
        externalName: source.name,
        isPrimaryTelemetry: false,
        linkedAt: now.toISOString(),
      });
    } else {
      for (const l of sourceLinks) {
        l.deviceId = target.id;
        l.isPrimaryTelemetry = false;
      }
    }

    state.devices = state.devices.filter((d) => d.id !== source.id);
    return {
      ...target,
      vendorLinks: state.vendorLinks.filter((l) => l.deviceId === target.id),
    };
  }

  await ensureSchemaInitialized(db);
  const [targetRows, sourceRows] = await Promise.all([
    db.select().from(devices).where(eq(devices.id, params.targetDeviceId)).limit(1),
    db.select().from(devices).where(eq(devices.id, params.sourceDeviceId)).limit(1),
  ]);

  const target = targetRows[0];
  const source = sourceRows[0];
  if (!target || !source) return null;

  const targetPrimary: VendorId = isValidVendorId(target.primaryVendor)
    ? target.primaryVendor
    : 'tuya';
  const sourcePrimary: VendorId = isValidVendorId(source.primaryVendor)
    ? source.primaryVendor
    : 'google_home';

  const mergedSystems = normalizeSystems(
    [
      ...normalizeSystems(target.systems, targetPrimary),
      ...normalizeSystems(source.systems, sourcePrimary),
    ],
    targetPrimary
  );

  const sourceLinks = await db
    .select()
    .from(deviceVendorLinks)
    .where(eq(deviceVendorLinks.deviceId, source.id));

  if (sourceLinks.length === 0) {
    await db
      .insert(deviceVendorLinks)
      .values({
        deviceId: target.id,
        vendor: sourcePrimary,
        externalId: source.id,
        externalName: source.name,
        isPrimaryTelemetry: false,
        linkedAt: now,
      })
      .onConflictDoNothing();
  } else {
    await db
      .update(deviceVendorLinks)
      .set({ deviceId: target.id, isPrimaryTelemetry: false })
      .where(eq(deviceVendorLinks.deviceId, source.id));
  }

  const [updatedTarget] = await db
    .update(devices)
    .set({
      systems: mergedSystems,
      roomId: target.roomId ?? source.roomId,
    })
    .where(eq(devices.id, target.id))
    .returning();

  await db.delete(devices).where(eq(devices.id, source.id));

  const targetLinks = await db
    .select()
    .from(deviceVendorLinks)
    .where(eq(deviceVendorLinks.deviceId, target.id));
  return mapDbDevice(updatedTarget, targetLinks.map(mapDbVendorLink));
}

export async function unlinkDeviceVendor(params: {
  deviceId: string;
  vendor: VendorId;
}): Promise<DeviceRecord | null> {
  return toggleDeviceSystemTag({
    deviceId: params.deviceId,
    vendor: params.vendor,
    enabled: false,
  });
}

async function collectGoogleHomeReadingsInDb(
  db: AppDatabase,
  googleDevices: Array<typeof devices.$inferSelect>,
  now: Date
): Promise<number> {
  if (googleDevices.length === 0 || !getGoogleHomeConfig().apiEnabled) return 0;
  const connRows = await db
    .select()
    .from(vendorConnections)
    .where(eq(vendorConnections.vendor, 'google_home'))
    .limit(1);
  const conn = connRows[0];
  if (!conn || conn.status !== 'connected' || (!conn.accessToken && !conn.refreshToken)) {
    return 0;
  }

  const mode: GoogleHomeMode =
    conn.mode === 'sdm' || conn.mode === 'mcp' ? conn.mode : getGoogleHomeConfig().defaultMode;
  const accessToken = await ensureValidGoogleAccessToken(db, conn);
  const inventory = await fetchGoogleHomeInventory({
    accessToken,
    mode,
    projectId: getGoogleHomeConfig().sdmProjectId,
  });

  const ghLinks = await db
    .select()
    .from(deviceVendorLinks)
    .where(eq(deviceVendorLinks.vendor, 'google_home'));
  const deviceIdByExternalId = new Map(ghLinks.map((l) => [l.externalId, l.deviceId]));
  const deviceById = new Map(googleDevices.map((d) => [d.id, d]));

  const readingsToInsert: Array<typeof metricReadings.$inferInsert> = [];

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
  return readingsToInsert.length;
}

export async function runCollection(trigger: 'schedule' | 'manual'): Promise<CollectionLogRecord> {
  const db = getDb();
  const tuya = getTuyaConfig();
  const startedMs = Date.now();

  if (!tuya.configured) {
    if (!db) {
      return simulateDemoCollection(trigger);
    }
    await ensureSchemaInitialized(db);
    const now = new Date();
    const ghMonitored = (await db.select().from(devices)).filter(
      (d) =>
        d.isMonitored &&
        !d.id.startsWith('manual_') &&
        d.primaryVendor === 'google_home'
    );
    try {
      const ghInserted = await collectGoogleHomeReadingsInDb(db, ghMonitored, now);
      if (ghInserted > 0 || ghMonitored.length > 0) {
        const [logRow] = await db
          .insert(collectionLogs)
          .values({
            trigger,
            devicesCount: ghMonitored.length,
            readingsInserted: ghInserted,
            status: 'success',
            errorMessage: null,
            durationMs: Date.now() - startedMs,
          })
          .returning();
        return mapDbLog(logRow);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur collecte Google Home';
      const [logRow] = await db
        .insert(collectionLogs)
        .values({
          trigger,
          devicesCount: 0,
          readingsInserted: 0,
          status: 'error',
          errorMessage: msg,
          durationMs: Date.now() - startedMs,
        })
        .returning();
      return mapDbLog(logRow);
    }

    const errMsg = 'Aucun fournisseur configuré (TUYA_ACCESS_ID / Google Home non connectés).';
    const [inserted] = await db
      .insert(collectionLogs)
      .values({
        trigger,
        devicesCount: 0,
        readingsInserted: 0,
        status: 'error',
        errorMessage: errMsg,
        durationMs: Date.now() - startedMs,
      })
      .returning();
    return mapDbLog(inserted);
  }

  if (!db) {
    // Tuya configuré sans Postgres : on collecte en mémoire dans demo-store
    const state = getDemoState();
    const rawDevices = await fetchTuyaDevices();
    const deviceIds = rawDevices.map((d) => d.id);
    const [statusMap, factoryInfoMap] = await Promise.all([
      fetchBatchStatuses(deviceIds),
      fetchBatchFactoryInfos(deviceIds),
    ]);
    const now = new Date();
    let inserted = 0;

    for (const raw of rawDevices) {
      const rawStatus = statusMap.get(raw.id) ?? raw.status ?? [];
      let dev = state.devices.find((d) => d.id === raw.id);
      const nextIp = raw.ip?.trim() || dev?.ipAddress || null;
      const nextMac =
        factoryInfoMap.get(raw.id)?.mac ?? formatMacAddress(raw.mac) ?? dev?.macAddress ?? null;
      if (!dev) {
        const spec = await fetchDeviceSpecification(raw.id);
        const detected = autoDetectDpConfig(rawStatus, spec, raw.category);
        dev = {
          id: raw.id,
          name: raw.name,
          customName: null,
          primaryVendor: 'tuya',
          systems: ['tuya'],
          roomId: null,
          category: detected.category,
          tuyaCategory: raw.category,
          productName: raw.product_name ?? null,
          ipAddress: nextIp,
          macAddress: nextMac,
          isOnline: raw.online ?? true,
          isMonitored: true,
          excludeFromTotals: false,
          energyMode: 'hybrid',
          dpConfig: detected.dpConfig,
          lastRawStatus: rawStatus,
          lastSeenAt: null,
          lastPowerW: null,
          lastVoltageV: null,
          lastAddEleKwh: null,
          lastTempC: null,
          lastHumidityPct: null,
          lastBatteryPct: null,
          lastContactOpen: null,
        };
        state.devices.push(dev);
        state.vendorLinks.push({
          id: state.nextLinkId++,
          deviceId: raw.id,
          vendor: 'tuya',
          externalId: raw.id,
          externalName: raw.name,
          isPrimaryTelemetry: true,
          linkedAt: now.toISOString(),
        });
      }

      if (!dev.isMonitored) continue;
      const effectiveDpConfig = sanitizeDeviceDpConfig(dev.dpConfig ?? {}, dev.tuyaCategory).dpConfig;
      const metrics = extractMetricsFromStatus(rawStatus, effectiveDpConfig);
      const energyRes =
        metrics.powerW !== null || metrics.addEleKwh !== null
          ? computeHybridEnergyKwh({
            energyMode: dev.energyMode,
            powerW: metrics.powerW,
            currentAddEleKwh: metrics.addEleKwh,
            previousAddEleKwh: dev.lastAddEleKwh,
            previousSeenAt: dev.lastSeenAt,
            now,
          })
          : null;

      state.readings.push({
        id: state.nextReadingId++,
        deviceId: dev.id,
        roomId: dev.roomId,
        recordedAt: now.toISOString(),
        powerW: metrics.powerW,
        voltageV: metrics.voltageV,
        energyKwh: energyRes ? energyRes.energyKwh : null,
        energySource: energyRes ? energyRes.source : null,
        tempC: metrics.tempC,
        humidityPct: metrics.humidityPct,
        contactOpen: metrics.contactOpen,
      });

      dev.lastRawStatus = rawStatus;
      dev.ipAddress = nextIp;
      dev.macAddress = nextMac;
      dev.lastSeenAt = now.toISOString();
      dev.lastPowerW = metrics.powerW;
      dev.lastVoltageV = metrics.voltageV;
      dev.lastAddEleKwh = metrics.addEleKwh;
      dev.lastTempC = metrics.tempC;
      dev.lastHumidityPct = metrics.humidityPct;
      dev.lastBatteryPct = metrics.batteryPct;
      dev.lastContactOpen = metrics.contactOpen;
      inserted++;
    }

    const log: CollectionLogRecord = {
      id: state.nextLogId++,
      executedAt: now.toISOString(),
      trigger,
      devicesCount: rawDevices.length,
      readingsInserted: inserted,
      status: 'success',
      errorMessage: null,
      durationMs: Date.now() - startedMs,
    };
    state.logs.unshift(log);
    return log;
  }

  // Mode complet : Neon Postgres + Multi-Vendors (Tuya Cloud + Google Home)
  try {
    await seedDefaultDataIfEmpty(db);
    let allDevices = await db.select().from(devices);
    if (allDevices.length === 0) {
      await syncTuyaDevices();
      allDevices = await db.select().from(devices);
    }

    const tuyaMonitored = allDevices.filter(
      (d) =>
        d.isMonitored &&
        !d.id.startsWith('manual_') &&
        (!d.primaryVendor || d.primaryVendor === 'tuya')
    );
    const googleMonitored = allDevices.filter(
      (d) =>
        d.isMonitored &&
        !d.id.startsWith('manual_') &&
        d.primaryVendor === 'google_home'
    );

    const statusMap = await fetchBatchStatuses(tuyaMonitored.map((d) => d.id));
    const now = new Date();

    const readingsToInsert: Array<typeof metricReadings.$inferInsert> = [];

    for (const dev of tuyaMonitored) {
      const rawStatus: RawDpStatus[] = statusMap.get(dev.id) ?? [];
      if (rawStatus.length === 0) continue;

      const effectiveDpConfig = sanitizeDeviceDpConfig(dev.dpConfig ?? {}, dev.tuyaCategory).dpConfig;
      const metrics = extractMetricsFromStatus(rawStatus, effectiveDpConfig);
      const hasPower = metrics.powerW !== null || metrics.addEleKwh !== null;
      const hasClimate = metrics.tempC !== null || metrics.humidityPct !== null;
      const hasContact = metrics.contactOpen !== null;
      if (!hasPower && !hasClimate && !hasContact) {
        await db
          .update(devices)
          .set({ lastRawStatus: rawStatus, lastSeenAt: now })
          .where(eq(devices.id, dev.id));
        continue;
      }

      const energyRes = hasPower
        ? computeHybridEnergyKwh({
          energyMode: (dev.energyMode as EnergyMode) || 'hybrid',
          powerW: metrics.powerW,
          currentAddEleKwh: metrics.addEleKwh,
          previousAddEleKwh: dev.lastAddEleKwh,
          previousSeenAt: dev.lastSeenAt,
          now,
        })
        : null;

      readingsToInsert.push({
        deviceId: dev.id,
        roomId: dev.roomId,
        recordedAt: now,
        powerW: metrics.powerW,
        voltageV: metrics.voltageV,
        energyKwh: energyRes ? energyRes.energyKwh : null,
        energySource: energyRes ? energyRes.source : null,
        tempC: metrics.tempC,
        humidityPct: metrics.humidityPct,
        contactOpen: metrics.contactOpen,
      });

      await db
        .update(devices)
        .set({
          lastRawStatus: rawStatus,
          lastSeenAt: now,
          lastPowerW: metrics.powerW,
          lastVoltageV: metrics.voltageV,
          lastAddEleKwh: metrics.addEleKwh,
          lastTempC: metrics.tempC,
          lastHumidityPct: metrics.humidityPct,
          lastBatteryPct: metrics.batteryPct,
          lastContactOpen: metrics.contactOpen,
        })
        .where(eq(devices.id, dev.id));
    }

    if (readingsToInsert.length > 0) {
      await db.insert(metricReadings).values(readingsToInsert);
    }

    const ghInserted = await collectGoogleHomeReadingsInDb(db, googleMonitored, now).catch(
      () => 0
    );

    const [logRow] = await db
      .insert(collectionLogs)
      .values({
        trigger,
        devicesCount: tuyaMonitored.length + googleMonitored.length,
        readingsInserted: readingsToInsert.length + ghInserted,
        status: 'success',
        errorMessage: null,
        durationMs: Date.now() - startedMs,
      })
      .returning();

    return mapDbLog(logRow);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue lors de la collecte';
    const [logRow] = await db
      .insert(collectionLogs)
      .values({
        trigger,
        devicesCount: 0,
        readingsInserted: 0,
        status: 'error',
        errorMessage,
        durationMs: Date.now() - startedMs,
      })
      .returning();
    return mapDbLog(logRow);
  }
}

export async function createRoom(input: {
  name: string;
  icon?: string;
  color?: string;
  targetTempMin?: number;
  targetTempMax?: number;
  targetHumidityMin?: number;
  targetHumidityMax?: number;
}): Promise<RoomRecord> {
  const db = getDb();
  if (!db) {
    const state = getDemoState();
    const room: RoomRecord = {
      id: state.nextRoomId++,
      name: input.name.trim(),
      icon: input.icon ?? 'Home',
      color: input.color ?? '#3b82f6',
      targetTempMin: input.targetTempMin ?? 19,
      targetTempMax: input.targetTempMax ?? 22,
      targetHumidityMin: input.targetHumidityMin ?? 40,
      targetHumidityMax: input.targetHumidityMax ?? 60,
      createdAt: new Date().toISOString(),
    };
    state.rooms.push(room);
    return room;
  }

  await ensureSchemaInitialized(db);
  const [created] = await db
    .insert(rooms)
    .values({
      name: input.name.trim(),
      icon: input.icon ?? 'Home',
      color: input.color ?? '#3b82f6',
      targetTempMin: input.targetTempMin ?? 19,
      targetTempMax: input.targetTempMax ?? 22,
      targetHumidityMin: input.targetHumidityMin ?? 40,
      targetHumidityMax: input.targetHumidityMax ?? 60,
    })
    .returning();
  return mapDbRoom(created);
}

export async function updateRoom(
  id: number,
  input: Partial<{
    name: string;
    icon: string;
    color: string;
    targetTempMin: number;
    targetTempMax: number;
    targetHumidityMin: number;
    targetHumidityMax: number;
  }>
): Promise<RoomRecord | null> {
  const normalized: typeof input = {
    ...input,
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
  };

  const db = getDb();
  if (!db) {
    const state = getDemoState();
    const room = state.rooms.find((r) => r.id === id);
    if (!room) return null;
    Object.assign(room, normalized);
    return room;
  }

  await ensureSchemaInitialized(db);
  const [updated] = await db
    .update(rooms)
    .set(normalized)
    .where(eq(rooms.id, id))
    .returning();
  return updated ? mapDbRoom(updated) : null;
}

export async function deleteRoom(id: number): Promise<void> {
  const db = getDb();
  if (!db) {
    const state = getDemoState();
    state.rooms = state.rooms.filter((r) => r.id !== id);
    for (const d of state.devices) {
      if (d.roomId === id) d.roomId = null;
    }
    return;
  }

  await ensureSchemaInitialized(db);
  await db.delete(rooms).where(eq(rooms.id, id));
}

export interface RoomVendorSyncResult {
  vendor: 'tuya' | 'google_home' | 'all';
  roomsFound: number;
  createdCount: number;
  assignedDevicesCount: number;
  mode: 'live' | 'demo';
  message: string;
}

async function syncRoomsFromTuya(): Promise<RoomVendorSyncResult> {
  const db = getDb();
  const tuya = getTuyaConfig();
  const now = new Date();

  if (!tuya.configured) {
    if (!db) {
      const state = getDemoState();
      state.vendorConnections.tuya.lastSyncedAt = now.toISOString();
      return {
        vendor: 'tuya',
        roomsFound: state.rooms.length,
        createdCount: 0,
        assignedDevicesCount: 0,
        mode: 'demo',
        message: `Mode démo actif : ${state.rooms.length} pièce(s) Tuya simulée(s) déjà disponible(s).`,
      };
    }
    throw new Error(
      'Identifiants Tuya manquants. Configurez TUYA_ACCESS_ID et TUYA_ACCESS_SECRET dans Vercel / .env.local.'
    );
  }

  const rawDevices = await fetchTuyaDevices();
  const roomMapping = await fetchTuyaRoomMapping(rawDevices);

  if (!db) {
    const state = getDemoState();
    const { roomNameToId, createdCount } = ensureMissingRoomsInDemo(roomMapping.roomNames);
    let assignedDevicesCount = 0;

    for (const [deviceId, tuyaRoomName] of roomMapping.deviceRoomMap.entries()) {
      const existing = state.devices.find((d) => d.id === deviceId);
      const mappedRoomId = roomNameToId.get(tuyaRoomName.trim().toLowerCase()) ?? null;
      if (existing && mappedRoomId !== null && existing.roomId !== mappedRoomId) {
        existing.roomId = mappedRoomId;
        assignedDevicesCount++;
      }
    }

    state.vendorConnections.tuya.connected = true;
    state.vendorConnections.tuya.lastSyncedAt = now.toISOString();
    state.vendorConnections.tuya.lastError = null;

    const baseMsg = `Tuya : ${roomMapping.roomNames.length} pièce(s) détectée(s) (${createdCount} créée(s), ${assignedDevicesCount} appareil(s) rattaché(s)).`;
    return {
      vendor: 'tuya',
      roomsFound: roomMapping.roomNames.length,
      createdCount,
      assignedDevicesCount,
      mode: 'demo',
      message: roomMapping.warning ? `${baseMsg} (${roomMapping.warning})` : baseMsg,
    };
  }

  await seedDefaultDataIfEmpty(db);

  const { existingRoomsRows, roomNameToId, createdCount } = await ensureMissingRoomsInDb(
    db,
    roomMapping.roomNames
  );

  const existingDeviceRows = await db
    .select({ id: devices.id, roomId: devices.roomId })
    .from(devices);
  const deviceById = new Map(existingDeviceRows.map((d) => [d.id, d]));

  let assignedDevicesCount = 0;
  for (const [deviceId, tuyaRoomName] of roomMapping.deviceRoomMap.entries()) {
    const existing = deviceById.get(deviceId);
    const tuyaRoomId = roomNameToId.get(tuyaRoomName.trim().toLowerCase()) ?? null;
    if (existing && tuyaRoomId !== null && existing.roomId !== tuyaRoomId) {
      await db.update(devices).set({ roomId: tuyaRoomId }).where(eq(devices.id, deviceId));
      await db
        .update(metricReadings)
        .set({ roomId: tuyaRoomId })
        .where(and(eq(metricReadings.deviceId, deviceId), isNull(metricReadings.roomId)));
      assignedDevicesCount++;
    }
  }

  await cleanupDefaultSeededRoomsInDb(db, roomMapping.roomNames, existingRoomsRows);

  await db
    .insert(vendorConnections)
    .values({
      vendor: 'tuya',
      mode: 'cloud_key',
      status: 'connected',
      lastSyncedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: vendorConnections.vendor,
      set: {
        status: 'connected',
        lastSyncedAt: now,
        lastError: null,
        updatedAt: now,
      },
    });

  const baseMsg = `Tuya : ${roomMapping.roomNames.length} pièce(s) détectée(s) (${createdCount} créée(s), ${assignedDevicesCount} appareil(s) rattaché(s)).`;
  return {
    vendor: 'tuya',
    roomsFound: roomMapping.roomNames.length,
    createdCount,
    assignedDevicesCount,
    mode: 'live',
    message: roomMapping.warning ? `${baseMsg} (${roomMapping.warning})` : baseMsg,
  };
}

async function syncRoomsFromGoogleHome(): Promise<RoomVendorSyncResult> {
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
      primaryVendor === 'tuya'
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

export async function syncRoomsFromVendor(
  vendor: 'tuya' | 'google_home' | 'all' = 'all'
): Promise<RoomVendorSyncResult> {
  if (vendor === 'tuya') return syncRoomsFromTuya();
  if (vendor === 'google_home') return syncRoomsFromGoogleHome();

  const db = getDb();
  const googleApiEnabled = getGoogleHomeConfig().apiEnabled;
  const tasks: Array<{ label: string; run: () => Promise<RoomVendorSyncResult> }> = [];

  if (!db) {
    tasks.push({ label: 'Tuya', run: syncRoomsFromTuya });
    if (googleApiEnabled) {
      tasks.push({ label: 'Google Home', run: syncRoomsFromGoogleHome });
    }
  } else {
    if (getTuyaConfig().configured) {
      tasks.push({ label: 'Tuya', run: syncRoomsFromTuya });
    }
    if (googleApiEnabled) {
      const ghRows = await db
        .select({
          status: vendorConnections.status,
          accessToken: vendorConnections.accessToken,
          refreshToken: vendorConnections.refreshToken,
        })
        .from(vendorConnections)
        .where(eq(vendorConnections.vendor, 'google_home'))
        .limit(1);
      const ghConn = ghRows[0];
      if (ghConn && ghConn.status === 'connected' && (ghConn.accessToken || ghConn.refreshToken)) {
        tasks.push({ label: 'Google Home', run: syncRoomsFromGoogleHome });
      }
    }
    if (tasks.length === 0) {
      throw new Error(
        googleApiEnabled
          ? 'Aucun système configuré ou connecté pour synchroniser les pièces (configurez Tuya ou connectez Google Home).'
          : 'Tuya n’est pas encore configuré pour synchroniser les pièces.'
      );
    }
  }

  const results: RoomVendorSyncResult[] = [];
  const errors: string[] = [];

  for (const task of tasks) {
    try {
      results.push(await task.run());
    } catch (err) {
      errors.push(`${task.label} : ${err instanceof Error ? err.message : 'Erreur inconnue'}`);
    }
  }

  if (results.length === 0) {
    throw new Error(errors.join(' | ') || 'Échec de synchronisation des pièces.');
  }

  const roomsFound = results.reduce((sum, r) => sum + r.roomsFound, 0);
  const createdCount = results.reduce((sum, r) => sum + r.createdCount, 0);
  const assignedDevicesCount = results.reduce((sum, r) => sum + r.assignedDevicesCount, 0);
  const mode = results.some((r) => r.mode === 'live') ? 'live' : 'demo';

  const summaryMsg = results.map((r) => r.message).join(' · ');
  const fullMessage =
    errors.length > 0 ? `${summaryMsg} · Avertissement : ${errors.join(' | ')}` : summaryMsg;

  return {
    vendor: 'all',
    roomsFound,
    createdCount,
    assignedDevicesCount,
    mode,
    message: fullMessage,
  };
}

function computeDeviceMetricsForDpConfig(
  rawStatus: RawDpStatus[] | null,
  dpConfig: DpConfig
): Partial<
  Pick<
    DeviceRecord,
    | 'lastPowerW'
    | 'lastVoltageV'
    | 'lastAddEleKwh'
    | 'lastTempC'
    | 'lastHumidityPct'
    | 'lastBatteryPct'
    | 'lastContactOpen'
  >
> {
  if (rawStatus && rawStatus.length > 0) {
    const metrics = extractMetricsFromStatus(rawStatus, dpConfig);
    return {
      lastPowerW: metrics.powerW,
      lastVoltageV: metrics.voltageV,
      lastAddEleKwh: metrics.addEleKwh,
      lastTempC: metrics.tempC,
      lastHumidityPct: metrics.humidityPct,
      lastBatteryPct: metrics.batteryPct,
      lastContactOpen: metrics.contactOpen,
    };
  }

  return {
    ...(!dpConfig.power ? { lastPowerW: null } : {}),
    ...(!dpConfig.voltage ? { lastVoltageV: null } : {}),
    ...(!dpConfig.addEle ? { lastAddEleKwh: null } : {}),
    ...(!dpConfig.temp ? { lastTempC: null } : {}),
    ...(!dpConfig.humidity ? { lastHumidityPct: null } : {}),
    ...(!dpConfig.battery ? { lastBatteryPct: null } : {}),
    ...(!dpConfig.contact ? { lastContactOpen: null } : {}),
  };
}

function sanitizeManualMac(rawMac: string | null | undefined): string | null {
  const trimmed = rawMac?.trim();
  if (!trimmed) return null;
  return formatMacAddress(trimmed) ?? trimmed;
}

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
  excludeFromTotals?: boolean;
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

async function syncTariffTimelineInDb(db: AppDatabase): Promise<TariffPeriodRecord[]> {
  const rows = await db.select().from(tariffPeriods).orderBy(asc(tariffPeriods.startDate));
  const mapped = rows.map(mapDbTariff);
  const normalized = normalizeTariffTimeline(mapped);

  for (let i = 0; i < mapped.length; i++) {
    const orig = mapped.find((m) => m.id === normalized[i].id);
    if (orig && orig.endDate !== normalized[i].endDate) {
      await db
        .update(tariffPeriods)
        .set({ endDate: normalized[i].endDate })
        .where(eq(tariffPeriods.id, normalized[i].id));
    }
  }
  return normalized;
}

export interface TariffInput {
  label: string;
  startDate: string;
  endDate: string | null;
  mode: TariffMode;
  baseRateEur: number | null;
  hpRateEur: number | null;
  hcRateEur: number | null;
  hcSlots: HcSlot[];
  monthlySubscriptionEur: number;
}

export async function createTariff(input: TariffInput): Promise<TariffPeriodRecord[]> {
  const db = getDb();
  if (!db) {
    const state = getDemoState();
    const created: TariffPeriodRecord = {
      id: state.nextTariffId++,
      ...input,
      createdAt: new Date().toISOString(),
    };
    state.tariffs = normalizeTariffTimeline([...state.tariffs, created]);
    return state.tariffs;
  }

  await ensureSchemaInitialized(db);
  await db.insert(tariffPeriods).values(input);
  return syncTariffTimelineInDb(db);
}

export async function updateTariff(
  id: number,
  input: Partial<TariffInput>
): Promise<TariffPeriodRecord[]> {
  const db = getDb();
  if (!db) {
    const state = getDemoState();
    const idx = state.tariffs.findIndex((t) => t.id === id);
    if (idx !== -1) {
      state.tariffs[idx] = { ...state.tariffs[idx], ...input };
      state.tariffs = normalizeTariffTimeline(state.tariffs);
    }
    return state.tariffs;
  }

  await ensureSchemaInitialized(db);
  await db.update(tariffPeriods).set(input).where(eq(tariffPeriods.id, id));
  return syncTariffTimelineInDb(db);
}

export async function deleteTariff(id: number): Promise<TariffPeriodRecord[]> {
  const db = getDb();
  if (!db) {
    const state = getDemoState();
    state.tariffs = normalizeTariffTimeline(state.tariffs.filter((t) => t.id !== id));
    return state.tariffs;
  }

  await ensureSchemaInitialized(db);
  await db.delete(tariffPeriods).where(eq(tariffPeriods.id, id));
  return syncTariffTimelineInDb(db);
}
