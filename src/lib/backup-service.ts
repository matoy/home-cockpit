import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { asc, gte, and, lte, eq, notInArray, sql } from 'drizzle-orm';
import { getDb, type AppDatabase } from '@/db';
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
import { safeEqualString } from './http-utils';
import { ensureSchemaInitialized, resetSeedCheckCache } from './services/shared';
import { getDemoState, type DemoVendorConnectionState } from './demo-store';
import { contributionHtToTtc, sanitizeTariffContributions } from './tariff-engine';
import { isValidVendorId, normalizeSystems } from './vendors/registry';
import type {
  AutomationAction,
  AutomationCondition,
  AutomationEffectiveTime,
  AutomationMatchType,
  AutomationRecord,
  AutomationRuleType,
  BackupImportMode,
  BackupImportResult,
  BackupMetricsRange,
  BackupPreviewResponse,
  BackupStats,
  CollectionLogRecord,
  DeviceCategory,
  DeviceRecord,
  DeviceVendorLinkRecord,
  DpConfig,
  EnergyMode,
  EnergySource,
  HcSlot,
  MeterReadingGranularity,
  MeterReadingRecord,
  MetricReadingRecord,
  RawDpStatus,
  RoomRecord,
  TariffMode,
  TariffPeriodRecord,
  VendorId,
} from '@/types';

const BACKUP_FORMAT = 'home-cockpit-backup' as const;
const BACKUP_VERSION = 1;
const MAX_GUNZIP_BYTES = 100 * 1024 * 1024; // 100 Mo décompressés max
const METRIC_INSERT_CHUNK_SIZE = 500;

interface BackupVendorConnectionItem {
  vendor: VendorId;
  mode: string;
  status: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
  config: Record<string, unknown>;
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface BackupVendorLinkItem extends DeviceVendorLinkRecord {
  vendorMetadata?: Record<string, unknown> | null;
}

export interface BackupArchiveIntegrity {
  algorithm: 'sha256';
  dataSha256: string;
}

export interface BackupArchiveV1 {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  sourceMode: 'live' | 'demo';
  options: {
    includeMetrics: boolean;
    metricsRange: BackupMetricsRange;
    includeEncryptedSessions: boolean;
  };
  integrity?: BackupArchiveIntegrity;
  stats: BackupStats;
  data: {
    rooms: RoomRecord[];
    devices: Array<Omit<DeviceRecord, 'vendorLinks'>>;
    deviceVendorLinks: BackupVendorLinkItem[];
    tariffPeriods: TariffPeriodRecord[];
    automations: AutomationRecord[];
    vendorConnections: BackupVendorConnectionItem[];
    metricReadings: MetricReadingRecord[];
    meterReadings?: MeterReadingRecord[];
    collectionLogs: CollectionLogRecord[];
  };
}

export interface BackupExportOutput {
  buffer: Buffer;
  filename: string;
  stats: BackupStats;
  compressedBytes: number;
  uncompressedBytes: number;
  archive: BackupArchiveV1;
}

function asRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : null;
}

function toFiniteNumber(val: unknown, fallback: number): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

function toNullableNumber(val: unknown): number | null {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function toStringOrNull(val: unknown): string | null {
  return typeof val === 'string' && val.trim() !== '' ? val : null;
}

function normalizeIsoDate(val: unknown, fallbackIso?: string): string {
  if (typeof val === 'string' && val.trim()) {
    const parsed = new Date(val);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return fallbackIso ?? new Date().toISOString();
}

function normalizeIsoDateOrNull(val: unknown): string | null {
  if (typeof val === 'string' && val.trim()) {
    const parsed = new Date(val);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return null;
}

function computeMetricsCutoffDate(range: BackupMetricsRange, now: Date): Date | null {
  if (range === 'none' || range === 'all') return null;
  const days = range === '30d' ? 30 : range === '90d' ? 90 : 365;
  return new Date(now.getTime() - days * 86_400_000);
}

function computeStatsFromData(
  data: BackupArchiveV1['data']
): BackupStats {
  let minIso: string | null = null;
  let maxIso: string | null = null;
  for (const r of data.metricReadings) {
    if (!minIso || r.recordedAt < minIso) minIso = r.recordedAt;
    if (!maxIso || r.recordedAt > maxIso) maxIso = r.recordedAt;
  }
  const encryptedSessionsCount = data.vendorConnections.filter((vc) =>
    Boolean(vc.accessToken || vc.refreshToken)
  ).length;

  return {
    rooms: data.rooms.length,
    devices: data.devices.length,
    deviceVendorLinks: data.deviceVendorLinks.length,
    tariffPeriods: data.tariffPeriods.length,
    automations: data.automations.length,
    vendorConnections: data.vendorConnections.length,
    encryptedSessionsCount,
    metricReadings: data.metricReadings.length,
    collectionLogs: data.collectionLogs.length,
    metricsDateMin: minIso,
    metricsDateMax: maxIso,
  };
}

export function computeBackupDataSha256(data: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(data), 'utf8').digest('hex');
}

function sanitizeCategory(raw: unknown): DeviceCategory {
  if (raw === 'power' || raw === 'climate' || raw === 'contact' || raw === 'hybrid') {
    return raw;
  }
  return 'other';
}

function sanitizeEnergyMode(raw: unknown): EnergyMode {
  if (raw === 'add_ele' || raw === 'integration') return raw;
  return 'hybrid';
}

function sanitizeEnergySource(raw: unknown): EnergySource | null {
  if (raw === 'add_ele' || raw === 'integration') return raw;
  return null;
}

function sanitizeCoverState(
  raw: unknown
): 'open' | 'partial' | 'closed' | 'unknown' | null {
  if (raw === 'open' || raw === 'partial' || raw === 'closed' || raw === 'unknown') {
    return raw;
  }
  return null;
}

function formatBackupFilename(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    '-',
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
  ].join('');
  return `home-cockpit-backup-${stamp}.json.gz`;
}

/**
 * Exporte la configuration (pièces, appareils, liaisons, tarifs, automatisations, réglages systèmes)
 * et optionnellement les métriques historiques dans une archive JSON compressée Gzip (`.json.gz`).
 */
export async function exportBackupArchive(options?: {
  metricsRange?: BackupMetricsRange;
  includeEncryptedSessions?: boolean;
}): Promise<BackupExportOutput> {
  const metricsRange: BackupMetricsRange = options?.metricsRange ?? 'none';
  const includeMetrics = metricsRange !== 'none';
  const includeEncryptedSessions = Boolean(options?.includeEncryptedSessions);
  const now = new Date();
  const cutoff = computeMetricsCutoffDate(metricsRange, now);

  const db = getDb();
  let data: BackupArchiveV1['data'];
  let sourceMode: 'live' | 'demo';

  if (!db) {
    sourceMode = 'demo';
    const state = getDemoState();
    const cutoffIso = cutoff ? cutoff.toISOString() : null;

    const exportedReadings = includeMetrics
      ? state.readings
          .filter((r) => !cutoffIso || r.recordedAt >= cutoffIso)
          .map((r) => ({ ...r }))
      : [];

    const exportedMeterReadings: MeterReadingRecord[] = includeMetrics
      ? state.meterReadings
          .filter((r) => !cutoffIso || r.recordedAt >= cutoffIso)
          .map((r) => ({ ...r }))
      : [];

    const exportedLogs = includeMetrics
      ? state.logs
          .filter((l) => !cutoffIso || l.executedAt >= cutoffIso)
          .map((l) => ({ ...l }))
      : [];

    const exportedVendorConnections: BackupVendorConnectionItem[] = (
      Object.keys(state.vendorConnections) as VendorId[]
    ).map((vendor) => {
      const vc = state.vendorConnections[vendor];
      return {
        vendor,
        mode: vc.mode,
        status: vc.connected ? 'connected' : 'disconnected',
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        config: vc.config ? { ...vc.config } : {},
        lastSyncedAt: vc.lastSyncedAt,
        lastError: vc.lastError,
      };
    });

    data = {
      rooms: state.rooms.map((r) => ({ ...r })),
      devices: state.devices.map((d) => {
        const rest = { ...d };
        delete rest.vendorLinks;
        return rest;
      }),
      deviceVendorLinks: state.vendorLinks.map((l) => ({ ...l })),
      tariffPeriods: state.tariffs.map((t) => ({
        ...t,
        hcSlots: t.hcSlots.map((s) => ({ ...s })),
        contributions: Array.isArray(t.contributions)
          ? t.contributions.map((c) => ({ ...c }))
          : [],
      })),
      automations: state.automations.map((a) => ({ ...a })),
      vendorConnections: exportedVendorConnections,
      metricReadings: exportedReadings,
      meterReadings: exportedMeterReadings,
      collectionLogs: exportedLogs,
    };
  } else {
    sourceMode = 'live';
    await ensureSchemaInitialized(db);

    const [
      roomRows,
      deviceRows,
      linkRows,
      tariffRows,
      automationRows,
      connRows,
      readingRows,
      meterReadingRows,
      logRows,
    ] = await Promise.all([
      db.select().from(rooms).orderBy(asc(rooms.id)),
      db.select().from(devices).orderBy(asc(devices.id)),
      db.select().from(deviceVendorLinks).orderBy(asc(deviceVendorLinks.id)),
      db.select().from(tariffPeriods).orderBy(asc(tariffPeriods.startDate), asc(tariffPeriods.id)),
      db.select().from(automations).orderBy(asc(automations.id)),
      db.select().from(vendorConnections).orderBy(asc(vendorConnections.vendor)),
      includeMetrics
        ? cutoff
          ? db
              .select()
              .from(metricReadings)
              .where(gte(metricReadings.recordedAt, cutoff))
              .orderBy(asc(metricReadings.recordedAt), asc(metricReadings.id))
          : db
              .select()
              .from(metricReadings)
              .orderBy(asc(metricReadings.recordedAt), asc(metricReadings.id))
        : Promise.resolve([]),
      includeMetrics
        ? cutoff
          ? db
              .select()
              .from(meterReadings)
              .where(gte(meterReadings.recordedAt, cutoff))
              .orderBy(asc(meterReadings.recordedAt), asc(meterReadings.id))
          : db
              .select()
              .from(meterReadings)
              .orderBy(asc(meterReadings.recordedAt), asc(meterReadings.id))
        : Promise.resolve([]),
      includeMetrics
        ? cutoff
          ? db
              .select()
              .from(collectionLogs)
              .where(gte(collectionLogs.executedAt, cutoff))
              .orderBy(asc(collectionLogs.executedAt), asc(collectionLogs.id))
          : db
              .select()
              .from(collectionLogs)
              .orderBy(asc(collectionLogs.executedAt), asc(collectionLogs.id))
        : Promise.resolve([]),
    ]);

    data = {
      rooms: roomRows.map((r) => ({
        id: r.id,
        name: r.name,
        icon: r.icon,
        color: r.color,
        targetTempMin: r.targetTempMin,
        targetTempMax: r.targetTempMax,
        targetHumidityMin: r.targetHumidityMin,
        targetHumidityMax: r.targetHumidityMax,
        createdAt: r.createdAt.toISOString(),
      })),
      devices: deviceRows.map((d) => {
        const primaryVendor: VendorId = isValidVendorId(d.primaryVendor)
          ? d.primaryVendor
          : 'tuya';
        return {
          id: d.id,
          name: d.name,
          customName: d.customName,
          primaryVendor,
          systems: normalizeSystems(d.systems, primaryVendor),
          roomId: d.roomId,
          category: sanitizeCategory(d.category),
          tuyaCategory: d.tuyaCategory,
          productName: d.productName,
          ipAddress: d.ipAddress,
          macAddress: d.macAddress,
          isOnline: d.isOnline,
          isMonitored: d.isMonitored,
          ignoreOfflineAlert: d.ignoreOfflineAlert,
          excludeFromTotals: d.excludeFromTotals,
          energyMode: sanitizeEnergyMode(d.energyMode),
          dpConfig: d.dpConfig ?? {},
          lastRawStatus: d.lastRawStatus ?? null,
          lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
          lastPowerW: d.lastPowerW,
          lastVoltageV: d.lastVoltageV,
          lastAddEleKwh: d.lastAddEleKwh,
          lastTempC: d.lastTempC,
          lastHumidityPct: d.lastHumidityPct,
          lastBatteryPct: d.lastBatteryPct,
          lastContactOpen: d.lastContactOpen,
        };
      }),
      deviceVendorLinks: linkRows.map((l) => ({
        id: l.id,
        deviceId: l.deviceId,
        vendor: isValidVendorId(l.vendor) ? l.vendor : 'tuya',
        externalId: l.externalId,
        externalName: l.externalName,
        vendorMetadata: l.vendorMetadata ?? null,
        isPrimaryTelemetry: l.isPrimaryTelemetry,
        linkedAt: l.linkedAt.toISOString(),
      })),
      tariffPeriods: tariffRows.map((t) => ({
        id: t.id,
        label: t.label,
        startDate: t.startDate,
        endDate: t.endDate,
        mode: t.mode === 'TEMPO' ? 'TEMPO' : t.mode === 'HP_HC' ? 'HP_HC' : 'BASE',
        baseRateEur: t.baseRateEur,
        hpRateEur: t.hpRateEur,
        hcRateEur: t.hcRateEur,
        hcSlots: Array.isArray(t.hcSlots) ? t.hcSlots : [],
        tempoConfig: t.tempoConfig ?? null,
        monthlySubscriptionEur: t.monthlySubscriptionEur,
        vatRatePct: t.vatRatePct ?? 20,
        subscriptionVatRatePct: t.subscriptionVatRatePct ?? 20,
        exciseRateEur: t.exciseRateEur ?? 0,
        contributions: Array.isArray(t.contributions) ? t.contributions : [],
        createdAt: t.createdAt.toISOString(),
      })),
      automations: automationRows.map((a) => ({
        id: a.id,
        homeId: a.homeId,
        vendor: isValidVendorId(a.vendor) ? a.vendor : 'tuya',
        name: a.name,
        ruleType: a.ruleType === 'scene' ? 'scene' : 'automation',
        enabled: a.enabled,
        matchType:
          a.matchType === 'all' || a.matchType === 'any' || a.matchType === 'scene'
            ? (a.matchType as AutomationMatchType)
            : 'any',
        effectiveTime: a.effectiveTime ?? null,
        conditions: Array.isArray(a.conditions) ? a.conditions : [],
        actions: Array.isArray(a.actions) ? a.actions : [],
        rawPayload: a.rawPayload ?? null,
        syncedAt: a.syncedAt.toISOString(),
      })),
      vendorConnections: connRows
        .filter((vc) => isValidVendorId(vc.vendor))
        .map((vc) => ({
          vendor: vc.vendor as VendorId,
          mode: vc.mode,
          status: includeEncryptedSessions ? vc.status : vc.status === 'connected' ? 'disconnected' : vc.status,
          accessToken: includeEncryptedSessions ? vc.accessToken : null,
          refreshToken: includeEncryptedSessions ? vc.refreshToken : null,
          tokenExpiresAt:
            includeEncryptedSessions && vc.tokenExpiresAt ? vc.tokenExpiresAt.toISOString() : null,
          config: vc.config ?? {},
          lastSyncedAt: vc.lastSyncedAt ? vc.lastSyncedAt.toISOString() : null,
          lastError: vc.lastError,
        })),
      metricReadings: readingRows.map((r) => ({
        id: r.id,
        deviceId: r.deviceId,
        roomId: r.roomId,
        recordedAt: r.recordedAt.toISOString(),
        powerW: r.powerW,
        voltageV: r.voltageV,
        energyKwh: r.energyKwh,
        energySource: sanitizeEnergySource(r.energySource),
        tempC: r.tempC,
        humidityPct: r.humidityPct,
        contactOpen: r.contactOpen,
        coverState: sanitizeCoverState(r.coverState),
        coverOpenPct: r.coverOpenPct,
      })),
      meterReadings: meterReadingRows.map((m) => ({
        id: m.id,
        pointId: m.pointId,
        granularity:
          m.granularity === 'load_curve_30m' || m.granularity === 'max_power_daily'
            ? (m.granularity as MeterReadingGranularity)
            : 'daily_kwh',
        recordedAt: m.recordedAt.toISOString(),
        dateKey: m.dateKey,
        energyKwh: m.energyKwh,
        powerW: m.powerW,
      })),
      collectionLogs: logRows.map((l) => ({
        id: l.id,
        executedAt: l.executedAt.toISOString(),
        trigger: l.trigger === 'manual' ? 'manual' : 'schedule',
        devicesCount: l.devicesCount,
        readingsInserted: l.readingsInserted,
        status: l.status === 'error' ? 'error' : 'success',
        errorMessage: l.errorMessage,
        durationMs: l.durationMs,
      })),
    };
  }

  const stats = computeStatsFromData(data);
  const integrity: BackupArchiveIntegrity = {
    algorithm: 'sha256',
    dataSha256: computeBackupDataSha256(data),
  };
  const archive: BackupArchiveV1 = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    sourceMode,
    options: {
      includeMetrics,
      metricsRange,
      includeEncryptedSessions,
    },
    integrity,
    stats,
    data,
  };

  const jsonStr = JSON.stringify(archive);
  const jsonBytes = Buffer.from(jsonStr, 'utf8');
  const gzipBuffer = zlib.gzipSync(jsonBytes, { level: 9 });

  return {
    buffer: gzipBuffer,
    filename: formatBackupFilename(now),
    stats,
    compressedBytes: gzipBuffer.length,
    uncompressedBytes: jsonBytes.length,
    archive,
  };
}

/**
 * Décompresse (si Gzip) et valide un fichier d'archive `.json.gz` ou `.json`.
 */
export function parseAndValidateBackupBuffer(rawBuffer: Buffer): {
  archive: BackupArchiveV1;
  compressed: boolean;
  compressedBytes: number;
  uncompressedBytes: number;
  warnings: string[];
} {
  if (!rawBuffer || rawBuffer.length === 0) {
    throw new Error('Le fichier d’archive est vide.');
  }

  const isGzip = rawBuffer.length >= 2 && rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b;
  let uncompressedBuf: Buffer;
  try {
    uncompressedBuf = isGzip
      ? zlib.gunzipSync(rawBuffer, { maxOutputLength: MAX_GUNZIP_BYTES })
      : rawBuffer;
  } catch (err) {
    throw new Error(
      `Impossible de décompresser l’archive Gzip : ${err instanceof Error ? err.message : 'fichier corrompu ou trop volumineux'}`
    );
  }

  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(uncompressedBuf.toString('utf8'));
  } catch {
    throw new Error('Le fichier fourni n’est pas un JSON valide.');
  }

  const root = asRecord(parsedRaw);
  if (!root || root.format !== BACKUP_FORMAT) {
    throw new Error(
      'Format de sauvegarde non reconnu (attendu : format="home-cockpit-backup").'
    );
  }
  if (root.version !== BACKUP_VERSION) {
    throw new Error(
      `Version de sauvegarde non supportée (${String(root.version ?? 'inconnue')}). Attendue : v${BACKUP_VERSION}.`
    );
  }

  const dataRec = asRecord(root.data);
  if (!dataRec) {
    throw new Error('Archive invalide : section "data" manquante.');
  }

  let parsedIntegrity: BackupArchiveIntegrity | undefined;
  let missingChecksumWarning = false;
  const rawIntegrity = asRecord(root.integrity);
  if (rawIntegrity) {
    const alg = toStringOrNull(rawIntegrity.algorithm);
    const expectedHash = toStringOrNull(rawIntegrity.dataSha256);
    if (alg !== 'sha256' || !expectedHash || !/^[0-9a-f]{64}$/i.test(expectedHash)) {
      throw new Error('Empreinte d’intégrité de l’archive invalide (algorithme SHA-256 attendu).');
    }
    const actualHash = computeBackupDataSha256(root.data);
    if (!safeEqualString(actualHash.toLowerCase(), expectedHash.toLowerCase())) {
      throw new Error('Intégrité de l’archive compromise : empreinte SHA-256 invalide.');
    }
    parsedIntegrity = { algorithm: 'sha256', dataSha256: actualHash };
  } else {
    missingChecksumWarning = true;
  }

  const unknownVendors = new Set<string>();
  const trackVendor = (rawVendor: unknown) => {
    if (typeof rawVendor === 'string') {
      const trimmed = rawVendor.trim();
      if (trimmed && !isValidVendorId(trimmed)) {
        unknownVendors.add(trimmed);
      }
    }
  };

  const rawRooms = Array.isArray(dataRec.rooms) ? dataRec.rooms : [];
  const rawDevices = Array.isArray(dataRec.devices) ? dataRec.devices : [];
  const rawLinks = Array.isArray(dataRec.deviceVendorLinks) ? dataRec.deviceVendorLinks : [];
  const rawTariffs = Array.isArray(dataRec.tariffPeriods) ? dataRec.tariffPeriods : [];
  const rawAutomations = Array.isArray(dataRec.automations) ? dataRec.automations : [];
  const rawConns = Array.isArray(dataRec.vendorConnections) ? dataRec.vendorConnections : [];
  const rawReadings = Array.isArray(dataRec.metricReadings) ? dataRec.metricReadings : [];
  const rawMeterReadings = Array.isArray(dataRec.meterReadings) ? dataRec.meterReadings : [];
  const rawLogs = Array.isArray(dataRec.collectionLogs) ? dataRec.collectionLogs : [];

  const parsedRooms: RoomRecord[] = [];
  for (const item of rawRooms) {
    const rec = asRecord(item);
    const id = toNullableNumber(rec?.id);
    const name = toStringOrNull(rec?.name);
    if (!rec || id === null || !name) continue;
    parsedRooms.push({
      id: Math.trunc(id),
      name: name.trim(),
      icon: toStringOrNull(rec.icon) ?? 'Home',
      color: toStringOrNull(rec.color) ?? '#3b82f6',
      targetTempMin: toFiniteNumber(rec.targetTempMin, 19),
      targetTempMax: toFiniteNumber(rec.targetTempMax, 22),
      targetHumidityMin: toFiniteNumber(rec.targetHumidityMin, 40),
      targetHumidityMax: toFiniteNumber(rec.targetHumidityMax, 60),
      createdAt: normalizeIsoDate(rec.createdAt),
    });
  }

  const parsedDevices: Array<Omit<DeviceRecord, 'vendorLinks'>> = [];
  for (const item of rawDevices) {
    const rec = asRecord(item);
    const id = toStringOrNull(rec?.id);
    const name = toStringOrNull(rec?.name);
    if (!rec || !id || !name) continue;
    trackVendor(rec.primaryVendor);
    if (Array.isArray(rec.systems)) {
      rec.systems.forEach(trackVendor);
    }
    const primaryVendor: VendorId = isValidVendorId(rec.primaryVendor)
      ? rec.primaryVendor
      : 'tuya';
    parsedDevices.push({
      id,
      name,
      customName: toStringOrNull(rec.customName),
      primaryVendor,
      systems: normalizeSystems(rec.systems, primaryVendor),
      roomId: toNullableNumber(rec.roomId) !== null ? Math.trunc(toNullableNumber(rec.roomId)!) : null,
      category: sanitizeCategory(rec.category),
      tuyaCategory: toStringOrNull(rec.tuyaCategory),
      productName: toStringOrNull(rec.productName),
      ipAddress: toStringOrNull(rec.ipAddress),
      macAddress: toStringOrNull(rec.macAddress),
      isOnline: typeof rec.isOnline === 'boolean' ? rec.isOnline : true,
      isMonitored: typeof rec.isMonitored === 'boolean' ? rec.isMonitored : true,
      ignoreOfflineAlert:
        typeof rec.ignoreOfflineAlert === 'boolean' ? rec.ignoreOfflineAlert : false,
      excludeFromTotals: typeof rec.excludeFromTotals === 'boolean' ? rec.excludeFromTotals : false,
      energyMode: sanitizeEnergyMode(rec.energyMode),
      dpConfig: (asRecord(rec.dpConfig) as DpConfig) ?? {},
      lastRawStatus: Array.isArray(rec.lastRawStatus)
        ? (rec.lastRawStatus as RawDpStatus[])
        : null,
      lastSeenAt: normalizeIsoDateOrNull(rec.lastSeenAt),
      lastPowerW: toNullableNumber(rec.lastPowerW),
      lastVoltageV: toNullableNumber(rec.lastVoltageV),
      lastAddEleKwh: toNullableNumber(rec.lastAddEleKwh),
      lastTempC: toNullableNumber(rec.lastTempC),
      lastHumidityPct: toNullableNumber(rec.lastHumidityPct),
      lastBatteryPct: toNullableNumber(rec.lastBatteryPct),
      lastContactOpen: typeof rec.lastContactOpen === 'boolean' ? rec.lastContactOpen : null,
    });
  }

  const parsedLinks: BackupVendorLinkItem[] = [];
  for (const item of rawLinks) {
    const rec = asRecord(item);
    const deviceId = toStringOrNull(rec?.deviceId);
    const externalId = toStringOrNull(rec?.externalId);
    trackVendor(rec?.vendor);
    if (!rec || !deviceId || !externalId || !isValidVendorId(rec.vendor)) continue;
    parsedLinks.push({
      id: Math.trunc(toFiniteNumber(rec.id, parsedLinks.length + 1)),
      deviceId,
      vendor: rec.vendor,
      externalId,
      externalName: toStringOrNull(rec.externalName),
      vendorMetadata: asRecord(rec.vendorMetadata),
      isPrimaryTelemetry: typeof rec.isPrimaryTelemetry === 'boolean' ? rec.isPrimaryTelemetry : false,
      linkedAt: normalizeIsoDate(rec.linkedAt),
    });
  }

  const parsedTariffs: TariffPeriodRecord[] = [];
  for (const item of rawTariffs) {
    const rec = asRecord(item);
    const label = toStringOrNull(rec?.label);
    const startDate = toStringOrNull(rec?.startDate);
    if (!rec || !label || !startDate) continue;
    const mode: TariffMode =
      rec.mode === 'TEMPO' ? 'TEMPO' : rec.mode === 'HP_HC' ? 'HP_HC' : 'BASE';
    const slots: HcSlot[] = Array.isArray(rec.hcSlots)
      ? rec.hcSlots
          .map(asRecord)
          .filter(
            (s): s is Record<string, unknown> =>
              s !== null && typeof s.start === 'string' && typeof s.end === 'string'
          )
          .map((s) => ({ start: s.start as string, end: s.end as string }))
      : [];
    const parsedVatRatePct = toFiniteNumber(rec.vatRatePct, 20);
    const legacyExciseRateEur = toFiniteNumber(rec.exciseRateEur, 0);
    let parsedContributions = sanitizeTariffContributions(rec.contributions);
    let baseRateEur = toNullableNumber(rec.baseRateEur);
    let hpRateEur = toNullableNumber(rec.hpRateEur);
    let hcRateEur = toNullableNumber(rec.hcRateEur);
    const rawTempo = asRecord(rec.tempoConfig) as TariffPeriodRecord['tempoConfig'] | null;
    let tempoConfig: TariffPeriodRecord['tempoConfig'] = rawTempo ? { ...rawTempo } : null;
    let finalExciseRateEur = legacyExciseRateEur;

    // Rétrocompatibilité des anciennes sauvegardes : convertir exciseRateEur > 0 en ligne de contribution dédiée
    if (parsedContributions.length === 0 && legacyExciseRateEur > 0) {
      const legacyExciseTtc = contributionHtToTtc(legacyExciseRateEur, parsedVatRatePct);
      parsedContributions = [
        {
          id: 'excise',
          name: "Accise sur l'électricité",
          kind: 'per_kwh',
          amountHtEur: legacyExciseRateEur,
          vatRatePct: parsedVatRatePct,
        },
      ];
      const stripExcise = (val: number | null) =>
        val !== null ? Math.max(0, Math.round((val - legacyExciseTtc) * 1_000_000) / 1_000_000) : null;
      baseRateEur = stripExcise(baseRateEur);
      hpRateEur = stripExcise(hpRateEur);
      hcRateEur = stripExcise(hcRateEur);
      if (tempoConfig) {
        tempoConfig = {
          ...tempoConfig,
          blueHpRateEur: stripExcise(tempoConfig.blueHpRateEur) ?? 0,
          blueHcRateEur: stripExcise(tempoConfig.blueHcRateEur) ?? 0,
          whiteHpRateEur: stripExcise(tempoConfig.whiteHpRateEur) ?? 0,
          whiteHcRateEur: stripExcise(tempoConfig.whiteHcRateEur) ?? 0,
          redHpRateEur: stripExcise(tempoConfig.redHpRateEur) ?? 0,
          redHcRateEur: stripExcise(tempoConfig.redHcRateEur) ?? 0,
        };
      }
      finalExciseRateEur = 0;
    }

    parsedTariffs.push({
      id: Math.trunc(toFiniteNumber(rec.id, parsedTariffs.length + 1)),
      label,
      startDate,
      endDate: toStringOrNull(rec.endDate),
      mode,
      baseRateEur,
      hpRateEur,
      hcRateEur,
      hcSlots: slots,
      tempoConfig,
      monthlySubscriptionEur: toFiniteNumber(rec.monthlySubscriptionEur, 0),
      vatRatePct: parsedVatRatePct,
      subscriptionVatRatePct: toFiniteNumber(rec.subscriptionVatRatePct, 20),
      exciseRateEur: finalExciseRateEur,
      contributions: parsedContributions,
      createdAt: normalizeIsoDate(rec.createdAt),
    });
  }

  const parsedAutomations: AutomationRecord[] = [];
  for (const item of rawAutomations) {
    const rec = asRecord(item);
    const id = toStringOrNull(rec?.id);
    const name = toStringOrNull(rec?.name);
    if (!rec || !id || !name) continue;
    trackVendor(rec.vendor);
    const ruleType: AutomationRuleType = rec.ruleType === 'scene' ? 'scene' : 'automation';
    const matchType: AutomationMatchType =
      rec.matchType === 'all' || rec.matchType === 'any' || rec.matchType === 'manual'
        ? rec.matchType
        : 'any';
    parsedAutomations.push({
      id,
      homeId: toStringOrNull(rec.homeId),
      vendor: isValidVendorId(rec.vendor) ? rec.vendor : 'tuya',
      name,
      ruleType,
      enabled: typeof rec.enabled === 'boolean' ? rec.enabled : true,
      matchType,
      effectiveTime: (asRecord(rec.effectiveTime) as AutomationEffectiveTime | null) ?? null,
      conditions: Array.isArray(rec.conditions)
        ? (rec.conditions as AutomationCondition[])
        : [],
      actions: Array.isArray(rec.actions) ? (rec.actions as AutomationAction[]) : [],
      rawPayload: rec.rawPayload ?? null,
      syncedAt: normalizeIsoDate(rec.syncedAt),
    });
  }

  const parsedConns: BackupVendorConnectionItem[] = [];
  for (const item of rawConns) {
    const rec = asRecord(item);
    trackVendor(rec?.vendor);
    if (!rec || !isValidVendorId(rec.vendor)) continue;
    parsedConns.push({
      vendor: rec.vendor,
      mode: toStringOrNull(rec.mode) ?? 'cloud_account',
      status: toStringOrNull(rec.status) ?? 'disconnected',
      accessToken: typeof rec.accessToken === 'string' ? rec.accessToken : null,
      refreshToken: typeof rec.refreshToken === 'string' ? rec.refreshToken : null,
      tokenExpiresAt: normalizeIsoDateOrNull(rec.tokenExpiresAt),
      config: asRecord(rec.config) ?? {},
      lastSyncedAt: normalizeIsoDateOrNull(rec.lastSyncedAt),
      lastError: toStringOrNull(rec.lastError),
    });
  }

  const parsedReadings: MetricReadingRecord[] = [];
  for (const item of rawReadings) {
    const rec = asRecord(item);
    const deviceId = toStringOrNull(rec?.deviceId);
    const recordedAt = normalizeIsoDateOrNull(rec?.recordedAt);
    if (!rec || !deviceId || !recordedAt) continue;
    parsedReadings.push({
      id: Math.trunc(toFiniteNumber(rec.id, parsedReadings.length + 1)),
      deviceId,
      roomId: toNullableNumber(rec.roomId) !== null ? Math.trunc(toNullableNumber(rec.roomId)!) : null,
      recordedAt,
      powerW: toNullableNumber(rec.powerW),
      voltageV: toNullableNumber(rec.voltageV),
      energyKwh: toNullableNumber(rec.energyKwh),
      energySource: sanitizeEnergySource(rec.energySource),
      tempC: toNullableNumber(rec.tempC),
      humidityPct: toNullableNumber(rec.humidityPct),
      contactOpen: typeof rec.contactOpen === 'boolean' ? rec.contactOpen : null,
      coverState: sanitizeCoverState(rec.coverState),
      coverOpenPct: toNullableNumber(rec.coverOpenPct),
    });
  }

  const parsedMeterReadings: MeterReadingRecord[] = [];
  for (const item of rawMeterReadings) {
    const rec = asRecord(item);
    const pointId = toStringOrNull(rec?.pointId);
    const recordedAt = normalizeIsoDateOrNull(rec?.recordedAt);
    const dateKey = toStringOrNull(rec?.dateKey);
    if (!rec || !pointId || !recordedAt || !dateKey) continue;
    const rawGran = toStringOrNull(rec.granularity);
    const granularity: MeterReadingGranularity =
      rawGran === 'load_curve_30m' || rawGran === 'max_power_daily' ? rawGran : 'daily_kwh';
    parsedMeterReadings.push({
      id: Math.trunc(toFiniteNumber(rec.id, parsedMeterReadings.length + 1)),
      pointId,
      granularity,
      recordedAt,
      dateKey,
      energyKwh: toNullableNumber(rec.energyKwh),
      powerW: toNullableNumber(rec.powerW),
    });
  }

  const parsedLogs: CollectionLogRecord[] = [];
  for (const item of rawLogs) {
    const rec = asRecord(item);
    const executedAt = normalizeIsoDateOrNull(rec?.executedAt);
    if (!rec || !executedAt) continue;
    parsedLogs.push({
      id: Math.trunc(toFiniteNumber(rec.id, parsedLogs.length + 1)),
      executedAt,
      trigger: rec.trigger === 'manual' ? 'manual' : 'schedule',
      devicesCount: Math.max(0, Math.trunc(toFiniteNumber(rec.devicesCount, 0))),
      readingsInserted: Math.max(0, Math.trunc(toFiniteNumber(rec.readingsInserted, 0))),
      status: rec.status === 'error' ? 'error' : 'success',
      errorMessage: toStringOrNull(rec.errorMessage),
      durationMs: toNullableNumber(rec.durationMs) !== null ? Math.trunc(toNullableNumber(rec.durationMs)!) : null,
    });
  }

  const data: BackupArchiveV1['data'] = {
    rooms: parsedRooms,
    devices: parsedDevices,
    deviceVendorLinks: parsedLinks,
    tariffPeriods: parsedTariffs,
    automations: parsedAutomations,
    vendorConnections: parsedConns,
    metricReadings: parsedReadings,
    ...(parsedMeterReadings.length > 0 ? { meterReadings: parsedMeterReadings } : {}),
    collectionLogs: parsedLogs,
  };

  const stats = computeStatsFromData(data);
  const optRec = asRecord(root.options);
  const rawRange = optRec?.metricsRange;
  const metricsRange: BackupMetricsRange =
    rawRange === 'none' ||
    rawRange === '30d' ||
    rawRange === '90d' ||
    rawRange === '365d' ||
    rawRange === 'all'
      ? rawRange
      : stats.metricReadings > 0
        ? 'all'
        : 'none';

  const archive: BackupArchiveV1 = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: normalizeIsoDate(root.exportedAt),
    sourceMode: root.sourceMode === 'live' ? 'live' : 'demo',
    options: {
      includeMetrics: stats.metricReadings > 0,
      metricsRange,
      includeEncryptedSessions: stats.encryptedSessionsCount > 0,
    },
    ...(parsedIntegrity ? { integrity: parsedIntegrity } : {}),
    stats,
    data,
  };

  const warnings: string[] = [];
  if (missingChecksumWarning) {
    warnings.push(
      'Archive sans empreinte SHA-256 (format hérité) : intégrité des données non vérifiée cryptographiquement.'
    );
  }
  if (unknownVendors.size > 0) {
    warnings.push(
      `${unknownVendors.size} fournisseur(s) non reconnu(s) sur cette instance (${Array.from(unknownVendors).join(', ')}) : certaines liaisons ou connexions seront ignorées.`
    );
  }
  if (stats.encryptedSessionsCount > 0) {
    warnings.push(
      `Cette archive contient ${stats.encryptedSessionsCount} session(s) chiffrée(s) (AES-256-GCM). La restauration de ces jetons nécessite la même TOKEN_ENCRYPTION_KEY / APP_PASSWORD.`
    );
  }
  if (stats.metricReadings === 0) {
    warnings.push('Archive de configuration uniquement (0 relevé métrique inclus).');
  }

  return {
    archive,
    compressed: isGzip,
    compressedBytes: rawBuffer.length,
    uncompressedBytes: uncompressedBuf.length,
    warnings,
  };
}

/**
 * Analyse une archive avant import (dry-run) et compare avec les compteurs actuels.
 */
export async function previewBackupArchive(rawBuffer: Buffer): Promise<BackupPreviewResponse> {
  const parsed = parseAndValidateBackupBuffer(rawBuffer);
  const db = getDb();

  let currentStats: BackupPreviewResponse['currentStats'];
  if (!db) {
    const state = getDemoState();
    currentStats = {
      rooms: state.rooms.length,
      devices: state.devices.length,
      deviceVendorLinks: state.vendorLinks.length,
      tariffPeriods: state.tariffs.length,
      automations: state.automations.length,
      metricReadings: state.readings.length,
    };
  } else {
    await ensureSchemaInitialized(db);
    const [rCnt, dCnt, lCnt, tCnt, aCnt, mCnt] = await Promise.all([
      db.select({ c: sql<number>`count(*)::int` }).from(rooms),
      db.select({ c: sql<number>`count(*)::int` }).from(devices),
      db.select({ c: sql<number>`count(*)::int` }).from(deviceVendorLinks),
      db.select({ c: sql<number>`count(*)::int` }).from(tariffPeriods),
      db.select({ c: sql<number>`count(*)::int` }).from(automations),
      db.select({ c: sql<number>`count(*)::int` }).from(metricReadings),
    ]);
    currentStats = {
      rooms: Number(rCnt[0]?.c ?? 0),
      devices: Number(dCnt[0]?.c ?? 0),
      deviceVendorLinks: Number(lCnt[0]?.c ?? 0),
      tariffPeriods: Number(tCnt[0]?.c ?? 0),
      automations: Number(aCnt[0]?.c ?? 0),
      metricReadings: Number(mCnt[0]?.c ?? 0),
    };
  }

  return {
    format: parsed.archive.format,
    version: parsed.archive.version,
    exportedAt: parsed.archive.exportedAt,
    sourceMode: parsed.archive.sourceMode,
    compressed: parsed.compressed,
    compressedBytes: parsed.compressedBytes,
    uncompressedBytes: parsed.uncompressedBytes,
    options: parsed.archive.options,
    stats: parsed.archive.stats,
    currentStats,
    warnings: parsed.warnings,
  };
}

async function resetPostgresSequences(db: AppDatabase): Promise<void> {
  const targets = [
    ['rooms', 'id'],
    ['device_vendor_links', 'id'],
    ['tariff_periods', 'id'],
    ['metric_readings', 'id'],
    ['meter_readings', 'id'],
    ['collection_logs', 'id'],
  ] as const;

  for (const [table, col] of targets) {
    await db.execute(
      sql.raw(
        `SELECT setval(pg_get_serial_sequence('${table}', '${col}'), COALESCE((SELECT MAX("${col}") FROM "${table}"), 1), (SELECT COUNT(*) > 0 FROM "${table}"))`
      )
    );
  }
}

function mapConnectionModeToDemo(mode: string): DemoVendorConnectionState['mode'] {
  if (
    mode === 'cloud_key' ||
    mode === 'cloud_account' ||
    mode === 'oauth_prod' ||
    mode === 'oauth_simulator' ||
    mode === 'oauth_cn' ||
    mode === 'bearer_token' ||
    mode === 'mcp' ||
    mode === 'sdm'
  ) {
    return mode;
  }
  return 'cloud_account';
}

/**
 * Restaure une archive `.json.gz` / `.json` dans Neon Postgres ou dans le store Démo en mémoire.
 */
export async function importBackupArchive(
  rawBuffer: Buffer,
  options?: {
    mode?: BackupImportMode;
    importMetrics?: boolean;
    importEncryptedSessions?: boolean;
  }
): Promise<BackupImportResult> {
  const mode: BackupImportMode = options?.mode === 'replace' ? 'replace' : 'merge';
  const parsed = parseAndValidateBackupBuffer(rawBuffer);
  const { archive } = parsed;
  const importMetrics =
    options?.importMetrics !== undefined
      ? Boolean(options.importMetrics)
      : archive.data.metricReadings.length > 0;
  const importEncryptedSessions = Boolean(options?.importEncryptedSessions);

  const imported = {
    rooms: 0,
    devices: 0,
    deviceVendorLinks: 0,
    tariffPeriods: 0,
    automations: 0,
    vendorConnections: 0,
    metricReadings: 0,
    collectionLogs: 0,
  };
  let skippedMetricsDuplicates = 0;

  const db = getDb();

  // ---------- MODE DÉMO (En mémoire) ----------
  if (!db) {
    const state = getDemoState();

    if (mode === 'replace') {
      state.rooms = archive.data.rooms.map((r) => ({ ...r }));
      imported.rooms = state.rooms.length;

      const validRoomIds = new Set(state.rooms.map((r) => r.id));
      state.devices = archive.data.devices.map((d) => ({
        ...d,
        roomId: d.roomId !== null && validRoomIds.has(d.roomId) ? d.roomId : null,
      }));
      imported.devices = state.devices.length;

      const validDeviceIds = new Set(state.devices.map((d) => d.id));
      state.vendorLinks = archive.data.deviceVendorLinks
        .filter((l) => validDeviceIds.has(l.deviceId))
        .map((l) => ({
          id: l.id,
          deviceId: l.deviceId,
          vendor: l.vendor,
          externalId: l.externalId,
          externalName: l.externalName,
          isPrimaryTelemetry: l.isPrimaryTelemetry,
          linkedAt: l.linkedAt,
        }));
      imported.deviceVendorLinks = state.vendorLinks.length;

      for (const dev of state.devices) {
        dev.vendorLinks = state.vendorLinks.filter((l) => l.deviceId === dev.id);
      }

      state.tariffs = archive.data.tariffPeriods.map((t) => ({
        ...t,
        hcSlots: t.hcSlots.map((s) => ({ ...s })),
        contributions: Array.isArray(t.contributions)
          ? t.contributions.map((c) => ({ ...c }))
          : [],
      }));
      imported.tariffPeriods = state.tariffs.length;

      state.automations = archive.data.automations.map((a) => ({ ...a }));
      imported.automations = state.automations.length;

      for (const vc of archive.data.vendorConnections) {
        state.vendorConnections[vc.vendor] = {
          mode: mapConnectionModeToDemo(vc.mode),
          connected: vc.status === 'connected',
          config: vc.config ? { ...vc.config } : {},
          lastSyncedAt: vc.lastSyncedAt,
          lastError: vc.lastError,
        };
        imported.vendorConnections++;
      }

      if (importMetrics) {
        state.readings = archive.data.metricReadings
          .filter((r) => validDeviceIds.has(r.deviceId))
          .map((r) => ({
            ...r,
            roomId: r.roomId !== null && validRoomIds.has(r.roomId) ? r.roomId : null,
          }));
        imported.metricReadings = state.readings.length;

        if (archive.data.meterReadings) {
          state.meterReadings = archive.data.meterReadings.map((m) => ({ ...m }));
        } else {
          state.meterReadings = [];
        }

        state.logs = archive.data.collectionLogs.map((l) => ({ ...l }));
        imported.collectionLogs = state.logs.length;
      } else {
        // Conserver uniquement les relevés rattachés aux appareils conservés
        state.readings = state.readings.filter((r) => validDeviceIds.has(r.deviceId));
      }

      state.nextRoomId =
        state.rooms.reduce((m, r) => Math.max(m, r.id), 0) + 1;
      state.nextLinkId =
        state.vendorLinks.reduce((m, l) => Math.max(m, l.id), 0) + 1;
      state.nextTariffId =
        state.tariffs.reduce((m, t) => Math.max(m, t.id), 0) + 1;
      state.nextReadingId =
        state.readings.reduce((m, r) => Math.max(m, r.id), 0) + 1;
      state.nextLogId =
        state.logs.reduce((m, l) => Math.max(m, l.id), 0) + 1;
    } else {
      // mode === 'merge' (Upsert)
      const roomIdMap = new Map<number, number>();
      const roomById = new Map(state.rooms.map((r) => [r.id, r]));
      const roomByName = new Map(state.rooms.map((r) => [r.name.trim().toLowerCase(), r]));

      for (const r of archive.data.rooms) {
        const match = roomById.get(r.id) ?? roomByName.get(r.name.trim().toLowerCase());
        if (match) {
          match.name = r.name;
          match.icon = r.icon;
          match.color = r.color;
          match.targetTempMin = r.targetTempMin;
          match.targetTempMax = r.targetTempMax;
          match.targetHumidityMin = r.targetHumidityMin;
          match.targetHumidityMax = r.targetHumidityMax;
          roomIdMap.set(r.id, match.id);
        } else {
          const newId = roomById.has(r.id) ? state.nextRoomId++ : r.id;
          if (newId >= state.nextRoomId) state.nextRoomId = newId + 1;
          const created: RoomRecord = { ...r, id: newId };
          state.rooms.push(created);
          roomById.set(created.id, created);
          roomByName.set(created.name.trim().toLowerCase(), created);
          roomIdMap.set(r.id, created.id);
        }
        imported.rooms++;
      }

      const devById = new Map(state.devices.map((d) => [d.id, d]));
      for (const d of archive.data.devices) {
        const mappedRoomId =
          d.roomId !== null ? (roomIdMap.get(d.roomId) ?? (roomById.has(d.roomId) ? d.roomId : null)) : null;
        const existing = devById.get(d.id);
        if (existing) {
          Object.assign(existing, { ...d, roomId: mappedRoomId });
        } else {
          const inserted: DeviceRecord = { ...d, roomId: mappedRoomId, vendorLinks: [] };
          state.devices.push(inserted);
          devById.set(inserted.id, inserted);
        }
        imported.devices++;
      }

      const validDeviceIds = new Set(state.devices.map((d) => d.id));
      for (const l of archive.data.deviceVendorLinks) {
        if (!validDeviceIds.has(l.deviceId)) continue;
        const existing = state.vendorLinks.find(
          (cur) => cur.vendor === l.vendor && cur.externalId === l.externalId
        );
        if (existing) {
          existing.deviceId = l.deviceId;
          existing.externalName = l.externalName;
          existing.isPrimaryTelemetry = l.isPrimaryTelemetry;
        } else {
          state.vendorLinks.push({
            id: state.nextLinkId++,
            deviceId: l.deviceId,
            vendor: l.vendor,
            externalId: l.externalId,
            externalName: l.externalName,
            isPrimaryTelemetry: l.isPrimaryTelemetry,
            linkedAt: l.linkedAt,
          });
        }
        imported.deviceVendorLinks++;
      }

      for (const dev of state.devices) {
        dev.vendorLinks = state.vendorLinks.filter((l) => l.deviceId === dev.id);
      }

      for (const t of archive.data.tariffPeriods) {
        const existing = state.tariffs.find(
          (cur) =>
            cur.startDate === t.startDate &&
            cur.mode === t.mode &&
            cur.label.trim().toLowerCase() === t.label.trim().toLowerCase()
        );
        if (existing) {
          Object.assign(existing, {
            ...t,
            id: existing.id,
            hcSlots: t.hcSlots.map((s) => ({ ...s })),
            contributions: Array.isArray(t.contributions)
              ? t.contributions.map((c) => ({ ...c }))
              : [],
          });
        } else {
          state.tariffs.push({
            ...t,
            id: state.nextTariffId++,
            hcSlots: t.hcSlots.map((s) => ({ ...s })),
            contributions: Array.isArray(t.contributions)
              ? t.contributions.map((c) => ({ ...c }))
              : [],
          });
        }
        imported.tariffPeriods++;
      }

      for (const a of archive.data.automations) {
        const existing = state.automations.find((cur) => cur.id === a.id);
        if (existing) {
          Object.assign(existing, { ...a });
        } else {
          state.automations.push({ ...a });
        }
        imported.automations++;
      }

      for (const vc of archive.data.vendorConnections) {
        const prev = state.vendorConnections[vc.vendor];
        state.vendorConnections[vc.vendor] = {
          mode: mapConnectionModeToDemo(vc.mode),
          connected: prev ? prev.connected || vc.status === 'connected' : vc.status === 'connected',
          config: vc.config && Object.keys(vc.config).length > 0 ? { ...vc.config } : prev?.config ?? {},
          lastSyncedAt: vc.lastSyncedAt ?? prev?.lastSyncedAt ?? null,
          lastError: vc.lastError,
        };
        imported.vendorConnections++;
      }

      if (importMetrics && archive.data.metricReadings.length > 0) {
        const existingKeys = new Set(
          state.readings.map((r) => `${r.deviceId}::${normalizeIsoDate(r.recordedAt)}`)
        );
        for (const r of archive.data.metricReadings) {
          if (!validDeviceIds.has(r.deviceId)) continue;
          const iso = normalizeIsoDate(r.recordedAt);
          const key = `${r.deviceId}::${iso}`;
          if (existingKeys.has(key)) {
            skippedMetricsDuplicates++;
            continue;
          }
          existingKeys.add(key);
          const mappedRoomId =
            r.roomId !== null ? (roomIdMap.get(r.roomId) ?? (roomById.has(r.roomId) ? r.roomId : null)) : null;
          state.readings.push({
            ...r,
            id: state.nextReadingId++,
            roomId: mappedRoomId,
            recordedAt: iso,
          });
          imported.metricReadings++;
        }

        const existingLogKeys = new Set(
          state.logs.map((l) => `${normalizeIsoDate(l.executedAt)}::${l.trigger}`)
        );
        for (const l of archive.data.collectionLogs) {
          const iso = normalizeIsoDate(l.executedAt);
          const key = `${iso}::${l.trigger}`;
          if (existingLogKeys.has(key)) continue;
          existingLogKeys.add(key);
          state.logs.push({ ...l, id: state.nextLogId++, executedAt: iso });
          imported.collectionLogs++;
        }

        if (archive.data.meterReadings && archive.data.meterReadings.length > 0) {
          const existingMeterKeys = new Set(
            state.meterReadings.map(
              (m) => `${m.pointId}::${m.granularity}::${normalizeIsoDate(m.recordedAt)}`
            )
          );
          for (const m of archive.data.meterReadings) {
            const iso = normalizeIsoDate(m.recordedAt);
            const key = `${m.pointId}::${m.granularity}::${iso}`;
            if (existingMeterKeys.has(key)) continue;
            existingMeterKeys.add(key);
            state.meterReadings.push({ ...m, id: state.nextMeterReadingId++, recordedAt: iso });
          }
        }
      }
    }

    return {
      mode,
      targetMode: 'demo',
      imported,
      skippedMetricsDuplicates,
      warnings: parsed.warnings,
      message:
        mode === 'replace'
          ? `Restauration complète (mode Démo) : ${imported.rooms} pièce(s), ${imported.devices} appareil(s), ${imported.deviceVendorLinks} liaison(s), ${imported.metricReadings} métrique(s).`
          : `Import fusionné (mode Démo) : ${imported.rooms} pièce(s), ${imported.devices} appareil(s), ${imported.deviceVendorLinks} liaison(s), ${imported.metricReadings} métrique(s) ajoutée(s).`,
    };
  }

  // ---------- MODE POSTGRES (Neon HTTP) ----------
  await ensureSchemaInitialized(db);

  if (mode === 'replace') {
    await db.delete(deviceVendorLinks);
    await db.delete(automations);
    await db.delete(tariffPeriods);
    if (importMetrics) {
      await db.delete(metricReadings);
      await db.delete(meterReadings);
      await db.delete(collectionLogs);
    }

    const keepRoomIds = archive.data.rooms.map((r) => r.id);
    if (keepRoomIds.length > 0) {
      await db.delete(rooms).where(notInArray(rooms.id, keepRoomIds));
    } else {
      await db.delete(rooms);
    }

    for (const r of archive.data.rooms) {
      await db
        .insert(rooms)
        .values({
          id: r.id,
          name: r.name,
          icon: r.icon,
          color: r.color,
          targetTempMin: r.targetTempMin,
          targetTempMax: r.targetTempMax,
          targetHumidityMin: r.targetHumidityMin,
          targetHumidityMax: r.targetHumidityMax,
          createdAt: new Date(r.createdAt),
        })
        .onConflictDoUpdate({
          target: rooms.id,
          set: {
            name: r.name,
            icon: r.icon,
            color: r.color,
            targetTempMin: r.targetTempMin,
            targetTempMax: r.targetTempMax,
            targetHumidityMin: r.targetHumidityMin,
            targetHumidityMax: r.targetHumidityMax,
          },
        });
      imported.rooms++;
    }

    const keepDeviceIds = archive.data.devices.map((d) => d.id);
    if (keepDeviceIds.length > 0) {
      await db.delete(devices).where(notInArray(devices.id, keepDeviceIds));
    } else {
      await db.delete(devices);
    }

    const validRoomIds = new Set(keepRoomIds);
    for (const d of archive.data.devices) {
      const targetRoomId = d.roomId !== null && validRoomIds.has(d.roomId) ? d.roomId : null;
      await db
        .insert(devices)
        .values({
          id: d.id,
          name: d.name,
          customName: d.customName,
          primaryVendor: d.primaryVendor,
          systems: d.systems,
          roomId: targetRoomId,
          category: d.category,
          tuyaCategory: d.tuyaCategory,
          productName: d.productName,
          ipAddress: d.ipAddress,
          macAddress: d.macAddress,
          isOnline: d.isOnline,
          isMonitored: d.isMonitored,
          ignoreOfflineAlert: d.ignoreOfflineAlert,
          excludeFromTotals: d.excludeFromTotals,
          energyMode: d.energyMode,
          dpConfig: d.dpConfig,
          lastRawStatus: d.lastRawStatus,
          lastSeenAt: d.lastSeenAt ? new Date(d.lastSeenAt) : null,
          lastPowerW: d.lastPowerW,
          lastVoltageV: d.lastVoltageV,
          lastAddEleKwh: d.lastAddEleKwh,
          lastTempC: d.lastTempC,
          lastHumidityPct: d.lastHumidityPct,
          lastBatteryPct: d.lastBatteryPct,
          lastContactOpen: d.lastContactOpen,
        })
        .onConflictDoUpdate({
          target: devices.id,
          set: {
            name: d.name,
            customName: d.customName,
            primaryVendor: d.primaryVendor,
            systems: d.systems,
            roomId: targetRoomId,
            category: d.category,
            tuyaCategory: d.tuyaCategory,
            productName: d.productName,
            ipAddress: d.ipAddress,
            macAddress: d.macAddress,
            isOnline: d.isOnline,
            isMonitored: d.isMonitored,
            ignoreOfflineAlert: d.ignoreOfflineAlert ?? false,
            excludeFromTotals: d.excludeFromTotals,
            energyMode: d.energyMode,
            dpConfig: d.dpConfig,
            lastRawStatus: d.lastRawStatus,
            lastSeenAt: d.lastSeenAt ? new Date(d.lastSeenAt) : null,
            lastPowerW: d.lastPowerW,
            lastVoltageV: d.lastVoltageV,
            lastAddEleKwh: d.lastAddEleKwh,
            lastTempC: d.lastTempC,
            lastHumidityPct: d.lastHumidityPct,
            lastBatteryPct: d.lastBatteryPct,
            lastContactOpen: d.lastContactOpen,
          },
        });
      imported.devices++;
    }

    const validDeviceIds = new Set(keepDeviceIds);
    for (const l of archive.data.deviceVendorLinks) {
      if (!validDeviceIds.has(l.deviceId)) continue;
      await db
        .insert(deviceVendorLinks)
        .values({
          deviceId: l.deviceId,
          vendor: l.vendor,
          externalId: l.externalId,
          externalName: l.externalName,
          vendorMetadata: l.vendorMetadata ?? null,
          isPrimaryTelemetry: l.isPrimaryTelemetry,
          linkedAt: new Date(l.linkedAt),
        })
        .onConflictDoNothing();
      imported.deviceVendorLinks++;
    }

    for (const t of archive.data.tariffPeriods) {
      await db.insert(tariffPeriods).values({
        label: t.label,
        startDate: t.startDate,
        endDate: t.endDate,
        mode: t.mode,
        baseRateEur: t.baseRateEur,
        hpRateEur: t.hpRateEur,
        hcRateEur: t.hcRateEur,
        hcSlots: t.hcSlots,
        tempoConfig: t.tempoConfig ?? null,
        monthlySubscriptionEur: t.monthlySubscriptionEur,
        vatRatePct: t.vatRatePct ?? 20,
        subscriptionVatRatePct: t.subscriptionVatRatePct ?? 20,
        exciseRateEur: t.exciseRateEur ?? 0,
        contributions: Array.isArray(t.contributions) ? t.contributions : [],
        createdAt: new Date(t.createdAt),
      });
      imported.tariffPeriods++;
    }

    for (const a of archive.data.automations) {
      await db
        .insert(automations)
        .values({
          id: a.id,
          homeId: a.homeId,
          vendor: a.vendor,
          name: a.name,
          ruleType: a.ruleType,
          enabled: a.enabled,
          matchType: a.matchType,
          effectiveTime: a.effectiveTime,
          conditions: a.conditions,
          actions: a.actions,
          rawPayload: a.rawPayload,
          syncedAt: new Date(a.syncedAt),
        })
        .onConflictDoUpdate({
          target: automations.id,
          set: {
            homeId: a.homeId,
            vendor: a.vendor,
            name: a.name,
            ruleType: a.ruleType,
            enabled: a.enabled,
            matchType: a.matchType,
            effectiveTime: a.effectiveTime,
            conditions: a.conditions,
            actions: a.actions,
            rawPayload: a.rawPayload,
            syncedAt: new Date(a.syncedAt),
          },
        });
      imported.automations++;
    }

    if (importEncryptedSessions) {
      await db.delete(vendorConnections);
    }
    for (const vc of archive.data.vendorConnections) {
      const hasTokenInArchive = importEncryptedSessions && Boolean(vc.accessToken || vc.refreshToken);
      await db
        .insert(vendorConnections)
        .values({
          vendor: vc.vendor,
          mode: vc.mode,
          status: hasTokenInArchive ? vc.status : 'disconnected',
          accessToken: hasTokenInArchive ? vc.accessToken : null,
          refreshToken: hasTokenInArchive ? vc.refreshToken : null,
          tokenExpiresAt:
            hasTokenInArchive && vc.tokenExpiresAt ? new Date(vc.tokenExpiresAt) : null,
          config: vc.config,
          lastSyncedAt: vc.lastSyncedAt ? new Date(vc.lastSyncedAt) : null,
          lastError: vc.lastError,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: vendorConnections.vendor,
          set: {
            mode: vc.mode,
            config: vc.config,
            ...(hasTokenInArchive
              ? {
                  status: vc.status,
                  accessToken: vc.accessToken,
                  refreshToken: vc.refreshToken,
                  tokenExpiresAt: vc.tokenExpiresAt ? new Date(vc.tokenExpiresAt) : null,
                }
              : {}),
            lastSyncedAt: vc.lastSyncedAt ? new Date(vc.lastSyncedAt) : null,
            lastError: vc.lastError,
            updatedAt: new Date(),
          },
        });
      imported.vendorConnections++;
    }

    if (importMetrics && archive.data.metricReadings.length > 0) {
      const rows = archive.data.metricReadings
        .filter((r) => validDeviceIds.has(r.deviceId))
        .map((r) => ({
          deviceId: r.deviceId,
          roomId: r.roomId !== null && validRoomIds.has(r.roomId) ? r.roomId : null,
          recordedAt: new Date(r.recordedAt),
          powerW: r.powerW,
          voltageV: r.voltageV,
          energyKwh: r.energyKwh,
          energySource: r.energySource,
          tempC: r.tempC,
          humidityPct: r.humidityPct,
          contactOpen: r.contactOpen,
          coverState: r.coverState ?? null,
          coverOpenPct: r.coverOpenPct ?? null,
        }));

      for (let i = 0; i < rows.length; i += METRIC_INSERT_CHUNK_SIZE) {
        const chunk = rows.slice(i, i + METRIC_INSERT_CHUNK_SIZE);
        await db.insert(metricReadings).values(chunk);
        imported.metricReadings += chunk.length;
      }

      const logValues = archive.data.collectionLogs.map((l) => ({
        executedAt: new Date(l.executedAt),
        trigger: l.trigger,
        devicesCount: l.devicesCount,
        readingsInserted: l.readingsInserted,
        status: l.status,
        errorMessage: l.errorMessage,
        durationMs: l.durationMs,
      }));
      for (let i = 0; i < logValues.length; i += METRIC_INSERT_CHUNK_SIZE) {
        const chunk = logValues.slice(i, i + METRIC_INSERT_CHUNK_SIZE);
        await db.insert(collectionLogs).values(chunk);
        imported.collectionLogs += chunk.length;
      }
    }

    if (importMetrics && archive.data.meterReadings && archive.data.meterReadings.length > 0) {
      const meterValues = archive.data.meterReadings.map((m) => ({
        pointId: m.pointId,
        granularity: m.granularity,
        recordedAt: new Date(m.recordedAt),
        dateKey: m.dateKey,
        energyKwh: m.energyKwh,
        powerW: m.powerW,
      }));
      for (let i = 0; i < meterValues.length; i += METRIC_INSERT_CHUNK_SIZE) {
        const chunk = meterValues.slice(i, i + METRIC_INSERT_CHUNK_SIZE);
        await db
          .insert(meterReadings)
          .values(chunk)
          .onConflictDoUpdate({
            target: [meterReadings.pointId, meterReadings.granularity, meterReadings.recordedAt],
            set: {
              dateKey: sql`excluded.date_key`,
              energyKwh: sql`excluded.energy_kwh`,
              powerW: sql`excluded.power_w`,
            },
          });
      }
    }

    await resetPostgresSequences(db);
    resetSeedCheckCache();
  } else {
    // mode === 'merge' (Upsert)
    const existingRooms = await db.select().from(rooms);
    const roomById = new Map(existingRooms.map((r) => [r.id, r]));
    const roomByName = new Map(existingRooms.map((r) => [r.name.trim().toLowerCase(), r]));
    const roomIdMap = new Map<number, number>();

    for (const r of archive.data.rooms) {
      const match = roomById.get(r.id) ?? roomByName.get(r.name.trim().toLowerCase());
      if (match) {
        await db
          .update(rooms)
          .set({
            name: r.name,
            icon: r.icon,
            color: r.color,
            targetTempMin: r.targetTempMin,
            targetTempMax: r.targetTempMax,
            targetHumidityMin: r.targetHumidityMin,
            targetHumidityMax: r.targetHumidityMax,
          })
          .where(eq(rooms.id, match.id));
        roomIdMap.set(r.id, match.id);
      } else {
        const canPreserveId = !roomById.has(r.id);
        const [inserted] = await db
          .insert(rooms)
          .values({
            ...(canPreserveId ? { id: r.id } : {}),
            name: r.name,
            icon: r.icon,
            color: r.color,
            targetTempMin: r.targetTempMin,
            targetTempMax: r.targetTempMax,
            targetHumidityMin: r.targetHumidityMin,
            targetHumidityMax: r.targetHumidityMax,
            createdAt: new Date(r.createdAt),
          })
          .returning();
        roomById.set(inserted.id, inserted);
        roomByName.set(inserted.name.trim().toLowerCase(), inserted);
        roomIdMap.set(r.id, inserted.id);
      }
      imported.rooms++;
    }

    for (const d of archive.data.devices) {
      const mappedRoomId =
        d.roomId !== null ? (roomIdMap.get(d.roomId) ?? (roomById.has(d.roomId) ? d.roomId : null)) : null;
      await db
        .insert(devices)
        .values({
          id: d.id,
          name: d.name,
          customName: d.customName,
          primaryVendor: d.primaryVendor,
          systems: d.systems,
          roomId: mappedRoomId,
          category: d.category,
          tuyaCategory: d.tuyaCategory,
          productName: d.productName,
          ipAddress: d.ipAddress,
          macAddress: d.macAddress,
          isOnline: d.isOnline,
          isMonitored: d.isMonitored,
          ignoreOfflineAlert: d.ignoreOfflineAlert,
          excludeFromTotals: d.excludeFromTotals,
          energyMode: d.energyMode,
          dpConfig: d.dpConfig,
          lastRawStatus: d.lastRawStatus,
          lastSeenAt: d.lastSeenAt ? new Date(d.lastSeenAt) : null,
          lastPowerW: d.lastPowerW,
          lastVoltageV: d.lastVoltageV,
          lastAddEleKwh: d.lastAddEleKwh,
          lastTempC: d.lastTempC,
          lastHumidityPct: d.lastHumidityPct,
          lastBatteryPct: d.lastBatteryPct,
          lastContactOpen: d.lastContactOpen,
        })
        .onConflictDoUpdate({
          target: devices.id,
          set: {
            name: d.name,
            customName: d.customName,
            primaryVendor: d.primaryVendor,
            systems: d.systems,
            roomId: mappedRoomId,
            category: d.category,
            tuyaCategory: d.tuyaCategory,
            productName: d.productName,
            ipAddress: d.ipAddress,
            macAddress: d.macAddress,
            isOnline: d.isOnline,
            isMonitored: d.isMonitored,
            ignoreOfflineAlert: d.ignoreOfflineAlert ?? false,
            excludeFromTotals: d.excludeFromTotals,
            energyMode: d.energyMode,
            dpConfig: d.dpConfig,
            lastRawStatus: d.lastRawStatus,
            lastSeenAt: d.lastSeenAt ? new Date(d.lastSeenAt) : null,
            lastPowerW: d.lastPowerW,
            lastVoltageV: d.lastVoltageV,
            lastAddEleKwh: d.lastAddEleKwh,
            lastTempC: d.lastTempC,
            lastHumidityPct: d.lastHumidityPct,
            lastBatteryPct: d.lastBatteryPct,
            lastContactOpen: d.lastContactOpen,
          },
        });
      imported.devices++;
    }

    const allDeviceRows = await db.select({ id: devices.id }).from(devices);
    const validDeviceIds = new Set(allDeviceRows.map((d) => d.id));

    for (const l of archive.data.deviceVendorLinks) {
      if (!validDeviceIds.has(l.deviceId)) continue;
      await db
        .insert(deviceVendorLinks)
        .values({
          deviceId: l.deviceId,
          vendor: l.vendor,
          externalId: l.externalId,
          externalName: l.externalName,
          vendorMetadata: l.vendorMetadata ?? null,
          isPrimaryTelemetry: l.isPrimaryTelemetry,
          linkedAt: new Date(l.linkedAt),
        })
        .onConflictDoUpdate({
          target: [deviceVendorLinks.vendor, deviceVendorLinks.externalId],
          set: {
            deviceId: l.deviceId,
            externalName: l.externalName,
            vendorMetadata: l.vendorMetadata ?? null,
            isPrimaryTelemetry: l.isPrimaryTelemetry,
          },
        });
      imported.deviceVendorLinks++;
    }

    const existingTariffs = await db.select().from(tariffPeriods);
    for (const t of archive.data.tariffPeriods) {
      const existing = existingTariffs.find(
        (cur) =>
          cur.startDate === t.startDate &&
          cur.mode === t.mode &&
          cur.label.trim().toLowerCase() === t.label.trim().toLowerCase()
      );
      if (existing) {
        await db
          .update(tariffPeriods)
          .set({
            endDate: t.endDate,
            baseRateEur: t.baseRateEur,
            hpRateEur: t.hpRateEur,
            hcRateEur: t.hcRateEur,
            hcSlots: t.hcSlots,
            tempoConfig: t.tempoConfig ?? null,
            monthlySubscriptionEur: t.monthlySubscriptionEur,
            vatRatePct: t.vatRatePct ?? 20,
            subscriptionVatRatePct: t.subscriptionVatRatePct ?? 20,
            exciseRateEur: t.exciseRateEur ?? 0,
            contributions: Array.isArray(t.contributions) ? t.contributions : [],
          })
          .where(eq(tariffPeriods.id, existing.id));
      } else {
        await db.insert(tariffPeriods).values({
          label: t.label,
          startDate: t.startDate,
          endDate: t.endDate,
          mode: t.mode,
          baseRateEur: t.baseRateEur,
          hpRateEur: t.hpRateEur,
          hcRateEur: t.hcRateEur,
          hcSlots: t.hcSlots,
          tempoConfig: t.tempoConfig ?? null,
          monthlySubscriptionEur: t.monthlySubscriptionEur,
          vatRatePct: t.vatRatePct ?? 20,
          subscriptionVatRatePct: t.subscriptionVatRatePct ?? 20,
          exciseRateEur: t.exciseRateEur ?? 0,
          contributions: Array.isArray(t.contributions) ? t.contributions : [],
          createdAt: new Date(t.createdAt),
        });
      }
      imported.tariffPeriods++;
    }

    for (const a of archive.data.automations) {
      await db
        .insert(automations)
        .values({
          id: a.id,
          homeId: a.homeId,
          vendor: a.vendor,
          name: a.name,
          ruleType: a.ruleType,
          enabled: a.enabled,
          matchType: a.matchType,
          effectiveTime: a.effectiveTime,
          conditions: a.conditions,
          actions: a.actions,
          rawPayload: a.rawPayload,
          syncedAt: new Date(a.syncedAt),
        })
        .onConflictDoUpdate({
          target: automations.id,
          set: {
            homeId: a.homeId,
            vendor: a.vendor,
            name: a.name,
            ruleType: a.ruleType,
            enabled: a.enabled,
            matchType: a.matchType,
            effectiveTime: a.effectiveTime,
            conditions: a.conditions,
            actions: a.actions,
            rawPayload: a.rawPayload,
            syncedAt: new Date(a.syncedAt),
          },
        });
      imported.automations++;
    }

    for (const vc of archive.data.vendorConnections) {
      const hasTokenInArchive = importEncryptedSessions && Boolean(vc.accessToken || vc.refreshToken);
      await db
        .insert(vendorConnections)
        .values({
          vendor: vc.vendor,
          mode: vc.mode,
          status: hasTokenInArchive ? vc.status : 'disconnected',
          accessToken: hasTokenInArchive ? vc.accessToken : null,
          refreshToken: hasTokenInArchive ? vc.refreshToken : null,
          tokenExpiresAt:
            hasTokenInArchive && vc.tokenExpiresAt ? new Date(vc.tokenExpiresAt) : null,
          config: vc.config,
          lastSyncedAt: vc.lastSyncedAt ? new Date(vc.lastSyncedAt) : null,
          lastError: vc.lastError,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: vendorConnections.vendor,
          set: {
            mode: vc.mode,
            config: vc.config,
            ...(hasTokenInArchive
              ? {
                  status: vc.status,
                  accessToken: vc.accessToken,
                  refreshToken: vc.refreshToken,
                  tokenExpiresAt: vc.tokenExpiresAt ? new Date(vc.tokenExpiresAt) : null,
                }
              : {}),
            updatedAt: new Date(),
          },
        });
      imported.vendorConnections++;
    }

    if (importMetrics && archive.data.metricReadings.length > 0 && archive.stats.metricsDateMin && archive.stats.metricsDateMax) {
      const minDate = new Date(archive.stats.metricsDateMin);
      const maxDate = new Date(archive.stats.metricsDateMax);
      const existingRows = await db
        .select({
          deviceId: metricReadings.deviceId,
          recordedAt: metricReadings.recordedAt,
        })
        .from(metricReadings)
        .where(
          and(
            gte(metricReadings.recordedAt, minDate),
            lte(metricReadings.recordedAt, maxDate)
          )
        );
      const existingKeys = new Set(
        existingRows.map((r) => `${r.deviceId}::${r.recordedAt.toISOString()}`)
      );

      const toInsert: Array<typeof metricReadings.$inferInsert> = [];
      for (const r of archive.data.metricReadings) {
        if (!validDeviceIds.has(r.deviceId)) continue;
        const iso = normalizeIsoDate(r.recordedAt);
        const key = `${r.deviceId}::${iso}`;
        if (existingKeys.has(key)) {
          skippedMetricsDuplicates++;
          continue;
        }
        existingKeys.add(key);
        const mappedRoomId =
          r.roomId !== null ? (roomIdMap.get(r.roomId) ?? (roomById.has(r.roomId) ? r.roomId : null)) : null;
        toInsert.push({
          deviceId: r.deviceId,
          roomId: mappedRoomId,
          recordedAt: new Date(iso),
          powerW: r.powerW,
          voltageV: r.voltageV,
          energyKwh: r.energyKwh,
          energySource: r.energySource,
          tempC: r.tempC,
          humidityPct: r.humidityPct,
          contactOpen: r.contactOpen,
          coverState: r.coverState ?? null,
          coverOpenPct: r.coverOpenPct ?? null,
        });
      }

      for (let i = 0; i < toInsert.length; i += METRIC_INSERT_CHUNK_SIZE) {
        const chunk = toInsert.slice(i, i + METRIC_INSERT_CHUNK_SIZE);
        await db.insert(metricReadings).values(chunk);
        imported.metricReadings += chunk.length;
      }

      if (archive.data.collectionLogs.length > 0) {
        const existingLogRows = await db
          .select({ executedAt: collectionLogs.executedAt, trigger: collectionLogs.trigger })
          .from(collectionLogs)
          .where(gte(collectionLogs.executedAt, minDate));
        const existingLogKeys = new Set(
          existingLogRows.map((l) => `${l.executedAt.toISOString()}::${l.trigger}`)
        );
        const logValues: Array<typeof collectionLogs.$inferInsert> = [];
        for (const l of archive.data.collectionLogs) {
          const iso = normalizeIsoDate(l.executedAt);
          const key = `${iso}::${l.trigger}`;
          if (existingLogKeys.has(key)) continue;
          existingLogKeys.add(key);
          logValues.push({
            executedAt: new Date(iso),
            trigger: l.trigger,
            devicesCount: l.devicesCount,
            readingsInserted: l.readingsInserted,
            status: l.status,
            errorMessage: l.errorMessage,
            durationMs: l.durationMs,
          });
        }
        for (let i = 0; i < logValues.length; i += METRIC_INSERT_CHUNK_SIZE) {
          const chunk = logValues.slice(i, i + METRIC_INSERT_CHUNK_SIZE);
          await db.insert(collectionLogs).values(chunk);
          imported.collectionLogs += chunk.length;
        }
      }

      if (archive.data.meterReadings && archive.data.meterReadings.length > 0) {
        const meterValues = archive.data.meterReadings.map((m) => ({
          pointId: m.pointId,
          granularity: m.granularity,
          recordedAt: new Date(m.recordedAt),
          dateKey: m.dateKey,
          energyKwh: m.energyKwh,
          powerW: m.powerW,
        }));
        for (let i = 0; i < meterValues.length; i += METRIC_INSERT_CHUNK_SIZE) {
          const chunk = meterValues.slice(i, i + METRIC_INSERT_CHUNK_SIZE);
          await db
            .insert(meterReadings)
            .values(chunk)
            .onConflictDoUpdate({
              target: [meterReadings.pointId, meterReadings.granularity, meterReadings.recordedAt],
              set: {
                dateKey: sql`excluded.date_key`,
                energyKwh: sql`excluded.energy_kwh`,
                powerW: sql`excluded.power_w`,
              },
            });
        }
      }
    }

    await resetPostgresSequences(db);
  }

  return {
    mode,
    targetMode: 'live',
    imported,
    skippedMetricsDuplicates,
    warnings: parsed.warnings,
    message:
      mode === 'replace'
        ? `Restauration complète effectuée : ${imported.rooms} pièce(s), ${imported.devices} appareil(s), ${imported.deviceVendorLinks} liaison(s), ${imported.metricReadings} métrique(s).`
        : `Import fusionné effectué : ${imported.rooms} pièce(s), ${imported.devices} appareil(s), ${imported.deviceVendorLinks} liaison(s), ${imported.metricReadings} métrique(s) ajoutée(s).`,
  };
}
