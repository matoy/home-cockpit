import { normalizeLocale, type AppLocale } from '@/lib/i18n/types';
import { toFiniteNumber } from '@/lib/utils';
import type { DeviceRecord, RawDpStatus } from '@/types';

export type SomfyProtocol = 'io' | 'RTS' | 'Zigbee' | 'Overkiz';

export type CoverKind =
  | 'shutter'
  | 'blind'
  | 'awning'
  | 'curtain'
  | 'garage'
  | 'gate'
  | 'window';

export type CoverPositionState = 'open' | 'closed' | 'partial' | 'unknown';

export interface CoverSummary {
  isCover: true;
  source: 'somfy' | 'tuya';
  protocol: SomfyProtocol | 'Tuya';
  kind: CoverKind;
  kindLabel: string;
  state: CoverPositionState;
  stateLabel: string;
  /** 0 = ouvert (0 % fermé), 100 = fermé (100 % fermé), ou null si RTS/inconnu */
  closurePct: number | null;
  /** 100 = ouvert à 100 %, 0 = fermé à 0 %, ou null si RTS/inconnu */
  openPct: number | null;
  tiltPct: number | null;
  moving: boolean;
  isLowSpeed: boolean;
  rssiPct: number | null;
  rssiLevel: string | null;
  batteryPct: number | null;
  unidirectional: boolean;
}

export const SOMFY_COVER_UI_CLASSES = new Set<string>([
  'Shutter',
  'RollerShutter',
  'ExteriorScreen',
  'Awning',
  'HorizontalAwning',
  'VerticalExteriorAwning',
  'Pergola',
  'Curtain',
  'Blind',
  'ExteriorBlind',
  'VenetianBlind',
  'ExteriorVenetianBlind',
  'ExteriorVenetianShutter',
  'VerticalInteriorBlind',
  'VeluxInteriorBlind',
  'GarageDoor',
  'Gate',
  'Window',
  'RoofWindow',
  'SwingingShutter',
  'Screen',
]);

const SOMFY_COVER_UI_CLASSES_LOWER = new Set<string>(
  [...SOMFY_COVER_UI_CLASSES].map((item) => item.toLowerCase())
);

const SOMFY_COVER_KEYWORD_RE =
  /(shutter|blind|awning|pergola|curtain|screen|garagedoor|gate|window)/i;

export const TUYA_COVER_CATEGORIES = new Set<string>(['cl', 'clkg', 'mc', 'ckmkzq']);

const DEPLOYMENT_UI_CLASSES_LOWER = new Set<string>([
  'awning',
  'horizontalawning',
  'verticalexteriorawning',
  'pergola',
]);

const UI_CLASS_KIND: Record<string, CoverKind> = {
  shutter: 'shutter',
  rollershutter: 'shutter',
  swingingshutter: 'shutter',
  exteriorvenetianshutter: 'shutter',
  exteriorscreen: 'blind',
  screen: 'blind',
  blind: 'blind',
  exteriorblind: 'blind',
  venetianblind: 'blind',
  exteriorvenetianblind: 'blind',
  verticalinteriorblind: 'blind',
  veluxinteriorblind: 'blind',
  awning: 'awning',
  horizontalawning: 'awning',
  verticalexteriorawning: 'awning',
  pergola: 'awning',
  curtain: 'curtain',
  garagedoor: 'garage',
  gate: 'gate',
  window: 'window',
  roofwindow: 'window',
};

const UI_CLASS_LABELS_BY_LOCALE: Record<AppLocale, Record<string, string>> = {
  fr: {
    shutter: 'Volet',
    rollershutter: 'Volet roulant',
    swingingshutter: 'Volet battant',
    exteriorvenetianshutter: 'Volet vénitien',
    exteriorscreen: 'Screen extérieur',
    screen: 'Store écran',
    blind: 'Store',
    exteriorblind: 'Store extérieur',
    venetianblind: 'Store vénitien',
    exteriorvenetianblind: 'BSO (brise-soleil)',
    verticalinteriorblind: 'Store intérieur vertical',
    veluxinteriorblind: 'Store Velux',
    awning: 'Store banne',
    horizontalawning: 'Store banne',
    verticalexteriorawning: 'Store vertical extérieur',
    pergola: 'Pergola',
    curtain: 'Rideau motorisé',
    garagedoor: 'Porte de garage',
    gate: 'Portail',
    window: 'Fenêtre motorisée',
    roofwindow: 'Fenêtre de toit',
  },
  en: {
    shutter: 'Shutter',
    rollershutter: 'Roller shutter',
    swingingshutter: 'Hinged shutter',
    exteriorvenetianshutter: 'Venetian shutter',
    exteriorscreen: 'Exterior screen',
    screen: 'Screen blind',
    blind: 'Blind',
    exteriorblind: 'Exterior blind',
    venetianblind: 'Venetian blind',
    exteriorvenetianblind: 'Exterior venetian blind',
    verticalinteriorblind: 'Vertical interior blind',
    veluxinteriorblind: 'Velux blind',
    awning: 'Awning',
    horizontalawning: 'Horizontal awning',
    verticalexteriorawning: 'Vertical exterior awning',
    pergola: 'Pergola',
    curtain: 'Motorized curtain',
    garagedoor: 'Garage door',
    gate: 'Gate',
    window: 'Motorized window',
    roofwindow: 'Roof window',
  },
  es: {
    shutter: 'Persiana',
    rollershutter: 'Persiana enrollable',
    swingingshutter: 'Contraventana batiente',
    exteriorvenetianshutter: 'Persiana veneciana',
    exteriorscreen: 'Screen exterior',
    screen: 'Estor screen',
    blind: 'Estor',
    exteriorblind: 'Estor exterior',
    venetianblind: 'Estor veneciano',
    exteriorvenetianblind: 'Celosía exterior',
    verticalinteriorblind: 'Estor vertical interior',
    veluxinteriorblind: 'Estor Velux',
    awning: 'Toldo',
    horizontalawning: 'Toldo horizontal',
    verticalexteriorawning: 'Toldo vertical exterior',
    pergola: 'Pérgola',
    curtain: 'Cortina motorizada',
    garagedoor: 'Puerta de garaje',
    gate: 'Portal',
    window: 'Ventana motorizada',
    roofwindow: 'Ventana de techo',
  },
  de: {
    shutter: 'Rollladen',
    rollershutter: 'Rollladen',
    swingingshutter: 'Klappladen',
    exteriorvenetianshutter: 'Außenjalousie',
    exteriorscreen: 'Außen-Screen',
    screen: 'Screen-Rollo',
    blind: 'Rollo / Jalousie',
    exteriorblind: 'Außenraffstore',
    venetianblind: 'Jalousie',
    exteriorvenetianblind: 'Raffstore',
    verticalinteriorblind: 'Vertikal-Innenrollo',
    veluxinteriorblind: 'Velux-Rollo',
    awning: 'Markise',
    horizontalawning: 'Markise',
    verticalexteriorawning: 'Senkrechtmarkise',
    pergola: 'Pergola',
    curtain: 'Motorisierter Vorhang',
    garagedoor: 'Garagentor',
    gate: 'Tor',
    window: 'Motorisiertes Fenster',
    roofwindow: 'Dachfenster',
  },
  it: {
    shutter: 'Tapparella',
    rollershutter: 'Tapparella avvolgibile',
    swingingshutter: 'Persiana a battente',
    exteriorvenetianshutter: 'Persiana veneziana',
    exteriorscreen: 'Screen esterno',
    screen: 'Tenda screen',
    blind: 'Tenda',
    exteriorblind: 'Tenda esterna',
    venetianblind: 'Veneziana',
    exteriorvenetianblind: 'Frangisole esterno',
    verticalinteriorblind: 'Tenda verticale interna',
    veluxinteriorblind: 'Tenda Velux',
    awning: 'Tenda da sole',
    horizontalawning: 'Tenda da sole',
    verticalexteriorawning: 'Tenda verticale esterna',
    pergola: 'Pergola',
    curtain: 'Tenda motorizzata',
    garagedoor: 'Porta garage',
    gate: 'Cancello',
    window: 'Finestra motorizzata',
    roofwindow: 'Finestra da tetto',
  },
};

const COVER_COPY: Record<
  AppLocale,
  {
    fallbackCover: string;
    tuyaShutter: string;
    tuyaAwning: string;
    tuyaCurtain: string;
    tuyaMotor: string;
    moving: string;
    opening: string;
    closing: string;
    deployed: string;
    retracted: string;
    open: string;
    closed: string;
    openPct: (pct: number) => string;
    rtsUnidirectional: string;
    unknownState: string;
    rssi: Record<string, string>;
  }
> = {
  fr: {
    fallbackCover: 'Volet / Store',
    tuyaShutter: 'Volet / Moteur tubulaire',
    tuyaAwning: 'Store / Moteur tubulaire',
    tuyaCurtain: 'Rideau / Moteur tubulaire',
    tuyaMotor: 'Moteur tubulaire (Tubular Motor)',
    moving: 'En mouvement',
    opening: 'Ouverture en cours',
    closing: 'Fermeture en cours',
    deployed: 'Déployé',
    retracted: 'Replié',
    open: 'Ouvert',
    closed: 'Fermé',
    openPct: (pct) => `Ouvert à ${pct} %`,
    rtsUnidirectional: 'RTS unidirectionnel',
    unknownState: 'État inconnu',
    rssi: { good: 'Bon', normal: 'Moyen', low: 'Faible', verylow: 'Très faible' },
  },
  en: {
    fallbackCover: 'Cover / Blind',
    tuyaShutter: 'Shutter / Tubular motor',
    tuyaAwning: 'Awning / Tubular motor',
    tuyaCurtain: 'Curtain / Tubular motor',
    tuyaMotor: 'Tubular motor',
    moving: 'Moving',
    opening: 'Opening',
    closing: 'Closing',
    deployed: 'Extended',
    retracted: 'Retracted',
    open: 'Open',
    closed: 'Closed',
    openPct: (pct) => `${pct}% open`,
    rtsUnidirectional: 'RTS one-way',
    unknownState: 'Unknown state',
    rssi: { good: 'Good', normal: 'Fair', low: 'Low', verylow: 'Very low' },
  },
  es: {
    fallbackCover: 'Persiana / Estor',
    tuyaShutter: 'Persiana / Motor tubular',
    tuyaAwning: 'Toldo / Motor tubular',
    tuyaCurtain: 'Cortina / Motor tubular',
    tuyaMotor: 'Motor tubular',
    moving: 'En movimiento',
    opening: 'Abriendo',
    closing: 'Cerrando',
    deployed: 'Desplegado',
    retracted: 'Recogido',
    open: 'Abierto',
    closed: 'Cerrado',
    openPct: (pct) => `Abierto al ${pct}%`,
    rtsUnidirectional: 'RTS unidireccional',
    unknownState: 'Estado desconocido',
    rssi: { good: 'Bueno', normal: 'Medio', low: 'Bajo', verylow: 'Muy bajo' },
  },
  de: {
    fallbackCover: 'Rollladen / Markise',
    tuyaShutter: 'Rollladen / Rohrmotor',
    tuyaAwning: 'Markise / Rohrmotor',
    tuyaCurtain: 'Vorhang / Rohrmotor',
    tuyaMotor: 'Rohrmotor',
    moving: 'In Bewegung',
    opening: 'Öffnet',
    closing: 'Schließt',
    deployed: 'Ausgefahren',
    retracted: 'Eingefahren',
    open: 'Offen',
    closed: 'Geschlossen',
    openPct: (pct) => `${pct} % offen`,
    rtsUnidirectional: 'RTS unidirektional',
    unknownState: 'Unbekannter Status',
    rssi: { good: 'Gut', normal: 'Mittel', low: 'Schwach', verylow: 'Sehr schwach' },
  },
  it: {
    fallbackCover: 'Tapparella / Tenda',
    tuyaShutter: 'Tapparella / Motore tubolare',
    tuyaAwning: 'Tenda / Motore tubolare',
    tuyaCurtain: 'Tenda / Motore tubolare',
    tuyaMotor: 'Motore tubolare',
    moving: 'In movimento',
    opening: 'In apertura',
    closing: 'In chiusura',
    deployed: 'Esteso',
    retracted: 'Chiuso',
    open: 'Aperto',
    closed: 'Chiuso',
    openPct: (pct) => `Aperto al ${pct}%`,
    rtsUnidirectional: 'RTS unidirezionale',
    unknownState: 'Stato sconosciuto',
    rssi: { good: 'Buono', normal: 'Medio', low: 'Debole', verylow: 'Molto debole' },
  },
};

function inferSomfyCoverKind(
  uiClass: string | null | undefined,
  controllableName: string | null | undefined,
  locale: AppLocale
): { kind: CoverKind; label: string } {
  const labels = UI_CLASS_LABELS_BY_LOCALE[locale];
  const key = (uiClass ?? '').trim().toLowerCase();
  if (key && UI_CLASS_KIND[key]) {
    return { kind: UI_CLASS_KIND[key], label: labels[key] ?? uiClass?.trim() ?? labels.shutter };
  }
  const combined = `${uiClass ?? ''} ${controllableName ?? ''}`.toLowerCase();
  if (combined.includes('garage')) return { kind: 'garage', label: labels.garagedoor };
  if (combined.includes('gate')) return { kind: 'gate', label: labels.gate };
  if (combined.includes('awning') || combined.includes('pergola')) {
    return { kind: 'awning', label: uiClass?.trim() || labels.awning };
  }
  if (combined.includes('curtain')) return { kind: 'curtain', label: labels.curtain };
  if (combined.includes('window')) return { kind: 'window', label: labels.window };
  if (combined.includes('blind') || combined.includes('screen')) {
    return { kind: 'blind', label: uiClass?.trim() || labels.blind };
  }
  if (combined.includes('shutter')) return { kind: 'shutter', label: uiClass?.trim() || labels.shutter };
  return { kind: 'shutter', label: uiClass?.trim() || COVER_COPY[locale].fallbackCover };
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getRawMap(rawStatus: RawDpStatus[] | null | undefined): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (!Array.isArray(rawStatus)) return map;
  for (const item of rawStatus) {
    if (item && typeof item.code === 'string') {
      map.set(item.code, item.value);
    }
  }
  return map;
}

function inferTuyaCoverKind(
  name: string | null | undefined,
  locale: AppLocale
): { kind: CoverKind; label: string } {
  const lower = (name ?? '').toLowerCase();
  const labels = UI_CLASS_LABELS_BY_LOCALE[locale];
  const copy = COVER_COPY[locale];
  if (lower.includes('volet') || lower.includes('shutter') || lower.includes('persiana')) {
    return { kind: 'shutter', label: copy.tuyaShutter };
  }
  if (lower.includes('store') || lower.includes('banne') || lower.includes('awning')) {
    return { kind: 'awning', label: copy.tuyaAwning };
  }
  if (lower.includes('garage')) return { kind: 'garage', label: labels.garagedoor };
  if (lower.includes('portail') || lower.includes('gate')) return { kind: 'gate', label: labels.gate };
  if (lower.includes('rideau') || lower.includes('curtain')) {
    return { kind: 'curtain', label: copy.tuyaCurtain };
  }
  return { kind: 'shutter', label: copy.tuyaMotor };
}

function extractSomfyBatteryPct(rawMap: Map<string, unknown>): number | null {
  const numeric = toFiniteNumber(rawMap.get('core:BatteryLevelState'));
  if (numeric !== null) return clampPct(numeric);
  const discrete = rawMap.get('core:BatteryState');
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

export function isSomfyCoverUiClass(
  uiClass: string | null | undefined,
  controllableName?: string | null
): boolean {
  const lowerUi = (uiClass ?? '').trim().toLowerCase();
  if (lowerUi && SOMFY_COVER_UI_CLASSES_LOWER.has(lowerUi)) {
    return true;
  }
  const combined = `${lowerUi} ${(controllableName ?? '').toLowerCase()}`;
  if (
    !combined.trim() ||
    combined.includes('sensor') ||
    combined.includes('pod') ||
    combined.includes('gateway')
  ) {
    return false;
  }
  return SOMFY_COVER_KEYWORD_RE.test(combined);
}

export function isCoverDevice(
  device: Pick<
    DeviceRecord,
    'name' | 'primaryVendor' | 'tuyaCategory' | 'category' | 'lastRawStatus'
  >
): boolean {
  const rawMap = getRawMap(device.lastRawStatus);
  const uiClass =
    (typeof rawMap.get('somfy:uiClass') === 'string'
      ? (rawMap.get('somfy:uiClass') as string)
      : null) ?? device.tuyaCategory;
  const controllableName =
    typeof rawMap.get('somfy:controllableName') === 'string'
      ? (rawMap.get('somfy:controllableName') as string)
      : null;

  if (device.primaryVendor === 'somfy' || rawMap.has('somfy:uiClass')) {
    if (isSomfyCoverUiClass(uiClass, controllableName)) return true;
    const isSensorLike = /sensor|alarm|siren|heating|light|plug/i.test(uiClass ?? '');
    if (
      !isSensorLike &&
      (rawMap.has('core:ClosureState') ||
        rawMap.has('core:DeploymentState') ||
        rawMap.has('core:SlateOrientationState') ||
        rawMap.has('core:OpenClosedState') ||
        rawMap.has('core:OpenClosedUnknownState') ||
        rawMap.has('core:OpenClosedPartialState'))
    ) {
      return true;
    }
    return false;
  }

  const tuyaCat = (device.tuyaCategory ?? '').toLowerCase().trim();
  if (tuyaCat && TUYA_COVER_CATEGORIES.has(tuyaCat)) {
    return true;
  }

  if (
    device.category === 'other' &&
    (rawMap.has('percent_state') || rawMap.has('percent_control') || rawMap.has('situation_set'))
  ) {
    return true;
  }

  return false;
}

export function extractCoverSummary(
  device: Pick<
    DeviceRecord,
    'name' | 'primaryVendor' | 'tuyaCategory' | 'category' | 'lastRawStatus' | 'lastBatteryPct'
  >,
  rawLocale: AppLocale = 'fr'
): CoverSummary | null {
  if (!isCoverDevice(device)) return null;
  const locale = normalizeLocale(rawLocale);
  const copy = COVER_COPY[locale];

  const rawMap = getRawMap(device.lastRawStatus);
  const isSomfy = device.primaryVendor === 'somfy' || rawMap.has('somfy:uiClass');

  if (isSomfy) {
    const uiClass =
      (typeof rawMap.get('somfy:uiClass') === 'string'
        ? (rawMap.get('somfy:uiClass') as string)
        : null) ??
      device.tuyaCategory ??
      'RollerShutter';
    const controllableName =
      typeof rawMap.get('somfy:controllableName') === 'string'
        ? (rawMap.get('somfy:controllableName') as string)
        : null;
    const rawProto = rawMap.get('somfy:protocol');
    const protocol: SomfyProtocol =
      rawProto === 'io' || rawProto === 'RTS' || rawProto === 'Zigbee' || rawProto === 'Overkiz'
        ? rawProto
        : 'Overkiz';

    const kindMeta = inferSomfyCoverKind(uiClass, controllableName, locale);
    const isDeploymentDevice = DEPLOYMENT_UI_CLASSES_LOWER.has(uiClass.trim().toLowerCase());

    const deploymentRaw = toFiniteNumber(rawMap.get('core:DeploymentState'));
    const closureRaw = toFiniteNumber(rawMap.get('core:ClosureState'));
    const targetClosureRaw = toFiniteNumber(rawMap.get('core:TargetClosureState'));
    const tiltRaw = toFiniteNumber(
      rawMap.get('core:SlateOrientationState') ?? rawMap.get('core:SlateRotationState')
    );

    let closurePct: number | null = null;
    let openPct: number | null = null;

    if (isDeploymentDevice && deploymentRaw !== null) {
      openPct = clampPct(deploymentRaw);
      closurePct = clampPct(100 - deploymentRaw);
    } else if (closureRaw !== null) {
      closurePct = clampPct(closureRaw);
      openPct = clampPct(100 - closureRaw);
    } else if (targetClosureRaw !== null && protocol !== 'RTS') {
      closurePct = clampPct(targetClosureRaw);
      openPct = clampPct(100 - targetClosureRaw);
    }

    const openClosedRaw = String(
      rawMap.get('core:OpenClosedState') ??
        rawMap.get('core:OpenClosedPartialState') ??
        rawMap.get('core:OpenClosedUnknownState') ??
        ''
    )
      .toLowerCase()
      .trim();

    let state: CoverPositionState = 'unknown';
    if (openPct !== null) {
      if (openPct >= 97) state = 'open';
      else if (openPct <= 3) state = 'closed';
      else state = 'partial';
    } else if (openClosedRaw === 'open' || openClosedRaw === 'opened') {
      state = 'open';
    } else if (openClosedRaw === 'closed') {
      state = 'closed';
    } else if (openClosedRaw === 'partial') {
      state = 'partial';
    }

    const moving = Boolean(rawMap.get('core:MovingState') === true);
    const isLowSpeed =
      rawMap.get('io:LowSpeedState') === true ||
      String(rawMap.get('core:SpeedState') ?? '').toLowerCase() === 'lowspeed';

    const rssiPct = toFiniteNumber(rawMap.get('core:RSSILevelState'));
    const discreteRssi = rawMap.get('core:DiscreteRSSILevelState');
    const rssiLevel =
      typeof discreteRssi === 'string'
        ? copy.rssi[discreteRssi.toLowerCase()] ?? discreteRssi
        : null;

    const batteryPct = device.lastBatteryPct ?? extractSomfyBatteryPct(rawMap);
    const unidirectional = protocol === 'RTS' && openPct === null && state === 'unknown';

    let stateLabel: string;
    if (moving) {
      stateLabel = copy.moving;
    } else if (state === 'open') {
      stateLabel = isDeploymentDevice ? copy.deployed : copy.open;
    } else if (state === 'closed') {
      stateLabel = isDeploymentDevice ? copy.retracted : copy.closed;
    } else if (state === 'partial' && openPct !== null) {
      stateLabel = copy.openPct(openPct);
    } else if (unidirectional) {
      stateLabel = copy.rtsUnidirectional;
    } else {
      stateLabel = copy.unknownState;
    }

    return {
      isCover: true,
      source: 'somfy',
      protocol,
      kind: kindMeta.kind,
      kindLabel: kindMeta.label,
      state,
      stateLabel,
      closurePct,
      openPct,
      tiltPct: tiltRaw !== null ? clampPct(tiltRaw) : null,
      moving,
      isLowSpeed,
      rssiPct: rssiPct !== null ? clampPct(rssiPct) : null,
      rssiLevel,
      batteryPct,
      unidirectional,
    };
  }

  const kindMeta = inferTuyaCoverKind(device.name, locale);
  const percentState = toFiniteNumber(rawMap.get('percent_state'));
  const percentControl = toFiniteNumber(rawMap.get('percent_control'));
  const rawPct = percentState ?? percentControl;

  const situationSet = String(rawMap.get('situation_set') ?? '').toLowerCase().trim();
  const workState = String(rawMap.get('work_state') ?? '').toLowerCase().trim();
  const control = String(rawMap.get('control') ?? '').toLowerCase().trim();

  let closurePct: number | null = null;
  let openPct: number | null = null;

  if (rawPct !== null) {
    const pct = clampPct(rawPct);
    const reversedScale = situationSet === 'fully_open' && pct >= 95;
    if (reversedScale) {
      openPct = pct;
      closurePct = clampPct(100 - pct);
    } else {
      closurePct = pct;
      openPct = clampPct(100 - pct);
    }
  } else if (situationSet === 'fully_open' || control === 'open') {
    openPct = 100;
    closurePct = 0;
  } else if (situationSet === 'fully_close' || control === 'close') {
    openPct = 0;
    closurePct = 100;
  }

  let state: CoverPositionState = 'unknown';
  if (openPct !== null) {
    if (openPct >= 97) state = 'open';
    else if (openPct <= 3) state = 'closed';
    else state = 'partial';
  }

  const moving = workState === 'opening' || workState === 'closing';
  let stateLabel: string;
  if (workState === 'opening') {
    stateLabel = copy.opening;
  } else if (workState === 'closing') {
    stateLabel = copy.closing;
  } else if (state === 'open') {
    stateLabel = copy.open;
  } else if (state === 'closed') {
    stateLabel = copy.closed;
  } else if (state === 'partial' && openPct !== null) {
    stateLabel = copy.openPct(openPct);
  } else {
    stateLabel = copy.unknownState;
  }

  return {
    isCover: true,
    source: 'tuya',
    protocol: 'Tuya',
    kind: kindMeta.kind,
    kindLabel: kindMeta.label,
    state,
    stateLabel,
    closurePct,
    openPct,
    tiltPct: null,
    moving,
    isLowSpeed: false,
    rssiPct: null,
    rssiLevel: null,
    batteryPct: device.lastBatteryPct,
    unidirectional: false,
  };
}

export function formatCoverCompactSummary(summary: CoverSummary): string {
  const protoTag = summary.protocol === 'Tuya' ? 'Tuya' : `Somfy ${summary.protocol}`;
  return `${protoTag} • ${summary.stateLabel}`;
}
