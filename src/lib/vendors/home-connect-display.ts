import type { RawDpStatus } from '@/types';

export interface HomeConnectDisplaySummary {
  applianceType: string | null;
  operationState: string | null;
  operationLabel: string | null;
  operationTone: 'cyan' | 'emerald' | 'amber' | 'rose' | 'slate';
  activeProgram: string | null;
  progressPct: number | null;
  remainingLabel: string | null;
  doorOpen: boolean;
  tempsLabel: string | null;
  compactText: string;
  searchableText: string;
}

const HC_KEYS = new Set([
  'appliance_type',
  'operation_state',
  'power_state',
  'active_program',
  'cavity_temp_c',
  'fridge_temp_c',
  'freezer_temp_c',
  'door_state',
  'door_fridge',
  'door_freezer',
]);

function formatRemainingDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0 min';
  const totalMin = Math.max(1, Math.round(sec / 60));
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }
  return `${totalMin} min`;
}

function getStringTrait(map: Map<string, unknown>, key: string): string | null {
  const val = map.get(key);
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

function getNumberTrait(map: Map<string, unknown>, key: string): number | null {
  const val = map.get(key);
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

/**
 * Extrait un résumé lisible d'appareil Siemens / Home Connect depuis `lastRawStatus`.
 */
export function extractHomeConnectSummary(
  lastRawStatus: RawDpStatus[] | null | undefined
): HomeConnectDisplaySummary | null {
  if (!Array.isArray(lastRawStatus) || lastRawStatus.length === 0) return null;

  const hasHcKey = lastRawStatus.some((item) => item && HC_KEYS.has(item.code));
  if (!hasHcKey) return null;

  const map = new Map<string, unknown>(lastRawStatus.map((item) => [item.code, item.value]));

  const applianceType = getStringTrait(map, 'appliance_type');
  const brand = getStringTrait(map, 'brand');
  const operationState = getStringTrait(map, 'operation_state');
  const powerState = getStringTrait(map, 'power_state');
  const activeProgram = getStringTrait(map, 'active_program');
  const progressRaw = getNumberTrait(map, 'program_progress');
  const progressPct = progressRaw !== null ? Math.round(progressRaw) : null;
  const remainingSec = getNumberTrait(map, 'remaining_seconds');
  const remainingLabel = remainingSec !== null ? formatRemainingDuration(remainingSec) : null;

  const doorOpen = ['door_state', 'door_fridge', 'door_freezer'].some(
    (k) => getStringTrait(map, k) === 'Open'
  );

  let operationLabel: string | null = null;
  let operationTone: HomeConnectDisplaySummary['operationTone'] = 'slate';

  switch (operationState) {
    case 'Run':
      operationLabel = 'En cours';
      operationTone = 'cyan';
      break;
    case 'DelayedStart':
      operationLabel = 'Départ différé';
      operationTone = 'cyan';
      break;
    case 'Pause':
      operationLabel = 'En pause';
      operationTone = 'amber';
      break;
    case 'Finished':
      operationLabel = 'Terminé';
      operationTone = 'emerald';
      break;
    case 'Ready':
      operationLabel = 'Prêt';
      operationTone = 'slate';
      break;
    case 'ActionRequired':
      operationLabel = 'Action requise';
      operationTone = 'amber';
      break;
    case 'Aborting':
      operationLabel = 'Arrêt…';
      operationTone = 'amber';
      break;
    case 'Error':
      operationLabel = 'Erreur';
      operationTone = 'rose';
      break;
    case 'Inactive':
      operationLabel = powerState === 'Off' ? 'Éteint' : 'Veille';
      operationTone = 'slate';
      break;
    default:
      if (powerState === 'Off') {
        operationLabel = 'Éteint';
      } else if (powerState === 'Standby') {
        operationLabel = 'Veille';
      } else if (powerState === 'On') {
        operationLabel = 'Allumé';
        operationTone = 'cyan';
      }
      break;
  }

  const cavityTemp = getNumberTrait(map, 'cavity_temp_c');
  const fridgeTemp = getNumberTrait(map, 'fridge_temp_c');
  const freezerTemp = getNumberTrait(map, 'freezer_temp_c');

  const tempParts: string[] = [];
  if (cavityTemp !== null) tempParts.push(`Four ${cavityTemp} °C`);
  if (fridgeTemp !== null) tempParts.push(`Frigo ${fridgeTemp} °C`);
  if (freezerTemp !== null) tempParts.push(`Congél. ${freezerTemp} °C`);
  const tempsLabel = tempParts.length > 0 ? tempParts.join(' · ') : null;

  const statusParts: string[] = [];
  if (operationLabel && !(tempsLabel && operationState === 'Inactive' && powerState === 'On')) {
    statusParts.push(operationLabel);
  }
  if (progressPct !== null) statusParts.push(`${progressPct} %`);
  if (remainingLabel) statusParts.push(remainingLabel);

  const compactParts: string[] = [];
  if (statusParts.length > 0) compactParts.push(statusParts.join(' · '));
  if (tempsLabel) compactParts.push(tempsLabel);
  if (compactParts.length === 0 && activeProgram) compactParts.push(activeProgram);

  const compactText = compactParts.join(' · ');

  const searchableText = [
    applianceType,
    brand,
    operationState,
    operationLabel,
    activeProgram,
    tempsLabel,
    doorOpen ? 'porte ouverte' : null,
    'siemens home connect',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    applianceType,
    operationState,
    operationLabel,
    operationTone,
    activeProgram,
    progressPct,
    remainingLabel,
    doorOpen,
    tempsLabel,
    compactText,
    searchableText,
  };
}
