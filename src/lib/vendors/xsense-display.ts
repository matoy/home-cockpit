import type { DeviceRecord, RawDpStatus } from '@/types';

export type XSenseUnitType =
  | 'baseStation'
  | 'smokeCoDetector'
  | 'waterLeakSensor'
  | 'thermoHygrometer';

export type XSenseAlarmStatus = 'normal' | 'smoke' | 'co' | 'water_leak' | 'muted' | 'fault';
export type XSenseAlarmTone = 'emerald' | 'rose' | 'amber' | 'slate';

export interface XSenseDeviceSummary {
  unitType: XSenseUnitType;
  unitTypeLabel: string;
  model: string | null;
  alarmStatus: XSenseAlarmStatus;
  alarmLabel: string;
  alarmTone: XSenseAlarmTone;
  isAlert: boolean;
  smokeDetected: boolean;
  coDetected: boolean;
  coPpm: number | null;
  waterLeakDetected: boolean;
  isMuted: boolean;
  stationName: string | null;
  houseName: string | null;
  rfLevel: number | null;
  wifiRssiDbm: number | null;
  tempC: number | null;
  humidityPct: number | null;
  compactText: string;
  searchableText: string;
}

const UNIT_TYPE_LABELS: Record<XSenseUnitType, string> = {
  baseStation: 'Station de base',
  smokeCoDetector: 'Détecteur Fumée / CO',
  waterLeakSensor: 'Capteur Fuite d’eau',
  thermoHygrometer: 'Thermo-hygromètre',
};

const ALARM_META: Record<XSenseAlarmStatus, { label: string; tone: XSenseAlarmTone }> = {
  normal: { label: 'Normal', tone: 'emerald' },
  smoke: { label: 'ALERTE FUMÉE', tone: 'rose' },
  co: { label: 'ALERTE CO', tone: 'rose' },
  water_leak: { label: 'FUITE D’EAU', tone: 'rose' },
  muted: { label: 'Silencieux', tone: 'amber' },
  fault: { label: 'Anomalie', tone: 'amber' },
};

function toStr(val: unknown): string | null {
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

function toNum(val: unknown): number | null {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function normalizeUnitType(raw: string | null): XSenseUnitType {
  if (
    raw === 'baseStation' ||
    raw === 'smokeCoDetector' ||
    raw === 'waterLeakSensor' ||
    raw === 'thermoHygrometer'
  ) {
    return raw;
  }
  return 'smokeCoDetector';
}

function normalizeAlarmStatus(raw: string | null): XSenseAlarmStatus {
  if (
    raw === 'normal' ||
    raw === 'smoke' ||
    raw === 'co' ||
    raw === 'water_leak' ||
    raw === 'muted' ||
    raw === 'fault'
  ) {
    return raw;
  }
  return 'normal';
}

export function isXSenseSecurityDevice(
  device: Pick<DeviceRecord, 'primaryVendor' | 'lastRawStatus'>
): boolean {
  if (device.primaryVendor === 'xsense') return true;
  if (!Array.isArray(device.lastRawStatus)) return false;
  return device.lastRawStatus.some(
    (item) => typeof item.code === 'string' && item.code.startsWith('xsense:')
  );
}

export function extractXSenseSummary(
  rawStatus: RawDpStatus[] | null | undefined
): XSenseDeviceSummary | null {
  if (!Array.isArray(rawStatus) || rawStatus.length === 0) return null;

  const map = new Map<string, unknown>();
  for (const item of rawStatus) {
    if (item && typeof item.code === 'string') {
      map.set(item.code, item.value);
    }
  }

  const hasXSenseKey = Array.from(map.keys()).some((k) => k.startsWith('xsense:'));
  if (!hasXSenseKey) return null;

  const unitType = normalizeUnitType(toStr(map.get('xsense:unitType')));
  const unitTypeLabel = UNIT_TYPE_LABELS[unitType];
  const model = toStr(map.get('xsense:model'));
  const alarmStatus = normalizeAlarmStatus(toStr(map.get('xsense:alarmStatus')));
  const meta = ALARM_META[alarmStatus];

  const smokeDetected = map.get('xsense:smokeDetected') === true;
  const coDetected = map.get('xsense:coDetected') === true;
  const waterLeakDetected = map.get('xsense:waterLeakDetected') === true;
  const isMuted = map.get('xsense:isMuted') === true;
  const isAlert =
    alarmStatus === 'smoke' || alarmStatus === 'co' || alarmStatus === 'water_leak';

  const coPpm = toNum(map.get('xsense:coPpm'));
  const stationName = toStr(map.get('xsense:stationName'));
  const houseName = toStr(map.get('xsense:houseName'));
  const rfLevel = toNum(map.get('xsense:rfLevel'));
  const wifiRssiDbm = toNum(map.get('xsense:wifiRssi'));
  const tempC = toNum(map.get('xsense:tempC'));
  const humidityPct = toNum(map.get('xsense:humidityPct'));

  const parts: string[] = [meta.label];
  if (coPpm !== null) parts.push(`${coPpm} ppm CO`);
  if (rfLevel !== null) parts.push(`RF ${rfLevel}/3`);
  if (wifiRssiDbm !== null) parts.push(`${wifiRssiDbm} dBm`);
  if (stationName) parts.push(`via ${stationName}`);

  const searchableText = [
    'xsense x-sense',
    unitType,
    unitTypeLabel,
    model,
    meta.label,
    stationName,
    houseName,
    smokeDetected ? 'fumee smoke' : null,
    coDetected ? 'monoxyde co' : null,
    waterLeakDetected ? 'fuite eau' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    unitType,
    unitTypeLabel,
    model,
    alarmStatus,
    alarmLabel: meta.label,
    alarmTone: meta.tone,
    isAlert,
    smokeDetected,
    coDetected,
    coPpm,
    waterLeakDetected,
    isMuted,
    stationName,
    houseName,
    rfLevel,
    wifiRssiDbm,
    tempC,
    humidityPct,
    compactText: parts.join(' · '),
    searchableText,
  };
}
