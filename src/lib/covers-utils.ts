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

const UI_CLASS_KIND_META: Record<string, { kind: CoverKind; label: string }> = {
  shutter: { kind: 'shutter', label: 'Volet' },
  rollershutter: { kind: 'shutter', label: 'Volet roulant' },
  swingingshutter: { kind: 'shutter', label: 'Volet battant' },
  exteriorvenetianshutter: { kind: 'shutter', label: 'Volet vénitien' },
  exteriorscreen: { kind: 'blind', label: 'Screen extérieur' },
  screen: { kind: 'blind', label: 'Store écran' },
  blind: { kind: 'blind', label: 'Store' },
  exteriorblind: { kind: 'blind', label: 'Store extérieur' },
  venetianblind: { kind: 'blind', label: 'Store vénitien' },
  exteriorvenetianblind: { kind: 'blind', label: 'BSO (brise-soleil)' },
  verticalinteriorblind: { kind: 'blind', label: 'Store intérieur vertical' },
  veluxinteriorblind: { kind: 'blind', label: 'Store Velux' },
  awning: { kind: 'awning', label: 'Store banne' },
  horizontalawning: { kind: 'awning', label: 'Store banne' },
  verticalexteriorawning: { kind: 'awning', label: 'Store vertical extérieur' },
  pergola: { kind: 'awning', label: 'Pergola' },
  curtain: { kind: 'curtain', label: 'Rideau motorisé' },
  garagedoor: { kind: 'garage', label: 'Porte de garage' },
  gate: { kind: 'gate', label: 'Portail' },
  window: { kind: 'window', label: 'Fenêtre motorisée' },
  roofwindow: { kind: 'window', label: 'Fenêtre de toit' },
};

function inferSomfyCoverKind(
  uiClass: string | null | undefined,
  controllableName?: string | null
): { kind: CoverKind; label: string } {
  const key = (uiClass ?? '').trim().toLowerCase();
  if (key && UI_CLASS_KIND_META[key]) {
    return UI_CLASS_KIND_META[key];
  }
  const combined = `${uiClass ?? ''} ${controllableName ?? ''}`.toLowerCase();
  if (combined.includes('garage')) return { kind: 'garage', label: 'Porte de garage' };
  if (combined.includes('gate')) return { kind: 'gate', label: 'Portail' };
  if (combined.includes('awning') || combined.includes('pergola')) {
    return { kind: 'awning', label: uiClass?.trim() || 'Store banne' };
  }
  if (combined.includes('curtain')) return { kind: 'curtain', label: 'Rideau motorisé' };
  if (combined.includes('window')) return { kind: 'window', label: 'Fenêtre motorisée' };
  if (combined.includes('blind') || combined.includes('screen')) {
    return { kind: 'blind', label: uiClass?.trim() || 'Store' };
  }
  if (combined.includes('shutter')) return { kind: 'shutter', label: uiClass?.trim() || 'Volet' };
  return { kind: 'shutter', label: uiClass?.trim() || 'Volet / Store' };
}

const DISCRETE_RSSI_LABELS_FR: Record<string, string> = {
  good: 'Bon',
  normal: 'Moyen',
  low: 'Faible',
  verylow: 'Très faible',
};

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

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function inferTuyaCoverKind(name: string | null | undefined): { kind: CoverKind; label: string } {
  const lower = (name ?? '').toLowerCase();
  if (lower.includes('volet')) return { kind: 'shutter', label: 'Volet / Moteur tubulaire' };
  if (lower.includes('store') || lower.includes('banne')) {
    return { kind: 'awning', label: 'Store / Moteur tubulaire' };
  }
  if (lower.includes('garage')) return { kind: 'garage', label: 'Porte de garage' };
  if (lower.includes('portail')) return { kind: 'gate', label: 'Portail' };
  if (lower.includes('rideau')) return { kind: 'curtain', label: 'Rideau / Moteur tubulaire' };
  return { kind: 'shutter', label: 'Moteur tubulaire (Tubular Motor)' };
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

  // Cas de secours pour appareils Tuya sans tuyaCategory normalisée mais dotés des DPs volets/rideaux
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
  >
): CoverSummary | null {
  if (!isCoverDevice(device)) return null;

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

    const kindMeta = inferSomfyCoverKind(uiClass, controllableName);
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
        ? DISCRETE_RSSI_LABELS_FR[discreteRssi.toLowerCase()] ?? discreteRssi
        : null;

    const batteryPct = device.lastBatteryPct ?? extractSomfyBatteryPct(rawMap);
    const unidirectional = protocol === 'RTS' && openPct === null && state === 'unknown';

    let stateLabel: string;
    if (moving) {
      stateLabel = 'En mouvement';
    } else if (state === 'open') {
      stateLabel = isDeploymentDevice ? 'Déployé' : 'Ouvert';
    } else if (state === 'closed') {
      stateLabel = isDeploymentDevice ? 'Replié' : 'Fermé';
    } else if (state === 'partial' && openPct !== null) {
      stateLabel = `Ouvert à ${openPct} %`;
    } else if (unidirectional) {
      stateLabel = 'RTS unidirectionnel';
    } else {
      stateLabel = 'État inconnu';
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

  // Appareil Tuya (Tubular Motors : cl, clkg, mc, ckmkzq)
  const kindMeta = inferTuyaCoverKind(device.name);
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
    // Tuya Tubular Motor standard : 0 = ouvert (0% fermé), 100 = fermé (100% fermé).
    // Si situation_set === 'fully_open' avec valeur >= 95, ce firmware inverse le pourcentage en ouverture.
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
    stateLabel = 'Ouverture en cours';
  } else if (workState === 'closing') {
    stateLabel = 'Fermeture en cours';
  } else if (state === 'open') {
    stateLabel = 'Ouvert';
  } else if (state === 'closed') {
    stateLabel = 'Fermé';
  } else if (state === 'partial' && openPct !== null) {
    stateLabel = `Ouvert à ${openPct} %`;
  } else {
    stateLabel = 'État inconnu';
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
  if (summary.openPct !== null) {
    return `${protoTag} • ${summary.stateLabel}`;
  }
  return `${protoTag} • ${summary.stateLabel}`;
}
