import crypto from 'node:crypto';
import { fetchWithTimeout } from '@/lib/http-utils';
import type { DeviceCategory, RawDpStatus } from '@/types';
import type { NormalizedVendorDevice, VendorInventoryResult } from './registry';

const KASA_REGION_URLS: Record<string, string> = {
  eu: 'https://eu-wap.tplinkcloud.com',
  us: 'https://use1-wap.tplinkcloud.com',
  ap: 'https://aps1-wap.tplinkcloud.com',
  global: 'https://wap.tplinkcloud.com',
};

const KASA_APP_TYPE_CANDIDATES = ['Tapo_Ios', 'Kasa_Android', 'Tapo_Android'] as const;

export interface KasaConfig {
  email: string;
  password: string;
  region: string;
  cloudUrl: string;
  explicitCloudUrl: boolean;
  terminalUuid: string;
  configured: boolean;
}

export interface KasaRawDevice {
  deviceId: string;
  alias?: string;
  deviceName?: string;
  deviceModel?: string;
  deviceType?: string;
  deviceMac?: string;
  status?: number | boolean;
  appServerUrl?: string;
  fwVer?: string;
  hwVer?: string;
  roomName?: string;
  room?: string;
  groupName?: string;
  location?: string;
  roomId?: string;
  [key: string]: unknown;
}

export interface KasaEmeterRealtime {
  powerW: number | null;
  voltageV: number | null;
  currentMa: number | null;
  addEleKwh: number | null;
}

export interface KasaInventoryResult extends VendorInventoryResult {
  sessionToken: string;
  cloudUrl: string;
}

export class KasaCloudError extends Error {
  readonly errorCode: number;

  constructor(errorCode: number, message: string) {
    super(message);
    this.name = 'KasaCloudError';
    this.errorCode = errorCode;
  }
}

/**
 * Dérive un UUIDv4 déterministe à partir de l'adresse email afin que les appels serverless
 * réutilisent le même terminalUUID et évitent les blocages de sessions concurrentes (-20675).
 */
export function deriveKasaTerminalUuid(email: string): string {
  const normalized = email.trim().toLowerCase();
  const hex = crypto
    .createHash('sha256')
    .update(`home-cockpit-kasa:${normalized}`)
    .digest('hex')
    .slice(0, 32)
    .split('');

  // Version 4 & variant RFC 4122 (8, 9, a, b)
  hex[12] = '4';
  const variantNibble = (parseInt(hex[16], 16) & 0x3) | 0x8;
  hex[16] = variantNibble.toString(16);

  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20, 32)}`;
}

export function getKasaConfig(): KasaConfig {
  const email = process.env.KASA_EMAIL?.trim() || process.env.KASA_USERNAME?.trim() || '';
  const password = process.env.KASA_PASSWORD?.trim() || '';
  const region = process.env.KASA_REGION?.trim().toLowerCase() || 'eu';
  const rawExplicitUrl = process.env.KASA_CLOUD_URL?.trim().replace(/\/+$/, '') || '';
  const explicitCloudUrl = Boolean(rawExplicitUrl);
  const cloudUrl = rawExplicitUrl || KASA_REGION_URLS[region] || KASA_REGION_URLS.global;
  const terminalUuid =
    process.env.KASA_TERMINAL_UUID?.trim() || deriveKasaTerminalUuid(email);

  return {
    email,
    password,
    region,
    cloudUrl,
    explicitCloudUrl,
    terminalUuid,
    configured: Boolean(email && password),
  };
}

export function makeKasaDeviceId(externalId: string): string {
  return `kasa_${externalId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)}`;
}

function formatKasaError(errorCode: number, rawMsg?: string): string {
  switch (errorCode) {
    case -20601:
      return 'Identifiants TP-Link Kasa incorrects (vérifiez KASA_EMAIL et KASA_PASSWORD).';
    case -20600:
      return "Compte TP-Link introuvable pour ce serveur / type d'application.";
    case -20651:
      return 'Jeton de session TP-Link Cloud expiré.';
    case -20675:
    case -20677:
    case -20004:
      return 'Authentification bloquée par TP-Link Cloud (la double authentification 2FA/MFA doit être désactivée sur votre compte TP-Link/Kasa pour la connexion cloud, ou réessayez dans quelques minutes).';
    case -20200:
    case -20571:
      return 'Appareil hors ligne ou injoignable via le cloud TP-Link.';
    default:
      return `TP-Link Cloud erreur ${errorCode}${rawMsg ? ` : ${rawMsg}` : ''}`;
  }
}

async function kasaCloudRpc<T = unknown>(
  baseUrl: string,
  body: Record<string, unknown>,
  token?: string
): Promise<T> {
  const cleanUrl = baseUrl.replace(/\/+$/, '');
  const endpoint = token ? `${cleanUrl}?token=${encodeURIComponent(token)}` : cleanUrl;

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 13; Kasa)',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();
  let parsed: { error_code?: unknown; msg?: unknown; result?: T } | null = null;
  try {
    parsed = JSON.parse(text) as { error_code?: unknown; msg?: unknown; result?: T };
  } catch {
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} TP-Link Cloud`);
    }
    throw new Error('Réponse non-JSON reçue du cloud TP-Link');
  }

  if (typeof parsed.error_code === 'number' && parsed.error_code !== 0) {
    const rawMsg = typeof parsed.msg === 'string' ? parsed.msg : undefined;
    throw new KasaCloudError(parsed.error_code, formatKasaError(parsed.error_code, rawMsg));
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} TP-Link Cloud`);
  }

  return parsed.result as T;
}

export async function kasaCloudLogin(
  config: KasaConfig = getKasaConfig()
): Promise<{ token: string; cloudUrl: string; appType: string }> {
  if (!config.configured) {
    throw new Error(
      'Identifiants Kasa manquants. Configurez KASA_EMAIL et KASA_PASSWORD dans Vercel / .env.local.'
    );
  }

  const urlCandidates: string[] = [config.cloudUrl];
  if (!config.explicitCloudUrl && config.cloudUrl !== KASA_REGION_URLS.global) {
    urlCandidates.push(KASA_REGION_URLS.global);
  }

  let lastError: unknown = null;

  for (const url of urlCandidates) {
    for (const appType of KASA_APP_TYPE_CANDIDATES) {
      try {
        const result = await kasaCloudRpc<{ token?: string }>(url, {
          method: 'login',
          params: {
            appType,
            cloudUserName: config.email,
            cloudPassword: config.password,
            terminalUUID: config.terminalUuid,
          },
        });
        if (result?.token && typeof result.token === 'string') {
          return { token: result.token, cloudUrl: url, appType };
        }
      } catch (err) {
        lastError = err;
        if (err instanceof KasaCloudError && err.errorCode === -20600) {
          continue;
        }
        throw err;
      }
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('Impossible de se connecter au cloud TP-Link Kasa.');
}

export function formatKasaMac(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (cleaned.length !== 12) return null;
  return cleaned.match(/.{2}/g)?.join(':') ?? null;
}

/**
 * Décode sans risque un alias Kasa/Tapo possiblement encodé en Base64 UTF-8,
 * tout en préservant les alias ASCII classiques non encodés (ex: "Lamp", "Home").
 */
export function decodeKasaAlias(raw: unknown, deviceType?: string | null): string {
  if (typeof raw !== 'string') return '';
  const str = raw.trim();
  if (!str) return '';

  const looksLikeBase64 =
    str.length >= 4 && str.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(str);
  if (!looksLikeBase64) return str;

  try {
    const buf = Buffer.from(str, 'base64');
    const decoded = buf.toString('utf8');
    if (!decoded || decoded.includes('\uFFFD')) return str;
    // Rejette tout caractère de contrôle ASCII
    if (/[\x00-\x1F\x7F]/.test(decoded)) return str;

    const roundTrip = Buffer.from(decoded, 'utf8').toString('base64');
    if (roundTrip !== str) return str;

    const isTapo = (deviceType ?? '').toUpperCase().includes('TAPO');
    const hasExplicitPadding = str.endsWith('=');
    const hasSpaceOrNonAscii = /[\s\u0080-\uFFFF]/.test(decoded);

    if (hasExplicitPadding || isTapo || (str.length >= 8 && hasSpaceOrNonAscii)) {
      return decoded.trim() || str;
    }
  } catch {
    return str;
  }

  return str;
}

function roundTo(val: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

/**
 * Extrait W, V, mA et kWh cumulés depuis emeter.get_realtime (v1 ou v2).
 */
export function parseKasaEmeterRealtime(realtime: unknown): KasaEmeterRealtime {
  if (!realtime || typeof realtime !== 'object' || Array.isArray(realtime)) {
    return { powerW: null, voltageV: null, currentMa: null, addEleKwh: null };
  }

  const data = realtime as Record<string, unknown>;
  if (typeof data.err_code === 'number' && data.err_code !== 0) {
    return { powerW: null, voltageV: null, currentMa: null, addEleKwh: null };
  }

  let powerW: number | null = null;
  if (typeof data.power_mw === 'number' && Number.isFinite(data.power_mw)) {
    powerW = roundTo(data.power_mw / 1000, 2);
  } else if (typeof data.power === 'number' && Number.isFinite(data.power)) {
    powerW = roundTo(data.power, 2);
  }

  let voltageV: number | null = null;
  if (typeof data.voltage_mv === 'number' && Number.isFinite(data.voltage_mv)) {
    voltageV = roundTo(data.voltage_mv / 1000, 1);
  } else if (typeof data.voltage === 'number' && Number.isFinite(data.voltage)) {
    voltageV = roundTo(data.voltage, 1);
  }

  let currentMa: number | null = null;
  if (typeof data.current_ma === 'number' && Number.isFinite(data.current_ma)) {
    currentMa = roundTo(data.current_ma, 1);
  } else if (typeof data.current === 'number' && Number.isFinite(data.current)) {
    currentMa = roundTo(data.current * 1000, 1);
  }

  let addEleKwh: number | null = null;
  if (typeof data.total_wh === 'number' && Number.isFinite(data.total_wh)) {
    addEleKwh = roundTo(data.total_wh / 1000, 3);
  } else if (typeof data.total === 'number' && Number.isFinite(data.total)) {
    addEleKwh = roundTo(data.total, 3);
  }

  return { powerW, voltageV, currentMa, addEleKwh };
}

function collectArrayCandidates(payload: unknown, keys: string[]): unknown[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  for (const k of keys) {
    if (Array.isArray(obj[k])) return obj[k] as unknown[];
  }
  return [];
}

function extractDeviceIdFromMember(member: unknown): string | null {
  if (typeof member === 'string' && member.trim()) return member.trim();
  if (member && typeof member === 'object') {
    const m = member as Record<string, unknown>;
    const candidate = m.childId ?? m.deviceId ?? m.id;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

/**
 * Agrège de manière pure et dédupliquée les pièces et groupes TP-Link Kasa Cloud
 * (listDeviceGroups / getGroupList / getRoomList / getHomeList / getFamilyList + métadonnées appareils).
 */
export function parseKasaGroupRoomMapping(params: {
  groupPayloads?: unknown[];
  roomPayloads?: unknown[];
  rawDevices?: KasaRawDevice[];
}): { roomNames: string[]; deviceRoomMap: Map<string, string> } {
  const seenRoomLower = new Map<string, string>();
  const roomNames: string[] = [];
  const deviceRoomMap = new Map<string, string>();
  const roomIdToName = new Map<string, string>();

  const registerRoomName = (rawName: unknown, deviceTypeHint?: string | null): string | null => {
    const decoded = decodeKasaAlias(rawName, deviceTypeHint);
    if (!decoded) return null;
    const lower = decoded.toLowerCase();
    const existing = seenRoomLower.get(lower);
    if (existing) return existing;
    seenRoomLower.set(lower, decoded);
    roomNames.push(decoded);
    return decoded;
  };

  // 1. Pièces explicites (getRoomList / getHomeList / getFamilyList) — prioritaires sur les groupes
  const roomObjects: Array<Record<string, unknown>> = [];
  for (const payload of params.roomPayloads ?? []) {
    if (!payload || typeof payload !== 'object') continue;
    const obj = payload as Record<string, unknown>;
    for (const r of collectArrayCandidates(obj, ['roomList', 'rooms'])) {
      if (r && typeof r === 'object') roomObjects.push(r as Record<string, unknown>);
    }
    for (const container of collectArrayCandidates(obj, ['homeList', 'familyList', 'homes', 'families'])) {
      if (!container || typeof container !== 'object') continue;
      for (const r of collectArrayCandidates(container, ['roomList', 'rooms'])) {
        if (r && typeof r === 'object') roomObjects.push(r as Record<string, unknown>);
      }
    }
  }

  for (const roomObj of roomObjects) {
    const name = registerRoomName(roomObj.roomName ?? roomObj.name ?? roomObj.alias, 'TAPO');
    if (!name) continue;
    const roomIdVal = roomObj.roomId ?? roomObj.id;
    if (typeof roomIdVal === 'string' && roomIdVal.trim()) {
      roomIdToName.set(roomIdVal.trim(), name);
    }
    const members = collectArrayCandidates(roomObj, [
      'deviceList',
      'deviceIds',
      'deviceIdList',
      'devices',
      'members',
    ]);
    for (const member of members) {
      const id = extractDeviceIdFromMember(member);
      if (id && !deviceRoomMap.has(id)) {
        deviceRoomMap.set(id, name);
      }
    }
  }

  // 2. Groupes d'appareils (listDeviceGroups / getGroupList)
  for (const payload of params.groupPayloads ?? []) {
    const groups = collectArrayCandidates(payload, ['groupList', 'groups', 'list']);
    for (const g of groups) {
      if (!g || typeof g !== 'object') continue;
      const gObj = g as Record<string, unknown>;
      const groupName = registerRoomName(
        gObj.groupName ?? gObj.name ?? gObj.alias ?? gObj.roomName
      );
      if (!groupName) continue;
      const members = collectArrayCandidates(gObj, [
        'deviceList',
        'deviceIds',
        'deviceIdList',
        'devices',
        'members',
      ]);
      for (const member of members) {
        const id = extractDeviceIdFromMember(member);
        if (id && !deviceRoomMap.has(id)) {
          deviceRoomMap.set(id, groupName);
        }
      }
    }
  }

  // 3. Métadonnées directes sur les objets appareils
  for (const dev of params.rawDevices ?? []) {
    const id = typeof dev.deviceId === 'string' ? dev.deviceId.trim() : '';
    const linkedByRoomId =
      typeof dev.roomId === 'string' && dev.roomId.trim()
        ? roomIdToName.get(dev.roomId.trim()) ?? null
        : null;
    const directRoom = registerRoomName(
      dev.roomName ?? dev.room ?? dev.groupName ?? dev.location ?? linkedByRoomId,
      dev.deviceType
    );
    if (id && directRoom && !deviceRoomMap.has(id)) {
      deviceRoomMap.set(id, directRoom);
    }
  }

  return { roomNames, deviceRoomMap };
}

function inferKasaCategory(params: {
  model?: string | null;
  deviceType?: string | null;
  sysinfo?: Record<string, unknown> | null;
  emeter: KasaEmeterRealtime;
}): DeviceCategory {
  const feature = typeof params.sysinfo?.feature === 'string' ? params.sysinfo.feature : '';
  const model = (params.model ?? '').toUpperCase();
  const dtype = (params.deviceType ?? '').toUpperCase();

  if (
    params.emeter.powerW !== null ||
    params.emeter.addEleKwh !== null ||
    feature.includes('ENE') ||
    /\b(HS110|HS300|KP115|KP125|KP125M|EP25|P110|P115)\b/i.test(model)
  ) {
    return 'power';
  }

  if (
    typeof params.sysinfo?.temp_c === 'number' ||
    typeof params.sysinfo?.current_temp === 'number' ||
    typeof params.sysinfo?.humidity === 'number' ||
    dtype.includes('THERMOSTAT') ||
    dtype.includes('SENSOR.TEMP')
  ) {
    return 'climate';
  }

  if (dtype.includes('CONTACT') || dtype.includes('SENSOR.OPEN')) {
    return 'contact';
  }

  return 'other';
}

function buildKasaRawTraits(params: {
  raw: KasaRawDevice;
  sysinfo?: Record<string, unknown> | null;
  emeter: KasaEmeterRealtime;
  relayState: unknown;
  brightness?: unknown;
}): RawDpStatus[] {
  const traits: RawDpStatus[] = [];

  if (typeof params.relayState === 'number' || typeof params.relayState === 'boolean') {
    traits.push({ code: 'relay_state', value: Boolean(params.relayState) });
  }
  if (params.emeter.powerW !== null) {
    traits.push({ code: 'power_w', value: params.emeter.powerW });
  }
  if (params.emeter.voltageV !== null) {
    traits.push({ code: 'voltage_v', value: params.emeter.voltageV });
  }
  if (params.emeter.currentMa !== null) {
    traits.push({ code: 'current_ma', value: params.emeter.currentMa });
  }
  if (params.emeter.addEleKwh !== null) {
    traits.push({ code: 'total_kwh', value: params.emeter.addEleKwh });
  }
  if (typeof params.brightness === 'number') {
    traits.push({ code: 'brightness', value: params.brightness });
  }
  if (typeof params.sysinfo?.rssi === 'number') {
    traits.push({ code: 'rssi', value: params.sysinfo.rssi });
  }
  if (params.raw.deviceModel || params.raw.deviceName) {
    traits.push({
      code: 'model',
      value: params.raw.deviceModel || params.raw.deviceName,
    });
  }
  if (params.raw.fwVer) {
    traits.push({ code: 'fw_ver', value: params.raw.fwVer });
  }
  if (params.raw.deviceType) {
    traits.push({ code: 'device_type', value: params.raw.deviceType });
  }

  return traits;
}

/**
 * Normalise un appareil Kasa (ou une multiprise multi-prises HS300/KP303 avec sysinfo.children)
 * au format unifié `NormalizedVendorDevice[]`.
 */
export function normalizeKasaDeviceEntry(params: {
  raw: KasaRawDevice;
  sysinfo?: Record<string, unknown> | null;
  emeter?: unknown;
  childEmeters?: Map<string, unknown>;
  roomMap?: Map<string, string>;
}): NormalizedVendorDevice[] {
  const { raw, sysinfo, emeter, childEmeters, roomMap } = params;
  const parentId = String(raw.deviceId ?? '').trim();
  if (!parentId) return [];

  const isOnline = raw.status === 1 || raw.status === true;
  const model =
    (typeof raw.deviceModel === 'string' && raw.deviceModel.trim()) ||
    (typeof sysinfo?.model === 'string' && sysinfo.model.trim()) ||
    (typeof raw.deviceName === 'string' && raw.deviceName.trim()) ||
    null;
  const deviceType = typeof raw.deviceType === 'string' ? raw.deviceType : null;
  const macAddress =
    formatKasaMac(sysinfo?.mac ?? sysinfo?.mic_mac ?? raw.deviceMac) ?? null;

  const fallbackRoomRaw =
    raw.roomName ?? raw.room ?? raw.groupName ?? raw.location ?? sysinfo?.location ?? null;
  const fallbackRoom = decodeKasaAlias(fallbackRoomRaw, deviceType) || null;
  const parentRoom = roomMap?.get(parentId) ?? fallbackRoom;
  const parentName =
    decodeKasaAlias(raw.alias ?? sysinfo?.alias, deviceType) ||
    model ||
    `Kasa ${parentId.slice(-6)}`;

  const children = Array.isArray(sysinfo?.children) ? sysinfo.children : [];
  if (children.length > 0) {
    const results: NormalizedVendorDevice[] = [];
    for (let idx = 0; idx < children.length; idx++) {
      const child = children[idx];
      if (!child || typeof child !== 'object') continue;
      const c = child as Record<string, unknown>;
      const rawChildId = typeof c.id === 'string' ? c.id.trim() : String(idx).padStart(2, '0');
      const fullChildId = rawChildId.startsWith(parentId)
        ? rawChildId
        : `${parentId}${rawChildId}`;
      const childAlias =
        decodeKasaAlias(c.alias, deviceType) || `${parentName} · Prise ${idx + 1}`;
      const childEmeterRaw = childEmeters?.get(fullChildId) ?? childEmeters?.get(rawChildId) ?? null;
      const childEmeter = parseKasaEmeterRealtime(childEmeterRaw);
      const category = inferKasaCategory({ model, deviceType, sysinfo, emeter: childEmeter });
      const roomName = roomMap?.get(fullChildId) ?? parentRoom;

      results.push({
        externalId: fullChildId,
        name: childAlias,
        roomName,
        manufacturer: 'TP-Link',
        model,
        deviceType,
        category,
        isOnline,
        tempC: null,
        humidityPct: null,
        batteryPct: null,
        contactOpen: null,
        powerW: childEmeter.powerW,
        voltageV: childEmeter.voltageV,
        addEleKwh: childEmeter.addEleKwh,
        macAddress,
        ipAddress: null,
        rawTraits: buildKasaRawTraits({
          raw,
          sysinfo,
          emeter: childEmeter,
          relayState: c.state,
        }),
      });
    }
    if (results.length > 0) return results;
  }

  const parsedEmeter = parseKasaEmeterRealtime(emeter);
  const category = inferKasaCategory({ model, deviceType, sysinfo, emeter: parsedEmeter });
  const lightState =
    sysinfo?.light_state && typeof sysinfo.light_state === 'object'
      ? (sysinfo.light_state as Record<string, unknown>)
      : null;
  const relayState = sysinfo?.relay_state ?? lightState?.on_off;

  return [
    {
      externalId: parentId,
      name: parentName,
      roomName: parentRoom,
      manufacturer: 'TP-Link',
      model,
      deviceType,
      category,
      isOnline,
      tempC: null,
      humidityPct: null,
      batteryPct: null,
      contactOpen: null,
      powerW: parsedEmeter.powerW,
      voltageV: parsedEmeter.voltageV,
      addEleKwh: parsedEmeter.addEleKwh,
      macAddress,
      ipAddress: null,
      rawTraits: buildKasaRawTraits({
        raw,
        sysinfo,
        emeter: parsedEmeter,
        relayState,
        brightness: lightState?.brightness,
      }),
    },
  ];
}

async function fetchKasaDeviceList(cloudUrl: string, token: string): Promise<KasaRawDevice[]> {
  try {
    const res = await kasaCloudRpc<{ deviceList?: KasaRawDevice[] }>(
      cloudUrl,
      { method: 'getDeviceList' },
      token
    );
    if (Array.isArray(res?.deviceList) && res.deviceList.length > 0) {
      return res.deviceList;
    }
  } catch (err) {
    if (err instanceof KasaCloudError && err.errorCode === -20651) {
      throw err;
    }
    // Repli sur getDeviceListByPage si getDeviceList échoue ou est paginé
  }

  const all: KasaRawDevice[] = [];
  const pageSize = 50;
  for (let page = 0; page < 10; page++) {
    const res = await kasaCloudRpc<{ deviceList?: KasaRawDevice[]; totalNum?: number }>(
      cloudUrl,
      {
        method: 'getDeviceListByPage',
        params: { index: page * pageSize, limit: pageSize },
      },
      token
    ).catch((err) => {
      if (err instanceof KasaCloudError && err.errorCode === -20651) {
        throw err;
      }
      return null;
    });

    const items = Array.isArray(res?.deviceList) ? res.deviceList : [];
    if (items.length === 0) break;
    all.push(...items);
    if (items.length < pageSize) break;
  }

  return all;
}

async function fetchKasaPassthroughReadOnly(
  raw: KasaRawDevice,
  token: string,
  requestPayload: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const serverUrl = typeof raw.appServerUrl === 'string' ? raw.appServerUrl.trim() : '';
  if (!serverUrl || !serverUrl.startsWith('https://')) return null;

  const result = await kasaCloudRpc<{ responseData?: unknown }>(
    serverUrl,
    {
      method: 'passthrough',
      params: {
        deviceId: raw.deviceId,
        requestData: JSON.stringify(requestPayload),
      },
    },
    token
  );

  if (!result || result.responseData === undefined) return null;
  if (typeof result.responseData === 'string') {
    return JSON.parse(result.responseData) as Record<string, unknown>;
  }
  if (typeof result.responseData === 'object') {
    return result.responseData as Record<string, unknown>;
  }
  return null;
}

/**
 * Récupère l'inventaire complet TP-Link Kasa Cloud (100 % cloud, 100 % lecture seule).
 */
export async function fetchKasaInventory(options?: {
  cachedToken?: string | null;
  cachedCloudUrl?: string | null;
  includeTelemetry?: boolean;
}): Promise<KasaInventoryResult> {
  const cfg = getKasaConfig();
  let sessionToken = options?.cachedToken?.trim() || '';
  let cloudUrl = options?.cachedCloudUrl?.trim().replace(/\/+$/, '') || cfg.cloudUrl;

  if (!sessionToken) {
    const auth = await kasaCloudLogin(cfg);
    sessionToken = auth.token;
    cloudUrl = auth.cloudUrl;
  }

  let rawDevices: KasaRawDevice[];
  try {
    rawDevices = await fetchKasaDeviceList(cloudUrl, sessionToken);
  } catch (err) {
    if (err instanceof KasaCloudError && err.errorCode === -20651) {
      const auth = await kasaCloudLogin(cfg);
      sessionToken = auth.token;
      cloudUrl = auth.cloudUrl;
      rawDevices = await fetchKasaDeviceList(cloudUrl, sessionToken);
    } else {
      throw err;
    }
  }

  // Découverte best-effort des groupes & pièces côté cloud (toutes les méthodes sont en lecture seule)
  const [listGroupsRes, getRoomListRes, getHomeListRes, getFamilyListRes] = await Promise.all([
    kasaCloudRpc(
      cloudUrl,
      { method: 'listDeviceGroups', params: { paginator: { from: 0, pageSize: 50 } } },
      sessionToken
    ).catch(() => null),
    kasaCloudRpc(cloudUrl, { method: 'getRoomList' }, sessionToken).catch(() => null),
    kasaCloudRpc(cloudUrl, { method: 'getHomeList' }, sessionToken).catch(() => null),
    kasaCloudRpc(cloudUrl, { method: 'getFamilyList' }, sessionToken).catch(() => null),
  ]);

  const groupPayloads: unknown[] = [];
  if (listGroupsRes) {
    groupPayloads.push(listGroupsRes);
  } else {
    const legacyGroupsRes = await kasaCloudRpc(
      cloudUrl,
      { method: 'getGroupList' },
      sessionToken
    ).catch(() => null);
    if (legacyGroupsRes) groupPayloads.push(legacyGroupsRes);
  }

  const roomPayloads = [getRoomListRes, getHomeListRes, getFamilyListRes].filter(Boolean);

  // Relevé télémétrique cloud en lecture seule (get_sysinfo + emeter.get_realtime) par lots de 5
  const includeTelemetry = options?.includeTelemetry !== false;
  const sysinfoMap = new Map<string, Record<string, unknown>>();
  const emeterMap = new Map<string, unknown>();
  const childEmeterMap = new Map<string, unknown>();

  if (includeTelemetry && rawDevices.length > 0) {
    const onlineLegacyDevices = rawDevices.filter((d) => {
      const online = d.status === 1 || d.status === true;
      const serverUrl = typeof d.appServerUrl === 'string' && d.appServerUrl.startsWith('https://');
      const isTapoOnly = (d.deviceType ?? '').toUpperCase().includes('SMART.TAPO');
      return online && serverUrl && !isTapoOnly;
    });

    const BATCH_SIZE = 5;
    for (let i = 0; i < onlineLegacyDevices.length; i += BATCH_SIZE) {
      const batch = onlineLegacyDevices.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async (raw) => {
          try {
            const resp = await fetchKasaPassthroughReadOnly(raw, sessionToken, {
              system: { get_sysinfo: {} },
              emeter: { get_realtime: {} },
            });
            if (!resp) return;

            const sysSection =
              resp.system && typeof resp.system === 'object'
                ? ((resp.system as Record<string, unknown>).get_sysinfo as
                    | Record<string, unknown>
                    | undefined)
                : undefined;
            if (sysSection && typeof sysSection === 'object') {
              sysinfoMap.set(raw.deviceId, sysSection);
            }

            const emeterSection =
              resp.emeter && typeof resp.emeter === 'object'
                ? (resp.emeter as Record<string, unknown>).get_realtime
                : undefined;
            if (emeterSection !== undefined) {
              emeterMap.set(raw.deviceId, emeterSection);
            }

            // Prises enfants sur multiprises (ex. HS300) avec comptage énergétique par prise
            const children = Array.isArray(sysSection?.children) ? sysSection.children : [];
            const hasEne = String(sysSection?.feature ?? '').includes('ENE');
            if (children.length > 0 && hasEne) {
              await Promise.allSettled(
                children.map(async (child) => {
                  if (!child || typeof child !== 'object') return;
                  const c = child as Record<string, unknown>;
                  const childId = typeof c.id === 'string' ? c.id.trim() : '';
                  if (!childId) return;
                  const fullChildId = childId.startsWith(raw.deviceId)
                    ? childId
                    : `${raw.deviceId}${childId}`;
                  const childResp = await fetchKasaPassthroughReadOnly(raw, sessionToken, {
                    context: { child_ids: [fullChildId] },
                    emeter: { get_realtime: {} },
                  }).catch(() => null);
                  const childEmeter =
                    childResp?.emeter && typeof childResp.emeter === 'object'
                      ? (childResp.emeter as Record<string, unknown>).get_realtime
                      : undefined;
                  if (childEmeter !== undefined) {
                    childEmeterMap.set(fullChildId, childEmeter);
                  }
                })
              );
            }
          } catch {
            // Passthrough optionnel : on ignore les erreurs d'appareils non compatibles emeter
          }
        })
      );
    }
  }

  // Enrichit les métadonnées de pièce si sysinfo expose `location` / `roomName`
  const enrichedRawDevices = rawDevices.map((raw) => {
    const sysinfo = sysinfoMap.get(raw.deviceId);
    if (!sysinfo) return raw;
    return {
      ...raw,
      roomName:
        raw.roomName ??
        (typeof sysinfo.roomName === 'string' ? sysinfo.roomName : undefined) ??
        (typeof sysinfo.location === 'string' ? sysinfo.location : undefined),
    };
  });

  const { roomNames, deviceRoomMap } = parseKasaGroupRoomMapping({
    groupPayloads,
    roomPayloads,
    rawDevices: enrichedRawDevices,
  });

  const normalizedDevices: NormalizedVendorDevice[] = [];
  for (const raw of enrichedRawDevices) {
    normalizedDevices.push(
      ...normalizeKasaDeviceEntry({
        raw,
        sysinfo: sysinfoMap.get(raw.deviceId) ?? null,
        emeter: emeterMap.get(raw.deviceId) ?? null,
        childEmeters: childEmeterMap,
        roomMap: deviceRoomMap,
      })
    );
  }

  return {
    roomNames,
    devices: normalizedDevices,
    warning: undefined,
    sessionToken,
    cloudUrl,
  };
}
