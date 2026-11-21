import crypto from 'node:crypto';
import type { DeviceCategory, DpConfig, RawDpStatus } from '@/types';

const TUYA_REGION_ENDPOINTS: Record<string, string> = {
  eu: 'https://openapi.tuyaeu.com',
  weu: 'https://openapi-weaz.tuyaeu.com',
  us: 'https://openapi.tuyaus.com',
  eus: 'https://openapi-ueaz.tuyaus.com',
  cn: 'https://openapi.tuyacn.com',
  in: 'https://openapi.tuyain.com',
};

export interface TuyaRawDevice {
  id: string;
  name: string;
  category: string;
  product_name?: string;
  online?: boolean;
  status?: RawDpStatus[];
}

interface TuyaTokenCache {
  accessToken: string;
  expiresAtMs: number;
  baseUrl: string;
}

let tokenCache: TuyaTokenCache | null = null;

export function getTuyaConfig() {
  const accessId = process.env.TUYA_ACCESS_ID?.trim() ?? '';
  const accessSecret = process.env.TUYA_ACCESS_SECRET?.trim() ?? '';
  const region = (process.env.TUYA_REGION?.trim() || 'eu').toLowerCase();
  const userUid = process.env.TUYA_USER_UID?.trim() ?? '';
  const baseUrl = TUYA_REGION_ENDPOINTS[region] ?? TUYA_REGION_ENDPOINTS.eu;

  return {
    configured: Boolean(accessId && accessSecret),
    accessId,
    accessSecret,
    region,
    userUid,
    baseUrl,
  };
}

function sha256Hex(payload: string): string {
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function hmacSha256Hex(message: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(message, 'utf8').digest('hex').toUpperCase();
}

function buildSignHeaders(params: {
  method: string;
  pathWithQuery: string;
  body?: string;
  accessToken?: string;
  accessId: string;
  accessSecret: string;
}) {
  const { method, pathWithQuery, body = '', accessToken, accessId, accessSecret } = params;
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const contentHash = sha256Hex(body);
  const stringToSign = [method.toUpperCase(), contentHash, '', pathWithQuery].join('\n');
  const signPayload = accessToken
    ? accessId + accessToken + t + nonce + stringToSign
    : accessId + t + nonce + stringToSign;
  const sign = hmacSha256Hex(signPayload, accessSecret);

  const headers: Record<string, string> = {
    client_id: accessId,
    sign,
    t,
    sign_method: 'HMAC-SHA256',
    nonce,
    'Content-Type': 'application/json',
  };

  if (accessToken) {
    headers.access_token = accessToken;
  }

  return headers;
}

async function getAccessToken(): Promise<string> {
  const cfg = getTuyaConfig();
  if (!cfg.configured) {
    throw new Error('Identifiants Tuya manquants (TUYA_ACCESS_ID / TUYA_ACCESS_SECRET).');
  }

  if (tokenCache && tokenCache.baseUrl === cfg.baseUrl && tokenCache.expiresAtMs > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const pathWithQuery = '/v1.0/token?grant_type=1';
  const headers = buildSignHeaders({
    method: 'GET',
    pathWithQuery,
    accessId: cfg.accessId,
    accessSecret: cfg.accessSecret,
  });

  const res = await fetch(`${cfg.baseUrl}${pathWithQuery}`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });

  const data = (await res.json()) as {
    success: boolean;
    msg?: string;
    code?: number;
    result?: { access_token: string; expire_time: number };
  };

  if (!res.ok || !data.success || !data.result?.access_token) {
    throw new Error(`Erreur auth Tuya (${data.code ?? res.status}): ${data.msg ?? 'Token refusé'}`);
  }

  tokenCache = {
    accessToken: data.result.access_token,
    expiresAtMs: Date.now() + data.result.expire_time * 1000,
    baseUrl: cfg.baseUrl,
  };

  return tokenCache.accessToken;
}

async function tuyaRequest<T>(pathWithQuery: string, method = 'GET', body?: unknown): Promise<T> {
  const cfg = getTuyaConfig();
  const accessToken = await getAccessToken();
  const bodyStr = body ? JSON.stringify(body) : '';

  const headers = buildSignHeaders({
    method,
    pathWithQuery,
    body: bodyStr,
    accessToken,
    accessId: cfg.accessId,
    accessSecret: cfg.accessSecret,
  });

  const res = await fetch(`${cfg.baseUrl}${pathWithQuery}`, {
    method,
    headers,
    body: bodyStr || undefined,
    cache: 'no-store',
  });

  const data = (await res.json()) as {
    success: boolean;
    msg?: string;
    code?: number;
    result: T;
  };

  if (!res.ok || !data.success) {
    if (data.code === 1010) {
      tokenCache = null;
    }
    throw new Error(`Erreur Tuya API [${pathWithQuery}] (${data.code ?? res.status}): ${data.msg ?? 'Échec'}`);
  }

  return data.result;
}

export async function fetchTuyaDevices(): Promise<TuyaRawDevice[]> {
  const cfg = getTuyaConfig();
  if (cfg.userUid) {
    return tuyaRequest<TuyaRawDevice[]>(`/v1.0/users/${encodeURIComponent(cfg.userUid)}/devices`);
  }

  // Fallback pagination sur les appareils associés au projet Cloud
  const collected: TuyaRawDevice[] = [];
  let lastRowKey = '';
  for (let page = 0; page < 5; page++) {
    const query = lastRowKey
      ? `/v1.0/iot-01/associated-users/devices?size=50&last_row_key=${encodeURIComponent(lastRowKey)}`
      : '/v1.0/iot-01/associated-users/devices?size=50';
    const res = await tuyaRequest<{ devices?: TuyaRawDevice[]; last_row_key?: string; has_more?: boolean }>(
      query
    );
    if (res.devices?.length) {
      collected.push(...res.devices);
    }
    if (!res.has_more || !res.last_row_key) break;
    lastRowKey = res.last_row_key;
  }
  return collected;
}

export interface TuyaDpSpec {
  code: string;
  type: string;
  scale?: number;
  unit?: string;
}

export async function fetchDeviceSpecification(deviceId: string): Promise<Record<string, TuyaDpSpec>> {
  try {
    const res = await tuyaRequest<{
      status?: Array<{ code: string; type: string; values?: string }>;
      functions?: Array<{ code: string; type: string; values?: string }>;
    }>(`/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/specification`);

    const map: Record<string, TuyaDpSpec> = {};
    for (const item of [...(res.status ?? []), ...(res.functions ?? [])]) {
      let scale: number | undefined;
      let unit: string | undefined;
      if (item.values) {
        try {
          const parsed = JSON.parse(item.values) as { scale?: number; unit?: string };
          if (typeof parsed.scale === 'number') scale = parsed.scale;
          if (typeof parsed.unit === 'string') unit = parsed.unit;
        } catch {
          // Ignore malformed values JSON
        }
      }
      map[item.code] = { code: item.code, type: item.type, scale, unit };
    }
    return map;
  } catch {
    return {};
  }
}

export interface TuyaBatchStatusItem {
  id: string;
  status: RawDpStatus[];
}

export async function fetchBatchStatuses(deviceIds: string[]): Promise<Map<string, RawDpStatus[]>> {
  const result = new Map<string, RawDpStatus[]>();
  if (deviceIds.length === 0) return result;

  // Lots de 20 appareils pour optimiser le quota gratuit Tuya IoT Core
  for (let i = 0; i < deviceIds.length; i += 20) {
    const chunk = deviceIds.slice(i, i + 20);
    const idsParam = encodeURIComponent(chunk.join(','));
    const items = await tuyaRequest<TuyaBatchStatusItem[]>(
      `/v1.0/iot-03/devices/status?device_ids=${idsParam}`
    );
    for (const item of items ?? []) {
      result.set(item.id, item.status ?? []);
    }
  }

  return result;
}

const POWER_CODES = ['cur_power', 'power', 'total_power', 'active_power', 'power_a'];
const VOLTAGE_CODES = ['cur_voltage', 'voltage_a', 'voltage', 'phase_a'];
const CURRENT_CODES = ['cur_current', 'current', 'current_a'];
const ADD_ELE_CODES = ['add_ele', 'forward_energy_total', 'ele', 'total_forward_energy'];
const TEMP_CODES = ['va_temperature', 'temp_current', 'temp_value', 'temperature', 'temp_set'];
const HUMIDITY_CODES = ['va_humidity', 'humidity_value', 'humidity_current', 'humidity'];
const BATTERY_CODES = ['battery_percentage', 'va_battery', 'battery_value'];

function findMatchingDp(
  rawStatus: RawDpStatus[],
  candidates: string[]
): RawDpStatus | undefined {
  for (const code of candidates) {
    const match = rawStatus.find((item) => item.code === code && typeof item.value === 'number');
    if (match) return match;
  }
  return undefined;
}

function resolveScale(
  code: string,
  rawValue: unknown,
  specMap: Record<string, TuyaDpSpec>,
  defaultScale: number,
  heuristic?: (val: number) => number
): number {
  const spec = specMap[code];
  if (spec && typeof spec.scale === 'number') {
    return Math.pow(10, -spec.scale);
  }
  if (typeof rawValue === 'number' && heuristic) {
    return heuristic(rawValue);
  }
  return defaultScale;
}

export function autoDetectDpConfig(
  rawStatus: RawDpStatus[],
  specMap: Record<string, TuyaDpSpec> = {}
): { dpConfig: DpConfig; category: DeviceCategory } {
  const dpConfig: DpConfig = {};

  const powerDp = findMatchingDp(rawStatus, POWER_CODES);
  if (powerDp) {
    dpConfig.power = {
      code: powerDp.code,
      scale: resolveScale(powerDp.code, powerDp.value, specMap, 0.1),
    };
  }

  const voltageDp = findMatchingDp(rawStatus, VOLTAGE_CODES);
  if (voltageDp) {
    dpConfig.voltage = {
      code: voltageDp.code,
      scale: resolveScale(voltageDp.code, voltageDp.value, specMap, 0.1, (v) => (v > 400 ? 0.1 : 1)),
    };
  }

  const currentDp = findMatchingDp(rawStatus, CURRENT_CODES);
  if (currentDp) {
    dpConfig.current = {
      code: currentDp.code,
      scale: resolveScale(currentDp.code, currentDp.value, specMap, 1),
    };
  }

  const addEleDp = findMatchingDp(rawStatus, ADD_ELE_CODES);
  if (addEleDp) {
    dpConfig.addEle = {
      code: addEleDp.code,
      scale: resolveScale(addEleDp.code, addEleDp.value, specMap, 0.001),
    };
  }

  const tempDp = findMatchingDp(rawStatus, TEMP_CODES);
  if (tempDp) {
    dpConfig.temp = {
      code: tempDp.code,
      scale: resolveScale(tempDp.code, tempDp.value, specMap, 0.1, (v) =>
        Math.abs(v) > 65 ? 0.1 : 1
      ),
    };
  }

  const humidityDp = findMatchingDp(rawStatus, HUMIDITY_CODES);
  if (humidityDp) {
    dpConfig.humidity = {
      code: humidityDp.code,
      scale: resolveScale(humidityDp.code, humidityDp.value, specMap, 1, (v) => (v > 100 ? 0.1 : 1)),
    };
  }

  const batteryDp = findMatchingDp(rawStatus, BATTERY_CODES);
  if (batteryDp) {
    dpConfig.battery = {
      code: batteryDp.code,
      scale: resolveScale(batteryDp.code, batteryDp.value, specMap, 1),
    };
  }

  const hasPower = Boolean(dpConfig.power || dpConfig.addEle);
  const hasClimate = Boolean(dpConfig.temp || dpConfig.humidity);
  const category: DeviceCategory =
    hasPower && hasClimate ? 'hybrid' : hasPower ? 'power' : hasClimate ? 'climate' : 'other';

  return { dpConfig, category };
}

export interface ExtractedMetrics {
  powerW: number | null;
  voltageV: number | null;
  currentMa: number | null;
  addEleKwh: number | null;
  tempC: number | null;
  humidityPct: number | null;
  batteryPct: number | null;
}

function readScaledMetric(
  rawStatus: RawDpStatus[],
  mapping?: { code: string; scale: number }
): number | null {
  if (!mapping?.code) return null;
  const dp = rawStatus.find((item) => item.code === mapping.code);
  if (!dp || typeof dp.value !== 'number' || !Number.isFinite(dp.value)) {
    return null;
  }
  const scaled = dp.value * (mapping.scale || 1);
  return Math.round(scaled * 1000) / 1000;
}

export function extractMetricsFromStatus(
  rawStatus: RawDpStatus[],
  dpConfig: DpConfig
): ExtractedMetrics {
  return {
    powerW: readScaledMetric(rawStatus, dpConfig.power),
    voltageV: readScaledMetric(rawStatus, dpConfig.voltage),
    currentMa: readScaledMetric(rawStatus, dpConfig.current),
    addEleKwh: readScaledMetric(rawStatus, dpConfig.addEle),
    tempC: readScaledMetric(rawStatus, dpConfig.temp),
    humidityPct: readScaledMetric(rawStatus, dpConfig.humidity),
    batteryPct: readScaledMetric(rawStatus, dpConfig.battery),
  };
}
