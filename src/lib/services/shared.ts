import { asc, eq } from 'drizzle-orm';
import { isDatabaseConfigured, type AppDatabase } from '@/db';
import {
  automations,
  collectionLogs,
  devices,
  deviceVendorLinks,
  meterReadings,
  metricReadings,
  rooms,
  tariffPeriods,
} from '@/db/schema';
import { isAppPasswordConfigured } from '@/lib/auth';
import { getOidcConfig } from '@/lib/auth-oidc';
import { getDemoState } from '@/lib/demo-store';
import { sql } from 'drizzle-orm';
import { extractMetricsFromStatus, getTuyaConfig, normalizeTuyaRule } from '@/lib/tuya-client';
import { getDaikinConfig } from '@/lib/vendors/daikin-client';
import { getConsoApiEnvConfig, maskPrm } from '@/lib/vendors/conso-api-client';
import { getGoogleHomeConfig } from '@/lib/vendors/google-home-client';
import { getHomeConnectConfig } from '@/lib/vendors/home-connect-client';
import { getKasaConfig } from '@/lib/vendors/kasa-client';
import { isValidVendorId, normalizeSystems } from '@/lib/vendors/registry';
import { getSomfyConfig } from '@/lib/vendors/somfy-client';
import { getXiaomiConfig } from '@/lib/vendors/xiaomi-client';
import { getXSenseConfig } from '@/lib/vendors/xsense-client';
import type {
  AutomationMatchType,
  AutomationRecord,
  AutomationRuleType,
  CollectionLogRecord,
  DeviceCategory,
  DeviceRecord,
  DeviceVendorLinkRecord,
  DpConfig,
  EnergyMode,
  EnergySource,
  EnvStatus,
  MeterReadingGranularity,
  MeterReadingRecord,
  MetricReadingRecord,
  RawDpStatus,
  RoomRecord,
  TariffMode,
  TariffPeriodRecord,
  VendorConnectionSummary,
  VendorId,
} from '@/types';

export type DemoVendorMode = VendorConnectionSummary['mode'];

export const ROOM_PALETTE = [
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#10b981',
  '#ec4899',
  '#06b6d4',
  '#f43f5e',
  '#14b8a6',
];

export function getEnvStatus(
  googleHomeConnected = false,
  homeConnectConnected = false,
  daikinConnected = false,
  xiaomiConnected = false,
  consoApiState?: {
    configured?: boolean;
    connected?: boolean;
    prm?: string | null;
    subscribedKva?: number | null;
  }
): EnvStatus {
  const tuya = getTuyaConfig();
  const kasa = getKasaConfig();
  const hc = getHomeConnectConfig();
  const somfy = getSomfyConfig();
  const daikin = getDaikinConfig();
  const xsense = getXSenseConfig();
  const xiaomi = getXiaomiConfig();
  const google = getGoogleHomeConfig();
  const consoApi = getConsoApiEnvConfig();
  const oidc = getOidcConfig();
  const databaseConfigured = isDatabaseConfigured();
  const effectiveConsoConfigured = consoApiState?.configured ?? consoApi.configured;
  const effectiveConsoPrm = consoApiState?.prm ?? (consoApi.prm || null);
  const effectiveConsoKva = consoApiState?.subscribedKva ?? consoApi.subscribedKva;
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
    xsenseConfigured: xsense.configured,
    xiaomiConfigured: xiaomi.configured,
    xiaomiConnected: Boolean(xiaomiConnected),
    xiaomiRegion: xiaomi.region,
    appPasswordConfigured: isAppPasswordConfigured(),
    oidcConfigured: oidc.configured,
    oidcProviderName: oidc.configured ? oidc.providerName : null,
    scheduleSecretConfigured: Boolean(process.env.SCHEDULE_SECRET?.trim()),
    googleHomeApiEnabled: google.apiEnabled,
    googleHomeConfigured: google.configured,
    googleHomeMode: google.defaultMode,
    googleHomeConnected: google.apiEnabled && googleHomeConnected,
    googleSdmProjectConfigured: Boolean(google.sdmProjectId),
    consoApiConfigured: effectiveConsoConfigured,
    consoApiConnected: Boolean(consoApiState?.connected),
    consoApiPrmMasked: maskPrm(effectiveConsoPrm),
    consoApiSubscribedKva: effectiveConsoKva,
  };
}

export function mapDbRoom(row: typeof rooms.$inferSelect): RoomRecord {
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

export function mapDbVendorLink(row: typeof deviceVendorLinks.$inferSelect): DeviceVendorLinkRecord {
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

export function mapDbDevice(
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
    ignoreOfflineAlert: row.ignoreOfflineAlert ?? false,
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

export function mapDbMeterReading(row: typeof meterReadings.$inferSelect): MeterReadingRecord {
  const gran = row.granularity;
  const granularity: MeterReadingGranularity =
    gran === 'load_curve_30m' || gran === 'max_power_daily' ? gran : 'daily_kwh';
  return {
    id: row.id,
    pointId: row.pointId,
    granularity,
    recordedAt: row.recordedAt.toISOString(),
    dateKey: row.dateKey,
    energyKwh: row.energyKwh,
    powerW: row.powerW,
  };
}

export function mapDbReading(row: typeof metricReadings.$inferSelect): MetricReadingRecord {
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

export function mapDbTariff(row: typeof tariffPeriods.$inferSelect): TariffPeriodRecord {
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
    tempoConfig: row.tempoConfig ?? null,
    monthlySubscriptionEur: row.monthlySubscriptionEur,
    vatRatePct: row.vatRatePct ?? 20,
    subscriptionVatRatePct: row.subscriptionVatRatePct ?? 20,
    exciseRateEur: row.exciseRateEur ?? 0,
    contributions: Array.isArray(row.contributions) ? row.contributions : [],
    createdAt: row.createdAt.toISOString(),
  };
}

export function mapDbLog(row: typeof collectionLogs.$inferSelect): CollectionLogRecord {
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

export function mapDbAutomation(row: typeof automations.$inferSelect): AutomationRecord {
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
let seedCompletedPromise: Promise<void> | null = null;

function isSchemaProbeReady(probeResult: unknown): boolean {
  const rows = Array.isArray(probeResult)
    ? probeResult
    : ((probeResult as { rows?: unknown[] } | null)?.rows ?? []);
  const first = rows[0] as { ready?: unknown } | undefined;
  return first?.ready === true;
}

export function resetSeedCheckCache(): void {
  seedCompletedPromise = null;
}

export async function ensureSchemaInitialized(db: AppDatabase): Promise<void> {
  if (!schemaInitPromise) {
    schemaInitPromise = (async () => {
      try {
        const probe = await db.execute(sql`
          SELECT (
            to_regclass('public.rooms') IS NOT NULL
            AND to_regclass('public.devices') IS NOT NULL
            AND to_regclass('public.metric_readings') IS NOT NULL
            AND to_regclass('public.tariff_periods') IS NOT NULL
            AND to_regclass('public.collection_logs') IS NOT NULL
            AND to_regclass('public.automations') IS NOT NULL
            AND to_regclass('public.device_vendor_links') IS NOT NULL
            AND to_regclass('public.vendor_connections') IS NOT NULL
            AND to_regclass('public.alert_events') IS NOT NULL
            AND to_regclass('public.meter_readings') IS NOT NULL
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'systems')
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'ignore_offline_alert')
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'exclude_from_totals')
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'metric_readings' AND column_name = 'cover_open_pct')
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'automations' AND column_name = 'vendor')
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tariff_periods' AND column_name = 'tempo_config')
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tariff_periods' AND column_name = 'excise_rate_eur')
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tariff_periods' AND column_name = 'contributions')
          ) AS ready
        `);
        if (isSchemaProbeReady(probe)) {
          return;
        }
      } catch {
        // En cas d'échec de la sonde, on exécute les créations/migrations idempotentes
      }

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
          "ignore_offline_alert" boolean DEFAULT false NOT NULL,
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
        ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "ignore_offline_alert" boolean DEFAULT false NOT NULL
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
          "tempo_config" jsonb,
          "monthly_subscription_eur" real DEFAULT 0 NOT NULL,
          "vat_rate_pct" real DEFAULT 20 NOT NULL,
          "subscription_vat_rate_pct" real DEFAULT 20 NOT NULL,
          "excise_rate_eur" real DEFAULT 0 NOT NULL,
          "contributions" jsonb DEFAULT '[]'::jsonb NOT NULL,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`
        ALTER TABLE "tariff_periods" ADD COLUMN IF NOT EXISTS "tempo_config" jsonb
      `);
      await db.execute(sql`
        ALTER TABLE "tariff_periods" ADD COLUMN IF NOT EXISTS "vat_rate_pct" real DEFAULT 20 NOT NULL
      `);
      await db.execute(sql`
        ALTER TABLE "tariff_periods" ADD COLUMN IF NOT EXISTS "subscription_vat_rate_pct" real DEFAULT 20 NOT NULL
      `);
      await db.execute(sql`
        ALTER TABLE "tariff_periods" ADD COLUMN IF NOT EXISTS "excise_rate_eur" real DEFAULT 0 NOT NULL
      `);
      await db.execute(sql`
        ALTER TABLE "tariff_periods" ADD COLUMN IF NOT EXISTS "contributions" jsonb DEFAULT '[]'::jsonb NOT NULL
      `);
      await db.execute(sql`
        UPDATE "tariff_periods"
        SET
          "contributions" = jsonb_build_array(
            jsonb_build_object(
              'id', 'excise',
              'name', 'Accise sur l''électricité',
              'kind', 'per_kwh',
              'amountHtEur', "excise_rate_eur",
              'vatRatePct', "vat_rate_pct"
            )
          ),
          "base_rate_eur" = CASE
            WHEN "base_rate_eur" IS NOT NULL
            THEN GREATEST(0, "base_rate_eur" - "excise_rate_eur" * (1 + "vat_rate_pct" / 100.0))
            ELSE NULL
          END,
          "hp_rate_eur" = CASE
            WHEN "hp_rate_eur" IS NOT NULL
            THEN GREATEST(0, "hp_rate_eur" - "excise_rate_eur" * (1 + "vat_rate_pct" / 100.0))
            ELSE NULL
          END,
          "hc_rate_eur" = CASE
            WHEN "hc_rate_eur" IS NOT NULL
            THEN GREATEST(0, "hc_rate_eur" - "excise_rate_eur" * (1 + "vat_rate_pct" / 100.0))
            ELSE NULL
          END,
          "tempo_config" = CASE
            WHEN "tempo_config" IS NOT NULL
            THEN jsonb_build_object(
              'blueHpRateEur', GREATEST(0, COALESCE(("tempo_config"->>'blueHpRateEur')::double precision, 0) - "excise_rate_eur" * (1 + "vat_rate_pct" / 100.0)),
              'blueHcRateEur', GREATEST(0, COALESCE(("tempo_config"->>'blueHcRateEur')::double precision, 0) - "excise_rate_eur" * (1 + "vat_rate_pct" / 100.0)),
              'whiteHpRateEur', GREATEST(0, COALESCE(("tempo_config"->>'whiteHpRateEur')::double precision, 0) - "excise_rate_eur" * (1 + "vat_rate_pct" / 100.0)),
              'whiteHcRateEur', GREATEST(0, COALESCE(("tempo_config"->>'whiteHcRateEur')::double precision, 0) - "excise_rate_eur" * (1 + "vat_rate_pct" / 100.0)),
              'redHpRateEur', GREATEST(0, COALESCE(("tempo_config"->>'redHpRateEur')::double precision, 0) - "excise_rate_eur" * (1 + "vat_rate_pct" / 100.0)),
              'redHcRateEur', GREATEST(0, COALESCE(("tempo_config"->>'redHcRateEur')::double precision, 0) - "excise_rate_eur" * (1 + "vat_rate_pct" / 100.0))
            ) || CASE WHEN "tempo_config" ? 'dayColors' THEN jsonb_build_object('dayColors', "tempo_config"->'dayColors') ELSE '{}'::jsonb END
            ELSE NULL
          END,
          "excise_rate_eur" = 0
        WHERE "excise_rate_eur" > 0
          AND jsonb_array_length(COALESCE("contributions", '[]'::jsonb)) = 0
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
        CREATE TABLE IF NOT EXISTS "alert_events" (
          "dedup_key" text PRIMARY KEY NOT NULL,
          "severity" text DEFAULT 'warning' NOT NULL,
          "message" text NOT NULL,
          "last_sent_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "meter_readings" (
          "id" serial PRIMARY KEY NOT NULL,
          "point_id" text NOT NULL,
          "granularity" text NOT NULL,
          "recorded_at" timestamp with time zone NOT NULL,
          "date_key" text NOT NULL,
          "energy_kwh" real,
          "power_w" real
        )
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "idx_meter_readings_unique" ON "meter_readings" ("point_id", "granularity", "recorded_at")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "idx_meter_readings_granularity_date" ON "meter_readings" ("granularity", "date_key")
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

export function inferRoomStyle(name: string, index: number): {
  color: string;
  icon: string;
  targetTempMin: number;
  targetTempMax: number;
  targetHumidityMin: number;
  targetHumidityMax: number;
} {
  const lower = name.toLowerCase();
  if (lower.includes('salon') || lower.includes('séjour') || lower.includes('living')) {
    return {
      color: '#3b82f6',
      icon: 'Sofa',
      targetTempMin: 19.5,
      targetTempMax: 22.5,
      targetHumidityMin: 40,
      targetHumidityMax: 60,
    };
  }
  if (lower.includes('bureau') || lower.includes('office')) {
    return {
      color: '#8b5cf6',
      icon: 'Monitor',
      targetTempMin: 19,
      targetTempMax: 22,
      targetHumidityMin: 40,
      targetHumidityMax: 60,
    };
  }
  if (lower.includes('cuisine') || lower.includes('kitchen')) {
    return {
      color: '#f59e0b',
      icon: 'Utensils',
      targetTempMin: 18.5,
      targetTempMax: 23,
      targetHumidityMin: 40,
      targetHumidityMax: 65,
    };
  }
  if (lower.includes('chambre') || lower.includes('bed')) {
    return {
      color: '#10b981',
      icon: 'Bed',
      targetTempMin: 17,
      targetTempMax: 20,
      targetHumidityMin: 40,
      targetHumidityMax: 60,
    };
  }
  if (lower.includes('bain') || lower.includes('sdb') || lower.includes('douche') || lower.includes('bath')) {
    return {
      color: '#ec4899',
      icon: 'Bath',
      targetTempMin: 20,
      targetTempMax: 24,
      targetHumidityMin: 45,
      targetHumidityMax: 65,
    };
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

export async function seedDefaultDataIfEmpty(db: AppDatabase): Promise<void> {
  await ensureSchemaInitialized(db);

  if (!seedCompletedPromise) {
    seedCompletedPromise = (async () => {
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
          vatRatePct: 20,
          subscriptionVatRatePct: 20,
          exciseRateEur: 0,
          contributions: [],
        });
      }
    })().catch((err) => {
      seedCompletedPromise = null;
      throw err;
    });
  }

  await seedCompletedPromise;
}

export async function ensureMissingRoomsInDb(
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

export function ensureMissingRoomsInDemo(roomNames: string[]): {
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

export async function cleanupDefaultSeededRoomsInDb(
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

export function computeDeviceMetricsForDpConfig(
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
