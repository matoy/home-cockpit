import type { HomeConnectEnv, RawDpStatus } from '@/types';
import { fetchWithTimeout } from '@/lib/http-utils';
import type { NormalizedVendorDevice, VendorInventoryResult } from './registry';

const HOME_CONNECT_BASE_URLS: Record<HomeConnectEnv, string> = {
  prod: 'https://api.home-connect.com',
  simulator: 'https://simulator.home-connect.com',
  cn: 'https://api.home-connect.cn',
};

// Scopes strictement en lecture seule (aucun scope Control)
const HOME_CONNECT_SCOPES = 'IdentifyAppliance Monitor Settings';

const ACTIVE_OPERATION_STATES = new Set([
  'Run',
  'DelayedStart',
  'Pause',
  'ActionRequired',
  'Aborting',
]);

const FRIDGE_APPLIANCE_TYPES = new Set([
  'FridgeFreezer',
  'Refrigerator',
  'Freezer',
  'WineCooler',
]);

const PROGRAM_LABELS_FR: Record<string, string> = {
  Eco50: 'Eco 50°',
  Auto1: 'Auto 35-45°',
  Auto2: 'Auto 45-65°',
  Auto3: 'Auto 65-75°',
  Intensiv70: 'Intensif 70°',
  Intensive70: 'Intensif 70°',
  Quick45: 'Rapide 45°',
  Quick65: 'Rapide 65°',
  Kurz60: 'Rapide 60°',
  PreRinse: 'Prélavage',
  MachineCare: 'Entretien machine',
  NightWash: 'Silence 50°',
  Silence50: 'Silence 50°',
  Cotton: 'Coton',
  CottonEco: 'Coton Eco',
  EasyCare: 'Synthétiques',
  Mix: 'Mix',
  DelicatesSilk: 'Délicat / Soie',
  Wool: 'Laine',
  Super153045: 'Express 15/30 min',
  DarkWash: 'Couleurs sombres',
  OutdoorWaterproofing: 'Imperméabilisant',
  SpinDrain: 'Essorage / Vidange',
  HotAir: 'Chaleur tournante',
  HotAirEco: 'Chaleur tournante Eco',
  TopBottomHeating: 'Convection naturelle',
  PizzaSetting: 'Position Pizza',
  Grill: 'Gril',
  HotAirGrilling: 'Gril air pulsé',
  PreHeating: 'Préchauffage',
  KeepWarm: 'Maintien au chaud',
  Pyrolysis: 'Pyrolyse',
  Espresso: 'Espresso',
  Coffee: 'Café',
  Cappuccino: 'Cappuccino',
  LatteMacchiato: 'Latte Macchiato',
  CaffeLatte: 'Café au lait',
  Ristretto: 'Ristretto',
  Americano: 'Americano',
  MilkFroth: 'Mousse de lait',
  WarmMilk: 'Lait chaud',
  HotWater: 'Eau chaude',
};

export interface HomeConnectConfig {
  clientId: string;
  clientSecret: string;
  defaultEnv: HomeConnectEnv;
  configured: boolean;
}

export interface HomeConnectRawAppliance {
  haId: string;
  name?: string;
  type?: string;
  brand?: string;
  vib?: string;
  enumber?: string;
  connected?: boolean;
}

export interface HomeConnectKeyValueItem {
  key: string;
  value: unknown;
  unit?: string;
  name?: string;
  displayvalue?: string;
}

export interface HomeConnectActiveProgram {
  key?: string;
  name?: string;
  options?: HomeConnectKeyValueItem[];
}

export class HomeConnectApiError extends Error {
  readonly status: number;
  readonly errorKey?: string;

  constructor(status: number, message: string, errorKey?: string) {
    super(message);
    this.name = 'HomeConnectApiError';
    this.status = status;
    this.errorKey = errorKey;
  }
}

function normalizeHomeConnectEnv(raw: string | undefined): HomeConnectEnv {
  const val = raw?.trim().toLowerCase() ?? '';
  if (val === 'simulator' || val === 'sim') return 'simulator';
  if (val === 'cn' || val === 'china') return 'cn';
  return 'prod';
}

export function getHomeConnectConfig(): HomeConnectConfig {
  const clientId =
    process.env.SIEMENS_HOME_CONNECT_CLIENT_ID?.trim() ||
    process.env.SIEMENSHOMECONNECT_CLIENT_ID?.trim() ||
    process.env.SIEMENSHOMECONNET_CLIENT_ID?.trim() ||
    '';

  const clientSecret =
    process.env.SIEMENS_HOME_CONNECT_CLIENT_SECRET?.trim() ||
    process.env.SIEMENSHOMECONNECT_CLIENT_SECRET?.trim() ||
    process.env.SIEMENSHOMECONNET_CLIENT_SECRET?.trim() ||
    '';

  const rawEnv =
    process.env.SIEMENS_HOME_CONNECT_ENV ||
    process.env.SIEMENSHOMECONNECT_ENV ||
    process.env.SIEMENSHOMECONNET_ENV;

  return {
    clientId,
    clientSecret,
    defaultEnv: normalizeHomeConnectEnv(rawEnv),
    configured: Boolean(clientId && clientSecret),
  };
}

export function getHomeConnectBaseUrl(env: HomeConnectEnv = 'prod'): string {
  return HOME_CONNECT_BASE_URLS[env] ?? HOME_CONNECT_BASE_URLS.prod;
}

export function makeHomeConnectDeviceId(haId: string): string {
  return `hc_${haId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)}`;
}

export function buildHomeConnectAuthorizeUrl(params: {
  env: HomeConnectEnv;
  redirectUri: string;
  state: string;
}): string {
  const cfg = getHomeConnectConfig();
  if (!cfg.configured) {
    throw new Error(
      'Identifiants Siemens Home Connect manquants (SIEMENS_HOME_CONNECT_CLIENT_ID et SECRET).'
    );
  }

  const baseUrl = getHomeConnectBaseUrl(params.env);
  const url = new URL(`${baseUrl}/security/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', HOME_CONNECT_SCOPES);
  url.searchParams.set('state', params.state);
  return url.toString();
}

async function postHomeConnectTokenRequest(
  env: HomeConnectEnv,
  formParams: URLSearchParams
): Promise<{ accessToken: string; refreshToken: string | null; expiresInSec: number }> {
  const baseUrl = getHomeConnectBaseUrl(env);
  const res = await fetchWithTimeout(`${baseUrl}/security/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formParams.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();
  let json: {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    error?: unknown;
    error_description?: unknown;
  } = {};

  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    if (!res.ok) {
      throw new HomeConnectApiError(
        res.status,
        `Erreur OAuth Home Connect (HTTP ${res.status})`
      );
    }
  }

  if (!res.ok || typeof json.access_token !== 'string') {
    const errKey = typeof json.error === 'string' ? json.error : undefined;
    const desc =
      typeof json.error_description === 'string'
        ? json.error_description
        : `HTTP ${res.status}`;
    if (res.status === 429) {
      throw new HomeConnectApiError(
        429,
        'Quota de renouvellement OAuth Home Connect atteint (max 10/min ou 100/jour). Réessayez plus tard.',
        errKey
      );
    }
    throw new HomeConnectApiError(
      res.status,
      `OAuth Siemens Home Connect échoué : ${desc}`,
      errKey
    );
  }

  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    expiresInSec:
      typeof json.expires_in === 'number' && Number.isFinite(json.expires_in)
        ? json.expires_in
        : 86_400,
  };
}

export async function exchangeHomeConnectCodeForTokens(params: {
  code: string;
  redirectUri: string;
  env: HomeConnectEnv;
}): Promise<{ accessToken: string; refreshToken: string | null; expiresInSec: number }> {
  const cfg = getHomeConnectConfig();
  if (!cfg.configured) {
    throw new Error(
      'Identifiants Siemens Home Connect manquants (SIEMENS_HOME_CONNECT_CLIENT_ID et SECRET).'
    );
  }

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  return postHomeConnectTokenRequest(params.env, form);
}

export async function refreshHomeConnectAccessToken(params: {
  refreshToken: string;
  env: HomeConnectEnv;
}): Promise<{ accessToken: string; refreshToken: string | null; expiresInSec: number }> {
  const cfg = getHomeConnectConfig();
  if (!cfg.configured) {
    throw new Error('Identifiants Siemens Home Connect manquants.');
  }

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  return postHomeConnectTokenRequest(params.env, form);
}

/**
 * Extrait la valeur finale d'une clé énumérée Home Connect
 * (ex: "BSH.Common.EnumType.OperationState.Run" -> "Run").
 */
export function parseHomeConnectEnumTail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const idx = trimmed.lastIndexOf('.');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * Traduit une clé de programme BSH en libellé français lisible.
 */
export function formatHomeConnectProgramName(rawKey: unknown): string | null {
  const tail = parseHomeConnectEnumTail(rawKey);
  if (!tail) return null;
  if (PROGRAM_LABELS_FR[tail]) {
    return PROGRAM_LABELS_FR[tail];
  }
  return tail
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d+)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumericValue(item: HomeConnectKeyValueItem | undefined): number | null {
  if (!item || typeof item.value !== 'number' || !Number.isFinite(item.value)) return null;
  if (item.unit === '°F' || item.unit === 'F') {
    return Math.round(((item.value - 32) * (5 / 9)) * 10) / 10;
  }
  return Math.round(item.value * 10) / 10;
}

function findKv(
  items: HomeConnectKeyValueItem[],
  ...keys: string[]
): HomeConnectKeyValueItem | undefined {
  for (const k of keys) {
    const found = items.find((item) => item.key === k);
    if (found) return found;
  }
  return undefined;
}

/**
 * Extrait et formate l'adresse MAC Wi-Fi BSH depuis le `haId` Home Connect
 * lorsque celui-ci se termine par `-<12 hex>` (ex: `SIEMENS-SN65ZX49CE-68A40E1A2B3C`).
 */
export function extractHomeConnectMacFromHaId(haId?: string | null): string | null {
  if (!haId || typeof haId !== 'string') return null;
  const trimmed = haId.trim();
  const dashIdx = trimmed.lastIndexOf('-');
  if (dashIdx < 0) return null;
  const tail = trimmed.slice(dashIdx + 1).trim().toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(tail)) return null;
  if (tail === '000000000000' || tail === 'FFFFFFFFFFFF') return null;
  return tail.match(/.{1,2}/g)?.join(':') ?? null;
}

/**
 * Normalise un appareil Home Connect (100 % lecture seule) sans jamais renseigner
 * `tempC` / `contactOpen` / `powerW` pour éviter de polluer les onglets Climat et Ouvertures.
 */
export function normalizeHomeConnectAppliance(params: {
  raw: HomeConnectRawAppliance;
  statusItems?: HomeConnectKeyValueItem[];
  settingItems?: HomeConnectKeyValueItem[];
  activeProgram?: HomeConnectActiveProgram | null;
}): NormalizedVendorDevice {
  const { raw, statusItems = [], settingItems = [], activeProgram = null } = params;
  const allKv = [...statusItems, ...settingItems, ...(activeProgram?.options ?? [])];

  const traits: RawDpStatus[] = [];
  if (raw.haId) traits.push({ code: 'ha_id', value: raw.haId });
  if (raw.type) traits.push({ code: 'appliance_type', value: raw.type });
  if (raw.brand) traits.push({ code: 'brand', value: raw.brand });
  if (raw.vib) traits.push({ code: 'vib', value: raw.vib });
  if (raw.enumber) traits.push({ code: 'enumber', value: raw.enumber });

  const opState = parseHomeConnectEnumTail(
    findKv(statusItems, 'BSH.Common.Status.OperationState')?.value
  );
  if (opState) traits.push({ code: 'operation_state', value: opState });

  const powerState = parseHomeConnectEnumTail(
    findKv(settingItems, 'BSH.Common.Setting.PowerState')?.value ??
      findKv(statusItems, 'BSH.Common.Setting.PowerState')?.value
  );
  if (powerState) traits.push({ code: 'power_state', value: powerState });

  const doorState = parseHomeConnectEnumTail(
    findKv(statusItems, 'BSH.Common.Status.DoorState')?.value
  );
  if (doorState) traits.push({ code: 'door_state', value: doorState });

  const doorFridge = parseHomeConnectEnumTail(
    findKv(
      statusItems,
      'Refrigeration.Common.Status.Door.Refrigerator',
      'Refrigeration.Common.Status.DoorState.Refrigerator'
    )?.value
  );
  if (doorFridge) traits.push({ code: 'door_fridge', value: doorFridge });

  const doorFreezer = parseHomeConnectEnumTail(
    findKv(
      statusItems,
      'Refrigeration.Common.Status.Door.Freezer',
      'Refrigeration.Common.Status.DoorState.Freezer'
    )?.value
  );
  if (doorFreezer) traits.push({ code: 'door_freezer', value: doorFreezer });

  const programName =
    activeProgram?.name?.trim() || formatHomeConnectProgramName(activeProgram?.key);
  if (programName) traits.push({ code: 'active_program', value: programName });

  const progress = toNumericValue(findKv(allKv, 'BSH.Common.Option.ProgramProgress'));
  if (progress !== null) traits.push({ code: 'program_progress', value: progress });

  const remainingSec = toNumericValue(findKv(allKv, 'BSH.Common.Option.RemainingProgramTime'));
  if (remainingSec !== null) {
    traits.push({ code: 'remaining_seconds', value: Math.round(remainingSec) });
  }

  const cavityTempC = toNumericValue(
    findKv(statusItems, 'Cooking.Oven.Status.CurrentCavityTemperature')
  );
  if (cavityTempC !== null) traits.push({ code: 'cavity_temp_c', value: cavityTempC });

  const fridgeTempC = toNumericValue(
    findKv(
      allKv,
      'Refrigeration.FridgeFreezer.Setting.SetpointTemperatureRefrigerator',
      'Refrigeration.Common.Setting.SetpointTemperatureRefrigerator'
    )
  );
  if (fridgeTempC !== null) traits.push({ code: 'fridge_temp_c', value: fridgeTempC });

  const freezerTempC = toNumericValue(
    findKv(
      allKv,
      'Refrigeration.FridgeFreezer.Setting.SetpointTemperatureFreezer',
      'Refrigeration.Common.Setting.SetpointTemperatureFreezer'
    )
  );
  if (freezerTempC !== null) traits.push({ code: 'freezer_temp_c', value: freezerTempC });

  const remoteStartItem = findKv(statusItems, 'BSH.Common.Status.RemoteControlStartAllowed');
  if (typeof remoteStartItem?.value === 'boolean') {
    traits.push({ code: 'remote_start_allowed', value: remoteStartItem.value });
  }

  const manufacturer = raw.brand?.trim() || 'Siemens';
  const model = raw.enumber?.trim() || raw.vib?.trim() || raw.type?.trim() || null;
  const fallbackName = [manufacturer, raw.type].filter(Boolean).join(' ') || raw.haId;
  const macAddress = extractHomeConnectMacFromHaId(raw.haId);

  return {
    externalId: raw.haId,
    name: raw.name?.trim() || fallbackName,
    roomName: null,
    manufacturer,
    model,
    deviceType: raw.type?.trim() || null,
    category: 'other',
    isOnline: Boolean(raw.connected),
    tempC: null,
    humidityPct: null,
    batteryPct: null,
    contactOpen: null,
    powerW: null,
    macAddress,
    ipAddress: null,
    rawTraits: traits,
  };
}

async function homeConnectGet<T>(
  baseUrl: string,
  path: string,
  accessToken: string
): Promise<T> {
  const res = await fetchWithTimeout(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.bsh.sdk.v1+json',
      'Accept-Language': 'fr-FR',
    },
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();
  let parsed: { data?: T; error?: { key?: string; description?: string } } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    if (!res.ok) {
      throw new HomeConnectApiError(res.status, `HTTP ${res.status} Home Connect`);
    }
    throw new HomeConnectApiError(res.status, 'Réponse non-JSON reçue de Home Connect.');
  }

  if (!res.ok) {
    const errKey = parsed.error?.key;
    const errDesc = parsed.error?.description || `HTTP ${res.status}`;
    if (res.status === 401) {
      throw new HomeConnectApiError(
        401,
        'Jeton Home Connect expiré ou révoqué. Reconnectez Siemens Home Connect.',
        errKey
      );
    }
    if (res.status === 429) {
      throw new HomeConnectApiError(
        429,
        'Quota API Home Connect temporairement atteint (1 000 req/jour ou 50 req/min).',
        errKey
      );
    }
    throw new HomeConnectApiError(res.status, `Home Connect : ${errDesc}`, errKey);
  }

  return parsed.data as T;
}

/**
 * Récupère l'inventaire et les états Home Connect en respectant strictement
 * les quotas API (100 % GET lecture seule).
 */
export async function fetchHomeConnectInventory(params: {
  accessToken: string;
  env: HomeConnectEnv;
  mode?: 'full' | 'poll';
}): Promise<VendorInventoryResult> {
  const baseUrl = getHomeConnectBaseUrl(params.env);
  const fetchMode = params.mode ?? 'full';

  const listData = await homeConnectGet<{ homeappliances?: HomeConnectRawAppliance[] }>(
    baseUrl,
    '/api/homeappliances',
    params.accessToken
  );

  const rawAppliances = Array.isArray(listData?.homeappliances) ? listData.homeappliances : [];
  if (rawAppliances.length === 0) {
    return {
      roomNames: [],
      devices: [],
      warning:
        'Aucun appareil trouvé sur votre compte Home Connect (vérifiez que vos appareils Siemens sont appairés dans l’app Home Connect).',
    };
  }

  const normalizedByHaId = new Map<string, NormalizedVendorDevice>();
  const connectedAppliances = rawAppliances.filter((a) => Boolean(a.connected));
  const offlineAppliances = rawAppliances.filter((a) => !a.connected);

  for (const off of offlineAppliances) {
    normalizedByHaId.set(off.haId, normalizeHomeConnectAppliance({ raw: off }));
  }

  let rateLimited = false;
  const BATCH_SIZE = 3;

  for (let i = 0; i < connectedAppliances.length; i += BATCH_SIZE) {
    if (rateLimited) break;
    const batch = connectedAppliances.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (raw) => {
        if (rateLimited) {
          normalizedByHaId.set(raw.haId, normalizeHomeConnectAppliance({ raw }));
          return;
        }

        let statusItems: HomeConnectKeyValueItem[] = [];
        let settingItems: HomeConnectKeyValueItem[] = [];
        let activeProgram: HomeConnectActiveProgram | null = null;

        try {
          const statusRes = await homeConnectGet<{ status?: HomeConnectKeyValueItem[] }>(
            baseUrl,
            `/api/homeappliances/${encodeURIComponent(raw.haId)}/status`,
            params.accessToken
          );
          if (Array.isArray(statusRes?.status)) {
            statusItems = statusRes.status;
          }
        } catch (err) {
          if (err instanceof HomeConnectApiError && err.status === 401) throw err;
          if (err instanceof HomeConnectApiError && err.status === 429) {
            rateLimited = true;
          }
        }

        if (!rateLimited) {
          const opTail = parseHomeConnectEnumTail(
            findKv(statusItems, 'BSH.Common.Status.OperationState')?.value
          );
          if (opTail && ACTIVE_OPERATION_STATES.has(opTail)) {
            try {
              const progRes = await homeConnectGet<HomeConnectActiveProgram>(
                baseUrl,
                `/api/homeappliances/${encodeURIComponent(raw.haId)}/programs/active`,
                params.accessToken
              );
              if (progRes && typeof progRes === 'object') {
                activeProgram = progRes;
              }
            } catch (err) {
              if (err instanceof HomeConnectApiError && err.status === 401) throw err;
              if (err instanceof HomeConnectApiError && err.status === 429) {
                rateLimited = true;
              }
            }
          }
        }

        const shouldFetchSettings =
          !rateLimited &&
          (fetchMode !== 'poll' || (raw.type ? FRIDGE_APPLIANCE_TYPES.has(raw.type) : false));

        if (shouldFetchSettings) {
          try {
            const setRes = await homeConnectGet<{ settings?: HomeConnectKeyValueItem[] }>(
              baseUrl,
              `/api/homeappliances/${encodeURIComponent(raw.haId)}/settings`,
              params.accessToken
            );
            if (Array.isArray(setRes?.settings)) {
              settingItems = setRes.settings;
            }
          } catch (err) {
            if (err instanceof HomeConnectApiError && err.status === 401) throw err;
            if (err instanceof HomeConnectApiError && err.status === 429) {
              rateLimited = true;
            }
          }
        }

        normalizedByHaId.set(
          raw.haId,
          normalizeHomeConnectAppliance({
            raw,
            statusItems,
            settingItems,
            activeProgram,
          })
        );
      })
    );
  }

  for (const raw of connectedAppliances) {
    if (!normalizedByHaId.has(raw.haId)) {
      normalizedByHaId.set(raw.haId, normalizeHomeConnectAppliance({ raw }));
    }
  }

  const devices = rawAppliances.map(
    (raw) => normalizedByHaId.get(raw.haId) ?? normalizeHomeConnectAppliance({ raw })
  );

  return {
    roomNames: [],
    devices,
    ...(rateLimited
      ? {
          warning:
            'Quota API Home Connect partiellement atteint (HTTP 429) : inventaire mis à jour, détails partiels.',
        }
      : {}),
  };
}
