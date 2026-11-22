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

const MODE_META_FR: Record<
  DaikinOperationMode,
  { label: string; tone: DaikinModeTone }
> = {
  heating: { label: 'Chauffage', tone: 'amber' },
  cooling: { label: 'Clim', tone: 'sky' },
  auto: { label: 'Auto', tone: 'indigo' },
  dry: { label: 'Déshumidif.', tone: 'teal' },
  fanOnly: { label: 'Ventilation', tone: 'slate' },
  unknown: { label: 'Actif', tone: 'slate' },
};

const UNIT_TYPE_LABELS: Record<string, string> = {
  climateControl: 'Split / Clim réversible',
  climateControlMainZone: 'PAC Air/Eau (Zone principale)',
  domesticHotWaterTank: 'Ballon ECS (Altherma)',
};

function toNum(val: unknown): number | null {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

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
  rawStatus: RawDpStatus[] | null | undefined
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

  const unitType = toStr(map.get('daikin:unitType')) ?? 'climateControl';
  const unitTypeLabel = UNIT_TYPE_LABELS[unitType] ?? 'Unité Daikin';
  const model = toStr(map.get('daikin:model'));
  const onOff = toStr(map.get('daikin:onOff'))?.toLowerCase();
  const isOn = onOff === 'on';

  const operationMode = normalizeMode(toStr(map.get('daikin:operationMode')));
  const modeMeta = MODE_META_FR[operationMode];
  const modeLabel = isOn ? modeMeta.label : 'Veille';
  const modeTone: DaikinModeTone = isOn ? modeMeta.tone : 'slate';

  const roomTempC = toNum(map.get('daikin:roomTempC'));
  const humidityPct = toNum(map.get('daikin:roomHumidityPct'));
  const targetTempC = toNum(map.get('daikin:targetTempC'));
  const outdoorTempC = toNum(map.get('daikin:outdoorTempC'));

  const fanSpeed = toStr(map.get('daikin:fanSpeed'));
  const fanStep = toNum(map.get('daikin:fanStep'));
  let fanLabel: string | null = null;
  if (fanSpeed) {
    const lower = fanSpeed.toLowerCase();
    if (lower === 'auto') fanLabel = 'Ventil. Auto';
    else if (lower === 'quiet') fanLabel = 'Silence';
    else if (lower === 'fixed' && fanStep !== null) fanLabel = `Vitesse ${fanStep}`;
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
  if (targetTempC !== null) compactParts.push(`Cible ${targetTempC}°C`);
  if (outdoorTempC !== null) compactParts.push(`Ext. ${outdoorTempC}°C`);
  if (todayKwh !== null) compactParts.push(`${todayKwh.toFixed(1)} kWh/j`);

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
