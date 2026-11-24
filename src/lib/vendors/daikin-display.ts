import { normalizeLocale, type AppLocale } from '@/lib/i18n/types';
import { toFiniteNumber as toNum } from '@/lib/utils';
import type { DeviceRecord, RawDpStatus } from '@/types';

export type DaikinOperationMode =
  | 'heating'
  | 'cooling'
  | 'auto'
  | 'dry'
  | 'fanOnly'
  | 'unknown';

export type DaikinModeTone = 'amber' | 'sky' | 'indigo' | 'teal' | 'slate';

export interface DaikinUnitSummary {
  unitType: string;
  unitTypeLabel: string;
  model: string | null;
  isOn: boolean;
  operationMode: DaikinOperationMode;
  modeLabel: string;
  modeTone: DaikinModeTone;
  roomTempC: number | null;
  humidityPct: number | null;
  targetTempC: number | null;
  outdoorTempC: number | null;
  fanLabel: string | null;
  swingLabel: string | null;
  econo: boolean;
  powerful: boolean;
  streamer: boolean;
  todayKwh: number | null;
  todayHeatingKwh: number | null;
  todayCoolingKwh: number | null;
  weekKwh: number | null;
  yearKwh: number | null;
  wifiSsid: string | null;
  wifiRssiDbm: number | null;
  compactText: string;
  searchableText: string;
}

const MODE_TONES: Record<DaikinOperationMode, DaikinModeTone> = {
  heating: 'amber',
  cooling: 'sky',
  auto: 'indigo',
  dry: 'teal',
  fanOnly: 'slate',
  unknown: 'slate',
};

const DAIKIN_COPY: Record<
  AppLocale,
  {
    modes: Record<DaikinOperationMode, string>;
    unitTypes: Record<string, string>;
    unitFallback: string;
    standby: string;
    fanAuto: string;
    fanQuiet: string;
    fanStep: (step: number) => string;
    target: (temp: number) => string;
    outdoor: (temp: number) => string;
    kwhDay: (val: string) => string;
  }
> = {
  fr: {
    modes: {
      heating: 'Chauffage',
      cooling: 'Clim',
      auto: 'Auto',
      dry: 'Déshumidif.',
      fanOnly: 'Ventilation',
      unknown: 'Actif',
    },
    unitTypes: {
      climateControl: 'Split / Clim réversible',
      climateControlMainZone: 'PAC Air/Eau (Zone principale)',
      domesticHotWaterTank: 'Ballon ECS (Altherma)',
    },
    unitFallback: 'Unité Daikin',
    standby: 'Veille',
    fanAuto: 'Ventil. Auto',
    fanQuiet: 'Silence',
    fanStep: (step) => `Vitesse ${step}`,
    target: (temp) => `Cible ${temp}°C`,
    outdoor: (temp) => `Ext. ${temp}°C`,
    kwhDay: (val) => `${val} kWh/j`,
  },
  en: {
    modes: {
      heating: 'Heating',
      cooling: 'Cooling',
      auto: 'Auto',
      dry: 'Dry',
      fanOnly: 'Fan',
      unknown: 'Active',
    },
    unitTypes: {
      climateControl: 'Split AC / Heat Pump',
      climateControlMainZone: 'Air-to-Water HP (Main Zone)',
      domesticHotWaterTank: 'DHW Tank (Altherma)',
    },
    unitFallback: 'Daikin Unit',
    standby: 'Standby',
    fanAuto: 'Auto Fan',
    fanQuiet: 'Quiet',
    fanStep: (step) => `Speed ${step}`,
    target: (temp) => `Target ${temp}°C`,
    outdoor: (temp) => `Out. ${temp}°C`,
    kwhDay: (val) => `${val} kWh/d`,
  },
  es: {
    modes: {
      heating: 'Calefacción',
      cooling: 'Frío',
      auto: 'Auto',
      dry: 'Deshumidif.',
      fanOnly: 'Ventilación',
      unknown: 'Activo',
    },
    unitTypes: {
      climateControl: 'Split / Bomba de calor',
      climateControlMainZone: 'Bomba Aire/Agua (Zona principal)',
      domesticHotWaterTank: 'Depósito ACS (Altherma)',
    },
    unitFallback: 'Unidad Daikin',
    standby: 'Espera',
    fanAuto: 'Ventil. Auto',
    fanQuiet: 'Silencio',
    fanStep: (step) => `Velocidad ${step}`,
    target: (temp) => `Obj. ${temp}°C`,
    outdoor: (temp) => `Ext. ${temp}°C`,
    kwhDay: (val) => `${val} kWh/d`,
  },
  de: {
    modes: {
      heating: 'Heizen',
      cooling: 'Kühlen',
      auto: 'Auto',
      dry: 'Entfeuchten',
      fanOnly: 'Lüften',
      unknown: 'Aktiv',
    },
    unitTypes: {
      climateControl: 'Split-Klimagerät / WP',
      climateControlMainZone: 'Luft/Wasser-WP (Hauptzone)',
      domesticHotWaterTank: 'Warmwasserspeicher (Altherma)',
    },
    unitFallback: 'Daikin-Gerät',
    standby: 'Standby',
    fanAuto: 'Auto-Lüfter',
    fanQuiet: 'Leise',
    fanStep: (step) => `Stufe ${step}`,
    target: (temp) => `Soll ${temp}°C`,
    outdoor: (temp) => `Außen ${temp}°C`,
    kwhDay: (val) => `${val} kWh/T`,
  },
  it: {
    modes: {
      heating: 'Riscaldamento',
      cooling: 'Raffresc.',
      auto: 'Auto',
      dry: 'Deumidif.',
      fanOnly: 'Ventilazione',
      unknown: 'Attivo',
    },
    unitTypes: {
      climateControl: 'Split / Pompa di calore',
      climateControlMainZone: 'PdC Aria/Acqua (Zona principale)',
      domesticHotWaterTank: 'Boiler ACS (Altherma)',
    },
    unitFallback: 'Unità Daikin',
    standby: 'Standby',
    fanAuto: 'Vent. Auto',
    fanQuiet: 'Silenzioso',
    fanStep: (step) => `Velocità ${step}`,
    target: (temp) => `Target ${temp}°C`,
    outdoor: (temp) => `Est. ${temp}°C`,
    kwhDay: (val) => `${val} kWh/g`,
  },
};

function toStr(val: unknown): string | null {
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

function normalizeMode(raw: string | null): DaikinOperationMode {
  if (!raw) return 'unknown';
  const lower = raw.toLowerCase();
  if (lower === 'heating') return 'heating';
  if (lower === 'cooling') return 'cooling';
  if (lower === 'auto') return 'auto';
  if (lower === 'dry') return 'dry';
  if (lower === 'fanonly' || lower === 'fan_only') return 'fanOnly';
  return 'unknown';
}

export function isDaikinHvacDevice(
  device: Pick<DeviceRecord, 'primaryVendor' | 'lastRawStatus'>
): boolean {
  if (device.primaryVendor === 'daikin') return true;
  if (!Array.isArray(device.lastRawStatus)) return false;
  return device.lastRawStatus.some(
    (item) => typeof item.code === 'string' && item.code.startsWith('daikin:')
  );
}

export function extractDaikinSummary(
  rawStatus: RawDpStatus[] | null | undefined,
  rawLocale: AppLocale = 'fr'
): DaikinUnitSummary | null {
  if (!Array.isArray(rawStatus) || rawStatus.length === 0) return null;

  const map = new Map<string, unknown>();
  for (const item of rawStatus) {
    if (item && typeof item.code === 'string') {
      map.set(item.code, item.value);
    }
  }

  const hasDaikinKey = Array.from(map.keys()).some((k) => k.startsWith('daikin:'));
  if (!hasDaikinKey) return null;

  const locale = normalizeLocale(rawLocale);
  const copy = DAIKIN_COPY[locale];

  const unitType = toStr(map.get('daikin:unitType')) ?? 'climateControl';
  const unitTypeLabel = copy.unitTypes[unitType] ?? copy.unitFallback;
  const model = toStr(map.get('daikin:model'));
  const onOff = toStr(map.get('daikin:onOff'))?.toLowerCase();
  const isOn = onOff === 'on';

  const operationMode = normalizeMode(toStr(map.get('daikin:operationMode')));
  const modeLabel = isOn ? copy.modes[operationMode] : copy.standby;
  const modeTone: DaikinModeTone = isOn ? MODE_TONES[operationMode] : 'slate';

  const roomTempC = toNum(map.get('daikin:roomTempC'));
  const humidityPct = toNum(map.get('daikin:roomHumidityPct'));
  const targetTempC = toNum(map.get('daikin:targetTempC'));
  const outdoorTempC = toNum(map.get('daikin:outdoorTempC'));

  const fanSpeed = toStr(map.get('daikin:fanSpeed'));
  const fanStep = toNum(map.get('daikin:fanStep'));
  let fanLabel: string | null = null;
  if (fanSpeed) {
    const lower = fanSpeed.toLowerCase();
    if (lower === 'auto') fanLabel = copy.fanAuto;
    else if (lower === 'quiet') fanLabel = copy.fanQuiet;
    else if (lower === 'fixed' && fanStep !== null) fanLabel = copy.fanStep(fanStep);
    else fanLabel = fanSpeed;
  }

  const swingV = toStr(map.get('daikin:swingVertical'));
  const swingH = toStr(map.get('daikin:swingHorizontal'));
  const swingParts: string[] = [];
  if (swingV && swingV.toLowerCase() !== 'stop') swingParts.push(`V:${swingV}`);
  if (swingH && swingH.toLowerCase() !== 'stop') swingParts.push(`H:${swingH}`);
  const swingLabel = swingParts.length > 0 ? swingParts.join(' · ') : null;

  const econo = map.get('daikin:econo') === true;
  const powerful = map.get('daikin:powerful') === true;
  const streamer = map.get('daikin:streamer') === true;

  const todayKwh = toNum(map.get('daikin:todayKwh'));
  const todayHeatingKwh = toNum(map.get('daikin:todayHeatingKwh'));
  const todayCoolingKwh = toNum(map.get('daikin:todayCoolingKwh'));
  const weekKwh = toNum(map.get('daikin:weekKwh'));
  const yearKwh = toNum(map.get('daikin:yearKwh'));

  const wifiSsid = toStr(map.get('daikin:wifiSsid'));
  const wifiRssiDbm = toNum(map.get('daikin:wifiRssiDbm'));

  const compactParts: string[] = [modeLabel];
  if (targetTempC !== null) compactParts.push(copy.target(targetTempC));
  if (outdoorTempC !== null) compactParts.push(copy.outdoor(outdoorTempC));
  if (todayKwh !== null) compactParts.push(copy.kwhDay(todayKwh.toFixed(1)));

  const searchableText = [
    'daikin onecta',
    unitType,
    unitTypeLabel,
    model,
    modeLabel,
    operationMode,
    fanLabel,
    wifiSsid,
    econo ? 'econo' : null,
    powerful ? 'powerful' : null,
    streamer ? 'streamer' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    unitType,
    unitTypeLabel,
    model,
    isOn,
    operationMode,
    modeLabel,
    modeTone,
    roomTempC,
    humidityPct,
    targetTempC,
    outdoorTempC,
    fanLabel,
    swingLabel,
    econo,
    powerful,
    streamer,
    todayKwh,
    todayHeatingKwh,
    todayCoolingKwh,
    weekKwh,
    yearKwh,
    wifiSsid,
    wifiRssiDbm,
    compactText: compactParts.join(' · '),
    searchableText,
  };
}
