import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, type AppDatabase } from '@/db';
import { meterReadings, vendorConnections } from '@/db/schema';
import { getDemoState } from '@/lib/demo-store';
import { ensureSchemaInitialized, seedDefaultDataIfEmpty } from '@/lib/services/shared';
import type {
  VendorCollectionResult,
  VendorServerPlugin,
  VendorSyncResult,
} from '@/lib/services/vendors/types';
import {
  ConsoApiHttpError,
  fetchConsoDailyConsumption,
  fetchConsoDailyMaxPower,
  fetchConsoLoadCurve,
  getConsoApiEnvConfig,
  isValidPrm,
  parseSubscribedKva,
  type ConsoApiConfig,
  type ParsedConsoReading,
} from '@/lib/vendors/conso-api-client';
import { decryptSecret, encryptSecret } from '@/lib/vendors/crypto-store';

const DAILY_RETRY_COOLDOWN_MS = 6 * 3_600_000;
const MAX_SCHEDULED_ATTEMPTS_PER_DAY = 2;
const MANUAL_SYNC_COOLDOWN_MS = 15 * 60_000;
const RATE_LIMIT_BACKOFF_MS = 24 * 3_600_000;
const SEQUENTIAL_CALL_PAUSE_MS = 1_500;
const SCHEDULE_JITTER_MIN_MS = 1_500;
const SCHEDULE_JITTER_MAX_MS = 4_500;
const INITIAL_HISTORY_DAYS = 365;
const LOAD_CURVE_DAYS = 7;

interface StoredConsoSecretPayload {
  prm: string;
  token: string;
  subscribedKva?: number | null;
}

interface ConsoConnMetadata {
  prm?: string;
  subscribedKva?: number | null;
  lastAttemptAt?: string | null;
  dailyAttemptsDate?: string | null;
  dailyAttemptsCount?: number;
  cooldownUntil?: string | null;
  source?: 'db' | 'env';
}

export function getParisYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getParisHour(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
}

export function getParisMinutesOfDay(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/**
 * Calcule une minute de déclenchement déterministe par PRM entre 08h13 et 09h47 (Europe/Paris),
 * jamais sur une heure pile (`:00`), afin d'éviter l'effet de pic sur conso.boris.sh.
 */
export function getScheduledStartMinutesParis(prm?: string | null): number {
  const cleanPrm = prm?.trim() ?? '';
  if (!cleanPrm) {
    return 8 * 60 + 17;
  }
  let hash = 0;
  for (let i = 0; i < cleanPrm.length; i++) {
    hash = (hash * 31 + cleanPrm.charCodeAt(i)) >>> 0;
  }
  const minMinute = 8 * 60 + 13; // 08h13
  const maxMinute = 9 * 60 + 47; // 09h47
  let target = minMinute + (hash % (maxMinute - minMinute + 1));
  if (target % 60 === 0) {
    target += 7;
  }
  return target;
}

export function addDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Détermine si la collecte planifiée doit appeler Conso API.
 * Enedis publie J-1 le matin : on attend la fenêtre décalée (08h13–09h47 Paris, jamais :00),
 * on skippe si J-1 existe déjà, on plafonne les tentatives journalières (2/j max, 1 seule si
 * `daily_kwh` est déjà là mais la courbe 30 min absente), et on applique les cooldowns anti-ban.
 */
export function shouldRunScheduledConsoApiSync(params: {
  now: Date;
  hasYesterdayDaily: boolean;
  hasYesterdayLoadCurve: boolean;
  hasYesterdayMaxPower?: boolean;
  lastAttemptAt?: string | null;
  dailyAttemptsDate?: string | null;
  dailyAttemptsCount?: number;
  cooldownUntil?: string | null;
  prm?: string | null;
}): { shouldRun: boolean; reason: string } {
  const {
    now,
    hasYesterdayDaily,
    hasYesterdayLoadCurve,
    hasYesterdayMaxPower = true,
    lastAttemptAt,
    dailyAttemptsDate,
    dailyAttemptsCount = 0,
    cooldownUntil,
    prm,
  } = params;

  if (cooldownUntil) {
    const untilMs = new Date(cooldownUntil).getTime();
    if (!Number.isNaN(untilMs) && now.getTime() < untilMs) {
      return { shouldRun: false, reason: 'rate_limit_backoff' };
    }
  }

  if (getParisHour(now) < 8) {
    return { shouldRun: false, reason: 'before_08h_paris' };
  }

  if (getParisMinutesOfDay(now) < getScheduledStartMinutesParis(prm)) {
    return { shouldRun: false, reason: 'before_staggered_window' };
  }

  if (hasYesterdayDaily && hasYesterdayLoadCurve && hasYesterdayMaxPower) {
    return { shouldRun: false, reason: 'yesterday_already_synced' };
  }

  const todayParis = getParisYmd(now);
  const attemptsToday = dailyAttemptsDate === todayParis ? dailyAttemptsCount : 0;

  if (hasYesterdayDaily && attemptsToday >= 1) {
    return { shouldRun: false, reason: 'daily_already_synced_no_curve' };
  }

  if (attemptsToday >= MAX_SCHEDULED_ATTEMPTS_PER_DAY) {
    return { shouldRun: false, reason: 'daily_attempt_limit_reached' };
  }

  if (lastAttemptAt) {
    const lastMs = new Date(lastAttemptAt).getTime();
    if (!Number.isNaN(lastMs) && now.getTime() - lastMs < DAILY_RETRY_COOLDOWN_MS) {
      return { shouldRun: false, reason: 'attempt_cooldown' };
    }
  }

  return { shouldRun: true, reason: 'due' };
}

function parseDbConsoSecret(encrypted: string | null): StoredConsoSecretPayload | null {
  if (!encrypted) return null;
  const plain = decryptSecret(encrypted);
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain) as Record<string, unknown>;
    const prm = typeof parsed.prm === 'string' ? parsed.prm.trim() : '';
    const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
    if (!isValidPrm(prm) || !token) return null;
    return {
      prm,
      token,
      subscribedKva: parseSubscribedKva(parsed.subscribedKva),
    };
  } catch {
    return null;
  }
}

export async function loadEffectiveConsoApiConfig(
  db: AppDatabase | null,
  connRow?: typeof vendorConnections.$inferSelect
): Promise<{
  config: ConsoApiConfig;
  source: 'db' | 'env' | 'none';
  metadata: ConsoConnMetadata;
}> {
  const envCfg = getConsoApiEnvConfig();
  let row = connRow;

  if (!row && db) {
    const rows = await db
      .select()
      .from(vendorConnections)
      .where(eq(vendorConnections.vendor, 'conso_api'))
      .limit(1);
    row = rows[0];
  }

  if (!db) {
    const state = getDemoState();
    const demoCfg = state.consoApiConfig;
    const demoMeta = (state.vendorConnections.conso_api?.config ?? {}) as ConsoConnMetadata;
    if (demoCfg && isValidPrm(demoCfg.prm) && demoCfg.token) {
      return {
        config: {
          configured: true,
          prm: demoCfg.prm,
          token: demoCfg.token,
          subscribedKva: demoCfg.subscribedKva,
          baseUrl: envCfg.baseUrl,
        },
        source: 'db',
        metadata: demoMeta,
      };
    }
    if (envCfg.configured) {
      return { config: envCfg, source: 'env', metadata: demoMeta };
    }
    return { config: envCfg, source: 'none', metadata: demoMeta };
  }

  const metadata = (row?.config ?? {}) as ConsoConnMetadata;
  const dbSecret = row?.status === 'connected' ? parseDbConsoSecret(row.accessToken) : null;
  if (dbSecret) {
    return {
      config: {
        configured: true,
        prm: dbSecret.prm,
        token: dbSecret.token,
        subscribedKva:
          dbSecret.subscribedKva ??
          parseSubscribedKva(metadata.subscribedKva) ??
          envCfg.subscribedKva,
        baseUrl: envCfg.baseUrl,
      },
      source: 'db',
      metadata,
    };
  }

  if (envCfg.configured) {
    return {
      config: {
        ...envCfg,
        subscribedKva: parseSubscribedKva(metadata.subscribedKva) ?? envCfg.subscribedKva,
      },
      source: 'env',
      metadata,
    };
  }

  return { config: envCfg, source: 'none', metadata };
}

export async function saveConsoApiConfig(input: {
  prm: string;
  token?: string;
  subscribedKva?: number | null;
}): Promise<{ prm: string; subscribedKva: number | null }> {
  const cleanPrm = input.prm.trim();
  if (!isValidPrm(cleanPrm)) {
    throw new Error('PRM Linky invalide : 14 chiffres attendus.');
  }
  const subscribedKva = parseSubscribedKva(input.subscribedKva);
  const db = getDb();
  const now = new Date();

  const existing = await loadEffectiveConsoApiConfig(db);
  const cleanToken = input.token?.trim() || existing.config.token || '';
  if (!cleanToken) {
    throw new Error('Le token Conso API est requis.');
  }

  if (!db) {
    const state = getDemoState();
    state.consoApiConfig = {
      prm: cleanPrm,
      token: cleanToken,
      subscribedKva,
    };
    state.vendorConnections.conso_api = {
      ...state.vendorConnections.conso_api,
      mode: 'bearer_token',
      connected: true,
      config: {
        ...(state.vendorConnections.conso_api?.config ?? {}),
        prm: cleanPrm,
        subscribedKva,
        source: 'db',
      },
      lastError: null,
    };
    return { prm: cleanPrm, subscribedKva };
  }

  await ensureSchemaInitialized(db);
  const encryptedToken = encryptSecret(
    JSON.stringify({ prm: cleanPrm, token: cleanToken, subscribedKva })
  );
  const credentialsChanged =
    cleanPrm !== existing.config.prm || cleanToken !== existing.config.token;
  const nextMeta: ConsoConnMetadata = {
    ...existing.metadata,
    prm: cleanPrm,
    subscribedKva,
    cooldownUntil: credentialsChanged ? null : (existing.metadata.cooldownUntil ?? null),
    source: 'db',
  };

  await db
    .insert(vendorConnections)
    .values({
      vendor: 'conso_api',
      mode: 'bearer_token',
      status: 'connected',
      accessToken: encryptedToken,
      config: nextMeta as unknown as Record<string, unknown>,
      lastError: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: vendorConnections.vendor,
      set: {
        mode: 'bearer_token',
        status: 'connected',
        accessToken: encryptedToken,
        config: nextMeta as unknown as Record<string, unknown>,
        lastError: null,
        updatedAt: now,
      },
    });

  return { prm: cleanPrm, subscribedKva };
}

export async function disconnectConsoApi(): Promise<void> {
  const db = getDb();
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    state.consoApiConfig = null;
    state.vendorConnections.conso_api = {
      mode: 'bearer_token',
      connected: false,
      config: {},
      lastSyncedAt: state.vendorConnections.conso_api?.lastSyncedAt ?? null,
      lastError: null,
    };
    return;
  }

  await ensureSchemaInitialized(db);
  await db
    .update(vendorConnections)
    .set({
      status: 'disconnected',
      accessToken: null,
      refreshToken: null,
      config: {},
      lastError: null,
      updatedAt: now,
    })
    .where(eq(vendorConnections.vendor, 'conso_api'));
}

async function upsertMeterReadingsInDb(
  db: AppDatabase,
  rows: ParsedConsoReading[]
): Promise<number> {
  if (rows.length === 0) return 0;
  let count = 0;
  const CHUNK_SIZE = 200;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE).map((r) => ({
      pointId: r.pointId,
      granularity: r.granularity,
      recordedAt: new Date(r.recordedAt),
      dateKey: r.dateKey,
      energyKwh: r.energyKwh,
      powerW: r.powerW,
    }));
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
    count += chunk.length;
  }
  return count;
}

async function updateConsoConnState(
  db: AppDatabase,
  params: {
    status?: 'connected' | 'error';
    config: ConsoConnMetadata;
    lastSyncedAt?: Date;
    lastError?: string | null;
    now: Date;
  }
) {
  await db
    .insert(vendorConnections)
    .values({
      vendor: 'conso_api',
      mode: 'bearer_token',
      status: params.status ?? 'connected',
      config: params.config as unknown as Record<string, unknown>,
      lastSyncedAt: params.lastSyncedAt ?? null,
      lastError: params.lastError ?? null,
      updatedAt: params.now,
    })
    .onConflictDoUpdate({
      target: vendorConnections.vendor,
      set: {
        mode: 'bearer_token',
        ...(params.status === 'connected' ? { status: 'connected' } : {}),
        config: params.config as unknown as Record<string, unknown>,
        ...(params.lastSyncedAt ? { lastSyncedAt: params.lastSyncedAt } : {}),
        ...(params.lastError !== undefined ? { lastError: params.lastError } : {}),
        updatedAt: params.now,
      },
    });
}

export async function syncConsoApi(
  options: { trigger?: 'manual' | 'schedule' } = {}
): Promise<VendorSyncResult> {
  const trigger = options.trigger ?? 'manual';
  const db = getDb();
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    state.vendorConnections.conso_api = {
      ...state.vendorConnections.conso_api,
      mode: 'bearer_token',
      connected: true,
      lastSyncedAt: now.toISOString(),
      lastError: null,
    };
    return {
      syncedCount: state.meterReadings.length,
      newCount: 0,
      mode: 'demo',
      message: `${state.meterReadings.length} relevé(s) Linky simulés synchronisés (mode Démo).`,
    };
  }

  await ensureSchemaInitialized(db);
  await seedDefaultDataIfEmpty(db);

  const { config, metadata } = await loadEffectiveConsoApiConfig(db);
  if (!config.configured) {
    throw new Error('Conso API non configurée : renseignez votre PRM (14 chiffres) et votre token.');
  }

  // Cooldown backoff 24h en cas de 403/429 récent
  if (metadata.cooldownUntil) {
    const untilMs = new Date(metadata.cooldownUntil).getTime();
    if (!Number.isNaN(untilMs) && now.getTime() < untilMs) {
      const msg = `Conso API en pause anti-ban jusqu'à ${new Date(untilMs).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}.`;
      return { syncedCount: 0, newCount: 0, mode: 'live', message: msg };
    }
  }

  const todayParis = getParisYmd(now);
  const yesterdayParis = addDaysYmd(todayParis, -1);

  const [latestDailyRows, latestMaxRows, latestCurveRows] = await Promise.all([
    db
      .select({ dateKey: meterReadings.dateKey })
      .from(meterReadings)
      .where(and(eq(meterReadings.pointId, config.prm), eq(meterReadings.granularity, 'daily_kwh')))
      .orderBy(desc(meterReadings.dateKey))
      .limit(1),
    db
      .select({ dateKey: meterReadings.dateKey })
      .from(meterReadings)
      .where(
        and(eq(meterReadings.pointId, config.prm), eq(meterReadings.granularity, 'max_power_daily'))
      )
      .orderBy(desc(meterReadings.dateKey))
      .limit(1),
    db
      .select({ dateKey: meterReadings.dateKey })
      .from(meterReadings)
      .where(
        and(eq(meterReadings.pointId, config.prm), eq(meterReadings.granularity, 'load_curve_30m'))
      )
      .orderBy(desc(meterReadings.dateKey))
      .limit(1),
  ]);

  const lastDailyDate = latestDailyRows[0]?.dateKey ?? null;
  const lastMaxDate = latestMaxRows[0]?.dateKey ?? null;
  const lastCurveDate = latestCurveRows[0]?.dateKey ?? null;
  const isInitialImport = !lastDailyDate;

  if (!isInitialImport && trigger === 'schedule') {
    const decision = shouldRunScheduledConsoApiSync({
      now,
      hasYesterdayDaily: lastDailyDate >= yesterdayParis,
      hasYesterdayLoadCurve: Boolean(lastCurveDate && lastCurveDate >= yesterdayParis),
      hasYesterdayMaxPower: Boolean(lastMaxDate && lastMaxDate >= yesterdayParis),
      lastAttemptAt: metadata.lastAttemptAt,
      dailyAttemptsDate: metadata.dailyAttemptsDate,
      dailyAttemptsCount: metadata.dailyAttemptsCount,
      cooldownUntil: metadata.cooldownUntil,
      prm: config.prm,
    });
    if (!decision.shouldRun) {
      return {
        syncedCount: 0,
        newCount: 0,
        mode: 'live',
        message: `Conso API ignorée (${decision.reason}).`,
      };
    }
  }

  if (!isInitialImport && trigger === 'manual' && metadata.lastAttemptAt) {
    const lastMs = new Date(metadata.lastAttemptAt).getTime();
    if (!Number.isNaN(lastMs) && now.getTime() - lastMs < MANUAL_SYNC_COOLDOWN_MS) {
      const remainingMin = Math.max(
        1,
        Math.ceil((MANUAL_SYNC_COOLDOWN_MS - (now.getTime() - lastMs)) / 60_000)
      );
      return {
        syncedCount: 0,
        newCount: 0,
        mode: 'live',
        message: `Cooldown anti-ban actif : patientez ${remainingMin} min avant une nouvelle synchro manuelle Linky.`,
      };
    }
  }

  const needDaily = isInitialImport || !lastDailyDate || lastDailyDate < yesterdayParis;
  const needMax = isInitialImport || !lastMaxDate || lastMaxDate < yesterdayParis;
  const needCurve = isInitialImport || !lastCurveDate || lastCurveDate < yesterdayParis;

  if (!needDaily && !needMax && !needCurve) {
    return {
      syncedCount: 0,
      newCount: 0,
      mode: 'live',
      message: `Compteur Linky déjà à jour jusqu'au ${yesterdayParis} (0 requête envoyée).`,
    };
  }

  const prevAttemptsToday =
    metadata.dailyAttemptsDate === todayParis ? (metadata.dailyAttemptsCount ?? 0) : 0;
  const nextMeta: ConsoConnMetadata = {
    ...metadata,
    prm: config.prm,
    subscribedKva: config.subscribedKva,
    lastAttemptAt: now.toISOString(),
    ...(trigger === 'schedule'
      ? { dailyAttemptsDate: todayParis, dailyAttemptsCount: prevAttemptsToday + 1 }
      : {}),
  };

  // Verrou pré-requête en base avant le 1er appel HTTP pour empêcher les doublons concurrents
  await updateConsoConnState(db, {
    config: nextMeta,
    now,
  });

  if (trigger === 'schedule' && !process.env.VITEST) {
    const jitterRange = Math.max(0, SCHEDULE_JITTER_MAX_MS - SCHEDULE_JITTER_MIN_MS);
    await waitMs(SCHEDULE_JITTER_MIN_MS + Math.floor(Math.random() * jitterRange));
  }

  try {
    let totalSaved = 0;
    let madeHttpCall = false;
    let dailyPoints: ParsedConsoReading[] = [];
    let maxPoints: ParsedConsoReading[] = [];
    let curvePoints: ParsedConsoReading[] = [];

    // 1. Consommation quotidienne (dateFin est exclusive côté Enedis → todayParis inclut jusqu'à yesterdayParis)
    if (needDaily) {
      const dailyStart = isInitialImport
        ? addDaysYmd(todayParis, -INITIAL_HISTORY_DAYS)
        : addDaysYmd(lastDailyDate!, -1) > addDaysYmd(todayParis, -14)
          ? addDaysYmd(lastDailyDate!, -1)
          : addDaysYmd(todayParis, -14);

      dailyPoints = await fetchConsoDailyConsumption(config, dailyStart, todayParis);
      totalSaved += await upsertMeterReadingsInDb(db, dailyPoints);
      madeHttpCall = true;
    }

    // 2. Puissance maximale quotidienne
    if (needMax) {
      if (madeHttpCall) await waitMs(SEQUENTIAL_CALL_PAUSE_MS);
      const maxStart = !lastMaxDate
        ? addDaysYmd(todayParis, -INITIAL_HISTORY_DAYS)
        : addDaysYmd(lastMaxDate, -1) > addDaysYmd(todayParis, -14)
          ? addDaysYmd(lastMaxDate, -1)
          : addDaysYmd(todayParis, -14);
      maxPoints = await fetchConsoDailyMaxPower(config, maxStart, todayParis);
      totalSaved += await upsertMeterReadingsInDb(db, maxPoints);
      madeHttpCall = true;
    }

    // 3. Courbe de charge 30 min (max 7 jours par requête)
    if (needCurve) {
      if (madeHttpCall) await waitMs(SEQUENTIAL_CALL_PAUSE_MS);
      const curveWindowStart = addDaysYmd(todayParis, -LOAD_CURVE_DAYS);
      const curveStart =
        lastCurveDate && addDaysYmd(lastCurveDate, -1) > curveWindowStart
          ? addDaysYmd(lastCurveDate, -1)
          : curveWindowStart;
      curvePoints = await fetchConsoLoadCurve(config, curveStart, todayParis);
      totalSaved += await upsertMeterReadingsInDb(db, curvePoints);
    }

    nextMeta.cooldownUntil = null;
    await updateConsoConnState(db, {
      status: 'connected',
      config: nextMeta,
      lastSyncedAt: now,
      lastError: null,
      now,
    });

    const newLatest = dailyPoints[dailyPoints.length - 1]?.dateKey ?? lastDailyDate ?? yesterdayParis;
    return {
      syncedCount: totalSaved,
      newCount: totalSaved,
      mode: 'live',
      message: `${dailyPoints.length} jour(s), ${maxPoints.length} pic(s) VA et ${curvePoints.length} point(s) 30 min Linky synchronisés (jusqu'au ${newLatest}).`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur Conso API';
    if (err instanceof ConsoApiHttpError && (err.isRateLimited || err.isAuthError)) {
      const backoffMs = Math.max(RATE_LIMIT_BACKOFF_MS, err.retryAfterMs ?? 0);
      nextMeta.cooldownUntil = new Date(now.getTime() + backoffMs).toISOString();
    }
    await updateConsoConnState(db, {
      status: 'error',
      config: nextMeta,
      lastError: msg,
      now,
    });
    throw err;
  }
}

export async function collectConsoApiIfDue(
  db: AppDatabase,
  now: Date = new Date()
): Promise<VendorCollectionResult> {
  const { config, metadata } = await loadEffectiveConsoApiConfig(db);
  if (!config.configured) {
    return { devicesCount: 0, readingsInserted: 0, updatedCount: 0 };
  }

  const todayParis = getParisYmd(now);
  const yesterdayParis = addDaysYmd(todayParis, -1);

  const [dailyRows, maxRows, curveRows] = await Promise.all([
    db
      .select({ dateKey: meterReadings.dateKey })
      .from(meterReadings)
      .where(and(eq(meterReadings.pointId, config.prm), eq(meterReadings.granularity, 'daily_kwh')))
      .orderBy(desc(meterReadings.dateKey))
      .limit(1),
    db
      .select({ dateKey: meterReadings.dateKey })
      .from(meterReadings)
      .where(
        and(eq(meterReadings.pointId, config.prm), eq(meterReadings.granularity, 'max_power_daily'))
      )
      .orderBy(desc(meterReadings.dateKey))
      .limit(1),
    db
      .select({ dateKey: meterReadings.dateKey })
      .from(meterReadings)
      .where(
        and(eq(meterReadings.pointId, config.prm), eq(meterReadings.granularity, 'load_curve_30m'))
      )
      .orderBy(desc(meterReadings.dateKey))
      .limit(1),
  ]);

  const decision = shouldRunScheduledConsoApiSync({
    now,
    hasYesterdayDaily: Boolean(dailyRows[0]?.dateKey && dailyRows[0].dateKey >= yesterdayParis),
    hasYesterdayMaxPower: Boolean(maxRows[0]?.dateKey && maxRows[0].dateKey >= yesterdayParis),
    hasYesterdayLoadCurve: Boolean(curveRows[0]?.dateKey && curveRows[0].dateKey >= yesterdayParis),
    lastAttemptAt: metadata.lastAttemptAt,
    dailyAttemptsDate: metadata.dailyAttemptsDate,
    dailyAttemptsCount: metadata.dailyAttemptsCount,
    cooldownUntil: metadata.cooldownUntil,
    prm: config.prm,
  });

  if (!decision.shouldRun) {
    return { devicesCount: 0, readingsInserted: 0, updatedCount: 0 };
  }

  const res = await syncConsoApi({ trigger: 'schedule' });
  return {
    devicesCount: 1,
    readingsInserted: res.syncedCount,
    updatedCount: res.syncedCount > 0 ? 1 : 0,
  };
}

export const consoApiPlugin: VendorServerPlugin = {
  id: 'conso_api',
  isConfigured: () => getConsoApiEnvConfig().configured,
  isConfiguredLive: ({ conn }) => {
    const envCfg = getConsoApiEnvConfig();
    const dbSecret = conn?.status === 'connected' ? parseDbConsoSecret(conn.accessToken) : null;
    return envCfg.configured || Boolean(dbSecret);
  },
  getConnectionMode: () => 'bearer_token',
  isConnectedLive: ({ conn }) => {
    const envCfg = getConsoApiEnvConfig();
    const dbSecret = conn?.status === 'connected' ? parseDbConsoSecret(conn.accessToken) : null;
    if (conn?.status === 'error') return false;
    return Boolean(dbSecret) || (envCfg.configured && conn?.status === 'connected');
  },
  syncDevices: () => syncConsoApi({ trigger: 'manual' }),
  collectReadings: ({ db, now }) => collectConsoApiIfDue(db, now),
  disconnect: disconnectConsoApi,
};
