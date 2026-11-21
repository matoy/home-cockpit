import type {
  EnergyMode,
  EnergySource,
  HcSlot,
  TariffPeriodRecord,
} from '@/types';

export interface HybridEnergyInput {
  energyMode: EnergyMode;
  powerW: number | null;
  currentAddEleKwh: number | null;
  previousAddEleKwh: number | null;
  previousSeenAt: Date | string | null;
  now: Date;
}

export interface HybridEnergyResult {
  energyKwh: number;
  source: EnergySource;
  deltaHours: number;
}

/**
 * Calcule l'énergie consommée sur l'intervalle (~30 min par défaut) selon le mode :
 * - 'hybrid' : utilise le compteur Tuya add_ele si pertinent, sinon intègre W × Δt
 * - 'add_ele' : privilégie add_ele avec repli sécurisé sur l'intégration si null
 * - 'integration' : calcule toujours (powerW / 1000) × Δt
 */
export function computeHybridEnergyKwh(input: HybridEnergyInput): HybridEnergyResult {
  const { energyMode, powerW, currentAddEleKwh, previousAddEleKwh, previousSeenAt, now } = input;

  let deltaHours = 0.5;
  if (previousSeenAt) {
    const prevMs = previousSeenAt instanceof Date ? previousSeenAt.getTime() : new Date(previousSeenAt).getTime();
    if (!Number.isNaN(prevMs)) {
      const rawHours = (now.getTime() - prevMs) / 3_600_000;
      deltaHours = Math.min(1.0, Math.max(0.05, rawHours));
    }
  }

  const integratedKwh = Math.max(0, ((powerW ?? 0) / 1000) * deltaHours);

  if (energyMode === 'integration') {
    return {
      energyKwh: roundKwh(integratedKwh),
      source: 'integration',
      deltaHours,
    };
  }

  if (currentAddEleKwh !== null && Number.isFinite(currentAddEleKwh)) {
    // Cas 1 : compteur cumulatif qui a progressé de façon cohérente sur l'intervalle
    if (
      previousAddEleKwh !== null &&
      Number.isFinite(previousAddEleKwh) &&
      currentAddEleKwh > previousAddEleKwh
    ) {
      const diff = currentAddEleKwh - previousAddEleKwh;
      if (diff <= 20) {
        return {
          energyKwh: roundKwh(diff),
          source: 'add_ele',
          deltaHours,
        };
      }
    }

    // Cas 2 : incrément direct non nul (ex: prise qui remonte le delta depuis le dernier reset)
    if (
      currentAddEleKwh > 0 &&
      currentAddEleKwh <= 10 &&
      currentAddEleKwh !== previousAddEleKwh &&
      (previousAddEleKwh === null || currentAddEleKwh < previousAddEleKwh)
    ) {
      return {
        energyKwh: roundKwh(currentAddEleKwh),
        source: 'add_ele',
        deltaHours,
      };
    }
  }

  return {
    energyKwh: roundKwh(integratedKwh),
    source: 'integration',
    deltaHours,
  };
}

function roundKwh(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

const parisPartsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function getParisDateAndTime(input: Date | string): { dateStr: string; timeStr: string } {
  const date = input instanceof Date ? input : new Date(input);
  const parts = parisPartsFormatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  const hour = map.hour === '24' ? '00' : map.hour;
  return {
    dateStr: `${map.year}-${map.month}-${map.day}`,
    timeStr: `${hour}:${map.minute}`,
  };
}

export function isTimeInHcSlot(timeStr: string, slot: HcSlot): boolean {
  const start = slot.start;
  const end = slot.end;
  if (!start || !end) return false;
  if (start === end) return false;

  if (start < end) {
    return timeStr >= start && timeStr < end;
  }
  // Plage à cheval sur minuit (ex: 22:00 -> 06:00)
  return timeStr >= start || timeStr < end;
}

export function findTariffForDate(
  dateStr: string,
  tariffPeriods: TariffPeriodRecord[]
): TariffPeriodRecord | null {
  if (tariffPeriods.length === 0) return null;

  const sorted = [...tariffPeriods].sort((a, b) => a.startDate.localeCompare(b.startDate));

  // Recherche exacte d'une période couvrant dateStr
  const matching = sorted.filter(
    (p) => p.startDate <= dateStr && (!p.endDate || p.endDate >= dateStr)
  );
  if (matching.length > 0) {
    return matching[matching.length - 1];
  }

  // Repli si date antérieure à la première période ou postérieure à une période fermée
  const prior = sorted.filter((p) => p.startDate <= dateStr);
  if (prior.length > 0) {
    return prior[prior.length - 1];
  }

  return sorted[0];
}

export interface ReadingCostResult {
  costEur: number;
  rateEur: number;
  periodType: 'BASE' | 'HP' | 'HC';
  tariffLabel: string;
}

export function computeReadingCost(
  recordedAt: Date | string,
  energyKwh: number,
  tariffPeriods: TariffPeriodRecord[]
): ReadingCostResult {
  if (!energyKwh || energyKwh <= 0) {
    return {
      costEur: 0,
      rateEur: 0,
      periodType: 'BASE',
      tariffLabel: 'Aucun',
    };
  }

  const { dateStr, timeStr } = getParisDateAndTime(recordedAt);
  const tariff = findTariffForDate(dateStr, tariffPeriods);

  if (!tariff) {
    const fallbackRate = 0.2016;
    return {
      costEur: energyKwh * fallbackRate,
      rateEur: fallbackRate,
      periodType: 'BASE',
      tariffLabel: 'Tarif par défaut',
    };
  }

  if (tariff.mode === 'HP_HC') {
    const slots = tariff.hcSlots ?? [];
    const inHc = slots.some((slot) => isTimeInHcSlot(timeStr, slot));
    const rate = inHc ? tariff.hcRateEur ?? tariff.baseRateEur ?? 0.16 : tariff.hpRateEur ?? tariff.baseRateEur ?? 0.22;
    return {
      costEur: energyKwh * rate,
      rateEur: rate,
      periodType: inHc ? 'HC' : 'HP',
      tariffLabel: tariff.label,
    };
  }

  const baseRate = tariff.baseRateEur ?? tariff.hpRateEur ?? 0.2016;
  return {
    costEur: energyKwh * baseRate,
    rateEur: baseRate,
    periodType: 'BASE',
    tariffLabel: tariff.label,
  };
}

export function subtractOneDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Trie les périodes tarifaires chronologiquement et clôture automatiquement
 * une période ouverte (endDate === null) la veille du démarrage de la suivante.
 */
export function normalizeTariffTimeline<
  T extends { id?: number; startDate: string; endDate: string | null }
>(periods: T[]): T[] {
  const sorted = [...periods]
    .map((p) => ({ ...p }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (!current.endDate && next.startDate > current.startDate) {
      current.endDate = subtractOneDay(next.startDate);
    }
  }

  return sorted;
}

/**
 * Calcule le point de rosée approximatif (°C) via la formule de Magnus-Tetens.
 */
export function computeDewPointC(tempC: number | null, humidityPct: number | null): number | null {
  if (tempC === null || humidityPct === null || humidityPct <= 0) return null;
  const a = 17.27;
  const b = 237.7;
  const alpha = (a * tempC) / (b + tempC) + Math.log(Math.min(100, Math.max(1, humidityPct)) / 100);
  const dew = (b * alpha) / (a - alpha);
  return Math.round(dew * 10) / 10;
}
