import crypto from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm';
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
import {
  fetchKasaInventory,
  getKasaConfig,
  makeKasaDeviceId,
} from './vendors/kasa-client';
import {
  DaikinApiError,
  fetchDaikinInventory,
  getDaikinConfig,
  makeDaikinDeviceId,
  refreshDaikinAccessToken,
} from './vendors/daikin-client';
import {
  fetchHomeConnectInventory,
  getHomeConnectConfig,
  HomeConnectApiError,
  makeHomeConnectDeviceId,
  refreshHomeConnectAccessToken,
} from './vendors/home-connect-client';
import { extractCoverSummary, isSomfyCoverUiClass } from './covers-utils';
import {
  fetchSomfyInventoryWithSession,
  getSomfyConfig,
  makeSomfyDeviceId,
} from './vendors/somfy-client';
import {
  isValidVendorId,
  normalizeSystems,
  type NormalizedVendorDevice,
  VENDOR_IDS,
  VENDOR_REGISTRY,
} from './vendors/registry';
import {
  autoDetectDpConfig,
  extractMetricsFromStatus,
  fetchBatchFactoryInfos,
  fetchBatchStatuses,
  fetchDeviceSpecification,
  fetchTuyaAutomations,
  fetchTuyaDevices,
  fetchTuyaDeviceReportLogs,
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
  HomeConnectEnv,
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

export function getEnvStatus(
  googleHomeConnected = false,
  homeConnectConnected = false,
  daikinConnected = false
): EnvStatus {
  const tuya = getTuyaConfig();
  const kasa = getKasaConfig();
  const hc = getHomeConnectConfig();
  const somfy = getSomfyConfig();
  const daikin = getDaikinConfig();
  const google = getGoogleHomeConfig();
  const databaseConfigured = isDatabaseConfigured();
  return {
    mode: databaseConfigured ? 'live' : 'demo',
    databaseConfigured,
    tuyaConfigured: tuya.configured,
    tuyaRegion: tuya.region,
    tuyaUserUidConfigured: Boolean(tuya.userUid),
    kasaConfigured: kasa.configured,
    kasaRegion: kasa.region,
    homeConnectConfigured: hc.configured,
    homeConnectConnected: hc.configured && homeConnectConnected,
    homeConnectEnv: hc.defaultEnv,
    somfyConfigured: somfy.configured,
    somfyRegion: somfy.region,
    daikinConfigured: daikin.configured,
    daikinConnected: daikin.configured && daikinConnected,
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
    coverState: (row.coverState as MetricReadingRecord['coverState']) ?? null,
    coverOpenPct: row.coverOpenPct ?? null,
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
        ALTER TABLE "metric_readings" ADD COLUMN IF NOT EXISTS "cover_state" text
      `);
      await db.execute(sql`
        ALTER TABLE "metric_readings" ADD COLUMN IF NOT EXISTS "cover_open_pct" real
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
  kasaConnected: boolean;
  kasaLastSyncedAt: string | null;
  kasaLastError: string | null;
  hcConnected: boolean;
  hcEnv: HomeConnectEnv;
  hcLastSyncedAt: string | null;
  hcLastError: string | null;
  somfyConnected: boolean;
  somfyLastSyncedAt: string | null;
  somfyLastError: string | null;
  daikinConnected: boolean;
  daikinLastSyncedAt: string | null;
  daikinLastError: string | null;
  ghConnected: boolean;
  ghMode: GoogleHomeMode;
  ghLastSyncedAt: string | null;
  ghLastError: string | null;
}): VendorConnectionSummary[] {
  const tuyaCfg = getTuyaConfig();
  const kasaCfg = getKasaConfig();
  const hcCfg = getHomeConnectConfig();
  const somfyCfg = getSomfyConfig();
  const daikinCfg = getDaikinConfig();
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
      vendor: 'kasa',
      label: VENDOR_REGISTRY.kasa.label,
      mode: 'cloud_account',
      configured: kasaCfg.configured,
      connected: params.kasaConnected,
      devicesCount: countFor('kasa'),
      lastSyncedAt: params.kasaLastSyncedAt,
      lastError: params.kasaLastError,
    },
    {
      vendor: 'home_connect',
      label: VENDOR_REGISTRY.home_connect.label,
      mode: `oauth_${params.hcEnv}` as VendorConnectionSummary['mode'],
      configured: hcCfg.configured,
      connected: params.hcConnected,
      devicesCount: countFor('home_connect'),
      lastSyncedAt: params.hcLastSyncedAt,
      lastError: params.hcLastError,
    },
    {
      vendor: 'somfy',
      label: VENDOR_REGISTRY.somfy.label,
      mode: 'cloud_account',
      configured: somfyCfg.configured,
      connected: params.somfyConnected,
      devicesCount: countFor('somfy'),
      lastSyncedAt: params.somfyLastSyncedAt,
      lastError: params.somfyLastError,
    },
    {
      vendor: 'daikin',
      label: VENDOR_REGISTRY.daikin.label,
      mode: 'oauth_prod',
      configured: daikinCfg.configured,
      connected: params.daikinConnected,
      devicesCount: countFor('daikin'),
      lastSyncedAt: params.daikinLastSyncedAt,
      lastError: params.daikinLastError,
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
    const kasaState = state.vendorConnections.kasa;
    const hcState = state.vendorConnections.home_connect;
    const somfyState = state.vendorConnections.somfy;
    const daikinState = state.vendorConnections.daikin;
    const hcEnv: HomeConnectEnv =
      hcState.mode === 'oauth_simulator'
        ? 'simulator'
        : hcState.mode === 'oauth_cn'
          ? 'cn'
          : getHomeConnectConfig().defaultEnv;
    const env = {
      ...getEnvStatus(ghState.connected, hcState.connected, daikinState.connected),
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
    const vendors = buildVendorConnectionSummaries({
      devices: devicesWithLinks,
      tuyaConnected: tuyaState.connected,
      tuyaLastSyncedAt: tuyaState.lastSyncedAt,
      tuyaLastError: tuyaState.lastError,
      kasaConnected: kasaState.connected,
      kasaLastSyncedAt: kasaState.lastSyncedAt,
      kasaLastError: kasaState.lastError,
      hcConnected: hcState.connected,
      hcEnv,
      hcLastSyncedAt: hcState.lastSyncedAt,
      hcLastError: hcState.lastError,
      somfyConnected: somfyState.connected,
      somfyLastSyncedAt: somfyState.lastSyncedAt,
      somfyLastError: somfyState.lastError,
      daikinConnected: daikinState.connected,
      daikinLastSyncedAt: daikinState.lastSyncedAt,
      daikinLastError: daikinState.lastError,
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
  const kasaConn = connRows.find((c) => c.vendor === 'kasa');
  const hcConn = connRows.find((c) => c.vendor === 'home_connect');
  const somfyConn = connRows.find((c) => c.vendor === 'somfy');
  const daikinConn = connRows.find((c) => c.vendor === 'daikin');
  const ghConn = connRows.find((c) => c.vendor === 'google_home');
  const googleCfg = getGoogleHomeConfig();
  const tuyaCfg = getTuyaConfig();
  const kasaCfg = getKasaConfig();
  const hcCfg = getHomeConnectConfig();
  const somfyCfg = getSomfyConfig();
  const daikinCfg = getDaikinConfig();

  const ghMode: GoogleHomeMode =
    ghConn?.mode === 'mcp' || ghConn?.mode === 'sdm' ? ghConn.mode : googleCfg.defaultMode;
  const ghConnected =
    googleCfg.apiEnabled &&
    Boolean(ghConn && ghConn.status === 'connected' && (ghConn.accessToken || ghConn.refreshToken));
  const tuyaConnected = tuyaCfg.configured || mappedDevices.some((d) => d.systems.includes('tuya'));
  const kasaConnected =
    kasaCfg.configured ||
    kasaConn?.status === 'connected' ||
    mappedDevices.some((d) => d.systems.includes('kasa'));
  const hcEnv: HomeConnectEnv =
    hcConn?.mode === 'oauth_simulator'
      ? 'simulator'
      : hcConn?.mode === 'oauth_cn'
        ? 'cn'
        : hcCfg.defaultEnv;
  const hcConnected =
    hcCfg.configured &&
    Boolean(hcConn && hcConn.status === 'connected' && (hcConn.accessToken || hcConn.refreshToken));
  const somfyConnected =
    somfyCfg.configured ||
    somfyConn?.status === 'connected' ||
    mappedDevices.some((d) => d.systems.includes('somfy'));
  const daikinConnected =
    daikinCfg.configured &&
    Boolean(
      daikinConn &&
        daikinConn.status === 'connected' &&
        (daikinConn.accessToken || daikinConn.refreshToken)
    );

  const env: EnvStatus = {
    ...getEnvStatus(ghConnected, hcConnected, daikinConnected),
    googleHomeMode: ghMode,
    homeConnectEnv: hcEnv,
  };

  const vendors = buildVendorConnectionSummaries({
    devices: mappedDevices,
    tuyaConnected,
    tuyaLastSyncedAt: tuyaConn?.lastSyncedAt ? tuyaConn.lastSyncedAt.toISOString() : null,
    tuyaLastError: tuyaConn?.lastError ?? null,
    kasaConnected,
    kasaLastSyncedAt: kasaConn?.lastSyncedAt ? kasaConn.lastSyncedAt.toISOString() : null,
    kasaLastError: kasaConn?.lastError ?? null,
    hcConnected,
    hcEnv,
    hcLastSyncedAt: hcConn?.lastSyncedAt ? hcConn.lastSyncedAt.toISOString() : null,
    hcLastError: hcConn?.lastError ?? null,
    somfyConnected,
    somfyLastSyncedAt: somfyConn?.lastSyncedAt ? somfyConn.lastSyncedAt.toISOString() : null,
    somfyLastError: somfyConn?.lastError ?? null,
    daikinConnected,
    daikinLastSyncedAt: daikinConn?.lastSyncedAt ? daikinConn.lastSyncedAt.toISOString() : null,
    daikinLastError: daikinConn?.lastError ?? null,
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

      if (
        primaryVendor === 'tuya' ||
        primaryVendor === 'kasa' ||
        primaryVendor === 'home_connect'
      ) {
        // Priorité télémétrique Tuya / Kasa / Siemens Home Connect : on conserve les mesures et statuts d'origine
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

export async function syncKasaDevices(): Promise<{
  syncedCount: number;
  newCount: number;
  mode: 'live' | 'demo';
  message: string;
}> {
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
        let candidateId = makeKasaDeviceId(kd.externalId);
        if (state.devices.some((d) => d.id === candidateId)) {
          candidateId = `${candidateId}_${now.getTime().toString(36).slice(-4)}`;
        }
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
  const [existingDeviceRows, kasaLinkRows] = await Promise.all([
    db.select().from(devices),
    db.select().from(deviceVendorLinks).where(eq(deviceVendorLinks.vendor, 'kasa')),
  ]);

  const deviceById = new Map(existingDeviceRows.map((d) => [d.id, d]));
  const linkByExternalId = new Map(kasaLinkRows.map((l) => [l.externalId, l]));
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

        if (nextRoomId !== null && nextRoomId !== linkedDevice.roomId) {
          await db
            .update(metricReadings)
            .set({ roomId: nextRoomId })
            .where(and(eq(metricReadings.deviceId, linkedDevice.id), isNull(metricReadings.roomId)));
        }
      }

      await db
        .update(deviceVendorLinks)
        .set({
          externalName: kd.name,
          vendorMetadata,
        })
        .where(eq(deviceVendorLinks.id, existingLink!.id));
    } else {
      let candidateId = makeKasaDeviceId(kd.externalId);
      if (deviceById.has(candidateId)) {
        candidateId = `${candidateId}_${now.getTime().toString(36).slice(-4)}`;
      }
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

function parseHomeConnectEnvFromMode(
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

type DemoVendorMode = VendorConnectionSummary['mode'];

export async function disconnectHomeConnect(): Promise<void> {
  const db = getDb();
  if (!db) {
    const state = getDemoState();
    state.vendorConnections.home_connect.connected = false;
    state.vendorConnections.home_connect.lastError = null;
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
    .where(eq(vendorConnections.vendor, 'home_connect'));
}

export async function syncHomeConnectDevices(): Promise<{
  syncedCount: number;
  newCount: number;
  mode: 'live' | 'demo';
  message: string;
}> {
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

  const [existingDeviceRows, hcLinkRows] = await Promise.all([
    db.select().from(devices),
    db.select().from(deviceVendorLinks).where(eq(deviceVendorLinks.vendor, 'home_connect')),
  ]);

  const deviceById = new Map(existingDeviceRows.map((d) => [d.id, d]));
  const linkByExternalId = new Map(hcLinkRows.map((l) => [l.externalId, l]));
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
      let candidateId = makeHomeConnectDeviceId(hc.externalId);
      if (deviceById.has(candidateId)) {
        candidateId = `${candidateId}_${now.getTime().toString(36).slice(-4)}`;
      }

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

export interface BulkToggleSystemResult {
  vendor: VendorId;
  enabled: boolean;
  requestedCount: number;
  updatedCount: number;
  alreadySetCount: number;
  skippedPrimaryCount: number;
  notFoundCount: number;
  message: string;
}

function formatBulkToggleMessage(params: {
  vendorLabel: string;
  enabled: boolean;
  updatedCount: number;
  alreadySetCount: number;
  skippedPrimaryCount: number;
}): string {
  const { vendorLabel, enabled, updatedCount, alreadySetCount, skippedPrimaryCount } = params;
  if (enabled) {
    if (updatedCount > 0) {
      return `${updatedCount} appareil(s) lié(s) à ${vendorLabel}${
        alreadySetCount > 0 ? ` (${alreadySetCount} déjà lié(s))` : ''
      }.`;
    }
    if (alreadySetCount > 0) {
      return `Les ${alreadySetCount} appareil(s) sélectionné(s) étaient déjà lié(s) à ${vendorLabel}.`;
    }
    return 'Aucun appareil trouvé à lier.';
  }

  if (updatedCount === 0 && skippedPrimaryCount > 0 && alreadySetCount === 0) {
    return `Impossible de dissocier : ${vendorLabel} est le système principal des ${skippedPrimaryCount} appareil(s) sélectionné(s).`;
  }
  if (updatedCount === 0 && skippedPrimaryCount === 0 && alreadySetCount === 0) {
    return 'Aucun appareil trouvé à dissocier.';
  }

  const notes: string[] = [];
  if (skippedPrimaryCount > 0) {
    notes.push(`${skippedPrimaryCount} ignoré(s) car système principal`);
  }
  if (alreadySetCount > 0) {
    notes.push(`${alreadySetCount} non lié(s)`);
  }
  return `${updatedCount} appareil(s) dissocié(s) de ${vendorLabel}${
    notes.length > 0 ? ` (${notes.join(', ')})` : ''
  }.`;
}

export async function bulkToggleDeviceSystemTag(params: {
  deviceIds: string[];
  vendor: VendorId;
  enabled: boolean;
}): Promise<BulkToggleSystemResult> {
  const uniqueIds = Array.from(
    new Set(params.deviceIds.map((id) => id.trim()).filter(Boolean))
  );
  const vendorLabel = VENDOR_REGISTRY[params.vendor].label;

  if (uniqueIds.length === 0) {
    return {
      vendor: params.vendor,
      enabled: params.enabled,
      requestedCount: 0,
      updatedCount: 0,
      alreadySetCount: 0,
      skippedPrimaryCount: 0,
      notFoundCount: 0,
      message: 'Aucun appareil sélectionné.',
    };
  }

  const db = getDb();
  const now = new Date();
  let updatedCount = 0;
  let alreadySetCount = 0;
  let skippedPrimaryCount = 0;
  let notFoundCount = 0;

  if (!db) {
    const state = getDemoState();
    for (const id of uniqueIds) {
      const dev = state.devices.find((d) => d.id === id);
      if (!dev) {
        notFoundCount++;
        continue;
      }

      if (!params.enabled && dev.primaryVendor === params.vendor) {
        skippedPrimaryCount++;
        continue;
      }

      const hasSystem = dev.systems.includes(params.vendor);
      const hasLink = state.vendorLinks.some(
        (l) => l.deviceId === dev.id && l.vendor === params.vendor
      );

      if (params.enabled) {
        if (hasSystem && hasLink) {
          alreadySetCount++;
          continue;
        }
        dev.systems = mergeDeviceSystems(dev.systems, params.vendor, dev.primaryVendor);
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
        updatedCount++;
      } else {
        if (!hasSystem && !hasLink) {
          alreadySetCount++;
          continue;
        }
        dev.systems = normalizeSystems(
          dev.systems.filter((s) => s !== params.vendor),
          dev.primaryVendor
        );
        state.vendorLinks = state.vendorLinks.filter(
          (l) => !(l.deviceId === dev.id && l.vendor === params.vendor)
        );
        updatedCount++;
      }
    }

    return {
      vendor: params.vendor,
      enabled: params.enabled,
      requestedCount: uniqueIds.length,
      updatedCount,
      alreadySetCount,
      skippedPrimaryCount,
      notFoundCount,
      message: formatBulkToggleMessage({
        vendorLabel,
        enabled: params.enabled,
        updatedCount,
        alreadySetCount,
        skippedPrimaryCount,
      }),
    };
  }

  await ensureSchemaInitialized(db);
  const rows = await db.select().from(devices).where(inArray(devices.id, uniqueIds));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const foundIds = rows.map((r) => r.id);

  const existingLinks =
    foundIds.length > 0
      ? await db
          .select()
          .from(deviceVendorLinks)
          .where(
            and(
              inArray(deviceVendorLinks.deviceId, foundIds),
              eq(deviceVendorLinks.vendor, params.vendor)
            )
          )
      : [];
  const linkedDeviceIds = new Set(existingLinks.map((l) => l.deviceId));

  const linksToInsert: Array<typeof deviceVendorLinks.$inferInsert> = [];
  const unlinkDeviceIds: string[] = [];

  for (const id of uniqueIds) {
    const row = rowById.get(id);
    if (!row) {
      notFoundCount++;
      continue;
    }

    const primaryVendor: VendorId = isValidVendorId(row.primaryVendor)
      ? row.primaryVendor
      : 'tuya';
    if (!params.enabled && primaryVendor === params.vendor) {
      skippedPrimaryCount++;
      continue;
    }

    const currentSystems = normalizeSystems(row.systems, primaryVendor);
    const hasSystem = currentSystems.includes(params.vendor);
    const hasLink = linkedDeviceIds.has(row.id);

    if (params.enabled) {
      if (hasSystem && hasLink) {
        alreadySetCount++;
        continue;
      }
      const nextSystems = mergeDeviceSystems(currentSystems, params.vendor, primaryVendor);
      const systemsChanged =
        nextSystems.length !== currentSystems.length ||
        nextSystems.some((s, idx) => s !== currentSystems[idx]);
      if (systemsChanged) {
        await db
          .update(devices)
          .set({ systems: nextSystems })
          .where(eq(devices.id, row.id));
      }
      if (!hasLink) {
        linksToInsert.push({
          deviceId: row.id,
          vendor: params.vendor,
          externalId: `manual:${params.vendor}:${row.id}`,
          externalName: row.customName || row.name,
          isPrimaryTelemetry: false,
          linkedAt: now,
        });
      }
      updatedCount++;
    } else {
      if (!hasSystem && !hasLink) {
        alreadySetCount++;
        continue;
      }
      const nextSystems = normalizeSystems(
        currentSystems.filter((s) => s !== params.vendor),
        primaryVendor
      );
      const systemsChanged =
        nextSystems.length !== currentSystems.length ||
        nextSystems.some((s, idx) => s !== currentSystems[idx]);
      if (systemsChanged) {
        await db
          .update(devices)
          .set({ systems: nextSystems })
          .where(eq(devices.id, row.id));
      }
      if (hasLink) {
        unlinkDeviceIds.push(row.id);
      }
      updatedCount++;
    }
  }

  if (linksToInsert.length > 0) {
    await db.insert(deviceVendorLinks).values(linksToInsert).onConflictDoNothing();
  }
  if (unlinkDeviceIds.length > 0) {
    await db
      .delete(deviceVendorLinks)
      .where(
        and(
          inArray(deviceVendorLinks.deviceId, unlinkDeviceIds),
          eq(deviceVendorLinks.vendor, params.vendor)
        )
      );
  }

  return {
    vendor: params.vendor,
    enabled: params.enabled,
    requestedCount: uniqueIds.length,
    updatedCount,
    alreadySetCount,
    skippedPrimaryCount,
    notFoundCount,
    message: formatBulkToggleMessage({
      vendorLabel,
      enabled: params.enabled,
      updatedCount,
      alreadySetCount,
      skippedPrimaryCount,
    }),
  };
}

export interface BulkMergeDevicesResult {
  mergedCount: number;
  skippedCount: number;
  errors: string[];
  message: string;
}

export async function bulkMergeDevices(params: {
  pairs: Array<{ targetDeviceId: string; sourceDeviceId: string }>;
}): Promise<BulkMergeDevicesResult> {
  const consumedIds = new Set<string>();
  const errors: string[] = [];
  let mergedCount = 0;
  let skippedCount = 0;

  for (const rawPair of params.pairs) {
    const targetDeviceId = rawPair.targetDeviceId.trim();
    const sourceDeviceId = rawPair.sourceDeviceId.trim();

    if (
      !targetDeviceId ||
      !sourceDeviceId ||
      targetDeviceId === sourceDeviceId ||
      consumedIds.has(sourceDeviceId) ||
      consumedIds.has(targetDeviceId)
    ) {
      skippedCount++;
      continue;
    }

    try {
      const merged = await mergeDevices({ targetDeviceId, sourceDeviceId });
      if (!merged) {
        skippedCount++;
        continue;
      }
      consumedIds.add(sourceDeviceId);
      mergedCount++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Erreur fusion');
      skippedCount++;
    }
  }

  const message =
    mergedCount > 0
      ? `${mergedCount} doublon(s) fusionné(s) sans perte de mesures${
          skippedCount > 0 ? ` (${skippedCount} ignoré(s))` : ''
        }.`
      : 'Aucun doublon fusionné.';

  return {
    mergedCount,
    skippedCount,
    errors,
    message,
  };
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

async function collectKasaReadingsInDb(
  db: AppDatabase,
  kasaDevices: Array<typeof devices.$inferSelect>,
  now: Date
): Promise<number> {
  const kasaCfg = getKasaConfig();
  if (kasaDevices.length === 0 || !kasaCfg.configured) return 0;

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

  const kasaLinks = await db
    .select()
    .from(deviceVendorLinks)
    .where(eq(deviceVendorLinks.vendor, 'kasa'));
  const deviceIdByExternalId = new Map(kasaLinks.map((l) => [l.externalId, l.deviceId]));
  const deviceById = new Map(kasaDevices.map((d) => [d.id, d]));

  const readingsToInsert: Array<typeof metricReadings.$inferInsert> = [];

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
  return readingsToInsert.length;
}

async function collectHomeConnectStatusInDb(
  db: AppDatabase,
  hcDevices: Array<typeof devices.$inferSelect>,
  now: Date
): Promise<number> {
  const hcCfg = getHomeConnectConfig();
  if (hcDevices.length === 0 || !hcCfg.configured) return 0;

  const connRows = await db
    .select()
    .from(vendorConnections)
    .where(eq(vendorConnections.vendor, 'home_connect'))
    .limit(1);
  const conn = connRows[0];
  if (!conn || conn.status !== 'connected' || (!conn.accessToken && !conn.refreshToken)) {
    return 0;
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

  const hcLinks = await db
    .select()
    .from(deviceVendorLinks)
    .where(eq(deviceVendorLinks.vendor, 'home_connect'));
  const deviceIdByExternalId = new Map(hcLinks.map((l) => [l.externalId, l.deviceId]));
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

  return updatedCount;
}

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

export async function syncSomfyDevices(): Promise<{
  syncedCount: number;
  newCount: number;
  mode: 'live' | 'demo';
  message: string;
}> {
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
        let candidateId = makeSomfyDeviceId(sf.externalId);
        if (state.devices.some((d) => d.id === candidateId)) {
          candidateId = `${candidateId}_${now.getTime().toString(36).slice(-4)}`;
        }
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
  const [existingDeviceRows, somfyLinkRows] = await Promise.all([
    db.select().from(devices),
    db.select().from(deviceVendorLinks).where(eq(deviceVendorLinks.vendor, 'somfy')),
  ]);

  const deviceById = new Map(existingDeviceRows.map((d) => [d.id, d]));
  const linkByExternalId = new Map(somfyLinkRows.map((l) => [l.externalId, l]));
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

        if (nextRoomId !== null && nextRoomId !== linkedDevice.roomId) {
          await db
            .update(metricReadings)
            .set({ roomId: nextRoomId })
            .where(and(eq(metricReadings.deviceId, linkedDevice.id), isNull(metricReadings.roomId)));
        }
      }

      await db
        .update(deviceVendorLinks)
        .set({
          externalName: sf.name,
          vendorMetadata,
        })
        .where(eq(deviceVendorLinks.id, existingLink!.id));
    } else {
      let candidateId = makeSomfyDeviceId(sf.externalId);
      if (deviceById.has(candidateId)) {
        candidateId = `${candidateId}_${now.getTime().toString(36).slice(-4)}`;
      }
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
  const db = getDb();
  if (!db) {
    const state = getDemoState();
    state.vendorConnections.daikin.connected = false;
    state.vendorConnections.daikin.lastError = null;
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
    .where(eq(vendorConnections.vendor, 'daikin'));
}

export async function syncDaikinDevices(): Promise<{
  syncedCount: number;
  newCount: number;
  mode: 'live' | 'demo';
  message: string;
}> {
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

  const [existingDeviceRows, dkLinkRows] = await Promise.all([
    db.select().from(devices),
    db.select().from(deviceVendorLinks).where(eq(deviceVendorLinks.vendor, 'daikin')),
  ]);

  const deviceById = new Map(existingDeviceRows.map((d) => [d.id, d]));
  const linkByExternalId = new Map(dkLinkRows.map((l) => [l.externalId, l]));
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
      let candidateId = makeDaikinDeviceId(dk.externalId);
      if (deviceById.has(candidateId)) {
        candidateId = `${candidateId}_${now.getTime().toString(36).slice(-4)}`;
      }

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

async function collectSomfyReadingsInDb(
  db: AppDatabase,
  somfyDevices: Array<typeof devices.$inferSelect>,
  now: Date
): Promise<{ updatedCount: number; readingsInserted: number }> {
  const somfyCfg = getSomfyConfig();
  if (somfyDevices.length === 0 || !somfyCfg.configured) {
    return { updatedCount: 0, readingsInserted: 0 };
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

  const somfyLinks = await db
    .select()
    .from(deviceVendorLinks)
    .where(eq(deviceVendorLinks.vendor, 'somfy'));
  const deviceIdByExternalId = new Map(somfyLinks.map((l) => [l.externalId, l.deviceId]));
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

  return { updatedCount, readingsInserted: readingsToInsert.length };
}

interface TuyaIntermediateReading {
  recordedAt: Date;
  contactOpen: boolean | null;
  coverState: NonNullable<MetricReadingRecord['coverState']> | null;
  coverOpenPct: number | null;
}

const TUYA_COVER_EVENT_CODES = [
  'percent_state',
  'percent_control',
  'situation_set',
  'control',
];

async function collectTuyaIntermediateEvents(params: {
  deviceId: string;
  deviceName: string;
  tuyaCategory: string | null;
  category: DeviceCategory;
  lastBatteryPct: number | null;
  lastSeenAt: Date | string | null;
  effectiveDpConfig: DpConfig;
  hasContact: boolean;
  hasCover: boolean;
  now: Date;
}): Promise<TuyaIntermediateReading[]> {
  if (!params.hasContact && !params.hasCover) return [];

  const codes: string[] = [];
  if (params.hasContact && params.effectiveDpConfig.contact?.code) {
    codes.push(params.effectiveDpConfig.contact.code);
  }
  if (params.hasCover) {
    for (const code of TUYA_COVER_EVENT_CODES) {
      if (!codes.includes(code)) codes.push(code);
    }
  }
  if (codes.length === 0) return [];

  const nowMs = params.now.getTime();
  const rawLastMs = params.lastSeenAt ? new Date(params.lastSeenAt).getTime() : NaN;
  const startTimeMs = Number.isFinite(rawLastMs)
    ? Math.max(nowMs - 12 * 3_600_000, rawLastMs + 1000)
    : nowMs - 30 * 60_000;
  const endTimeMs = nowMs - 2000;
  if (endTimeMs <= startTimeMs) return [];

  const logs = await fetchTuyaDeviceReportLogs({
    deviceId: params.deviceId,
    codes,
    startTimeMs,
    endTimeMs,
    size: 50,
  });
  if (logs.length === 0) return [];

  // Regrouper les événements simultanés (ex. control + percent_state dans la même seconde)
  const buckets = new Map<number, { tsMs: number; statuses: RawDpStatus[] }>();
  for (const entry of logs) {
    if (Math.abs(nowMs - entry.eventTimeMs) <= 2000) continue;
    const key = Math.floor(entry.eventTimeMs / 2000);
    const bucket = buckets.get(key) ?? { tsMs: entry.eventTimeMs, statuses: [] };
    bucket.tsMs = Math.max(bucket.tsMs, entry.eventTimeMs);
    bucket.statuses.push({ code: entry.code, value: entry.value });
    buckets.set(key, bucket);
  }

  const results: TuyaIntermediateReading[] = [];
  for (const bucket of Array.from(buckets.values()).sort((a, b) => a.tsMs - b.tsMs)) {
    const contactOpen =
      params.hasContact && params.effectiveDpConfig.contact
        ? extractMetricsFromStatus(bucket.statuses, { contact: params.effectiveDpConfig.contact })
            .contactOpen
        : null;
    const coverSummary = params.hasCover
      ? extractCoverSummary({
          name: params.deviceName,
          primaryVendor: 'tuya',
          tuyaCategory: params.tuyaCategory,
          category: params.category,
          lastRawStatus: bucket.statuses,
          lastBatteryPct: params.lastBatteryPct,
        })
      : null;

    if (contactOpen !== null || coverSummary !== null) {
      results.push({
        recordedAt: new Date(bucket.tsMs),
        contactOpen,
        coverState: coverSummary ? coverSummary.state : null,
        coverOpenPct: coverSummary ? coverSummary.openPct : null,
      });
    }
  }
  return results;
}

async function collectDaikinReadingsInDb(
  db: AppDatabase,
  daikinDevices: Array<typeof devices.$inferSelect>,
  now: Date
): Promise<{ updatedCount: number; readingsInserted: number }> {
  const daikinCfg = getDaikinConfig();
  if (daikinDevices.length === 0 || !daikinCfg.configured) {
    return { updatedCount: 0, readingsInserted: 0 };
  }

  const connRows = await db
    .select()
    .from(vendorConnections)
    .where(eq(vendorConnections.vendor, 'daikin'))
    .limit(1);
  const conn = connRows[0];
  if (!conn || conn.status !== 'connected' || (!conn.accessToken && !conn.refreshToken)) {
    return { updatedCount: 0, readingsInserted: 0 };
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

  const dkLinks = await db
    .select()
    .from(deviceVendorLinks)
    .where(eq(deviceVendorLinks.vendor, 'daikin'));
  const deviceIdByExternalId = new Map(dkLinks.map((l) => [l.externalId, l.deviceId]));
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

  return { updatedCount, readingsInserted: readingsToInsert.length };
}

export async function runCollection(trigger: 'schedule' | 'manual'): Promise<CollectionLogRecord> {
  const db = getDb();
  const tuya = getTuyaConfig();
  const kasa = getKasaConfig();
  const hcCfg = getHomeConnectConfig();
  const somfyCfg = getSomfyConfig();
  const daikinCfg = getDaikinConfig();
  const ghCfg = getGoogleHomeConfig();
  const startedMs = Date.now();

  if (!tuya.configured) {
    if (!db) {
      return simulateDemoCollection(trigger);
    }
    await seedDefaultDataIfEmpty(db);
    const now = new Date();
    try {
      let allDevices = await db.select().from(devices);
      if (allDevices.length === 0) {
        if (kasa.configured) await syncKasaDevices();
        if (somfyCfg.configured) await syncSomfyDevices();
        allDevices = await db.select().from(devices);
      }

      const kasaMonitored = allDevices.filter(
        (d) =>
          d.isMonitored &&
          !d.id.startsWith('manual_') &&
          d.primaryVendor === 'kasa'
      );
      const hcMonitored = allDevices.filter(
        (d) =>
          d.isMonitored &&
          !d.id.startsWith('manual_') &&
          d.primaryVendor === 'home_connect'
      );
      const somfyMonitored = allDevices.filter(
        (d) =>
          d.isMonitored &&
          !d.id.startsWith('manual_') &&
          d.primaryVendor === 'somfy'
      );
      const daikinMonitored = allDevices.filter(
        (d) =>
          d.isMonitored &&
          !d.id.startsWith('manual_') &&
          d.primaryVendor === 'daikin'
      );
      const ghMonitored = allDevices.filter(
        (d) =>
          d.isMonitored &&
          !d.id.startsWith('manual_') &&
          d.primaryVendor === 'google_home'
      );

      const hasFallbackVendors =
        kasa.configured ||
        hcCfg.configured ||
        daikinCfg.configured ||
        (ghCfg.apiEnabled && ghMonitored.length > 0);
      const kasaInserted = kasa.configured
        ? await collectKasaReadingsInDb(db, kasaMonitored, now)
        : 0;
      const somfyRes = somfyCfg.configured
        ? await collectSomfyReadingsInDb(db, somfyMonitored, now).catch((err) => {
          if (!hasFallbackVendors) throw err;
          return { updatedCount: 0, readingsInserted: 0 };
        })
        : { updatedCount: 0, readingsInserted: 0 };
      const daikinRes = daikinCfg.configured
        ? await collectDaikinReadingsInDb(db, daikinMonitored, now).catch((err) => {
          if (
            !kasa.configured &&
            !somfyCfg.configured &&
            !hcCfg.configured &&
            (!ghCfg.apiEnabled || ghMonitored.length === 0)
          ) {
            throw err;
          }
          return { updatedCount: 0, readingsInserted: 0 };
        })
        : { updatedCount: 0, readingsInserted: 0 };
      const hcUpdated = hcCfg.configured
        ? await collectHomeConnectStatusInDb(db, hcMonitored, now).catch((err) => {
          if (
            !kasa.configured &&
            !somfyCfg.configured &&
            !daikinCfg.configured &&
            (!ghCfg.apiEnabled || ghMonitored.length === 0)
          ) {
            throw err;
          }
          return 0;
        })
        : 0;
      const ghInserted = ghCfg.apiEnabled
        ? await collectGoogleHomeReadingsInDb(db, ghMonitored, now).catch((err) => {
          if (
            !kasa.configured &&
            !somfyCfg.configured &&
            !daikinCfg.configured &&
            hcMonitored.length === 0
          ) {
            throw err;
          }
          return 0;
        })
        : 0;

      if (
        kasa.configured ||
        somfyCfg.configured ||
        somfyRes.updatedCount > 0 ||
        somfyMonitored.length > 0 ||
        daikinRes.updatedCount > 0 ||
        daikinMonitored.length > 0 ||
        hcUpdated > 0 ||
        hcMonitored.length > 0 ||
        ghInserted > 0 ||
        (ghCfg.apiEnabled && ghMonitored.length > 0)
      ) {
        const [logRow] = await db
          .insert(collectionLogs)
          .values({
            trigger,
            devicesCount:
              kasaMonitored.length +
              somfyMonitored.length +
              daikinMonitored.length +
              hcMonitored.length +
              (ghCfg.apiEnabled ? ghMonitored.length : 0),
            readingsInserted:
              kasaInserted +
              somfyRes.readingsInserted +
              daikinRes.readingsInserted +
              ghInserted,
            status: 'success',
            errorMessage: null,
            durationMs: Date.now() - startedMs,
          })
          .returning();
        return mapDbLog(logRow);
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Erreur collecte Kasa / Somfy / Siemens Home Connect / Google Home';
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

    const errMsg =
      'Aucun fournisseur configuré (TUYA_ACCESS_ID / KASA_EMAIL / SIEMENS_HOME_CONNECT / Google Home non connectés).';
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
      const coverSummary = extractCoverSummary({
        name: dev.name,
        primaryVendor: 'tuya',
        tuyaCategory: dev.tuyaCategory,
        category: dev.category,
        lastRawStatus: rawStatus,
        lastBatteryPct: metrics.batteryPct,
      });
      const hasCover = coverSummary !== null;

      const intermediateEvents = await collectTuyaIntermediateEvents({
        deviceId: dev.id,
        deviceName: dev.name,
        tuyaCategory: dev.tuyaCategory,
        category: dev.category,
        lastBatteryPct: metrics.batteryPct,
        lastSeenAt: dev.lastSeenAt,
        effectiveDpConfig,
        hasContact: Boolean(effectiveDpConfig.contact?.code) || dev.category === 'contact',
        hasCover,
        now,
      });
      for (const ev of intermediateEvents) {
        state.readings.push({
          id: state.nextReadingId++,
          deviceId: dev.id,
          roomId: dev.roomId,
          recordedAt: ev.recordedAt.toISOString(),
          powerW: null,
          voltageV: null,
          energyKwh: null,
          energySource: null,
          tempC: null,
          humidityPct: null,
          contactOpen: ev.contactOpen,
          coverState: ev.coverState,
          coverOpenPct: ev.coverOpenPct,
        });
        inserted++;
      }

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
        coverState: coverSummary ? coverSummary.state : null,
        coverOpenPct: coverSummary ? coverSummary.openPct : null,
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

  // Mode complet : Neon Postgres + Multi-Vendors (Tuya Cloud + Kasa Cloud + Google Home)
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
    const kasaMonitored = allDevices.filter(
      (d) =>
        d.isMonitored &&
        !d.id.startsWith('manual_') &&
        d.primaryVendor === 'kasa'
    );
    const hcMonitored = allDevices.filter(
      (d) =>
        d.isMonitored &&
        !d.id.startsWith('manual_') &&
        d.primaryVendor === 'home_connect'
    );
    const somfyMonitored = allDevices.filter(
      (d) =>
        d.isMonitored &&
        !d.id.startsWith('manual_') &&
        d.primaryVendor === 'somfy'
    );
    const daikinMonitored = allDevices.filter(
      (d) =>
        d.isMonitored &&
        !d.id.startsWith('manual_') &&
        d.primaryVendor === 'daikin'
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
      const coverSummary = extractCoverSummary({
        name: dev.name,
        primaryVendor: 'tuya',
        tuyaCategory: dev.tuyaCategory,
        category: (dev.category as DeviceCategory) || 'other',
        lastRawStatus: rawStatus,
        lastBatteryPct: metrics.batteryPct,
      });
      const hasCover = coverSummary !== null;

      if (hasContact || Boolean(effectiveDpConfig.contact?.code) || dev.category === 'contact' || hasCover) {
        const intermediateEvents = await collectTuyaIntermediateEvents({
          deviceId: dev.id,
          deviceName: dev.name,
          tuyaCategory: dev.tuyaCategory,
          category: (dev.category as DeviceCategory) || 'other',
          lastBatteryPct: metrics.batteryPct,
          lastSeenAt: dev.lastSeenAt,
          effectiveDpConfig,
          hasContact: hasContact || Boolean(effectiveDpConfig.contact?.code) || dev.category === 'contact',
          hasCover,
          now,
        });
        for (const ev of intermediateEvents) {
          readingsToInsert.push({
            deviceId: dev.id,
            roomId: dev.roomId,
            recordedAt: ev.recordedAt,
            powerW: null,
            voltageV: null,
            energyKwh: null,
            energySource: null,
            tempC: null,
            humidityPct: null,
            contactOpen: ev.contactOpen,
            coverState: ev.coverState,
            coverOpenPct: ev.coverOpenPct,
          });
        }
      }

      if (!hasPower && !hasClimate && !hasContact && !hasCover) {
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
        coverState: coverSummary ? coverSummary.state : null,
        coverOpenPct: coverSummary ? coverSummary.openPct : null,
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

    const [kasaInserted, somfyRes, daikinRes, ghInserted] = await Promise.all([
      collectKasaReadingsInDb(db, kasaMonitored, now).catch(() => 0),
      collectSomfyReadingsInDb(db, somfyMonitored, now).catch(() => ({
        updatedCount: 0,
        readingsInserted: 0,
      })),
      collectDaikinReadingsInDb(db, daikinMonitored, now).catch(() => ({
        updatedCount: 0,
        readingsInserted: 0,
      })),
      collectGoogleHomeReadingsInDb(db, googleMonitored, now).catch(() => 0),
      collectHomeConnectStatusInDb(db, hcMonitored, now).catch(() => 0),
    ]);

    const [logRow] = await db
      .insert(collectionLogs)
      .values({
        trigger,
        devicesCount:
          tuyaMonitored.length +
          kasaMonitored.length +
          somfyMonitored.length +
          daikinMonitored.length +
          hcMonitored.length +
          (ghCfg.apiEnabled ? googleMonitored.length : 0),
        readingsInserted:
          readingsToInsert.length +
          kasaInserted +
          somfyRes.readingsInserted +
          daikinRes.readingsInserted +
          ghInserted,
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
  vendor: 'tuya' | 'kasa' | 'somfy' | 'google_home' | 'all';
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

async function syncRoomsFromKasa(): Promise<RoomVendorSyncResult> {
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
      await db
        .update(metricReadings)
        .set({ roomId: mappedRoomId })
        .where(and(eq(metricReadings.deviceId, linkedDevice.id), isNull(metricReadings.roomId)));
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

async function syncRoomsFromSomfy(): Promise<RoomVendorSyncResult> {
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
      await db
        .update(metricReadings)
        .set({ roomId: mappedRoomId })
        .where(and(eq(metricReadings.deviceId, linkedDevice.id), isNull(metricReadings.roomId)));
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

export async function syncRoomsFromVendor(
  vendor: 'tuya' | 'kasa' | 'somfy' | 'google_home' | 'all' = 'all'
): Promise<RoomVendorSyncResult> {
  if (vendor === 'tuya') return syncRoomsFromTuya();
  if (vendor === 'kasa') return syncRoomsFromKasa();
  if (vendor === 'somfy') return syncRoomsFromSomfy();
  if (vendor === 'google_home') return syncRoomsFromGoogleHome();

  const db = getDb();
  const googleApiEnabled = getGoogleHomeConfig().apiEnabled;
  const tasks: Array<{ label: string; run: () => Promise<RoomVendorSyncResult> }> = [];

  if (!db) {
    tasks.push({ label: 'Tuya', run: syncRoomsFromTuya });
    tasks.push({ label: 'Kasa', run: syncRoomsFromKasa });
    tasks.push({ label: 'Somfy', run: syncRoomsFromSomfy });
    if (googleApiEnabled) {
      tasks.push({ label: 'Google Home', run: syncRoomsFromGoogleHome });
    }
  } else {
    if (getTuyaConfig().configured) {
      tasks.push({ label: 'Tuya', run: syncRoomsFromTuya });
    }
    if (getKasaConfig().configured) {
      tasks.push({ label: 'Kasa', run: syncRoomsFromKasa });
    }
    if (getSomfyConfig().configured) {
      tasks.push({ label: 'Somfy', run: syncRoomsFromSomfy });
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
          ? 'Aucun système configuré ou connecté pour synchroniser les pièces (configurez Tuya, Kasa, Somfy ou connectez Google Home).'
          : 'Aucun système configuré pour synchroniser les pièces (configurez Tuya, Kasa ou Somfy).'
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
