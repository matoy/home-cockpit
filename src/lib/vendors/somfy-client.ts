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
}

export interface OverkizRawGateway {
  gatewayId?: string;
  type?: number;
  alive?: boolean;
  mode?: string;
}

export interface OverkizSetupPayload {
  id?: string;
  gateways?: OverkizRawGateway[];
  rootPlace?: OverkizPlace;
  devices?: OverkizRawDevice[];
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
  return {
    email,
    password,
    region,
    baseUrl,
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
  gatewayOnline = true
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

  rawTraits.push(
    { code: 'somfy:uiClass', value: uiClass },
    { code: 'somfy:protocol', value: protocol },
    { code: 'somfy:controllableName', value: controllableName },
    { code: 'somfy:deviceURL', value: raw.deviceURL }
  );

  const statusState = String(statesMap.get('core:StatusState') ?? '').toLowerCase();
  const isOnline =
    gatewayOnline &&
    raw.available !== false &&
    raw.enabled !== false &&
    statusState !== 'unavailable';

  const isCover = isSomfyCoverUiClass(uiClass);

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
    macAddress: null,
    ipAddress: null,
    rawTraits,
  };
}

export function normalizeSomfySetupPayload(setup: OverkizSetupPayload): VendorInventoryResult {
  const { placesMap, roomNames: subPlaceNames } = extractSomfyPlacesMap(setup.rootPlace);
  const gateways = Array.isArray(setup.gateways) ? setup.gateways : [];
  const gatewayOffline = gateways.length > 0 && gateways.every((g) => g.alive === false);

  const rawDevices = Array.isArray(setup.devices) ? setup.devices : [];
  const devices: NormalizedVendorDevice[] = [];
  const referencedRooms = new Set<string>(subPlaceNames);

  for (const raw of rawDevices) {
    const normalized = normalizeSomfyDevice(raw, placesMap, !gatewayOffline);
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
