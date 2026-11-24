import { normalizeLocale, type AppLocale } from '@/lib/i18n/types';
import { toFiniteNumber as toNum } from '@/lib/utils';
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

const XIAOMI_COPY: Record<
  AppLocale,
  {
    unitTypes: Record<XiaomiUnitType, string>;
    aqiExcellent: string;
    aqiGood: string;
    aqiModerate: string;
    aqiPoor: string;
    smokeAlert: string;
    gasAlert: string;
    waterLeak: string;
    normal: string;
    filterPct: (pct: number) => string;
  }
> = {
  fr: {
    unitTypes: {
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
    },
    aqiExcellent: 'Air excellent',
    aqiGood: 'Air correct',
    aqiModerate: 'Air modéré',
    aqiPoor: 'Air dégradé',
    smokeAlert: 'ALERTE FUMÉE',
    gasAlert: 'ALERTE GAZ',
    waterLeak: 'FUITE D’EAU',
    normal: 'Normal',
    filterPct: (pct) => `Filtre ${pct}%`,
  },
  en: {
    unitTypes: {
      climateSensor: 'Mi Climate Sensor',
      smartPlug: 'Mi Smart Plug',
      contactSensor: 'Mi Contact Sensor',
      smokeSensor: 'Mi Smoke Detector',
      gasSensor: 'Mi Gas Detector',
      waterLeakSensor: 'Mi Water Leak Sensor',
      motionSensor: 'Motion Sensor',
      airPurifier: 'Air Purifier',
      robotVacuum: 'Robot Vacuum',
      otherDevice: 'Xiaomi Home Device',
    },
    aqiExcellent: 'Excellent air',
    aqiGood: 'Good air',
    aqiModerate: 'Moderate air',
    aqiPoor: 'Poor air',
    smokeAlert: 'SMOKE ALERT',
    gasAlert: 'GAS ALERT',
    waterLeak: 'WATER LEAK',
    normal: 'Normal',
    filterPct: (pct) => `Filter ${pct}%`,
  },
  es: {
    unitTypes: {
      climateSensor: 'Sensor Clima Mi',
      smartPlug: 'Enchufe Mi',
      contactSensor: 'Sensor Apertura Mi',
      smokeSensor: 'Detector Humo Mi',
      gasSensor: 'Detector Gas Mi',
      waterLeakSensor: 'Sensor Fuga de Agua Mi',
      motionSensor: 'Sensor Movimiento',
      airPurifier: 'Purificador de aire',
      robotVacuum: 'Robot Aspirador',
      otherDevice: 'Dispositivo Xiaomi Home',
    },
    aqiExcellent: 'Aire excelente',
    aqiGood: 'Aire bueno',
    aqiModerate: 'Aire moderado',
    aqiPoor: 'Aire deficiente',
    smokeAlert: 'ALERTA HUMO',
    gasAlert: 'ALERTA GAS',
    waterLeak: 'FUGA DE AGUA',
    normal: 'Normal',
    filterPct: (pct) => `Filtro ${pct}%`,
  },
  de: {
    unitTypes: {
      climateSensor: 'Mi Klimasensor',
      smartPlug: 'Mi Steckdose',
      contactSensor: 'Mi Tür-/Fenstersensor',
      smokeSensor: 'Mi Rauchmelder',
      gasSensor: 'Mi Gasmelder',
      waterLeakSensor: 'Mi Wasserlecksensor',
      motionSensor: 'Bewegungsmelder',
      airPurifier: 'Luftreiniger',
      robotVacuum: 'Saugroboter',
      otherDevice: 'Xiaomi Home Gerät',
    },
    aqiExcellent: 'Ausgezeichnete Luft',
    aqiGood: 'Gute Luft',
    aqiModerate: 'Mäßige Luft',
    aqiPoor: 'Schlechte Luft',
    smokeAlert: 'RAUCHALARM',
    gasAlert: 'GASALARM',
    waterLeak: 'WASSERLECK',
    normal: 'Normal',
    filterPct: (pct) => `Filter ${pct}%`,
  },
  it: {
    unitTypes: {
      climateSensor: 'Sensore Clima Mi',
      smartPlug: 'Presa Smart Mi',
      contactSensor: 'Sensore Apertura Mi',
      smokeSensor: 'Rilevatore Fumo Mi',
      gasSensor: 'Rilevatore Gas Mi',
      waterLeakSensor: 'Sensore Perdita Acqua Mi',
      motionSensor: 'Sensore Movimento',
      airPurifier: 'Purificatore d’aria',
      robotVacuum: 'Robot Aspirapolvere',
      otherDevice: 'Dispositivo Xiaomi Home',
    },
    aqiExcellent: 'Aria eccellente',
    aqiGood: 'Aria buona',
    aqiModerate: 'Aria moderata',
    aqiPoor: 'Aria scarsa',
    smokeAlert: 'ALLARME FUMO',
    gasAlert: 'ALLARME GAS',
    waterLeak: 'PERDITA D’ACQUA',
    normal: 'Normale',
    filterPct: (pct) => `Filtro ${pct}%`,
  },
};

function toStr(val: unknown): string | null {
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

function normalizeUnitType(raw: string | null): XiaomiUnitType {
  if (raw && raw in XIAOMI_COPY.fr.unitTypes) {
    return raw as XiaomiUnitType;
  }
  return 'otherDevice';
}

function formatAqiLabel(pm25: number | null, locale: AppLocale): string | null {
  if (pm25 === null) return null;
  const copy = XIAOMI_COPY[locale];
  if (pm25 <= 12) return copy.aqiExcellent;
  if (pm25 <= 35) return copy.aqiGood;
  if (pm25 <= 55) return copy.aqiModerate;
  return copy.aqiPoor;
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
  rawStatus: RawDpStatus[] | null | undefined,
  rawLocale: AppLocale = 'fr'
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

  const locale = normalizeLocale(rawLocale);
  const copy = XIAOMI_COPY[locale];

  const unitType = normalizeUnitType(toStr(map.get('xiaomi:unitType')));
  const unitTypeLabel = copy.unitTypes[unitType];
  const model = toStr(map.get('xiaomi:model'));
  const pm25 = toNum(map.get('xiaomi:pm25'));
  const aqiLabel = formatAqiLabel(pm25, locale);
  const mode = toStr(map.get('xiaomi:mode'));
  const filterLifePct = toNum(map.get('xiaomi:filterLifePct'));
  const vacuumState = toStr(map.get('xiaomi:vacuumState'));
  const wifiRssiDbm = toNum(map.get('xiaomi:rssi'));

  const smokeAlert = map.get('xiaomi:smokeAlert') === true;
  const gasAlert = map.get('xiaomi:gasAlert') === true;
  const waterLeak = map.get('xiaomi:waterLeak') === true;
  const isAlert = smokeAlert || gasAlert || waterLeak;

  let alertLabel: string | null = null;
  if (smokeAlert) alertLabel = copy.smokeAlert;
  else if (gasAlert) alertLabel = copy.gasAlert;
  else if (waterLeak) alertLabel = copy.waterLeak;
  else if (
    unitType === 'waterLeakSensor' ||
    unitType === 'smokeSensor' ||
    unitType === 'gasSensor'
  ) {
    alertLabel = copy.normal;
  }

  const parts: string[] = [];
  if (alertLabel) parts.push(alertLabel);
  if (pm25 !== null) parts.push(`PM2.5 ${pm25} µg/m³`);
  if (mode) parts.push(mode);
  if (vacuumState) parts.push(vacuumState);
  if (filterLifePct !== null) parts.push(copy.filterPct(filterLifePct));
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
