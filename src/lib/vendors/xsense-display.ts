import { normalizeLocale, type AppLocale } from '@/lib/i18n/types';
import { toFiniteNumber as toNum } from '@/lib/utils';
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

const ALARM_TONES: Record<XSenseAlarmStatus, XSenseAlarmTone> = {
  normal: 'emerald',
  smoke: 'rose',
  co: 'rose',
  water_leak: 'rose',
  muted: 'amber',
  fault: 'amber',
};

const XSENSE_COPY: Record<
  AppLocale,
  {
    unitTypes: Record<XSenseUnitType, string>;
    alarms: Record<XSenseAlarmStatus, string>;
  }
> = {
  fr: {
    unitTypes: {
      baseStation: 'Station de base',
      smokeCoDetector: 'Détecteur Fumée / CO',
      waterLeakSensor: 'Capteur Fuite d’eau',
      thermoHygrometer: 'Thermo-hygromètre',
    },
    alarms: {
      normal: 'Normal',
      smoke: 'ALERTE FUMÉE',
      co: 'ALERTE CO',
      water_leak: 'FUITE D’EAU',
      muted: 'Silencieux',
      fault: 'Anomalie',
    },
  },
  en: {
    unitTypes: {
      baseStation: 'Base Station',
      smokeCoDetector: 'Smoke / CO Detector',
      waterLeakSensor: 'Water Leak Sensor',
      thermoHygrometer: 'Thermo-Hygrometer',
    },
    alarms: {
      normal: 'Normal',
      smoke: 'SMOKE ALERT',
      co: 'CO ALERT',
      water_leak: 'WATER LEAK',
      muted: 'Muted',
      fault: 'Fault',
    },
  },
  es: {
    unitTypes: {
      baseStation: 'Estación base',
      smokeCoDetector: 'Detector Humo / CO',
      waterLeakSensor: 'Sensor Fuga de agua',
      thermoHygrometer: 'Termo-higrómetro',
    },
    alarms: {
      normal: 'Normal',
      smoke: 'ALERTA HUMO',
      co: 'ALERTA CO',
      water_leak: 'FUGA DE AGUA',
      muted: 'Silenciado',
      fault: 'Anomalía',
    },
  },
  de: {
    unitTypes: {
      baseStation: 'Basisstation',
      smokeCoDetector: 'Rauch- / CO-Melder',
      waterLeakSensor: 'Wasserlecksensor',
      thermoHygrometer: 'Thermo-Hygrometer',
    },
    alarms: {
      normal: 'Normal',
      smoke: 'RAUCHALARM',
      co: 'CO-ALARM',
      water_leak: 'WASSERLECK',
      muted: 'Stumm',
      fault: 'Störung',
    },
  },
  it: {
    unitTypes: {
      baseStation: 'Stazione base',
      smokeCoDetector: 'Rilevatore Fumo / CO',
      waterLeakSensor: 'Sensore Perdita d’acqua',
      thermoHygrometer: 'Termo-igrometro',
    },
    alarms: {
      normal: 'Normale',
      smoke: 'ALLARME FUMO',
      co: 'ALLARME CO',
      water_leak: 'PERDITA D’ACQUA',
      muted: 'Silenziato',
      fault: 'Anomalia',
    },
  },
};

function toStr(val: unknown): string | null {
  return typeof val === 'string' && val.trim() ? val.trim() : null;
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
  rawStatus: RawDpStatus[] | null | undefined,
  rawLocale: AppLocale = 'fr'
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

  const locale = normalizeLocale(rawLocale);
  const copy = XSENSE_COPY[locale];

  const unitType = normalizeUnitType(toStr(map.get('xsense:unitType')));
  const unitTypeLabel = copy.unitTypes[unitType];
  const model = toStr(map.get('xsense:model'));
  const alarmStatus = normalizeAlarmStatus(toStr(map.get('xsense:alarmStatus')));
  const alarmLabel = copy.alarms[alarmStatus];
  const alarmTone = ALARM_TONES[alarmStatus];

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

  const parts: string[] = [alarmLabel];
  if (coPpm !== null) parts.push(`${coPpm} ppm CO`);
  if (rfLevel !== null) parts.push(`RF ${rfLevel}/3`);
  if (wifiRssiDbm !== null) parts.push(`${wifiRssiDbm} dBm`);
  if (stationName) parts.push(`via ${stationName}`);

  const searchableText = [
    'xsense x-sense',
    unitType,
    unitTypeLabel,
    model,
    alarmLabel,
    stationName,
    houseName,
    smokeDetected ? 'fumee smoke' : null,
    coDetected ? 'monoxyde co' : null,
    waterLeakDetected ? 'fuite eau leak' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    unitType,
    unitTypeLabel,
    model,
    alarmStatus,
    alarmLabel,
    alarmTone,
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
