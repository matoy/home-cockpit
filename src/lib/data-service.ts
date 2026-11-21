import { asc, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb, isDatabaseConfigured, type AppDatabase } from '@/db';
import {
  collectionLogs,
  devices,
  metricReadings,
  rooms,
  tariffPeriods,
} from '@/db/schema';
import { buildDashboardPayload } from './aggregator';
import { isAppPasswordConfigured } from './auth';
import { getDemoState, simulateDemoCollection } from './demo-store';
import { computeHybridEnergyKwh, normalizeTariffTimeline } from './tariff-engine';
import {
  autoDetectDpConfig,
  extractMetricsFromStatus,
  fetchBatchStatuses,
  fetchDeviceSpecification,
  fetchTuyaDevices,
  getTuyaConfig,
} from './tuya-client';
import type {
  CollectionLogRecord,
  DashboardPayload,
  DeviceCategory,
  DeviceRecord,
  DpConfig,
  EnergyMode,
  EnergySource,
  EnvStatus,
  HcSlot,
  MetricReadingRecord,
  RawDpStatus,
  RoomRecord,
  TariffMode,
  TariffPeriodRecord,
  TimeRange,
} from '@/types';

const RANGE_HOURS: Record<TimeRange, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
  '365d': 24 * 365,
};

export function getEnvStatus(): EnvStatus {
  const tuya = getTuyaConfig();
  const databaseConfigured = isDatabaseConfigured();
  return {
    mode: databaseConfigured ? 'live' : 'demo',
    databaseConfigured,
    tuyaConfigured: tuya.configured,
    tuyaRegion: tuya.region,
    tuyaUserUidConfigured: Boolean(tuya.userUid),
    appPasswordConfigured: isAppPasswordConfigured(),
    scheduleSecretConfigured: Boolean(process.env.SCHEDULE_SECRET?.trim()),
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

function mapDbDevice(row: typeof devices.$inferSelect): DeviceRecord {
  return {
    id: row.id,
    name: row.name,
    customName: row.customName,
    roomId: row.roomId,
    category: (row.category as DeviceCategory) || 'power',
    tuyaCategory: row.tuyaCategory,
    productName: row.productName,
    isOnline: row.isOnline,
    isMonitored: row.isMonitored,
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
          "is_online" boolean DEFAULT true NOT NULL,
          "is_monitored" boolean DEFAULT true NOT NULL,
          "energy_mode" text DEFAULT 'hybrid' NOT NULL,
          "dp_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
          "last_raw_status" jsonb,
          "last_seen_at" timestamp with time zone,
          "last_power_w" real,
          "last_voltage_v" real,
          "last_add_ele_kwh" real,
          "last_temp_c" real,
          "last_humidity_pct" real,
          "last_battery_pct" real
        )
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
          "humidity_pct" real
        )
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
    })().catch((err) => {
      schemaInitPromise = null;
      throw err;
    });
  }
  await schemaInitPromise;
}

async function seedDefaultDataIfEmpty(db: AppDatabase): Promise<void> {
  await ensureSchemaInitialized(db);
  const existingRooms = await db.select().from(rooms).limit(1);
  if (existingRooms.length === 0) {
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

export async function getDashboardData(
  range: TimeRange = '24h',
  selectedRoomId = 'all'
): Promise<DashboardPayload> {
  const env = getEnvStatus();
  const db = getDb();

  if (!db) {
    const state = getDemoState();
    return buildDashboardPayload({
      env,
      range,
      selectedRoomId,
      rooms: state.rooms,
      devices: state.devices,
      readings: state.readings,
      tariffs: state.tariffs,
      logs: state.logs,
    });
  }

  await seedDefaultDataIfEmpty(db);

  const hours = RANGE_HOURS[range] ?? 24;
  const cutoff = new Date(Date.now() - hours * 3_600_000);

  const [roomRows, deviceRows, readingRows, tariffRows, logRows] = await Promise.all([
    db.select().from(rooms).orderBy(asc(rooms.id)),
    db.select().from(devices).orderBy(asc(devices.name)),
    db
      .select()
      .from(metricReadings)
      .where(gte(metricReadings.recordedAt, cutoff))
      .orderBy(asc(metricReadings.recordedAt)),
    db.select().from(tariffPeriods).orderBy(asc(tariffPeriods.startDate)),
    db.select().from(collectionLogs).orderBy(desc(collectionLogs.executedAt)).limit(20),
  ]);

  return buildDashboardPayload({
    env,
    range,
    selectedRoomId,
    rooms: roomRows.map(mapDbRoom),
    devices: deviceRows.map(mapDbDevice),
    readings: readingRows.map(mapDbReading),
    tariffs: normalizeTariffTimeline(tariffRows.map(mapDbTariff)),
    logs: logRows.map(mapDbLog),
  });
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
      return {
        syncedCount: state.devices.length,
        newCount: 0,
        mode: 'demo',
        message: 'Mode démo actif : 8 appareils simulés déjà synchronisés.',
      };
    }
    throw new Error(
      'Identifiants Tuya manquants. Configurez TUYA_ACCESS_ID et TUYA_ACCESS_SECRET dans Vercel / .env.local.'
    );
  }

  const rawDevices = await fetchTuyaDevices();
  const deviceIds = rawDevices.map((d) => d.id);
  const statusMap = await fetchBatchStatuses(deviceIds);
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    let newCount = 0;
    for (const raw of rawDevices) {
      const rawStatus = statusMap.get(raw.id) ?? raw.status ?? [];
      const existing = state.devices.find((d) => d.id === raw.id);
      if (existing) {
        existing.name = raw.name;
        existing.isOnline = raw.online ?? true;
        existing.tuyaCategory = raw.category;
        existing.productName = raw.product_name ?? null;
        existing.lastRawStatus = rawStatus;
        const metrics = extractMetricsFromStatus(rawStatus, existing.dpConfig);
        existing.lastPowerW = metrics.powerW;
        existing.lastVoltageV = metrics.voltageV;
        existing.lastAddEleKwh = metrics.addEleKwh;
        existing.lastTempC = metrics.tempC;
        existing.lastHumidityPct = metrics.humidityPct;
        existing.lastBatteryPct = metrics.batteryPct;
        existing.lastSeenAt = now.toISOString();
      } else {
        const spec = await fetchDeviceSpecification(raw.id);
        const { dpConfig, category } = autoDetectDpConfig(rawStatus, spec);
        const metrics = extractMetricsFromStatus(rawStatus, dpConfig);
        state.devices.push({
          id: raw.id,
          name: raw.name,
          customName: null,
          roomId: null,
          category,
          tuyaCategory: raw.category,
          productName: raw.product_name ?? null,
          isOnline: raw.online ?? true,
          isMonitored: true,
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
        });
        newCount++;
      }
    }
    return {
      syncedCount: rawDevices.length,
      newCount,
      mode: 'demo',
      message: `${rawDevices.length} appareils récupérés depuis Tuya Cloud (${newCount} nouveaux).`,
    };
  }

  await seedDefaultDataIfEmpty(db);
  const existingRows = await db.select().from(devices);
  const existingMap = new Map(existingRows.map((d) => [d.id, d]));

  let newCount = 0;

  for (const raw of rawDevices) {
    const rawStatus = statusMap.get(raw.id) ?? raw.status ?? [];
    const existing = existingMap.get(raw.id);

    if (existing) {
      const dpConfig =
        existing.dpConfig && Object.keys(existing.dpConfig).length > 0
          ? existing.dpConfig
          : autoDetectDpConfig(rawStatus, await fetchDeviceSpecification(raw.id)).dpConfig;
      const metrics = extractMetricsFromStatus(rawStatus, dpConfig);

      await db
        .update(devices)
        .set({
          name: raw.name,
          tuyaCategory: raw.category,
          productName: raw.product_name ?? null,
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
        })
        .where(eq(devices.id, raw.id));
    } else {
      const spec = await fetchDeviceSpecification(raw.id);
      const { dpConfig, category } = autoDetectDpConfig(rawStatus, spec);
      const metrics = extractMetricsFromStatus(rawStatus, dpConfig);

      await db.insert(devices).values({
        id: raw.id,
        name: raw.name,
        customName: null,
        roomId: null,
        category,
        tuyaCategory: raw.category,
        productName: raw.product_name ?? null,
        isOnline: raw.online ?? true,
        isMonitored: true,
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
      });
      newCount++;
    }
  }

  return {
    syncedCount: rawDevices.length,
    newCount,
    mode: 'live',
    message: `${rawDevices.length} appareils synchronisés avec Tuya Cloud (${newCount} nouveaux).`,
  };
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
    const errMsg = 'TUYA_ACCESS_ID / TUYA_ACCESS_SECRET non configurés.';
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
    const statusMap = await fetchBatchStatuses(rawDevices.map((d) => d.id));
    const now = new Date();
    let inserted = 0;

    for (const raw of rawDevices) {
      const rawStatus = statusMap.get(raw.id) ?? raw.status ?? [];
      let dev = state.devices.find((d) => d.id === raw.id);
      if (!dev) {
        const spec = await fetchDeviceSpecification(raw.id);
        const detected = autoDetectDpConfig(rawStatus, spec);
        dev = {
          id: raw.id,
          name: raw.name,
          customName: null,
          roomId: null,
          category: detected.category,
          tuyaCategory: raw.category,
          productName: raw.product_name ?? null,
          isOnline: raw.online ?? true,
          isMonitored: true,
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
        };
        state.devices.push(dev);
      }

      if (!dev.isMonitored) continue;
      const metrics = extractMetricsFromStatus(rawStatus, dev.dpConfig);
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
      });

      dev.lastRawStatus = rawStatus;
      dev.lastSeenAt = now.toISOString();
      dev.lastPowerW = metrics.powerW;
      dev.lastVoltageV = metrics.voltageV;
      dev.lastAddEleKwh = metrics.addEleKwh;
      dev.lastTempC = metrics.tempC;
      dev.lastHumidityPct = metrics.humidityPct;
      dev.lastBatteryPct = metrics.batteryPct;
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

  // Mode complet : Neon Postgres + Tuya Cloud
  try {
    await seedDefaultDataIfEmpty(db);
    let allDevices = await db.select().from(devices);
    if (allDevices.length === 0) {
      await syncTuyaDevices();
      allDevices = await db.select().from(devices);
    }

    const monitored = allDevices.filter((d) => d.isMonitored);
    const statusMap = await fetchBatchStatuses(monitored.map((d) => d.id));
    const now = new Date();

    const readingsToInsert: Array<typeof metricReadings.$inferInsert> = [];

    for (const dev of monitored) {
      const rawStatus: RawDpStatus[] = statusMap.get(dev.id) ?? [];
      if (rawStatus.length === 0) continue;

      const metrics = extractMetricsFromStatus(rawStatus, dev.dpConfig ?? {});
      const hasPower = metrics.powerW !== null || metrics.addEleKwh !== null;
      const hasClimate = metrics.tempC !== null || metrics.humidityPct !== null;
      if (!hasPower && !hasClimate) {
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
        })
        .where(eq(devices.id, dev.id));
    }

    if (readingsToInsert.length > 0) {
      await db.insert(metricReadings).values(readingsToInsert);
    }

    const [logRow] = await db
      .insert(collectionLogs)
      .values({
        trigger,
        devicesCount: monitored.length,
        readingsInserted: readingsToInsert.length,
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
  const db = getDb();
  if (!db) {
    const state = getDemoState();
    const room = state.rooms.find((r) => r.id === id);
    if (!room) return null;
    Object.assign(room, input);
    return room;
  }

  await ensureSchemaInitialized(db);
  const [updated] = await db
    .update(rooms)
    .set(input)
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

export async function updateDevice(
  id: string,
  input: Partial<{
    customName: string | null;
    roomId: number | null;
    category: DeviceCategory;
    isMonitored: boolean;
    energyMode: EnergyMode;
    dpConfig: DpConfig;
  }>
): Promise<DeviceRecord | null> {
  const db = getDb();
  if (!db) {
    const state = getDemoState();
    const dev = state.devices.find((d) => d.id === id);
    if (!dev) return null;
    Object.assign(dev, input);
    if (input.dpConfig && dev.lastRawStatus) {
      const metrics = extractMetricsFromStatus(dev.lastRawStatus, dev.dpConfig);
      dev.lastPowerW = metrics.powerW;
      dev.lastVoltageV = metrics.voltageV;
      dev.lastAddEleKwh = metrics.addEleKwh;
      dev.lastTempC = metrics.tempC;
      dev.lastHumidityPct = metrics.humidityPct;
      dev.lastBatteryPct = metrics.batteryPct;
    }
    return dev;
  }

  await ensureSchemaInitialized(db);
  const existing = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
  if (existing.length === 0) return null;

  const updates: Partial<typeof devices.$inferInsert> = { ...input };
  if (input.dpConfig && existing[0].lastRawStatus) {
    const metrics = extractMetricsFromStatus(existing[0].lastRawStatus, input.dpConfig);
    updates.lastPowerW = metrics.powerW;
    updates.lastVoltageV = metrics.voltageV;
    updates.lastAddEleKwh = metrics.addEleKwh;
    updates.lastTempC = metrics.tempC;
    updates.lastHumidityPct = metrics.humidityPct;
    updates.lastBatteryPct = metrics.batteryPct;
  }

  const [updated] = await db
    .update(devices)
    .set(updates)
    .where(eq(devices.id, id))
    .returning();
  return updated ? mapDbDevice(updated) : null;
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
