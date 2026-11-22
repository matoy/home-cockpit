import type { DeviceCategory, RawDpStatus, VendorId } from '@/types';

export const VENDOR_IDS: readonly VendorId[] = ['tuya', 'google_home'];

export interface VendorMeta {
  id: VendorId;
  label: string;
  shortLabel: string;
  accentColor: string;
  badgeClass: string;
  dotClass: string;
  description: string;
}

export const VENDOR_REGISTRY: Record<VendorId, VendorMeta> = {
  tuya: {
    id: 'tuya',
    label: 'Tuya',
    shortLabel: 'T',
    accentColor: '#f97316',
    badgeClass: 'border-orange-500/40 bg-orange-500/15 text-orange-300',
    dotClass: 'bg-orange-400',
    description:
      'Appareils Smart Life / Tuya Cloud (puissance, kWh, climat, ouvertures, scénarios)',
  },
  google_home: {
    id: 'google_home',
    label: 'Google Home',
    shortLabel: 'GH',
    accentColor: '#38bdf8',
    badgeClass: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
    dotClass: 'bg-sky-400',
    description:
      'Écosystème Google Home / Nest / Matter (Home MCP tous appareils ou Nest SDM en lecture seule)',
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
  return value === 'tuya' || value === 'google_home';
}

export function getVendorMeta(vendor: VendorId): VendorMeta {
  return VENDOR_REGISTRY[vendor];
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
