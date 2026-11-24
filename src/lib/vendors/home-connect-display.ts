import { normalizeLocale, type AppLocale } from '@/lib/i18n/types';
import { toFiniteNumber } from '@/lib/utils';
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

const HC_COPY: Record<
  AppLocale,
  {
    run: string;
    delayedStart: string;
    pause: string;
    finished: string;
    ready: string;
    actionRequired: string;
    aborting: string;
    error: string;
    off: string;
    standby: string;
    on: string;
    oven: string;
    fridge: string;
    freezer: string;
    doorOpen: string;
  }
> = {
  fr: {
    run: 'En cours',
    delayedStart: 'Départ différé',
    pause: 'En pause',
    finished: 'Terminé',
    ready: 'Prêt',
    actionRequired: 'Action requise',
    aborting: 'Arrêt…',
    error: 'Erreur',
    off: 'Éteint',
    standby: 'Veille',
    on: 'Allumé',
    oven: 'Four',
    fridge: 'Frigo',
    freezer: 'Congél.',
    doorOpen: 'porte ouverte',
  },
  en: {
    run: 'Running',
    delayedStart: 'Delayed start',
    pause: 'Paused',
    finished: 'Finished',
    ready: 'Ready',
    actionRequired: 'Action required',
    aborting: 'Stopping…',
    error: 'Error',
    off: 'Off',
    standby: 'Standby',
    on: 'On',
    oven: 'Oven',
    fridge: 'Fridge',
    freezer: 'Freezer',
    doorOpen: 'door open',
  },
  es: {
    run: 'En curso',
    delayedStart: 'Inicio diferido',
    pause: 'En pausa',
    finished: 'Finalizado',
    ready: 'Listo',
    actionRequired: 'Acción requerida',
    aborting: 'Deteniendo…',
    error: 'Error',
    off: 'Apagado',
    standby: 'Espera',
    on: 'Encendido',
    oven: 'Horno',
    fridge: 'Frigo',
    freezer: 'Congel.',
    doorOpen: 'puerta abierta',
  },
  de: {
    run: 'Läuft',
    delayedStart: 'Startvorwahl',
    pause: 'Pausiert',
    finished: 'Fertig',
    ready: 'Bereit',
    actionRequired: 'Aktion erforderlich',
    aborting: 'Wird gestoppt…',
    error: 'Fehler',
    off: 'Aus',
    standby: 'Standby',
    on: 'Ein',
    oven: 'Backofen',
    fridge: 'Kühlschr.',
    freezer: 'Gefrier.',
    doorOpen: 'Tür offen',
  },
  it: {
    run: 'In corso',
    delayedStart: 'Avvio ritardato',
    pause: 'In pausa',
    finished: 'Terminato',
    ready: 'Pronto',
    actionRequired: 'Azione richiesta',
    aborting: 'Arresto…',
    error: 'Errore',
    off: 'Spento',
    standby: 'Standby',
    on: 'Acceso',
    oven: 'Forno',
    fridge: 'Frigo',
    freezer: 'Congel.',
    doorOpen: 'porta aperta',
  },
};

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

/**
 * Extrait un résumé lisible d'appareil Siemens / Home Connect depuis `lastRawStatus`.
 */
export function extractHomeConnectSummary(
  lastRawStatus: RawDpStatus[] | null | undefined,
  rawLocale: AppLocale = 'fr'
): HomeConnectDisplaySummary | null {
  if (!Array.isArray(lastRawStatus) || lastRawStatus.length === 0) return null;

  const hasHcKey = lastRawStatus.some((item) => item && HC_KEYS.has(item.code));
  if (!hasHcKey) return null;

  const locale = normalizeLocale(rawLocale);
  const copy = HC_COPY[locale];

  const map = new Map<string, unknown>(lastRawStatus.map((item) => [item.code, item.value]));

  const applianceType = getStringTrait(map, 'appliance_type');
  const brand = getStringTrait(map, 'brand');
  const operationState = getStringTrait(map, 'operation_state');
  const powerState = getStringTrait(map, 'power_state');
  const activeProgram = getStringTrait(map, 'active_program');
  const progressRaw = toFiniteNumber(map.get('program_progress'));
  const progressPct = progressRaw !== null ? Math.round(progressRaw) : null;
  const remainingSec = toFiniteNumber(map.get('remaining_seconds'));
  const remainingLabel = remainingSec !== null ? formatRemainingDuration(remainingSec) : null;

  const doorOpen = ['door_state', 'door_fridge', 'door_freezer'].some(
    (k) => getStringTrait(map, k) === 'Open'
  );

  let operationLabel: string | null = null;
  let operationTone: HomeConnectDisplaySummary['operationTone'] = 'slate';

  switch (operationState) {
    case 'Run':
      operationLabel = copy.run;
      operationTone = 'cyan';
      break;
    case 'DelayedStart':
      operationLabel = copy.delayedStart;
      operationTone = 'cyan';
      break;
    case 'Pause':
      operationLabel = copy.pause;
      operationTone = 'amber';
      break;
    case 'Finished':
      operationLabel = copy.finished;
      operationTone = 'emerald';
      break;
    case 'Ready':
      operationLabel = copy.ready;
      operationTone = 'slate';
      break;
    case 'ActionRequired':
      operationLabel = copy.actionRequired;
      operationTone = 'amber';
      break;
    case 'Aborting':
      operationLabel = copy.aborting;
      operationTone = 'amber';
      break;
    case 'Error':
      operationLabel = copy.error;
      operationTone = 'rose';
      break;
    case 'Inactive':
      operationLabel = powerState === 'Off' ? copy.off : copy.standby;
      operationTone = 'slate';
      break;
    default:
      if (powerState === 'Off') {
        operationLabel = copy.off;
      } else if (powerState === 'Standby') {
        operationLabel = copy.standby;
      } else if (powerState === 'On') {
        operationLabel = copy.on;
        operationTone = 'cyan';
      }
      break;
  }

  const cavityTemp = toFiniteNumber(map.get('cavity_temp_c'));
  const fridgeTemp = toFiniteNumber(map.get('fridge_temp_c'));
  const freezerTemp = toFiniteNumber(map.get('freezer_temp_c'));

  const tempParts: string[] = [];
  if (cavityTemp !== null) tempParts.push(`${copy.oven} ${cavityTemp} °C`);
  if (fridgeTemp !== null) tempParts.push(`${copy.fridge} ${fridgeTemp} °C`);
  if (freezerTemp !== null) tempParts.push(`${copy.freezer} ${freezerTemp} °C`);
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
    doorOpen ? `${copy.doorOpen} door open` : null,
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
