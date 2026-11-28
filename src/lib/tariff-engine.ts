import type {
  EnergyMode,
  EnergySource,
  HcSlot,
  TariffPeriodRecord,
  TempoConfig,
  TempoDayColor,
} from '@/types';

export const DEFAULT_VAT_RATE_PCT = 20;
export const DEFAULT_SUBSCRIPTION_VAT_RATE_PCT = 20;
export const DEFAULT_EXCISE_RATE_EUR = 0;

function roundTax6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Convertit un prix du kWh HT en TTC selon la formule : (HT + accise) × (1 + TVA/100).
 */
export function kwhHtToTtc(
  htEur: number,
  vatRatePct: number = DEFAULT_VAT_RATE_PCT,
  exciseRateEur: number = DEFAULT_EXCISE_RATE_EUR
): number {
  if (!Number.isFinite(htEur) || htEur < 0) return 0;
  const safeVat = Number.isFinite(vatRatePct) && vatRatePct >= 0 ? vatRatePct : DEFAULT_VAT_RATE_PCT;
  const safeExcise = Number.isFinite(exciseRateEur) && exciseRateEur >= 0 ? exciseRateEur : 0;
  return roundTax6((htEur + safeExcise) * (1 + safeVat / 100));
}

/**
 * Convertit un prix du kWh TTC en HT : max(0, TTC / (1 + TVA/100) - accise).
 */
export function kwhTtcToHt(
  ttcEur: number,
  vatRatePct: number = DEFAULT_VAT_RATE_PCT,
  exciseRateEur: number = DEFAULT_EXCISE_RATE_EUR
): number {
  if (!Number.isFinite(ttcEur) || ttcEur < 0) return 0;
  const safeVat = Number.isFinite(vatRatePct) && vatRatePct >= 0 ? vatRatePct : DEFAULT_VAT_RATE_PCT;
  const safeExcise = Number.isFinite(exciseRateEur) && exciseRateEur >= 0 ? exciseRateEur : 0;
  return roundTax6(Math.max(0, ttcEur / (1 + safeVat / 100) - safeExcise));
}

/**
 * Convertit un abonnement mensuel HT en TTC : HT × (1 + TVA_abo/100).
 */
export function subscriptionHtToTtc(
  htEur: number,
  subscriptionVatRatePct: number = DEFAULT_SUBSCRIPTION_VAT_RATE_PCT
): number {
  if (!Number.isFinite(htEur) || htEur < 0) return 0;
  const safeVat =
    Number.isFinite(subscriptionVatRatePct) && subscriptionVatRatePct >= 0
      ? subscriptionVatRatePct
      : DEFAULT_SUBSCRIPTION_VAT_RATE_PCT;
  return roundTax6(htEur * (1 + safeVat / 100));
}

/**
 * Convertit un abonnement mensuel TTC en HT : TTC / (1 + TVA_abo/100).
 */
export function subscriptionTtcToHt(
  ttcEur: number,
  subscriptionVatRatePct: number = DEFAULT_SUBSCRIPTION_VAT_RATE_PCT
): number {
  if (!Number.isFinite(ttcEur) || ttcEur < 0) return 0;
  const safeVat =
    Number.isFinite(subscriptionVatRatePct) && subscriptionVatRatePct >= 0
      ? subscriptionVatRatePct
      : DEFAULT_SUBSCRIPTION_VAT_RATE_PCT;
  return roundTax6(ttcEur / (1 + safeVat / 100));
}

export const DEFAULT_TEMPO_CONFIG: TempoConfig = {
  blueHpRateEur: 0.1494,
  blueHcRateEur: 0.1232,
  whiteHpRateEur: 0.173,
  whiteHcRateEur: 0.1391,
  redHpRateEur: 0.6468,
  redHcRateEur: 0.146,
};

export function getTempoDayColor(
  dateStr: string,
  tempoConfig?: TempoConfig | null
): TempoDayColor {
  const override = tempoConfig?.dayColors?.[dateStr];
  if (override === 'BLUE' || override === 'WHITE' || override === 'RED') {
    return override;
  }
  return 'BLUE';
}

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

  if (tariff.mode === 'TEMPO') {
    const slots = tariff.hcSlots?.length
      ? tariff.hcSlots
      : [{ start: '22:00', end: '06:00' }];
    const inHc = slots.some((slot) => isTimeInHcSlot(timeStr, slot));
    const tc: TempoConfig = { ...DEFAULT_TEMPO_CONFIG, ...(tariff.tempoConfig ?? {}) };
    const color = getTempoDayColor(dateStr, tc);
    const rate =
      color === 'RED'
        ? inHc
          ? tc.redHcRateEur
          : tc.redHpRateEur
        : color === 'WHITE'
          ? inHc
            ? tc.whiteHcRateEur
            : tc.whiteHpRateEur
          : inHc
            ? tc.blueHcRateEur
            : tc.blueHpRateEur;
    return {
      costEur: energyKwh * rate,
      rateEur: rate,
      periodType: inHc ? 'HC' : 'HP',
      tariffLabel: tariff.label,
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

export interface ContractSimulationResult {
  baseCost: number;
  hpHcCost: number;
  tempoCost: number;
  weightedTempoHp: number;
  weightedTempoHc: number;
  cheapest: 'BASE' | 'HP_HC' | 'TEMPO';
  bestSavingsVsBase: number;
}

/**
 * Simule et compare le coût d'une consommation sur les options Base, HP/HC et EDF Tempo
 * (pondération annuelle officielle 300 jours Bleus, 43 Blancs, 22 Rouges).
 */
export function simulateContracts(params: {
  totalKwh: number;
  hpKwh: number;
  hcKwh: number;
  baseRate: number;
  hpRate: number;
  hcRate: number;
  tempoConfig?: TempoConfig | null;
}): ContractSimulationResult {
  const { totalKwh, hpKwh, hcKwh, baseRate, hpRate, hcRate, tempoConfig } = params;
  const tc: TempoConfig = { ...DEFAULT_TEMPO_CONFIG, ...(tempoConfig ?? {}) };

  const weightedTempoHp =
    (300 * tc.blueHpRateEur + 43 * tc.whiteHpRateEur + 22 * tc.redHpRateEur) / 365;
  const weightedTempoHc =
    (300 * tc.blueHcRateEur + 43 * tc.whiteHcRateEur + 22 * tc.redHcRateEur) / 365;

  const baseCost = totalKwh * baseRate;
  const hpHcCost = hpKwh * hpRate + hcKwh * hcRate;
  const tempoCost = hpKwh * weightedTempoHp + hcKwh * weightedTempoHc;

  const minCost = Math.min(baseCost, hpHcCost, tempoCost);
  const cheapest: ContractSimulationResult['cheapest'] =
    tempoCost <= baseCost && tempoCost <= hpHcCost
      ? 'TEMPO'
      : hpHcCost <= baseCost
        ? 'HP_HC'
        : 'BASE';

  return {
    baseCost,
    hpHcCost,
    tempoCost,
    weightedTempoHp,
    weightedTempoHc,
    cheapest,
    bestSavingsVsBase: Math.max(0, baseCost - minCost),
  };
}
