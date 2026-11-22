import crypto from 'node:crypto';
import type { DeviceCategory, RawDpStatus } from '@/types';
import { isSomfyCoverUiClass, type SomfyProtocol } from '@/lib/covers-utils';
import type { NormalizedVendorDevice, VendorInventoryResult } from './registry';

export type SomfyRegion = 'eu' | 'na' | 'oc';

const SOMFY_OVERKIZ_BASE_URLS: Record<SomfyRegion, string> = {
  eu: 'https://ha101-1.overkiz.com/enduser-mobile-web/enduserAPI',
  na: 'https://ha401-1.overkiz.com/enduser-mobile-web/enduserAPI',
  oc: 'https://ha201-1.overkiz.com/enduser-mobile-web/enduserAPI',
};

const INTERNAL_UI_CLASSES = new Set<string>([
  'ProtocolGateway',
  'Pod',
  'NetworkComponent',
  'Controller',
  'Unknown',
]);

export interface SomfyConfig {
  email: string;
  password: string;
  region: SomfyRegion;
  baseUrl: string;
  gatewayIp: string | null;
  gatewayMac: string | null;
  configured: boolean;
}

export interface OverkizPlace {
  oid: string;
  label?: string;
  type?: number;
  subPlaces?: OverkizPlace[];
}

export interface OverkizRawState {
  name: string;
  type?: number;
  value?: unknown;
}

export interface OverkizRawDevice {
  deviceURL: string;
  label?: string;
  controllableName?: string;
  uiClass?: string;
  placeOID?: string;
  available?: boolean;
  enabled?: boolean;
  widget?: string;
  type?: number;
  states?: OverkizRawState[];
  attributes?: OverkizRawState[];
}

export interface OverkizRawGateway {
  gatewayId?: string;
  type?: number;
  alive?: boolean;
  mode?: string;
  ip?: string;
  ipAddress?: string;
  localIp?: string;
  mac?: string;
  macAddress?: string;
  connectivity?: {
    status?: string;
    protocolVersion?: string;
    ip?: string;
    ipAddress?: string;
    macAddress?: string;
  };
}

export interface OverkizSetupPayload {
  id?: string;
  gateways?: OverkizRawGateway[];
  rootPlace?: OverkizPlace;
  devices?: OverkizRawDevice[];
}

export interface SomfyGatewayNetworkInfo {
  gatewayId: string;
  ipAddress: string | null;
  macAddress: string | null;
}

export class SomfyCloudError extends Error {
  status?: number;
  errorCode?: string;

  constructor(message: string, opts?: { status?: number; errorCode?: string }) {
    super(message);
    this.name = 'SomfyCloudError';
    this.status = opts?.status;
    this.errorCode = opts?.errorCode;
  }
}

export function sanitizeSomfyIpv4(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'n/a' || lower === 'na' || lower === 'none' || lower === 'null' || trimmed === '0.0.0.0') {
    return null;
  }
  const match = trimmed.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  for (let i = 1; i <= 4; i++) {
    const octet = Number(match[i]);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
  }
  return trimmed;
}

export function formatSomfyMac(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return null;
  const compact = trimmed.replace(/[^A-F0-9]/g, '');
  if (compact.length !== 12) return null;
  const formatted = compact.match(/.{1,2}/g)?.join(':') ?? null;
  if (!formatted || formatted === '00:00:00:00:00:00' || formatted === 'FF:FF:FF:FF:FF:FF') {
    return null;
  }
  return formatted;
}

export function extractSomfyGatewayId(deviceUrl?: string | null): string | null {
  if (!deviceUrl) return null;
  const match = deviceUrl.trim().match(/^[a-z0-9+.-]+:\/\/([^/]+)/i);
  const gwId = match?.[1]?.trim();
  return gwId || null;
}

export function extractNetworkInfoFromEntries(
  entries?: OverkizRawState[] | null
): { ipAddress: string | null; macAddress: string | null } {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ipAddress: null, macAddress: null };
  }

  const byLowerName = new Map<string, unknown>();
  for (const item of entries) {
    if (item && typeof item.name === 'string') {
      byLowerName.set(item.name.toLowerCase(), item.value);
    }
  }

  const ipPriorityKeys = [
    'core:localipv4addressstate',
    'internal:localipv4addressstate',
    'core:ipaddressstate',
    'core:networkipaddressstate',
  ];
  let ipAddress: string | null = null;
  for (const key of ipPriorityKeys) {
    ipAddress = sanitizeSomfyIpv4(byLowerName.get(key));
    if (ipAddress) break;
  }
  if (!ipAddress) {
    for (const [key, val] of byLowerName.entries()) {
      if (/localip|ipv4|ipaddress/i.test(key)) {
        ipAddress = sanitizeSomfyIpv4(val);
        if (ipAddress) break;
      }
    }
  }

  const macPriorityKeys = [
    'core:networkmacstate',
    'core:macaddressstate',
    'internal:networkmacstate',
    'internal:macaddressstate',
    'core:wifimacaddressstate',
    'core:ethernetmacaddressstate',
  ];
  let macAddress: string | null = null;
  for (const key of macPriorityKeys) {
    macAddress = formatSomfyMac(byLowerName.get(key));
    if (macAddress) break;
  }
  if (!macAddress) {
    for (const [key, val] of byLowerName.entries()) {
      if (/macaddress|networkmac|macstate/i.test(key)) {
        macAddress = formatSomfyMac(val);
        if (macAddress) break;
      }
    }
  }

  return { ipAddress, macAddress };
}

export function extractSomfyGatewayNetworks(
  setup: OverkizSetupPayload,
  fallback?: { gatewayIp?: string | null; gatewayMac?: string | null }
): {
  byGatewayId: Map<string, SomfyGatewayNetworkInfo>;
  defaultGateway: SomfyGatewayNetworkInfo | null;
} {
  const byGatewayId = new Map<string, SomfyGatewayNetworkInfo>();
  const ensureEntry = (gwId: string): SomfyGatewayNetworkInfo => {
    const existing = byGatewayId.get(gwId);
    if (existing) return existing;
    const created: SomfyGatewayNetworkInfo = {
      gatewayId: gwId,
      ipAddress: null,
      macAddress: null,
    };
    byGatewayId.set(gwId, created);
    return created;
  };

  for (const gw of setup.gateways ?? []) {
    const gwId = (gw.gatewayId ?? '').trim();
    if (!gwId) continue;
    const entry = ensureEntry(gwId);
    const gwIp =
      sanitizeSomfyIpv4(gw.ip) ??
      sanitizeSomfyIpv4(gw.ipAddress) ??
      sanitizeSomfyIpv4(gw.localIp) ??
      sanitizeSomfyIpv4(gw.connectivity?.ip) ??
      sanitizeSomfyIpv4(gw.connectivity?.ipAddress);
    const gwMac =
      formatSomfyMac(gw.mac) ??
      formatSomfyMac(gw.macAddress) ??
      formatSomfyMac(gw.connectivity?.macAddress);
    if (gwIp && !entry.ipAddress) entry.ipAddress = gwIp;
    if (gwMac && !entry.macAddress) entry.macAddress = gwMac;
  }

  for (const dev of setup.devices ?? []) {
    const gwId = extractSomfyGatewayId(dev.deviceURL);
    if (!gwId) continue;
    const isPodOrGateway =
      isInternalSomfyDevice(dev) || byGatewayId.has(gwId);
    if (!isPodOrGateway) continue;

    const fromStates = extractNetworkInfoFromEntries(dev.states);
    const fromAttrs = extractNetworkInfoFromEntries(dev.attributes);
    const ipAddress = fromStates.ipAddress ?? fromAttrs.ipAddress;
    const macAddress = fromStates.macAddress ?? fromAttrs.macAddress;
    if (ipAddress || macAddress || byGatewayId.has(gwId)) {
      const entry = ensureEntry(gwId);
      if (ipAddress && !entry.ipAddress) entry.ipAddress = ipAddress;
      if (macAddress && !entry.macAddress) entry.macAddress = macAddress;
    }
  }

  const fallbackIp = sanitizeSomfyIpv4(fallback?.gatewayIp);
  const fallbackMac = formatSomfyMac(fallback?.gatewayMac);

  for (const entry of byGatewayId.values()) {
    if (!entry.ipAddress && fallbackIp) entry.ipAddress = fallbackIp;
    if (!entry.macAddress && fallbackMac) entry.macAddress = fallbackMac;
  }

  let defaultGateway: SomfyGatewayNetworkInfo | null = null;
  if (byGatewayId.size === 1) {
    defaultGateway = [...byGatewayId.values()][0];
  } else if (byGatewayId.size > 1) {
    const firstWithNetwork = [...byGatewayId.values()].find(
      (g) => g.ipAddress || g.macAddress
    );
    defaultGateway = firstWithNetwork ?? [...byGatewayId.values()][0];
  } else if (fallbackIp || fallbackMac) {
    defaultGateway = {
      gatewayId: '',
      ipAddress: fallbackIp,
      macAddress: fallbackMac,
    };
  }

  return { byGatewayId, defaultGateway };
}

export function normalizeSomfyRegion(raw?: string | null): SomfyRegion {
  const val = (raw ?? 'eu').toLowerCase().trim();
  if (val === 'na' || val === 'us' || val === 'north_america') return 'na';
  if (val === 'oc' || val === 'au' || val === 'oceania') return 'oc';
  return 'eu';
}

export function getSomfyBaseUrl(region: SomfyRegion, overrideUrl?: string | null): string {
  const custom = (overrideUrl ?? process.env.SOMFY_CLOUD_URL ?? '').trim().replace(/\/+$/, '');
  if (custom) return custom;
  return SOMFY_OVERKIZ_BASE_URLS[region];
}

export function getSomfyConfig(): SomfyConfig {
  const email = (process.env.SOMFY_EMAIL ?? '').trim();
  const password = process.env.SOMFY_PASSWORD ?? '';
  const region = normalizeSomfyRegion(process.env.SOMFY_REGION);
  const baseUrl = getSomfyBaseUrl(region);
  const gatewayIp = sanitizeSomfyIpv4(process.env.SOMFY_GATEWAY_IP);
  const gatewayMac = formatSomfyMac(process.env.SOMFY_GATEWAY_MAC);
  return {
    email,
    password,
    region,
    baseUrl,
    gatewayIp,
    gatewayMac,
    configured: Boolean(email && password),
  };
}

export function makeSomfyDeviceId(deviceUrl: string): string {
  const digest = crypto.createHash('sha1').update(deviceUrl).digest('hex').slice(0, 18);
  return `somfy_${digest}`;
}

export function detectSomfyProtocol(
  deviceUrl?: string | null,
  controllableName?: string | null
): SomfyProtocol {
  const lowerUrl = (deviceUrl ?? '').toLowerCase();
  const lowerCtrl = (controllableName ?? '').toLowerCase();
  if (lowerUrl.startsWith('io://') || lowerCtrl.startsWith('io:')) return 'io';
  if (lowerUrl.startsWith('rts://') || lowerCtrl.startsWith('rts:')) return 'RTS';
  if (lowerUrl.startsWith('zigbee://') || lowerCtrl.startsWith('zigbee:')) return 'Zigbee';
  return 'Overkiz';
}

export function isInternalSomfyDevice(device: Pick<OverkizRawDevice, 'deviceURL' | 'controllableName' | 'uiClass'>): boolean {
  const url = (device.deviceURL ?? '').toLowerCase();
  const ctrl = (device.controllableName ?? '').toLowerCase();
  const uiClass = (device.uiClass ?? '').trim();
  if (url.startsWith('internal://') || ctrl.startsWith('internal:')) return true;
  if (INTERNAL_UI_CLASSES.has(uiClass)) return true;
  if (ctrl.includes('diagnostic') || ctrl.includes('stack:')) return true;
  return false;
}

export function extractSomfyPlacesMap(rootPlace?: OverkizPlace | null): {
  placesMap: Map<string, string>;
  roomNames: string[];
} {
  const placesMap = new Map<string, string>();
  const roomNameSet = new Set<string>();

  function visit(place: OverkizPlace, isRoot: boolean) {
    const label = (place.label ?? '').trim();
    if (place.oid && label) {
      placesMap.set(place.oid, label);
    }
    const children = Array.isArray(place.subPlaces) ? place.subPlaces : [];
    const hasChildren = children.length > 0;
    if (!isRoot && label && !hasChildren) {
      roomNameSet.add(label);
    } else if (!isRoot && label && place.type !== 10) {
      // Sur certains comptes Overkiz, un niveau étage/pièce peut contenir label utile s'il référence des appareils
      roomNameSet.add(label);
    }
    for (const child of children) {
      visit(child, false);
    }
  }

  if (rootPlace) {
    visit(rootPlace, true);
  }

  return {
    placesMap,
    roomNames: [...roomNameSet],
  };
}

function extractSetCookieValues(headers: Headers): string[] {
  const maybeGetSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof maybeGetSetCookie === 'function') {
    return maybeGetSetCookie.call(headers);
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function parseJSessionId(cookieHeaders: string[]): string | null {
  for (const rawCookie of cookieHeaders) {
    const match = rawCookie.match(/JSESSIONID=([^;,\s]+)/i);
    if (match?.[1]) {
      return `JSESSIONID=${match[1]}`;
    }
  }
  return null;
}

function extractOverkizErrorPayload(text: string): { errorCode?: string; error?: string } {
  try {
    const parsed = JSON.parse(text) as { errorCode?: string; error?: string };
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function somfyCloudLogin(config = getSomfyConfig()): Promise<{
  sessionCookie: string;
  baseUrl: string;
}> {
  if (!config.configured) {
    throw new Error(
      'Identifiants Somfy Cloud manquants (SOMFY_EMAIL et SOMFY_PASSWORD dans .env.local).'
    );
  }

  const body = new URLSearchParams({
    userId: config.email,
    userPassword: config.password,
  }).toString();

  const res = await fetch(`${config.baseUrl}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const rawText = await res.text().catch(() => '');
    const parsed = extractOverkizErrorPayload(rawText);
    const code = parsed.errorCode;

    if (res.status === 429 || code === 'TOO_MANY_REQUESTS') {
      throw new SomfyCloudError(
        'Somfy / Overkiz limite temporairement les connexions (trop de tentatives récentes). Patientez 15 à 30 minutes puis réessayez.',
        { status: 429, errorCode: code }
      );
    }

    if (res.status === 401 || code === 'AUTHENTICATION_ERROR' || code === 'BAD_CREDENTIALS') {
      throw new SomfyCloudError(
        'Identifiants Somfy refusés par Overkiz Cloud. Vérifiez SOMFY_EMAIL et SOMFY_PASSWORD (compte application TaHoma / Somfy) dans .env.local.',
        { status: 401, errorCode: code }
      );
    }

    throw new SomfyCloudError(
      `Échec authentification Somfy Cloud (${res.status}) : ${parsed.error || rawText || res.statusText}`,
      { status: res.status, errorCode: code }
    );
  }

  const setCookies = extractSetCookieValues(res.headers);
  const sessionCookie = parseJSessionId(setCookies);
  if (!sessionCookie) {
    throw new SomfyCloudError(
      'Authentification Somfy réussie mais aucun cookie JSESSIONID retourné par Overkiz Cloud.',
      { status: 500, errorCode: 'NO_SESSION_COOKIE' }
    );
  }

  return { sessionCookie, baseUrl: config.baseUrl };
}

export async function fetchSomfySetup(
  baseUrl: string,
  sessionCookie: string
): Promise<OverkizSetupPayload> {
  // Appel strictement en lecture seule : GET /setup uniquement (aucun POST /exec/apply)
  const res = await fetch(`${baseUrl}/setup`, {
    method: 'GET',
    headers: {
      Cookie: sessionCookie,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const rawText = await res.text().catch(() => '');
    const parsed = extractOverkizErrorPayload(rawText);
    const code = parsed.errorCode;

    if (res.status === 401 || code === 'NOT_AUTHENTICATED' || code === 'EXPIRED_SESSION') {
      throw new SomfyCloudError('Session Somfy expirée ou non authentifiée.', {
        status: 401,
        errorCode: code || 'NOT_AUTHENTICATED',
      });
    }

    if (res.status === 429 || code === 'TOO_MANY_REQUESTS') {
      throw new SomfyCloudError(
        'Quota de requêtes Somfy Cloud temporairement atteint (HTTP 429). Patientez quelques minutes.',
        { status: 429, errorCode: code }
      );
    }

    throw new SomfyCloudError(
      `Erreur lecture /setup Somfy Cloud (${res.status}) : ${parsed.error || rawText || res.statusText}`,
      { status: res.status, errorCode: code }
    );
  }

  return (await res.json()) as OverkizSetupPayload;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sanitizeTraitValue(value: unknown): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeTemperatureCelsius(rawTemp: number): number {
  // Overkiz renvoie souvent les températures en Kelvin (ex: 294.65 K = 21.5 °C)
  const celsius = rawTemp > 150 ? rawTemp - 273.15 : rawTemp;
  return Number(celsius.toFixed(1));
}

function extractSomfyBattery(statesMap: Map<string, unknown>): number | null {
  const num = toFiniteNumber(statesMap.get('core:BatteryLevelState'));
  if (num !== null) return Math.max(0, Math.min(100, Math.round(num)));
  const discrete = statesMap.get('core:BatteryState');
  if (typeof discrete !== 'string') return null;
  switch (discrete.toLowerCase()) {
    case 'full':
      return 100;
    case 'normal':
      return 75;
    case 'low':
      return 20;
    case 'verylow':
      return 5;
    default:
      return null;
  }
}

export function normalizeSomfyDevice(
  raw: OverkizRawDevice,
  placesMap: Map<string, string>,
  gatewayOnline = true,
  gatewayNetworks?: {
    byGatewayId: Map<string, SomfyGatewayNetworkInfo>;
    defaultGateway: SomfyGatewayNetworkInfo | null;
  }
): NormalizedVendorDevice | null {
  if (!raw.deviceURL || isInternalSomfyDevice(raw)) {
    return null;
  }

  const states = Array.isArray(raw.states) ? raw.states : [];
  const statesMap = new Map<string, unknown>();
  const rawTraits: RawDpStatus[] = [];

  for (const state of states) {
    if (!state || typeof state.name !== 'string') continue;
    statesMap.set(state.name, state.value);
    if (state.value !== undefined && state.value !== null) {
      rawTraits.push({
        code: state.name,
        value: sanitizeTraitValue(state.value),
      });
    }
  }

  const uiClass = (raw.uiClass ?? 'Unknown').trim();
  const protocol = detectSomfyProtocol(raw.deviceURL, raw.controllableName);
  const controllableName = (raw.controllableName ?? '').trim();

  const ownFromStates = extractNetworkInfoFromEntries(raw.states);
  const ownFromAttrs = extractNetworkInfoFromEntries(raw.attributes);
  const ownIp = ownFromStates.ipAddress ?? ownFromAttrs.ipAddress;
  const ownMac = ownFromStates.macAddress ?? ownFromAttrs.macAddress;

  const extractedGwId = extractSomfyGatewayId(raw.deviceURL);
  const gwNetwork =
    (extractedGwId ? gatewayNetworks?.byGatewayId.get(extractedGwId) : undefined) ??
    gatewayNetworks?.defaultGateway ??
    null;
  const gatewayId = extractedGwId || gwNetwork?.gatewayId || null;

  const ipAddress = ownIp ?? gwNetwork?.ipAddress ?? null;
  const macAddress = ownMac ?? gwNetwork?.macAddress ?? null;
  const usedGatewayNetwork =
    (!ownIp && Boolean(gwNetwork?.ipAddress)) || (!ownMac && Boolean(gwNetwork?.macAddress));

  rawTraits.push(
    { code: 'somfy:uiClass', value: uiClass },
    { code: 'somfy:protocol', value: protocol },
    { code: 'somfy:controllableName', value: controllableName },
    { code: 'somfy:deviceURL', value: raw.deviceURL }
  );
  if (gatewayId) {
    rawTraits.push({ code: 'somfy:gatewayId', value: gatewayId });
  }
  if (usedGatewayNetwork) {
    rawTraits.push({ code: 'somfy:networkSource', value: 'gateway' });
  }

  const statusState = String(statesMap.get('core:StatusState') ?? '').toLowerCase();
  const isOnline =
    gatewayOnline &&
    raw.available !== false &&
    raw.enabled !== false &&
    statusState !== 'unavailable';

  const isCover = isSomfyCoverUiClass(uiClass, controllableName);

  // IMPORTANT : Les volets, stores, pergolas, portails et fenêtres motorisées vont uniquement
  // dans "Volets & Stores", sans jamais polluer les onglets "Climat" ni "Ouvertures".
  let tempC: number | null = null;
  let humidityPct: number | null = null;
  let contactOpen: boolean | null = null;

  if (!isCover) {
    const rawTemp = toFiniteNumber(statesMap.get('core:TemperatureState'));
    if (rawTemp !== null) {
      tempC = normalizeTemperatureCelsius(rawTemp);
    }
    const rawHum = toFiniteNumber(statesMap.get('core:RelativeHumidityState'));
    if (rawHum !== null) {
      humidityPct = Number(rawHum.toFixed(1));
    }
    if (uiClass === 'ContactSensor' && statesMap.has('core:ContactState')) {
      const contactRaw = String(statesMap.get('core:ContactState') ?? '').toLowerCase().trim();
      if (contactRaw === 'open' || contactRaw === 'opened') contactOpen = true;
      else if (contactRaw === 'closed') contactOpen = false;
    }
  }

  const batteryPct = extractSomfyBattery(statesMap);

  let category: DeviceCategory = 'other';
  if (!isCover) {
    if (tempC !== null || humidityPct !== null) category = 'climate';
    else if (contactOpen !== null || uiClass === 'ContactSensor') category = 'contact';
  }

  const roomName = raw.placeOID ? placesMap.get(raw.placeOID) ?? null : null;
  const label = (raw.label ?? '').trim() || `${uiClass} Somfy`;

  return {
    externalId: raw.deviceURL,
    name: label,
    roomName,
    manufacturer: 'Somfy',
    model: controllableName || uiClass,
    deviceType: uiClass,
    category,
    isOnline,
    tempC,
    humidityPct,
    batteryPct,
    contactOpen,
    powerW: null,
    voltageV: null,
    addEleKwh: null,
    macAddress,
    ipAddress,
    rawTraits,
  };
}

export function normalizeSomfySetupPayload(
  setup: OverkizSetupPayload,
  fallbackOverride?: { gatewayIp?: string | null; gatewayMac?: string | null }
): VendorInventoryResult {
  const { placesMap, roomNames: subPlaceNames } = extractSomfyPlacesMap(setup.rootPlace);
  const gateways = Array.isArray(setup.gateways) ? setup.gateways : [];
  const gatewayOffline = gateways.length > 0 && gateways.every((g) => g.alive === false);

  const cfg = fallbackOverride ? null : getSomfyConfig();
  const gatewayNetworks = extractSomfyGatewayNetworks(
    setup,
    fallbackOverride ?? {
      gatewayIp: cfg?.gatewayIp ?? null,
      gatewayMac: cfg?.gatewayMac ?? null,
    }
  );

  const rawDevices = Array.isArray(setup.devices) ? setup.devices : [];
  const devices: NormalizedVendorDevice[] = [];
  const referencedRooms = new Set<string>(subPlaceNames);

  for (const raw of rawDevices) {
    const normalized = normalizeSomfyDevice(
      raw,
      placesMap,
      !gatewayOffline,
      gatewayNetworks
    );
    if (!normalized) continue;
    devices.push(normalized);
    if (normalized.roomName) {
      referencedRooms.add(normalized.roomName);
    }
  }

  let warning: string | undefined;
  if (gatewayOffline) {
    warning =
      'Le Kit de connectivité Somfy apparaît hors ligne côté Overkiz Cloud (passerelle injoignable).';
  } else if (devices.length === 0) {
    warning =
      'Aucun équipement Somfy détecté sur ce compte (vérifiez que vos volets/stores sont appairés dans TaHoma).';
  }

  return {
    roomNames: [...referencedRooms],
    devices,
    warning,
  };
}

export async function fetchSomfyInventoryWithSession(
  cachedSessionCookie?: string | null
): Promise<{
  inventory: VendorInventoryResult;
  sessionCookie: string;
  sessionRenewed: boolean;
  region: SomfyRegion;
  baseUrl: string;
}> {
  const config = getSomfyConfig();
  if (!config.configured) {
    throw new Error(
      'Identifiants Somfy Cloud manquants (SOMFY_EMAIL et SOMFY_PASSWORD dans .env.local).'
    );
  }

  let sessionCookie = (cachedSessionCookie ?? '').trim();
  let sessionRenewed = false;
  let setup: OverkizSetupPayload;

  if (sessionCookie) {
    try {
      setup = await fetchSomfySetup(config.baseUrl, sessionCookie);
    } catch (err) {
      if (err instanceof SomfyCloudError && err.status === 401) {
        const loginRes = await somfyCloudLogin(config);
        sessionCookie = loginRes.sessionCookie;
        sessionRenewed = true;
        setup = await fetchSomfySetup(config.baseUrl, sessionCookie);
      } else {
        throw err;
      }
    }
  } else {
    const loginRes = await somfyCloudLogin(config);
    sessionCookie = loginRes.sessionCookie;
    sessionRenewed = true;
    setup = await fetchSomfySetup(config.baseUrl, sessionCookie);
  }

  return {
    inventory: normalizeSomfySetupPayload(setup),
    sessionCookie,
    sessionRenewed,
    region: config.region,
    baseUrl: config.baseUrl,
  };
}

export async function fetchSomfyInventory(): Promise<VendorInventoryResult> {
  const res = await fetchSomfyInventoryWithSession(null);
  return res.inventory;
}
