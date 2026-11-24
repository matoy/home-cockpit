import type { DeviceCategory, RawDpStatus, VendorId } from '@/types';

export const VENDOR_IDS: readonly VendorId[] = [
  'tuya',
  'kasa',
  'home_connect',
  'somfy',
  'daikin',
  'xsense',
  'xiaomi',
  'google_home',
  'conso_api',
];

export type VendorAuthKind =
  | 'cloud_key'
  | 'cloud_credentials'
  | 'oauth2'
  | 'qr_or_credentials';

export type VendorDomain =
  | 'power'
  | 'climate'
  | 'contacts'
  | 'covers'
  | 'hvac'
  | 'security'
  | 'appliances'
  | 'automations';

export interface VendorCapabilities {
  syncDevices: boolean;
  collectTelemetry: boolean;
  syncRooms: boolean;
  supportsDisconnect: boolean;
  hasAutomations?: boolean;
  domains: readonly VendorDomain[];
}

export interface VendorMeta {
  id: VendorId;
  slug: string;
  label: string;
  shortLabel: string;
  accentColor: string;
  badgeClass: string;
  dotClass: string;
  description: string;
  authKind: VendorAuthKind;
  capabilities: VendorCapabilities;
  envVars: readonly string[];
  syncEndpoint: string;
  disconnectEndpoint?: string;
}

export const VENDOR_REGISTRY: Record<VendorId, VendorMeta> = {
  tuya: {
    id: 'tuya',
    slug: 'tuya',
    label: 'Tuya',
    shortLabel: 'T',
    accentColor: '#f97316',
    badgeClass: 'border-orange-500/40 bg-orange-500/15 text-orange-300',
    dotClass: 'bg-orange-400',
    description:
      'Appareils Smart Life / Tuya Cloud (puissance, kWh, climat, ouvertures, scénarios)',
    authKind: 'cloud_key',
    capabilities: {
      syncDevices: true,
      collectTelemetry: true,
      syncRooms: true,
      supportsDisconnect: false,
      hasAutomations: true,
      domains: ['power', 'climate', 'contacts', 'covers', 'automations'],
    },
    envVars: ['TUYA_ACCESS_ID', 'TUYA_ACCESS_SECRET', 'TUYA_REGION', 'TUYA_USER_UID'],
    syncEndpoint: '/api/tuya/sync',
  },
  kasa: {
    id: 'kasa',
    slug: 'kasa',
    label: 'Kasa',
    shortLabel: 'K',
    accentColor: '#14b8a6',
    badgeClass: 'border-teal-500/40 bg-teal-500/15 text-teal-300',
    dotClass: 'bg-teal-400',
    description:
      'Appareils TP-Link Kasa via Cloud (100 % cloud, lecture seule : prises, multiprises, ampoules, W / kWh)',
    authKind: 'cloud_credentials',
    capabilities: {
      syncDevices: true,
      collectTelemetry: true,
      syncRooms: true,
      supportsDisconnect: false,
      domains: ['power'],
    },
    envVars: ['KASA_EMAIL', 'KASA_PASSWORD', 'KASA_REGION'],
    syncEndpoint: '/api/vendors/kasa/sync',
  },
  home_connect: {
    id: 'home_connect',
    slug: 'home-connect',
    label: 'Siemens Home Connect',
    shortLabel: 'SHC',
    accentColor: '#06b6d4',
    badgeClass: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300',
    dotClass: 'bg-cyan-400',
    description:
      'Électroménager Siemens / BSH Home Connect via Cloud OAuth (100 % lecture seule : état, programme, temps restant, températures internes)',
    authKind: 'oauth2',
    capabilities: {
      syncDevices: true,
      collectTelemetry: true,
      syncRooms: false,
      supportsDisconnect: true,
      domains: ['appliances'],
    },
    envVars: [
      'SIEMENS_HOME_CONNECT_CLIENT_ID',
      'SIEMENS_HOME_CONNECT_CLIENT_SECRET',
      'SIEMENS_HOME_CONNECT_ENV',
    ],
    syncEndpoint: '/api/vendors/home-connect/sync',
    disconnectEndpoint: '/api/vendors/home-connect/disconnect',
  },
  somfy: {
    id: 'somfy',
    slug: 'somfy',
    label: 'Somfy',
    shortLabel: 'SF',
    accentColor: '#eab308',
    badgeClass: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
    dotClass: 'bg-amber-400',
    description:
      'Kit de connectivité Somfy / Overkiz Cloud (100 % cloud, lecture seule : volets io/RTS, stores, capteurs)',
    authKind: 'cloud_credentials',
    capabilities: {
      syncDevices: true,
      collectTelemetry: true,
      syncRooms: true,
      supportsDisconnect: false,
      domains: ['covers', 'climate', 'contacts', 'security'],
    },
    envVars: ['SOMFY_EMAIL', 'SOMFY_PASSWORD', 'SOMFY_REGION'],
    syncEndpoint: '/api/vendors/somfy/sync',
  },
  daikin: {
    id: 'daikin',
    slug: 'daikin',
    label: 'Daikin Onecta',
    shortLabel: 'DK',
    accentColor: '#3b82f6',
    badgeClass: 'border-blue-500/40 bg-blue-500/15 text-blue-300',
    dotClass: 'bg-blue-400',
    description:
      'Climatisation & PAC Daikin Onecta Cloud OAuth (100 % lecture seule : °C int./ext., consigne, mode, kWh)',
    authKind: 'oauth2',
    capabilities: {
      syncDevices: true,
      collectTelemetry: true,
      syncRooms: false,
      supportsDisconnect: true,
      domains: ['hvac', 'climate', 'power'],
    },
    envVars: ['DAIKIN_CLIENT_ID', 'DAIKIN_CLIENT_SECRET', 'DAIKIN_REDIRECT_URI'],
    syncEndpoint: '/api/vendors/daikin/sync',
    disconnectEndpoint: '/api/vendors/daikin/disconnect',
  },
  xsense: {
    id: 'xsense',
    slug: 'xsense',
    label: 'X-Sense Security',
    shortLabel: 'XS',
    accentColor: '#f43f5e',
    badgeClass: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
    dotClass: 'bg-rose-400',
    description:
      'Sécurité X-Sense Cloud (100 % lecture seule : fumée, CO ppm, fuite d’eau, stations SBS50, thermo-hygromètres)',
    authKind: 'cloud_credentials',
    capabilities: {
      syncDevices: true,
      collectTelemetry: true,
      syncRooms: false,
      supportsDisconnect: false,
      domains: ['security', 'climate'],
    },
    envVars: ['XSENSE_EMAIL', 'XSENSE_PASSWORD'],
    syncEndpoint: '/api/vendors/xsense/sync',
  },
  xiaomi: {
    id: 'xiaomi',
    slug: 'xiaomi',
    label: 'Xiaomi Home',
    shortLabel: 'MI',
    accentColor: '#fb923c',
    badgeClass: 'border-orange-500/40 bg-orange-500/15 text-orange-300',
    dotClass: 'bg-orange-400',
    description:
      'Xiaomi Home / Mi Cloud (100 % lecture seule via QR Code ou compte : capteurs, prises, purificateurs, robots)',
    authKind: 'qr_or_credentials',
    capabilities: {
      syncDevices: true,
      collectTelemetry: true,
      syncRooms: true,
      supportsDisconnect: true,
      domains: ['climate', 'power', 'contacts', 'security', 'covers', 'appliances'],
    },
    envVars: ['XIAOMI_USERNAME', 'XIAOMI_PASSWORD', 'XIAOMI_REGION'],
    syncEndpoint: '/api/vendors/xiaomi/sync',
    disconnectEndpoint: '/api/vendors/xiaomi/disconnect',
  },
  google_home: {
    id: 'google_home',
    slug: 'google-home',
    label: 'Google Home',
    shortLabel: 'GH',
    accentColor: '#38bdf8',
    badgeClass: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
    dotClass: 'bg-sky-400',
    description:
      'Écosystème Google Home / Nest / Matter (Home MCP tous appareils ou Nest SDM en lecture seule)',
    authKind: 'oauth2',
    capabilities: {
      syncDevices: true,
      collectTelemetry: true,
      syncRooms: true,
      supportsDisconnect: true,
      domains: ['power', 'climate', 'contacts', 'hvac', 'covers'],
    },
    envVars: [
      'GOOGLE_HOME_MODE',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_SDM_PROJECT_ID',
    ],
    syncEndpoint: '/api/vendors/google-home/sync',
    disconnectEndpoint: '/api/vendors/google-home/disconnect',
  },
  conso_api: {
    id: 'conso_api',
    slug: 'conso-api',
    label: 'Linky (Conso API)',
    shortLabel: 'LK',
    accentColor: '#84cc16',
    badgeClass: 'border-lime-500/40 bg-lime-500/15 text-lime-300',
    dotClass: 'bg-lime-400',
    description:
      'Compteur Linky via Conso API / Enedis (100 % lecture seule : conso totale J-1, courbe 30 min, puissance max VA)',
    authKind: 'cloud_key',
    capabilities: {
      syncDevices: true,
      collectTelemetry: true,
      syncRooms: false,
      supportsDisconnect: true,
      domains: ['power'],
    },
    envVars: ['CONSO_API_TOKEN', 'CONSO_API_PRM', 'CONSO_API_SUBSCRIBED_KVA'],
    syncEndpoint: '/api/vendors/conso-api/sync',
    disconnectEndpoint: '/api/vendors/conso-api/disconnect',
  },
};

export interface NormalizedVendorDevice {
  externalId: string;
  name: string;
  roomName: string | null;
  manufacturer: string | null;
  model: string | null;
  deviceType: string | null;
  category: DeviceCategory;
  isOnline: boolean;
  tempC: number | null;
  humidityPct: number | null;
  batteryPct: number | null;
  contactOpen: boolean | null;
  powerW: number | null;
  voltageV?: number | null;
  addEleKwh?: number | null;
  macAddress?: string | null;
  ipAddress?: string | null;
  rawTraits: RawDpStatus[];
}

export interface VendorInventoryResult {
  roomNames: string[];
  devices: NormalizedVendorDevice[];
  warning?: string;
}

export interface VendorAdapter {
  id: VendorId;
  fetchInventory: () => Promise<VendorInventoryResult>;
}

export function isValidVendorId(value: unknown): value is VendorId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VENDOR_REGISTRY, value);
}

export function getVendorMeta(vendor: VendorId): VendorMeta {
  return VENDOR_REGISTRY[vendor];
}

export function getVendorBySlug(slugOrId: string): VendorMeta | null {
  const normalized = slugOrId.trim().toLowerCase();
  if (!normalized) return null;
  if (isValidVendorId(normalized)) {
    return VENDOR_REGISTRY[normalized];
  }
  for (const id of VENDOR_IDS) {
    const meta = VENDOR_REGISTRY[id];
    if (meta.slug === normalized) return meta;
  }
  return null;
}

/**
 * Normalise et déduplique la liste des systèmes d'un appareil tout en garantissant
 * la présence de son fournisseur principal.
 */
export function normalizeSystems(systems: unknown, primaryVendor: VendorId = 'tuya'): VendorId[] {
  const validPrimary: VendorId = isValidVendorId(primaryVendor) ? primaryVendor : 'tuya';
  const result = new Set<VendorId>([validPrimary]);

  if (Array.isArray(systems)) {
    for (const item of systems) {
      if (isValidVendorId(item)) {
        result.add(item);
      }
    }
  }

  return VENDOR_IDS.filter((v) => result.has(v));
}
