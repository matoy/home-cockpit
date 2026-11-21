import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type {
  AutomationAction,
  AutomationCondition,
  AutomationEffectiveTime,
  DpConfig,
  HcSlot,
  RawDpStatus,
} from '@/types';

export const rooms = pgTable('rooms', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('Home'),
  color: text('color').notNull().default('#3b82f6'),
  targetTempMin: real('target_temp_min').default(19).notNull(),
  targetTempMax: real('target_temp_max').default(22).notNull(),
  targetHumidityMin: real('target_humidity_min').default(40).notNull(),
  targetHumidityMax: real('target_humidity_max').default(60).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const devices = pgTable('devices', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  customName: text('custom_name'),
  roomId: integer('room_id').references(() => rooms.id, { onDelete: 'set null' }),
  category: text('category').notNull().default('power'),
  tuyaCategory: text('tuya_category'),
  productName: text('product_name'),
  ipAddress: text('ip_address'),
  macAddress: text('mac_address'),
  isOnline: boolean('is_online').default(true).notNull(),
  isMonitored: boolean('is_monitored').default(true).notNull(),
  excludeFromTotals: boolean('exclude_from_totals').default(false).notNull(),
  energyMode: text('energy_mode').default('hybrid').notNull(),
  dpConfig: jsonb('dp_config').$type<DpConfig>().notNull().default({}),
  lastRawStatus: jsonb('last_raw_status').$type<RawDpStatus[]>(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  lastPowerW: real('last_power_w'),
  lastVoltageV: real('last_voltage_v'),
  lastAddEleKwh: real('last_add_ele_kwh'),
  lastTempC: real('last_temp_c'),
  lastHumidityPct: real('last_humidity_pct'),
  lastBatteryPct: real('last_battery_pct'),
  lastContactOpen: boolean('last_contact_open'),
});

export const metricReadings = pgTable(
  'metric_readings',
  {
    id: serial('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    roomId: integer('room_id').references(() => rooms.id, { onDelete: 'set null' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    powerW: real('power_w'),
    voltageV: real('voltage_v'),
    energyKwh: real('energy_kwh'),
    energySource: text('energy_source'),
    tempC: real('temp_c'),
    humidityPct: real('humidity_pct'),
    contactOpen: boolean('contact_open'),
  },
  (table) => [
    index('idx_readings_device_time').on(table.deviceId, table.recordedAt),
    index('idx_readings_room_time').on(table.roomId, table.recordedAt),
    index('idx_readings_time').on(table.recordedAt),
  ]
);

export const tariffPeriods = pgTable('tariff_periods', {
  id: serial('id').primaryKey(),
  label: text('label').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  mode: text('mode').notNull().default('BASE'),
  baseRateEur: real('base_rate_eur'),
  hpRateEur: real('hp_rate_eur'),
  hcRateEur: real('hc_rate_eur'),
  hcSlots: jsonb('hc_slots').$type<HcSlot[]>().default([]).notNull(),
  monthlySubscriptionEur: real('monthly_subscription_eur').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const collectionLogs = pgTable('collection_logs', {
  id: serial('id').primaryKey(),
  executedAt: timestamp('executed_at', { withTimezone: true }).defaultNow().notNull(),
  trigger: text('trigger').notNull(),
  devicesCount: integer('devices_count').notNull(),
  readingsInserted: integer('readings_inserted').notNull(),
  status: text('status').notNull(),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
});

export const automations = pgTable('automations', {
  id: text('id').primaryKey(),
  homeId: text('home_id'),
  name: text('name').notNull(),
  ruleType: text('rule_type').notNull().default('automation'),
  enabled: boolean('enabled').default(true).notNull(),
  matchType: text('match_type').notNull().default('any'),
  effectiveTime: jsonb('effective_time').$type<AutomationEffectiveTime | null>(),
  conditions: jsonb('conditions').$type<AutomationCondition[]>().default([]).notNull(),
  actions: jsonb('actions').$type<AutomationAction[]>().default([]).notNull(),
  rawPayload: jsonb('raw_payload'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
});
