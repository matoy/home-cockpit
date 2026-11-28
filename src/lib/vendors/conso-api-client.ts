import { fetchWithTimeout } from '@/lib/http-utils';
import type { MeterReadingGranularity } from '@/types';

const DEFAULT_CONSO_API_BASE_URL = 'https://conso.boris.sh/api';
const USER_AGENT = 'HomeCockpit/1.0';
const CONSO_FETCH_TIMEOUT_MS = 15_000;

export interface ConsoApiConfig {
  configured: boolean;
  prm: string;
  token: string;
  subscribedKva: number | null;
  baseUrl: string;
}

export interface ParsedConsoReading {
  pointId: string;
  granularity: MeterReadingGranularity;
  recordedAt: string; // ISO UTC
  dateKey: string; // YYYY-MM-DD (Europe/Paris)
  energyKwh: number | null;
  powerW: number | null;
}

const MAX_RETRY_AFTER_MS = 7 * 24 * 3_600_000;

/**
 * Analyse le header HTTP `Retry-After` (secondes ou date HTTP) en millisecondes,
 * borné entre 1 ms et 7 jours. Retourne `null` si absent ou invalide.
 */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  nowMs = Date.now()
): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.min(MAX_RETRY_AFTER_MS, seconds * 1000);
  }

  const parsedMs = Date.parse(trimmed);
  if (Number.isNaN(parsedMs)) return null;
  const delta = parsedMs - nowMs;
  if (delta <= 0) return null;
  return Math.min(MAX_RETRY_AFTER_MS, delta);
}

export class ConsoApiHttpError extends Error {
  readonly status: number;
  readonly isAuthError: boolean;
  readonly isRateLimited: boolean;
  readonly retryAfterMs: number | null;

  constructor(status: number, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'ConsoApiHttpError';
    this.status = status;
    this.isAuthError = status === 401;
    this.isRateLimited = status === 403 || status === 429;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isValidPrm(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return /^\d{14}$/.test(raw.trim());
}

export function maskPrm(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return null;
  if (trimmed.length <= 4) return trimmed;
  return `${'•'.repeat(Math.max(4, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

export function parseSubscribedKva(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  const rounded = Math.round(num);
  if (rounded < 3 || rounded > 36) return null;
  return rounded;
}

export function getConsoApiEnvConfig(
  env: Record<string, string | undefined> = process.env
): ConsoApiConfig {
  const token = env.CONSO_API_TOKEN?.trim() ?? '';
  const prmRaw = env.CONSO_API_PRM?.trim() ?? '';
  const prm = isValidPrm(prmRaw) ? prmRaw : '';
  const subscribedKva = parseSubscribedKva(env.CONSO_API_SUBSCRIBED_KVA);
  const rawBase = env.CONSO_API_BASE_URL?.trim() || DEFAULT_CONSO_API_BASE_URL;
  const baseUrl = rawBase.replace(/\/+$/, '');

  return {
    configured: Boolean(token && prm),
    prm,
    token,
    subscribedKva,
    baseUrl,
  };
}

function getParisOffsetMinutes(utcProbe: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(utcProbe);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const parisAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return Math.round((parisAsUtc - utcProbe.getTime()) / 60_000);
}

/**
 * Convertit une date/heure locale `Europe/Paris` (`YYYY-MM-DD` ou `YYYY-MM-DD HH:mm:ss` ou ISO)
 * en `{ recordedAtIso, dateKey }`.
 * Pour les points purement journaliers (`YYYY-MM-DD`), place le repère à 12:00 Europe/Paris
 * pour éviter tout changement de jour lors des agrégations en UTC ou Europe/Paris.
 */
export function parseConsoTimestamp(
  rawDate: string,
  granularity: MeterReadingGranularity
): { recordedAt: string; dateKey: string } | null {
  const trimmed = rawDate.trim();
  if (!trimmed) return null;

  // Format date pure: YYYY-MM-DD
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const hour = granularity === 'load_curve_30m' ? 0 : 12;
    const approxUtc = new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
    const offsetMin = getParisOffsetMinutes(approxUtc);
    const utcMs = Date.UTC(year, month - 1, day, hour, 0, 0) - offsetMin * 60_000;
    return {
      recordedAt: new Date(utcMs).toISOString(),
      dateKey: `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}`,
    };
  }

  // Format sans timezone explicite: "YYYY-MM-DD HH:mm:ss" ou "YYYY-MM-DDTHH:mm:ss" (heure locale Paris)
  const localMatch =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (localMatch) {
    const year = Number(localMatch[1]);
    const month = Number(localMatch[2]);
    const day = Number(localMatch[3]);
    const hour = Number(localMatch[4]);
    const minute = Number(localMatch[5]);
    const second = Number(localMatch[6] ?? '0');
    const approxUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const offsetMin = getParisOffsetMinutes(approxUtc);
    const utcMs =
      Date.UTC(year, month - 1, day, hour, minute, second) - offsetMin * 60_000;
    return {
      recordedAt: new Date(utcMs).toISOString(),
      dateKey: `${localMatch[1]}-${localMatch[2]}-${localMatch[3]}`,
    };
  }

  // Format ISO avec offset/Z
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const parisDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);

  return {
    recordedAt: parsed.toISOString(),
    dateKey: parisDate,
  };
}

function toEnergyAndPower(params: {
  value: number;
  unit: string;
  granularity: MeterReadingGranularity;
}): { energyKwh: number | null; powerW: number | null } {
  const { value, unit, granularity } = params;
  const u = unit.trim().toLowerCase();

  if (granularity === 'daily_kwh') {
    const energyKwh =
      u === 'kwh' ? value : u === 'wh' || u === '' ? value / 1000 : value / 1000;
    return {
      energyKwh: Math.round(energyKwh * 10000) / 10000,
      powerW: null,
    };
  }

  if (granularity === 'load_curve_30m') {
    if (u === 'wh') {
      return {
        energyKwh: Math.round((value / 1000) * 10000) / 10000,
        powerW: Math.round(value * 2 * 10) / 10,
      };
    }
    if (u === 'kwh') {
      return {
        energyKwh: Math.round(value * 10000) / 10000,
        powerW: Math.round(value * 2000 * 10) / 10,
      };
    }
    // Par défaut sur Enedis courbe de charge: puissance moyenne en W sur pas 30 min
    return {
      energyKwh: Math.round(((value * 0.5) / 1000) * 10000) / 10000,
      powerW: Math.round(value * 10) / 10,
    };
  }

  // max_power_daily (VA ou W)
  const powerW = u === 'kva' || u === 'kw' ? value * 1000 : value;
  return {
    energyKwh: null,
    powerW: Math.round(powerW * 10) / 10,
  };
}

/**
 * Parse les réponses Conso API au format Enedis Mesure Synchrone V2 (`grandeur[].points[]`)
 * ainsi que l'ancien format V5 (`meter_reading.interval_reading[]`).
 */
export function parseConsoApiResponse(
  payload: unknown,
  granularity: MeterReadingGranularity,
  fallbackPointId = ''
): ParsedConsoReading[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }

  const root = payload as Record<string, unknown>;
  const readings: ParsedConsoReading[] = [];
  const seenKeys = new Set<string>();

  const pushPoint = (pointId: string, rawDate: string, rawValue: unknown, unit: string) => {
    const val = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    if (!Number.isFinite(val) || val < 0) return;
    const ts = parseConsoTimestamp(rawDate, granularity);
    if (!ts) return;

    const dedup = `${pointId}::${granularity}::${ts.recordedAt}`;
    if (seenKeys.has(dedup)) return;
    seenKeys.add(dedup);

    const { energyKwh, powerW } = toEnergyAndPower({ value: val, unit, granularity });
    readings.push({
      pointId,
      granularity,
      recordedAt: ts.recordedAt,
      dateKey: ts.dateKey,
      energyKwh,
      powerW,
    });
  };

  // Format Enedis V2
  if (Array.isArray(root.grandeur)) {
    const pointId =
      typeof root.idPrm === 'string' && root.idPrm.trim() ? root.idPrm.trim() : fallbackPointId;
    for (const g of root.grandeur) {
      if (!g || typeof g !== 'object') continue;
      const rec = g as Record<string, unknown>;
      const unit = typeof rec.unite === 'string' ? rec.unite : '';
      const points = Array.isArray(rec.points) ? rec.points : [];
      for (const pt of points) {
        if (!pt || typeof pt !== 'object') continue;
        const p = pt as Record<string, unknown>;
        if (typeof p.d !== 'string') continue;
        pushPoint(pointId, p.d, p.v, unit);
      }
    }
    return readings;
  }

  // Format Legacy V5 (`meter_reading.interval_reading`)
  const mr =
    root.meter_reading && typeof root.meter_reading === 'object'
      ? (root.meter_reading as Record<string, unknown>)
      : null;
  if (mr && Array.isArray(mr.interval_reading)) {
    const pointId =
      typeof mr.usage_point_id === 'string' && mr.usage_point_id.trim()
        ? mr.usage_point_id.trim()
        : fallbackPointId;
    const rt =
      mr.reading_type && typeof mr.reading_type === 'object'
        ? (mr.reading_type as Record<string, unknown>)
        : null;
    const unit = typeof rt?.unit === 'string' ? rt.unit : '';
    for (const item of mr.interval_reading) {
      if (!item || typeof item !== 'object') continue;
      const p = item as Record<string, unknown>;
      if (typeof p.date !== 'string') continue;
      pushPoint(pointId, p.date, p.value, unit);
    }
  }

  return readings;
}

async function callConsoApiEndpoint(params: {
  config: ConsoApiConfig;
  endpoint:
    | 'consommation_quotidienne'
    | 'courbe_de_charge_consommation'
    | 'puissance_conso_max_quotidienne';
  granularity: MeterReadingGranularity;
  dateDebut: string;
  dateFin: string;
  fetchImpl?: typeof fetch;
}): Promise<ParsedConsoReading[]> {
  const { config, endpoint, granularity, dateDebut, dateFin, fetchImpl = fetch } = params;
  if (!config.configured) {
    throw new Error('Conso API non configurée (CONSO_API_TOKEN / CONSO_API_PRM).');
  }

  const qs = new URLSearchParams({
    pointId: config.prm,
    dateDebut,
    dateFin,
  });
  const url = `${config.baseUrl}/${endpoint}?${qs.toString()}`;

  const reqInit: RequestInit = {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    cache: 'no-store',
  };

  const res =
    fetchImpl === fetch
      ? await fetchWithTimeout(url, reqInit, CONSO_FETCH_TIMEOUT_MS)
      : await fetchImpl(url, {
          ...reqInit,
          signal: AbortSignal.timeout(CONSO_FETCH_TIMEOUT_MS),
        });

  if (!res.ok) {
    const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
    const rawText = await res.text().catch(() => '');
    let apiErrMsg = rawText;
    try {
      const parsed = JSON.parse(rawText) as { error?: string; message?: string; description?: string };
      apiErrMsg = parsed.error || parsed.message || parsed.description || rawText;
    } catch {
      // keep rawText
    }
    const cleanMsg = apiErrMsg.trim() || `HTTP ${res.status}`;
    if (res.status === 401) {
      throw new ConsoApiHttpError(
        401,
        `Conso API token invalide ou expiré (401) — pause automatique 24h activée : ${cleanMsg}`,
        retryAfterMs
      );
    }
    if (res.status === 403 || res.status === 429) {
      throw new ConsoApiHttpError(
        res.status,
        `Conso API quota / limitation (${res.status}) — pause automatique activée : ${cleanMsg}`,
        retryAfterMs
      );
    }
    throw new ConsoApiHttpError(
      res.status,
      `Conso API HTTP ${res.status} : ${cleanMsg}`,
      retryAfterMs
    );
  }

  const json = (await res.json()) as unknown;
  return parseConsoApiResponse(json, granularity, config.prm);
}

export async function fetchConsoDailyConsumption(
  config: ConsoApiConfig,
  dateDebut: string,
  dateFin: string,
  fetchImpl?: typeof fetch
): Promise<ParsedConsoReading[]> {
  return callConsoApiEndpoint({
    config,
    endpoint: 'consommation_quotidienne',
    granularity: 'daily_kwh',
    dateDebut,
    dateFin,
    fetchImpl,
  });
}

export async function fetchConsoDailyMaxPower(
  config: ConsoApiConfig,
  dateDebut: string,
  dateFin: string,
  fetchImpl?: typeof fetch
): Promise<ParsedConsoReading[]> {
  return callConsoApiEndpoint({
    config,
    endpoint: 'puissance_conso_max_quotidienne',
    granularity: 'max_power_daily',
    dateDebut,
    dateFin,
    fetchImpl,
  });
}

export async function fetchConsoLoadCurve(
  config: ConsoApiConfig,
  dateDebut: string,
  dateFin: string,
  fetchImpl?: typeof fetch
): Promise<ParsedConsoReading[]> {
  return callConsoApiEndpoint({
    config,
    endpoint: 'courbe_de_charge_consommation',
    granularity: 'load_curve_30m',
    dateDebut,
    dateFin,
    fetchImpl,
  });
}
