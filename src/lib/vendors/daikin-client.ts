import { formatMacAddress } from '@/lib/tuya-client';
import { fetchWithTimeout } from '@/lib/http-utils';
import { asRecord, toFiniteNumber } from '@/lib/utils';
import type { RawDpStatus } from '@/types';
import type { NormalizedVendorDevice, VendorInventoryResult } from './registry';

const DAIKIN_AUTHORIZE_URL = 'https://idp.onecta.daikineurope.com/v1/oidc/authorize';
const DAIKIN_TOKEN_URL = 'https://idp.onecta.daikineurope.com/v1/oidc/token';
const DAIKIN_GATEWAY_DEVICES_URL = 'https://api.onecta.daikineurope.com/v1/gateway-devices';

// Scope officiel Onecta strictement utilisé en lecture seule (GET /v1/gateway-devices uniquement)
const DAIKIN_SCOPES = 'openid onecta:basic.integration';

export interface DaikinConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string | null;
  configured: boolean;
}

export class DaikinApiError extends Error {
  readonly status: number;
  readonly rateLimitRemainingDay: string | null;

  constructor(status: number, message: string, rateLimitRemainingDay: string | null = null) {
    super(message);
    this.name = 'DaikinApiError';
    this.status = status;
    this.rateLimitRemainingDay = rateLimitRemainingDay;
  }
}

export function getDaikinConfig(): DaikinConfig {
  const clientId =
    process.env.DAIKIN_CLIENT_ID?.trim() ||
    process.env.DAIKIN_ONECTA_CLIENT_ID?.trim() ||
    '';
  const clientSecret =
    process.env.DAIKIN_CLIENT_SECRET?.trim() ||
    process.env.DAIKIN_ONECTA_CLIENT_SECRET?.trim() ||
    '';
  const redirectUri =
    process.env.DAIKIN_REDIRECT_URI?.trim() ||
    process.env.DAIKIN_ONECTA_REDIRECT_URI?.trim() ||
    null;

  return {
    clientId,
    clientSecret,
    redirectUri,
    configured: Boolean(clientId && clientSecret),
  };
}

export function makeDaikinDeviceId(externalId: string): string {
  const safe = externalId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  return `daikin_${safe}`;
}

export function buildDaikinAuthorizeUrl(params: {
  redirectUri: string;
  state: string;
}): string {
  const cfg = getDaikinConfig();
  if (!cfg.configured) {
    throw new Error('Identifiants Daikin Onecta manquants (DAIKIN_CLIENT_ID / DAIKIN_CLIENT_SECRET).');
  }

  const url = new URL(DAIKIN_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', DAIKIN_SCOPES);
  url.searchParams.set('state', params.state);
  return url.toString();
}

/**
 * Permet d'extraire le code OAuth soit directement depuis un code collé,
 * soit depuis une URL complète de callback (utile sur http://localhost:3000 où Daikin exige une Redirect URI HTTPS).
 */
export function extractCodeFromRedirectInput(rawInput: string): {
  code: string;
  state: string | null;
} {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error('Collez l’URL complète de redirection Daikin ou le paramètre code.');
  }

  if (trimmed.includes('://') || trimmed.includes('?') || trimmed.includes('code=')) {
    let params: URLSearchParams;
    try {
      const normalizedUrl = trimmed.includes('://')
        ? new URL(trimmed)
        : new URL(trimmed.startsWith('?') ? `https://example.invalid/${trimmed}` : `https://example.invalid/?${trimmed}`);
      params = normalizedUrl.searchParams;
    } catch {
      throw new Error('Format d’URL de retour OAuth Daikin invalide.');
    }

    const oauthErr = params.get('error');
    if (oauthErr) {
      const desc = params.get('error_description');
      throw new Error(`Erreur OAuth Daikin (${oauthErr})${desc ? ` : ${desc}` : ''}`);
    }

    const code = params.get('code')?.trim();
    if (!code) {
      throw new Error('Paramètre « code » introuvable dans l’URL collée.');
    }
    return {
      code,
      state: params.get('state')?.trim() || null,
    };
  }

  return { code: trimmed, state: null };
}

export async function exchangeDaikinCodeForTokens(params: {
  code: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken: string | null; expiresInSec: number }> {
  const cfg = getDaikinConfig();
  if (!cfg.configured) {
    throw new Error('Identifiants Daikin Onecta manquants (DAIKIN_CLIENT_ID / DAIKIN_CLIENT_SECRET).');
  }

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  });

  const res = await fetchWithTimeout(DAIKIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    cache: 'no-store',
  });

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    throw new Error(
      `Échec échange token Daikin (${res.status}) : ${json.error_description || json.error || 'réponse invalide'}`
    );
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresInSec: typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 3600,
  };
}

export async function refreshDaikinAccessToken(params: {
  refreshToken: string;
}): Promise<{ accessToken: string; refreshToken: string | null; expiresInSec: number }> {
  const cfg = getDaikinConfig();
  if (!cfg.configured) {
    throw new Error('Identifiants Daikin Onecta manquants (DAIKIN_CLIENT_ID / DAIKIN_CLIENT_SECRET).');
  }

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: params.refreshToken,
  });

  const res = await fetchWithTimeout(DAIKIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    cache: 'no-store',
  });

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    throw new DaikinApiError(
      res.status,
      `Échec rafraîchissement token Daikin (${res.status}) : ${json.error_description || json.error || 'session expirée'}`
    );
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresInSec: typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 3600,
  };
}

function readNodeValue(node: unknown): unknown {
  const rec = asRecord(node);
  return rec && 'value' in rec ? rec.value : node;
}

function toStringValue(val: unknown): string | null {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed || null;
  }
  return null;
}

function toBooleanFlag(val: unknown): boolean | null {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'on' || lower === 'true' || lower === '1') return true;
    if (lower === 'off' || lower === 'false' || lower === '0') return false;
  }
  return null;
}

function sumCurrentPeriodArray(rawArr: unknown, expectedCurrentLen: number): number | null {
  if (!Array.isArray(rawArr) || rawArr.length === 0) return null;
  const currentSlice =
    rawArr.length > expectedCurrentLen ? rawArr.slice(-expectedCurrentLen) : rawArr;
  let total = 0;
  let hasNumeric = false;
  for (const item of currentSlice) {
    const num = toFiniteNumber(item);
    if (num !== null && num >= 0) {
      total += num;
      hasNumeric = true;
    }
  }
  return hasNumeric ? Math.round(total * 1000) / 1000 : null;
}

function extractElectricalConsumption(consumptionDataNode: unknown): {
  todayHeatingKwh: number | null;
  todayCoolingKwh: number | null;
  todayKwh: number | null;
  weekKwh: number | null;
  yearKwh: number | null;
  addEleKwh: number | null;
} {
  const root = asRecord(readNodeValue(consumptionDataNode));
  const electrical = asRecord(root?.electrical);
  if (!electrical) {
    return {
      todayHeatingKwh: null,
      todayCoolingKwh: null,
      todayKwh: null,
      weekKwh: null,
      yearKwh: null,
      addEleKwh: null,
    };
  }

  const heating = asRecord(electrical.heating);
  const cooling = asRecord(electrical.cooling);

  const todayHeat = sumCurrentPeriodArray(heating?.d, 12);
  const todayCool = sumCurrentPeriodArray(cooling?.d, 12);
  const todayKwh =
    todayHeat !== null || todayCool !== null
      ? Math.round(((todayHeat ?? 0) + (todayCool ?? 0)) * 1000) / 1000
      : null;

  const weekHeat = sumCurrentPeriodArray(heating?.w, 7);
  const weekCool = sumCurrentPeriodArray(cooling?.w, 7);
  const weekKwh =
    weekHeat !== null || weekCool !== null
      ? Math.round(((weekHeat ?? 0) + (weekCool ?? 0)) * 1000) / 1000
      : null;

  const yearHeat = sumCurrentPeriodArray(heating?.m, 12);
  const yearCool = sumCurrentPeriodArray(cooling?.m, 12);
  const yearKwh =
    yearHeat !== null || yearCool !== null
      ? Math.round(((yearHeat ?? 0) + (yearCool ?? 0)) * 1000) / 1000
      : null;

  const addEleKwh = yearKwh ?? weekKwh ?? todayKwh;
  return {
    todayHeatingKwh: todayHeat,
    todayCoolingKwh: todayCool,
    todayKwh,
    weekKwh,
    yearKwh,
    addEleKwh,
  };
}

function sanitizeDaikinIp(raw: unknown): string | null {
  const str = toStringValue(raw);
  if (!str) return null;
  const match = str.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  for (let i = 1; i <= 4; i++) {
    const oct = Number(match[i]);
    if (!Number.isInteger(oct) || oct < 0 || oct > 255) return null;
  }
  return str === '0.0.0.0' ? null : str;
}

const HVAC_MANAGEMENT_POINT_TYPES = new Set([
  'climateControl',
  'climateControlMainZone',
  'domesticHotWaterTank',
]);

export function normalizeDaikinGatewayDevices(rawDevice: unknown): NormalizedVendorDevice[] {
  const gwDev = asRecord(rawDevice);
  const gatewayId = toStringValue(gwDev?.id);
  if (!gwDev || !gatewayId) return [];

  const pointsRaw = Array.isArray(gwDev.managementPoints) ? gwDev.managementPoints : [];
  const points = pointsRaw.map(asRecord).filter((p): p is Record<string, unknown> => p !== null);

  const gatewayPoint = points.find((p) => p.managementPointType === 'gateway');
  const hvacPoints = points.filter(
    (p) =>
      typeof p.managementPointType === 'string' &&
      HVAC_MANAGEMENT_POINT_TYPES.has(p.managementPointType)
  );

  const isCloudUp = toBooleanFlag(readNodeValue(gwDev.isCloudConnectionUp)) ?? true;
  const gwModel =
    toStringValue(readNodeValue(gatewayPoint?.modelInfo)) ??
    toStringValue(gwDev.deviceModel) ??
    'Daikin Onecta';
  const serialNumber = toStringValue(readNodeValue(gatewayPoint?.serialNumber));
  const firmware = toStringValue(readNodeValue(gatewayPoint?.firmwareVersion));
  const macAddress = formatMacAddress(toStringValue(readNodeValue(gatewayPoint?.macAddress)));
  const ipAddress = sanitizeDaikinIp(readNodeValue(gatewayPoint?.ipAddress));
  const wifiSsid = toStringValue(readNodeValue(gatewayPoint?.wifiConnectionSSID));
  const wifiRssiDbm = toFiniteNumber(readNodeValue(gatewayPoint?.wifiConnectionStrength));
  const gatewayName = toStringValue(readNodeValue(gatewayPoint?.name));

  const targetPoints = hvacPoints.length > 0 ? hvacPoints : points.slice(0, 1);
  if (targetPoints.length === 0) return [];

  const results: NormalizedVendorDevice[] = [];
  for (const pt of targetPoints) {
    const mpType = toStringValue(pt.managementPointType) ?? 'climateControl';
    const embeddedId = toStringValue(pt.embeddedId) ?? mpType;
    const externalId =
      targetPoints.length > 1 ? `${gatewayId}::${embeddedId}` : gatewayId;

    const unitName = toStringValue(readNodeValue(pt.name));
    const displayName =
      unitName ||
      (targetPoints.length > 1 && mpType === 'domesticHotWaterTank'
        ? `${gatewayName || gwModel} ECS`
        : gatewayName || gwModel);

    const onOffMode = toStringValue(readNodeValue(pt.onOffMode))?.toLowerCase() ?? null;
    const operationMode = toStringValue(readNodeValue(pt.operationMode)) ?? null;

    const sensoryRoot = asRecord(readNodeValue(pt.sensoryData));
    const roomTempC = toFiniteNumber(readNodeValue(sensoryRoot?.roomTemperature));
    const roomHumidityPct = toFiniteNumber(readNodeValue(sensoryRoot?.roomHumidity));
    const outdoorTempC = toFiniteNumber(readNodeValue(sensoryRoot?.outdoorTemperature));
    const tankTempC = toFiniteNumber(readNodeValue(sensoryRoot?.tankTemperature));
    const tempC = roomTempC ?? tankTempC;

    const tempControlRoot = asRecord(readNodeValue(pt.temperatureControl));
    const tempOpModes = asRecord(tempControlRoot?.operationModes);
    const activeTempModeObj =
      (operationMode ? asRecord(tempOpModes?.[operationMode]) : null) ??
      asRecord(tempOpModes?.auto) ??
      asRecord(tempOpModes?.heating) ??
      asRecord(tempOpModes?.cooling) ??
      (tempOpModes ? asRecord(Object.values(tempOpModes)[0]) : null);
    const setpoints = asRecord(activeTempModeObj?.setpoints);
    const targetTempC =
      toFiniteNumber(readNodeValue(setpoints?.roomTemperature)) ??
      toFiniteNumber(readNodeValue(setpoints?.domesticHotWaterTemperature)) ??
      toFiniteNumber(readNodeValue(setpoints?.leavingWaterTemperature));

    const fanControlRoot = asRecord(readNodeValue(pt.fanControl));
    const fanOpModes = asRecord(fanControlRoot?.operationModes);
    const activeFanModeObj =
      (operationMode ? asRecord(fanOpModes?.[operationMode]) : null) ??
      asRecord(fanOpModes?.auto) ??
      asRecord(fanOpModes?.heating) ??
      asRecord(fanOpModes?.cooling) ??
      (fanOpModes ? asRecord(Object.values(fanOpModes)[0]) : null);
    const fanSpeedObj = asRecord(activeFanModeObj?.fanSpeed);
    const fanSpeed = toStringValue(readNodeValue(fanSpeedObj?.currentMode));
    const fanModes = asRecord(fanSpeedObj?.modes);
    const fanStep = toFiniteNumber(readNodeValue(fanModes?.fixed));
    const fanDirectionObj = asRecord(activeFanModeObj?.fanDirection);
    const swingVertical = toStringValue(
      readNodeValue(asRecord(fanDirectionObj?.vertical)?.currentMode)
    );
    const swingHorizontal = toStringValue(
      readNodeValue(asRecord(fanDirectionObj?.horizontal)?.currentMode)
    );

    const econo = toBooleanFlag(readNodeValue(pt.econoMode));
    const powerful = toBooleanFlag(readNodeValue(pt.powerfulMode));
    const streamer = toBooleanFlag(readNodeValue(pt.streamerMode));

    const energy = extractElectricalConsumption(pt.consumptionData);

    const rawTraits: RawDpStatus[] = [
      { code: 'daikin:unitType', value: mpType },
      { code: 'daikin:model', value: gwModel },
      ...(onOffMode ? [{ code: 'daikin:onOff', value: onOffMode }] : []),
      ...(operationMode ? [{ code: 'daikin:operationMode', value: operationMode }] : []),
      ...(targetTempC !== null ? [{ code: 'daikin:targetTempC', value: targetTempC }] : []),
      ...(tempC !== null ? [{ code: 'daikin:roomTempC', value: tempC }] : []),
      ...(roomHumidityPct !== null
        ? [{ code: 'daikin:roomHumidityPct', value: roomHumidityPct }]
        : []),
      ...(outdoorTempC !== null ? [{ code: 'daikin:outdoorTempC', value: outdoorTempC }] : []),
      ...(fanSpeed ? [{ code: 'daikin:fanSpeed', value: fanSpeed }] : []),
      ...(fanStep !== null ? [{ code: 'daikin:fanStep', value: fanStep }] : []),
      ...(swingVertical ? [{ code: 'daikin:swingVertical', value: swingVertical }] : []),
      ...(swingHorizontal ? [{ code: 'daikin:swingHorizontal', value: swingHorizontal }] : []),
      ...(econo !== null ? [{ code: 'daikin:econo', value: econo }] : []),
      ...(powerful !== null ? [{ code: 'daikin:powerful', value: powerful }] : []),
      ...(streamer !== null ? [{ code: 'daikin:streamer', value: streamer }] : []),
      ...(energy.todayKwh !== null ? [{ code: 'daikin:todayKwh', value: energy.todayKwh }] : []),
      ...(energy.todayHeatingKwh !== null
        ? [{ code: 'daikin:todayHeatingKwh', value: energy.todayHeatingKwh }]
        : []),
      ...(energy.todayCoolingKwh !== null
        ? [{ code: 'daikin:todayCoolingKwh', value: energy.todayCoolingKwh }]
        : []),
      ...(energy.weekKwh !== null ? [{ code: 'daikin:weekKwh', value: energy.weekKwh }] : []),
      ...(energy.yearKwh !== null ? [{ code: 'daikin:yearKwh', value: energy.yearKwh }] : []),
      ...(wifiSsid ? [{ code: 'daikin:wifiSsid', value: wifiSsid }] : []),
      ...(wifiRssiDbm !== null ? [{ code: 'daikin:wifiRssiDbm', value: wifiRssiDbm }] : []),
      ...(serialNumber ? [{ code: 'daikin:serialNumber', value: serialNumber }] : []),
      ...(firmware ? [{ code: 'daikin:firmware', value: firmware }] : []),
    ];

    const hasPower = energy.addEleKwh !== null;
    const hasClimate = tempC !== null || roomHumidityPct !== null;
    const category = hasPower && hasClimate ? 'hybrid' : hasPower ? 'power' : hasClimate ? 'climate' : 'other';

    results.push({
      externalId,
      name: displayName,
      roomName: null,
      manufacturer: 'Daikin',
      model: gwModel,
      deviceType: mpType,
      category,
      isOnline: isCloudUp,
      tempC,
      humidityPct: roomHumidityPct,
      batteryPct: null,
      contactOpen: null,
      powerW: null,
      voltageV: null,
      addEleKwh: energy.addEleKwh,
      macAddress,
      ipAddress,
      rawTraits,
    });
  }

  return results;
}

export async function fetchDaikinInventory(params: {
  accessToken: string;
}): Promise<VendorInventoryResult> {
  const res = await fetchWithTimeout(DAIKIN_GATEWAY_DEVICES_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const remainingDay = res.headers.get('x-ratelimit-remaining-day');
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    if (res.status === 429) {
      throw new DaikinApiError(
        429,
        'Quota journalier Daikin Onecta atteint (200 req/jour). Réessayez ultérieurement.',
        remainingDay
      );
    }
    throw new DaikinApiError(
      res.status,
      `Erreur API Daikin Onecta (${res.status}) : ${errBody.message || errBody.error || 'requête refusée'}`,
      remainingDay
    );
  }

  const payload = (await res.json()) as unknown;
  const list = Array.isArray(payload) ? payload : [];
  const devices: NormalizedVendorDevice[] = [];

  for (const item of list) {
    devices.push(...normalizeDaikinGatewayDevices(item));
  }

  return {
    roomNames: [],
    devices,
  };
}
