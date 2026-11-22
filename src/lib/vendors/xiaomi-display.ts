import type { DeviceRecord, RawDpStatus } from '@/types';
import type { XiaomiUnitType } from './xiaomi-client';

export interface XiaomiDeviceSummary {
  unitType: XiaomiUnitType;
  unitTypeLabel: string;
  model: string | null;
  pm25: number | null;
  aqiLabel: string | null;
  mode: string | null;
  filterLifePct: number | null;
  vacuumState: string | null;
  isAlert: boolean;
  alertLabel: string | null;
  wifiRssiDbm: number | null;
  compactText: string;
  searchableText: string;
}

const UNIT_TYPE_LABELS: Record<XiaomiUnitType, string> = {
  climateSensor: 'Capteur Climat Mi',
  smartPlug: 'Prise connectée Mi',
  contactSensor: 'Capteur Ouverture Mi',
  smokeSensor: 'Détecteur Fumée Mi',
  gasSensor: 'Détecteur Gaz Mi',
  waterLeakSensor: 'Capteur Fuite d’eau Mi',
  motionSensor: 'Détecteur Mouvement',
  airPurifier: 'Purificateur d’air',
  robotVacuum: 'Aspirateur Robot',
  otherDevice: 'Appareil Xiaomi Home',
};

function toStr(val: unknown): string | null {
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

function toNum(val: unknown): number | null {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function normalizeUnitType(raw: string | null): XiaomiUnitType {
  if (raw && raw in UNIT_TYPE_LABELS) {
    return raw as XiaomiUnitType;
  }
  return 'otherDevice';
}

function formatAqiLabel(pm25: number | null): string | null {
  if (pm25 === null) return null;
  if (pm25 <= 12) return 'Air excellent';
  if (pm25 <= 35) return 'Air correct';
  if (pm25 <= 55) return 'Air modéré';
  return 'Air dégradé';
}

export function isXiaomiSecurityOrHomeDevice(
  device: Pick<DeviceRecord, 'primaryVendor' | 'lastRawStatus'>
): boolean {
  if (device.primaryVendor === 'xiaomi') return true;
  if (!Array.isArray(device.lastRawStatus)) return false;
  return device.lastRawStatus.some(
    (item) => typeof item.code === 'string' && item.code.startsWith('xiaomi:')
  );
}

export function extractXiaomiSummary(
  rawStatus: RawDpStatus[] | null | undefined
): XiaomiDeviceSummary | null {
  if (!Array.isArray(rawStatus) || rawStatus.length === 0) return null;

  const map = new Map<string, unknown>();
  for (const item of rawStatus) {
    if (item && typeof item.code === 'string') {
      map.set(item.code, item.value);
    }
  }

  const hasXiaomiKey = Array.from(map.keys()).some((k) => k.startsWith('xiaomi:'));
  if (!hasXiaomiKey) return null;

  const unitType = normalizeUnitType(toStr(map.get('xiaomi:unitType')));
  const unitTypeLabel = UNIT_TYPE_LABELS[unitType];
  const model = toStr(map.get('xiaomi:model'));
  const pm25 = toNum(map.get('xiaomi:pm25'));
  const aqiLabel = formatAqiLabel(pm25);
  const mode = toStr(map.get('xiaomi:mode'));
  const filterLifePct = toNum(map.get('xiaomi:filterLifePct'));
  const vacuumState = toStr(map.get('xiaomi:vacuumState'));
  const wifiRssiDbm = toNum(map.get('xiaomi:rssi'));

  const smokeAlert = map.get('xiaomi:smokeAlert') === true;
  const gasAlert = map.get('xiaomi:gasAlert') === true;
  const waterLeak = map.get('xiaomi:waterLeak') === true;
  const isAlert = smokeAlert || gasAlert || waterLeak;

  let alertLabel: string | null = null;
  if (smokeAlert) alertLabel = 'ALERTE FUMÉE';
  else if (gasAlert) alertLabel = 'ALERTE GAZ';
  else if (waterLeak) alertLabel = 'FUITE D’EAU';
  else if (
    unitType === 'waterLeakSensor' ||
    unitType === 'smokeSensor' ||
    unitType === 'gasSensor'
  ) {
    alertLabel = 'Normal';
  }

  const parts: string[] = [];
  if (alertLabel) parts.push(alertLabel);
  if (pm25 !== null) parts.push(`PM2.5 ${pm25} µg/m³`);
  if (mode) parts.push(mode);
  if (vacuumState) parts.push(vacuumState);
  if (filterLifePct !== null) parts.push(`Filtre ${filterLifePct}%`);
  if (parts.length === 0) parts.push(unitTypeLabel);

  const searchableText = [
    'xiaomi mi home',
    unitType,
    unitTypeLabel,
    model,
    mode,
    vacuumState,
    alertLabel,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    unitType,
    unitTypeLabel,
    model,
    pm25,
    aqiLabel,
    mode,
    filterLifePct,
    vacuumState,
    isAlert,
    alertLabel,
    wifiRssiDbm,
    compactText: parts.join(' · '),
    searchableText,
  };
}
