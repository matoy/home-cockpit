'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  Plus,
  Trash2,
  Edit3,
  Clock,
  Euro,
  Check,
  X,
  Scale,
  Calendar,
  Receipt,
} from 'lucide-react';
import {
  contributionHtToTtc,
  contributionTtcToHt,
  DEFAULT_SUBSCRIPTION_VAT_RATE_PCT,
  DEFAULT_TEMPO_CONFIG,
  DEFAULT_VAT_RATE_PCT,
  isTimeInHcSlot,
  kwhHtToTtc,
  kwhTtcToHt,
  simulateContracts,
  subscriptionHtToTtc,
  subscriptionTtcToHt,
  summarizeTariffContributions,
} from '@/lib/tariff-engine';
import { useI18n } from './I18nProvider';
import type {
  DashboardPayload,
  HcSlot,
  TariffContribution,
  TariffContributionKind,
  TariffMode,
  TariffPeriodRecord,
} from '@/types';

interface TariffsTabProps {
  data: DashboardPayload;
  onRefresh: () => Promise<void>;
}

interface TariffFormContributionRow {
  id: string;
  name: string;
  kind: TariffContributionKind;
  amountEur: string;
  vatRatePct: string;
}

interface TariffFormState {
  id: number | null;
  label: string;
  startDate: string;
  endDate: string;
  mode: TariffMode;
  inputTaxMode: 'HT' | 'TTC';
  vatRatePct: string;
  subscriptionVatRatePct: string;
  baseRateEur: string;
  hpRateEur: string;
  hcRateEur: string;
  hcSlots: HcSlot[];
  blueHpRateEur: string;
  blueHcRateEur: string;
  whiteHpRateEur: string;
  whiteHcRateEur: string;
  redHpRateEur: string;
  redHcRateEur: string;
  monthlySubscriptionEur: string;
  contributions: TariffFormContributionRow[];
}

function emptyForm(): TariffFormState {
  const today = new Date().toISOString().slice(0, 10);
  const toDefaultHt = (ttc: number) => kwhTtcToHt(ttc, DEFAULT_VAT_RATE_PCT).toFixed(4);
  return {
    id: null,
    label: '',
    startDate: today,
    endDate: '',
    mode: 'BASE',
    inputTaxMode: 'HT',
    vatRatePct: String(DEFAULT_VAT_RATE_PCT),
    subscriptionVatRatePct: String(DEFAULT_SUBSCRIPTION_VAT_RATE_PCT),
    baseRateEur: toDefaultHt(0.2016),
    hpRateEur: toDefaultHt(0.2146),
    hcRateEur: toDefaultHt(0.1696),
    hcSlots: [{ start: '22:00', end: '06:00' }],
    blueHpRateEur: toDefaultHt(DEFAULT_TEMPO_CONFIG.blueHpRateEur),
    blueHcRateEur: toDefaultHt(DEFAULT_TEMPO_CONFIG.blueHcRateEur),
    whiteHpRateEur: toDefaultHt(DEFAULT_TEMPO_CONFIG.whiteHpRateEur),
    whiteHcRateEur: toDefaultHt(DEFAULT_TEMPO_CONFIG.whiteHcRateEur),
    redHpRateEur: toDefaultHt(DEFAULT_TEMPO_CONFIG.redHpRateEur),
    redHcRateEur: toDefaultHt(DEFAULT_TEMPO_CONFIG.redHcRateEur),
    monthlySubscriptionEur: subscriptionTtcToHt(
      14.18,
      DEFAULT_SUBSCRIPTION_VAT_RATE_PCT
    ).toFixed(2),
    contributions: [],
  };
}

export function TariffsTab({ data, onRefresh }: TariffsTabProps) {
  const { t } = useI18n();
  const hcPresets: Array<{ label: string; slots: HcSlot[] }> = [
    { label: t('tariffs.presetClassic'), slots: [{ start: '22:00', end: '06:00' }] },
    { label: t('tariffs.presetLate'), slots: [{ start: '23:00', end: '07:00' }] },
    {
      label: t('tariffs.presetMidday'),
      slots: [
        { start: '12:30', end: '14:30' },
        { start: '01:30', end: '07:30' },
      ],
    },
  ];
  const [form, setForm] = useState<TariffFormState>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedTariffs = useMemo(
    () => [...data.tariffs].sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [data.tariffs]
  );

  const activeTariff = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (
      data.tariffs.find((t) => t.startDate <= today && (!t.endDate || t.endDate >= today)) ??
      sortedTariffs[0] ??
      null
    );
  }, [data.tariffs, sortedTariffs]);

  // Comparateur instantané Base vs HP/HC vs EDF Tempo sur la consommation de la période
  const comparator = useMemo(() => {
    const totalKwh = data.kpis.periodEnergyKwh;
    const baseRate = activeTariff?.baseRateEur ?? 0.2016;
    const hpRate = activeTariff?.hpRateEur ?? 0.2146;
    const hcRate = activeTariff?.hcRateEur ?? 0.1696;
    const slots = activeTariff?.hcSlots?.length ? activeTariff.hcSlots : [{ start: '22:00', end: '06:00' }];

    let hcKwh = 0;
    let hpKwh = 0;
    let exactFromBuckets = false;

    const hasHourlyBuckets = data.timeSeries.some((pt) => pt.bucket.includes('T'));
    if (hasHourlyBuckets && data.timeSeries.length > 0) {
      exactFromBuckets = true;
      for (const pt of data.timeSeries) {
        const timePart = pt.bucket.includes('T') ? pt.bucket.split('T')[1].slice(0, 5) : null;
        if (timePart && slots.some((s) => isTimeInHcSlot(timePart, s))) {
          hcKwh += pt.totalEnergyKwh;
        } else {
          hpKwh += pt.totalEnergyKwh;
        }
      }
    } else {
      hcKwh = totalKwh * 0.35;
      hpKwh = totalKwh * 0.65;
    }

    const perKwhContribTtc = summarizeTariffContributions(activeTariff?.contributions).perKwhTtcEur;
    const fixedPeriodTtc =
      data.kpis.subscriptionCostEur + (data.kpis.fixedContributionsCostEur ?? 0);

    const sim = simulateContracts({
      totalKwh,
      hpKwh,
      hcKwh,
      baseRate,
      hpRate,
      hcRate,
      tempoConfig: activeTariff?.tempoConfig ?? DEFAULT_TEMPO_CONFIG,
      perKwhContributionsTtc: perKwhContribTtc,
      fixedPeriodTtc,
    });

    return {
      totalKwh,
      hcKwh,
      hpKwh,
      hcPct: totalKwh > 0 ? (hcKwh / totalKwh) * 100 : 0,
      baseRate: baseRate + perKwhContribTtc,
      hpRate: hpRate + perKwhContribTtc,
      hcRate: hcRate + perKwhContribTtc,
      perKwhContribTtc,
      fixedPeriodTtc,
      ...sim,
      exactFromBuckets,
    };
  }, [
    data.kpis.periodEnergyKwh,
    data.kpis.subscriptionCostEur,
    data.kpis.fixedContributionsCostEur,
    data.timeSeries,
    activeTariff,
  ]);

  function startEdit(item: TariffPeriodRecord) {
    const tc = { ...DEFAULT_TEMPO_CONFIG, ...(item.tempoConfig ?? {}) };
    const existingContribs: TariffFormContributionRow[] = (item.contributions ?? []).map((c, idx) => {
      const decimals = c.kind === 'monthly' ? 2 : 4;
      const vat = c.vatRatePct ?? DEFAULT_VAT_RATE_PCT;
      return {
        id: c.id || `contrib_${idx + 1}`,
        name: c.name,
        kind: c.kind,
        amountEur: contributionHtToTtc(c.amountHtEur, vat).toFixed(decimals),
        vatRatePct: String(vat),
      };
    });
    setForm({
      id: item.id,
      label: item.label,
      startDate: item.startDate,
      endDate: item.endDate ?? '',
      mode: item.mode,
      inputTaxMode: 'TTC',
      vatRatePct: String(item.vatRatePct ?? DEFAULT_VAT_RATE_PCT),
      subscriptionVatRatePct: String(
        item.subscriptionVatRatePct ?? DEFAULT_SUBSCRIPTION_VAT_RATE_PCT
      ),
      baseRateEur: String(item.baseRateEur ?? 0.2016),
      hpRateEur: String(item.hpRateEur ?? 0.2146),
      hcRateEur: String(item.hcRateEur ?? 0.1696),
      hcSlots: item.hcSlots?.length ? item.hcSlots : [{ start: '22:00', end: '06:00' }],
      blueHpRateEur: String(tc.blueHpRateEur),
      blueHcRateEur: String(tc.blueHcRateEur),
      whiteHpRateEur: String(tc.whiteHpRateEur),
      whiteHcRateEur: String(tc.whiteHcRateEur),
      redHpRateEur: String(tc.redHpRateEur),
      redHcRateEur: String(tc.redHcRateEur),
      monthlySubscriptionEur: String(item.monthlySubscriptionEur ?? 0),
      contributions: existingContribs,
    });
    setShowForm(true);
    setError(null);
  }

  function startNew() {
    setForm(emptyForm());
    setShowForm(true);
    setError(null);
  }

  const parseNonNeg = (raw: string, fallback = 0): number => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };

  const formVatRate = parseNonNeg(form.vatRatePct, DEFAULT_VAT_RATE_PCT);
  const formSubVatRate = parseNonNeg(
    form.subscriptionVatRatePct,
    DEFAULT_SUBSCRIPTION_VAT_RATE_PCT
  );

  const formContributionsHt: TariffContribution[] = form.contributions.map((row, idx) => {
    const vat = parseNonNeg(row.vatRatePct, DEFAULT_VAT_RATE_PCT);
    const rawVal = parseNonNeg(row.amountEur, 0);
    const amountHtEur =
      form.inputTaxMode === 'HT' ? rawVal : contributionTtcToHt(rawVal, vat);
    return {
      id: row.id || `contrib_${idx + 1}`,
      name: row.name,
      kind: row.kind,
      amountHtEur,
      vatRatePct: vat,
    };
  });
  const formContribSummary = summarizeTariffContributions(formContributionsHt);

  function handleTaxModeChange(nextMode: 'HT' | 'TTC') {
    if (nextMode === form.inputTaxMode) return;
    const convertKwh = (raw: string): string => {
      const val = Number(raw);
      if (!Number.isFinite(val) || val < 0) return raw;
      const converted =
        nextMode === 'TTC'
          ? kwhHtToTtc(val, formVatRate)
          : kwhTtcToHt(val, formVatRate);
      return converted.toFixed(4);
    };
    const subVal = Number(form.monthlySubscriptionEur);
    const convertedSub =
      Number.isFinite(subVal) && subVal >= 0
        ? (nextMode === 'TTC'
            ? subscriptionHtToTtc(subVal, formSubVatRate)
            : subscriptionTtcToHt(subVal, formSubVatRate)
          ).toFixed(2)
        : form.monthlySubscriptionEur;

    const convertedContribs = form.contributions.map((row) => {
      const val = Number(row.amountEur);
      if (!Number.isFinite(val) || val < 0) return row;
      const rowVat = parseNonNeg(row.vatRatePct, DEFAULT_VAT_RATE_PCT);
      const decimals = row.kind === 'monthly' ? 2 : 4;
      const nextAmount =
        nextMode === 'TTC'
          ? contributionHtToTtc(val, rowVat)
          : contributionTtcToHt(val, rowVat);
      return { ...row, amountEur: nextAmount.toFixed(decimals) };
    });

    setForm({
      ...form,
      inputTaxMode: nextMode,
      baseRateEur: convertKwh(form.baseRateEur),
      hpRateEur: convertKwh(form.hpRateEur),
      hcRateEur: convertKwh(form.hcRateEur),
      blueHpRateEur: convertKwh(form.blueHpRateEur),
      blueHcRateEur: convertKwh(form.blueHcRateEur),
      whiteHpRateEur: convertKwh(form.whiteHpRateEur),
      whiteHcRateEur: convertKwh(form.whiteHcRateEur),
      redHpRateEur: convertKwh(form.redHpRateEur),
      redHcRateEur: convertKwh(form.redHcRateEur),
      monthlySubscriptionEur: convertedSub,
      contributions: convertedContribs,
    });
  }

  function addContributionRow(preset: 'accise' | 'cta' | 'custom') {
    const uid = `contrib_${Date.now().toString(36)}_${form.contributions.length + 1}`;
    const formatPresetAmount = (htVal: number, vat: number, kind: TariffContributionKind) => {
      const decimals = kind === 'monthly' ? 2 : 4;
      return form.inputTaxMode === 'HT'
        ? htVal.toFixed(kind === 'per_kwh' && htVal === 0.02998 ? 5 : decimals)
        : contributionHtToTtc(htVal, vat).toFixed(decimals);
    };

    const nextRow: TariffFormContributionRow =
      preset === 'accise'
        ? {
            id: uid,
            name: t('tariffs.contribAcciseDefaultName'),
            kind: 'per_kwh',
            amountEur: formatPresetAmount(0.02998, 20, 'per_kwh'),
            vatRatePct: '20',
          }
        : preset === 'cta'
          ? {
              id: uid,
              name: t('tariffs.contribCtaDefaultName'),
              kind: 'monthly',
              amountEur: formatPresetAmount(3.45, 20, 'monthly'),
              vatRatePct: '20',
            }
          : {
              id: uid,
              name: '',
              kind: 'per_kwh',
              amountEur: '0.0000',
              vatRatePct: '20',
            };

    setForm({ ...form, contributions: [...form.contributions, nextRow] });
  }

  function formatKwhEquivHint(raw: string): string {
    const val = parseNonNeg(raw, 0);
    if (form.inputTaxMode === 'HT') {
      return t('tariffs.equivTtcKwh', {
        value: kwhHtToTtc(val, formVatRate).toFixed(4),
      });
    }
    return t('tariffs.equivHtKwh', {
      value: kwhTtcToHt(val, formVatRate).toFixed(4),
    });
  }

  function formatSubEquivHint(raw: string): string {
    const val = parseNonNeg(raw, 0);
    if (form.inputTaxMode === 'HT') {
      return t('tariffs.equivTtcMonth', {
        value: subscriptionHtToTtc(val, formSubVatRate).toFixed(2),
      });
    }
    return t('tariffs.equivHtMonth', {
      value: subscriptionTtcToHt(val, formSubVatRate).toFixed(2),
    });
  }

  function formatContribEquivHint(row: TariffFormContributionRow): string {
    const val = parseNonNeg(row.amountEur, 0);
    const vat = parseNonNeg(row.vatRatePct, DEFAULT_VAT_RATE_PCT);
    const decimals = row.kind === 'monthly' ? 2 : 4;
    if (form.inputTaxMode === 'HT') {
      const converted = contributionHtToTtc(val, vat).toFixed(decimals);
      return row.kind === 'monthly'
        ? t('tariffs.equivTtcMonth', { value: converted })
        : t('tariffs.equivTtcKwh', { value: converted });
    }
    const converted = contributionTtcToHt(val, vat).toFixed(decimals);
    return row.kind === 'monthly'
      ? t('tariffs.equivHtMonth', { value: converted })
      : t('tariffs.equivHtKwh', { value: converted });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const toTtcRate = (raw: string, fallbackTtc?: number): number | null => {
      const val = Number(raw);
      if (!Number.isFinite(val) || val < 0) return fallbackTtc ?? null;
      return form.inputTaxMode === 'HT' ? kwhHtToTtc(val, formVatRate) : val;
    };

    const rawSub = Number(form.monthlySubscriptionEur);
    const storedSub =
      Number.isFinite(rawSub) && rawSub >= 0
        ? form.inputTaxMode === 'HT'
          ? subscriptionHtToTtc(rawSub, formSubVatRate)
          : rawSub
        : 0;

    const cleanedContributions: TariffContribution[] = form.contributions
      .map((row, idx) => {
        const name = row.name.trim();
        const vat = parseNonNeg(row.vatRatePct, DEFAULT_VAT_RATE_PCT);
        const rawAmount = parseNonNeg(row.amountEur, 0);
        const amountHtEur =
          form.inputTaxMode === 'HT' ? rawAmount : contributionTtcToHt(rawAmount, vat);
        return {
          id: row.id || `contrib_${idx + 1}`,
          name,
          kind: row.kind,
          amountHtEur: Math.round(amountHtEur * 1_000_000) / 1_000_000,
          vatRatePct: Math.min(100, Math.max(0, vat)),
        };
      })
      .filter((c) => c.name.length > 0);

    const payload = {
      id: form.id ?? undefined,
      label: form.label.trim(),
      startDate: form.startDate,
      endDate: form.endDate.trim() || null,
      mode: form.mode,
      baseRateEur: toTtcRate(form.baseRateEur),
      hpRateEur: toTtcRate(form.hpRateEur),
      hcRateEur: toTtcRate(form.hcRateEur),
      hcSlots: form.mode === 'HP_HC' || form.mode === 'TEMPO' ? form.hcSlots : [],
      tempoConfig:
        form.mode === 'TEMPO'
          ? {
              blueHpRateEur: toTtcRate(form.blueHpRateEur, DEFAULT_TEMPO_CONFIG.blueHpRateEur)!,
              blueHcRateEur: toTtcRate(form.blueHcRateEur, DEFAULT_TEMPO_CONFIG.blueHcRateEur)!,
              whiteHpRateEur: toTtcRate(form.whiteHpRateEur, DEFAULT_TEMPO_CONFIG.whiteHpRateEur)!,
              whiteHcRateEur: toTtcRate(form.whiteHcRateEur, DEFAULT_TEMPO_CONFIG.whiteHcRateEur)!,
              redHpRateEur: toTtcRate(form.redHpRateEur, DEFAULT_TEMPO_CONFIG.redHpRateEur)!,
              redHcRateEur: toTtcRate(form.redHcRateEur, DEFAULT_TEMPO_CONFIG.redHcRateEur)!,
            }
          : null,
      monthlySubscriptionEur: Math.round(storedSub * 100) / 100,
      vatRatePct: formVatRate,
      subscriptionVatRatePct: formSubVatRate,
      exciseRateEur: 0,
      contributions: cleanedContributions,
    };

    try {
      const res = await fetch('/api/tariffs', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || t('tariffs.saveError'));
      }
      setShowForm(false);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tariffs.unknownError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await fetch(`/api/tariffs?id=${id}`, { method: 'DELETE' });
      await onRefresh();
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-6">
      {/* En-tête + bouton d'ajout */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div>
          <h2 className="text-base font-semibold text-white">
            {t('tariffs.title')}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {t('tariffs.subtitle')}
          </p>
        </div>

        <button
          onClick={startNew}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-medium text-white transition"
        >
          <Plus className="h-4 w-4" />
          {t('tariffs.newBtn')}
        </button>
      </div>

      {/* Formulaire ajout / édition */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-indigo-500/40 bg-slate-900/90 p-6 space-y-5"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              {form.id ? t('tariffs.editTitle') : t('tariffs.addTitle')}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {t('tariffs.nameLabel')}
              </label>
              <input
                type="text"
                required
                placeholder={t('tariffs.namePlaceholder')}
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {t('tariffs.startLabel')}
              </label>
              <input
                type="date"
                required
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {t('tariffs.endLabel')}
              </label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Sélecteur visuel Base vs HP/HC vs EDF Tempo */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-2">
              {t('tariffs.optionLabel')}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, mode: 'BASE' })}
                className={`rounded-xl border p-3.5 text-left transition ${form.mode === 'BASE'
                    ? 'border-indigo-500 bg-indigo-500/15 text-white'
                    : 'border-slate-700 bg-slate-950/60 text-slate-400 hover:border-slate-600'
                  }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{t('tariffs.optionBaseTitle')}</span>
                  {form.mode === 'BASE' && <Check className="h-4 w-4 text-indigo-400" />}
                </div>
                <p className="mt-1 text-[11px] opacity-80">
                  {t('tariffs.optionBaseDesc')}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setForm({ ...form, mode: 'HP_HC' })}
                className={`rounded-xl border p-3.5 text-left transition ${form.mode === 'HP_HC'
                    ? 'border-emerald-500 bg-emerald-500/15 text-white'
                    : 'border-slate-700 bg-slate-950/60 text-slate-400 hover:border-slate-600'
                  }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{t('tariffs.optionHpHcTitle')}</span>
                  {form.mode === 'HP_HC' && <Check className="h-4 w-4 text-emerald-400" />}
                </div>
                <p className="mt-1 text-[11px] opacity-80">
                  {t('tariffs.optionHpHcDesc')}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setForm({ ...form, mode: 'TEMPO' })}
                className={`rounded-xl border p-3.5 text-left transition ${form.mode === 'TEMPO'
                    ? 'border-sky-500 bg-sky-500/15 text-white'
                    : 'border-slate-700 bg-slate-950/60 text-slate-400 hover:border-slate-600'
                  }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{t('tariffs.optionTempoTitle')}</span>
                  {form.mode === 'TEMPO' && <Check className="h-4 w-4 text-sky-400" />}
                </div>
                <p className="mt-1 text-[11px] opacity-80">
                  {t('tariffs.optionTempoDesc')}
                </p>
              </button>
            </div>
          </div>

          {/* Paramètres fiscaux & mode de saisie HT / TTC */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {t('tariffs.inputModeLabel')}
                </label>
                <div className="grid grid-cols-2 rounded-xl border border-slate-700 bg-slate-900 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => handleTaxModeChange('HT')}
                    className={`rounded-lg px-3 py-1.5 font-medium transition ${
                      form.inputTaxMode === 'HT'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {t('tariffs.inputModeHt')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTaxModeChange('TTC')}
                    className={`rounded-lg px-3 py-1.5 font-medium transition ${
                      form.inputTaxMode === 'TTC'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {t('tariffs.inputModeTtc')}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {t('tariffs.vatRateLabel')}
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={form.vatRatePct}
                  onChange={(e) => setForm({ ...form, vatRatePct: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                />
                <p className="mt-1 text-[10.5px] text-slate-500">{t('tariffs.energyOnlyNote')}</p>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    {t('tariffs.subVatRateLabel')}
                  </label>
                  <div className="flex gap-1">
                    {(['20', '5.5'] as const).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setForm({ ...form, subscriptionVatRatePct: preset })}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-mono border transition ${
                          form.subscriptionVatRatePct === preset
                            ? 'border-indigo-500/60 bg-indigo-500/20 text-indigo-200'
                            : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-white'
                        }`}
                      >
                        {preset}%
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={form.subscriptionVatRatePct}
                  onChange={(e) => setForm({ ...form, subscriptionVatRatePct: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Prix du kWh selon le mode */}
          {form.mode === 'TEMPO' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-sky-300 mb-1.5">
                  {t('tariffs.tempoBlueHp')} ({form.inputTaxMode})
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  required
                  value={form.blueHpRateEur}
                  onChange={(e) => setForm({ ...form, blueHpRateEur: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-sky-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] font-mono text-slate-400">
                  {formatKwhEquivHint(form.blueHpRateEur)}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-sky-200 mb-1.5">
                  {t('tariffs.tempoBlueHc')} ({form.inputTaxMode})
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  required
                  value={form.blueHcRateEur}
                  onChange={(e) => setForm({ ...form, blueHcRateEur: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-sky-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] font-mono text-slate-400">
                  {formatKwhEquivHint(form.blueHcRateEur)}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-200 mb-1.5">
                  {t('tariffs.tempoWhiteHp')} ({form.inputTaxMode})
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  required
                  value={form.whiteHpRateEur}
                  onChange={(e) => setForm({ ...form, whiteHpRateEur: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-sky-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] font-mono text-slate-400">
                  {formatKwhEquivHint(form.whiteHpRateEur)}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {t('tariffs.tempoWhiteHc')} ({form.inputTaxMode})
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  required
                  value={form.whiteHcRateEur}
                  onChange={(e) => setForm({ ...form, whiteHcRateEur: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-sky-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] font-mono text-slate-400">
                  {formatKwhEquivHint(form.whiteHcRateEur)}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-rose-300 mb-1.5">
                  {t('tariffs.tempoRedHp')} ({form.inputTaxMode})
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  required
                  value={form.redHpRateEur}
                  onChange={(e) => setForm({ ...form, redHpRateEur: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-rose-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] font-mono text-slate-400">
                  {formatKwhEquivHint(form.redHpRateEur)}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-rose-200 mb-1.5">
                  {t('tariffs.tempoRedHc')} ({form.inputTaxMode})
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  required
                  value={form.redHcRateEur}
                  onChange={(e) => setForm({ ...form, redHcRateEur: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-rose-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] font-mono text-slate-400">
                  {formatKwhEquivHint(form.redHcRateEur)}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {t('tariffs.subLabel')} ({form.inputTaxMode})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.monthlySubscriptionEur}
                  onChange={(e) => setForm({ ...form, monthlySubscriptionEur: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] font-mono text-slate-400">
                  {formatSubEquivHint(form.monthlySubscriptionEur)}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {form.mode === 'BASE' ? (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    {t('tariffs.baseRateLabel')} ({form.inputTaxMode})
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    required
                    value={form.baseRateEur}
                    onChange={(e) => setForm({ ...form, baseRateEur: e.target.value })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] font-mono text-slate-400">
                    {formatKwhEquivHint(form.baseRateEur)}
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-amber-300 mb-1.5">
                      {t('tariffs.hpRateLabel')} ({form.inputTaxMode})
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      required
                      value={form.hpRateEur}
                      onChange={(e) => setForm({ ...form, hpRateEur: e.target.value })}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] font-mono text-slate-400">
                      {formatKwhEquivHint(form.hpRateEur)}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-emerald-300 mb-1.5">
                      {t('tariffs.hcRateLabel')} ({form.inputTaxMode})
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      required
                      value={form.hcRateEur}
                      onChange={(e) => setForm({ ...form, hcRateEur: e.target.value })}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] font-mono text-slate-400">
                      {formatKwhEquivHint(form.hcRateEur)}
                    </p>
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {t('tariffs.subLabel')} ({form.inputTaxMode})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.monthlySubscriptionEur}
                  onChange={(e) => setForm({ ...form, monthlySubscriptionEur: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] font-mono text-slate-400">
                  {formatSubEquivHint(form.monthlySubscriptionEur)}
                </p>
              </div>
            </div>
          )}

          {/* Section Contributions & Taxes + Récapitulatif tout compris */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5 text-amber-400" />
                  {t('tariffs.contributionsTitle')}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {t('tariffs.contributionsDesc')}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => addContributionRow('accise')}
                  className="rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-200 transition"
                >
                  {t('tariffs.addAccisePreset')}
                </button>
                <button
                  type="button"
                  onClick={() => addContributionRow('cta')}
                  className="rounded-lg border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 px-2.5 py-1 text-[11px] font-medium text-sky-200 transition"
                >
                  {t('tariffs.addCtaPreset')}
                </button>
                <button
                  type="button"
                  onClick={() => addContributionRow('custom')}
                  className="rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition"
                >
                  {t('tariffs.addCustomContrib')}
                </button>
              </div>
            </div>

            {form.contributions.length === 0 ? (
              <p className="text-xs text-slate-500 italic">{t('tariffs.contributionsEmpty')}</p>
            ) : (
              <div className="space-y-2.5">
                {form.contributions.map((row, idx) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-start rounded-xl border border-slate-800 bg-slate-900/60 p-3"
                  >
                    <div className="sm:col-span-4">
                      <label className="block text-[10.5px] text-slate-400 mb-1">
                        {t('tariffs.contribNameLabel')}
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={80}
                        placeholder={t('tariffs.contribNamePlaceholder')}
                        value={row.name}
                        onChange={(e) => {
                          const next = [...form.contributions];
                          next[idx] = { ...row, name: e.target.value };
                          setForm({ ...form, contributions: next });
                        }}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-[10.5px] text-slate-400 mb-1">
                        {t('tariffs.contribKindLabel')}
                      </label>
                      <select
                        value={row.kind}
                        onChange={(e) => {
                          const nextKind = e.target.value === 'monthly' ? 'monthly' : 'per_kwh';
                          const next = [...form.contributions];
                          next[idx] = { ...row, kind: nextKind };
                          setForm({ ...form, contributions: next });
                        }}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="per_kwh">{t('tariffs.contribKindPerKwh')}</option>
                        <option value="monthly">{t('tariffs.contribKindMonthly')}</option>
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[10.5px] text-slate-400 mb-1">
                        {t('tariffs.contribAmountLabel')} ({form.inputTaxMode})
                      </label>
                      <input
                        type="number"
                        step={row.kind === 'monthly' ? '0.01' : '0.00001'}
                        min="0"
                        max="500"
                        required
                        value={row.amountEur}
                        onChange={(e) => {
                          const next = [...form.contributions];
                          next[idx] = { ...row, amountEur: e.target.value };
                          setForm({ ...form, contributions: next });
                        }}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                      />
                      <p className="mt-0.5 text-[10px] font-mono text-slate-400">
                        {formatContribEquivHint(row)}
                      </p>
                    </div>

                    <div className="sm:col-span-2">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <label className="block text-[10.5px] text-slate-400">
                          {t('tariffs.contribVatLabel')}
                        </label>
                        <div className="flex gap-1">
                          {(['20', '5.5', '0'] as const).map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => {
                                const next = [...form.contributions];
                                next[idx] = { ...row, vatRatePct: preset };
                                setForm({ ...form, contributions: next });
                              }}
                              className={`rounded px-1 py-0.2 text-[9px] font-mono border transition ${
                                row.vatRatePct === preset
                                  ? 'border-indigo-500/60 bg-indigo-500/20 text-indigo-200'
                                  : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-white'
                              }`}
                            >
                              {preset}%
                            </button>
                          ))}
                        </div>
                      </div>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={row.vatRatePct}
                        onChange={(e) => {
                          const next = [...form.contributions];
                          next[idx] = { ...row, vatRatePct: e.target.value };
                          setForm({ ...form, contributions: next });
                        }}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-1 flex sm:justify-end sm:pt-5">
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            contributions: form.contributions.filter((_, i) => i !== idx),
                          })
                        }
                        title={t('tariffs.contribDelete')}
                        className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Récapitulatif en direct tout compris */}
            {(() => {
              const energyTtc = (raw: string) => {
                const v = parseNonNeg(raw, 0);
                return form.inputTaxMode === 'HT' ? kwhHtToTtc(v, formVatRate) : v;
              };
              const subVal = parseNonNeg(form.monthlySubscriptionEur, 0);
              const subHt =
                form.inputTaxMode === 'HT' ? subVal : subscriptionTtcToHt(subVal, formSubVatRate);
              const subTtc =
                form.inputTaxMode === 'HT' ? subscriptionHtToTtc(subVal, formSubVatRate) : subVal;
              const fixedAllInHt = subHt + formContribSummary.monthlyHtEur;
              const fixedAllInTtc = subTtc + formContribSummary.monthlyTtcEur;

              const kwhRecap =
                form.mode === 'BASE'
                  ? `${(energyTtc(form.baseRateEur) + formContribSummary.perKwhTtcEur).toFixed(4)} €/kWh ${t('tariffs.ttcShort')}`
                  : form.mode === 'HP_HC'
                    ? `${t('tariffs.hpShort')} ${(energyTtc(form.hpRateEur) + formContribSummary.perKwhTtcEur).toFixed(4)} € · ${t('tariffs.hcShort')} ${(energyTtc(form.hcRateEur) + formContribSummary.perKwhTtcEur).toFixed(4)} € ${t('tariffs.ttcShort')}`
                    : `${t('tariffs.tempoRatesSummary', {
                        bHp: (energyTtc(form.blueHpRateEur) + formContribSummary.perKwhTtcEur).toFixed(4),
                        bHc: (energyTtc(form.blueHcRateEur) + formContribSummary.perKwhTtcEur).toFixed(4),
                        wHp: (energyTtc(form.whiteHpRateEur) + formContribSummary.perKwhTtcEur).toFixed(4),
                        wHc: (energyTtc(form.whiteHcRateEur) + formContribSummary.perKwhTtcEur).toFixed(4),
                        rHp: (energyTtc(form.redHpRateEur) + formContribSummary.perKwhTtcEur).toFixed(4),
                        rHc: (energyTtc(form.redHcRateEur) + formContribSummary.perKwhTtcEur).toFixed(4),
                      })} (${t('tariffs.ttcShort')})`;

              return (
                <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3.5 py-2.5 text-[11px] flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-indigo-200">
                    {t('tariffs.allInRecapTitle')}
                  </span>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-slate-200">
                    <span>
                      <span className="text-slate-400">{t('tariffs.allInKwhLabel')} </span>
                      {kwhRecap}
                    </span>
                    <span>
                      <span className="text-slate-400">{t('tariffs.allInMonthlyFixedLabel')} </span>
                      {fixedAllInTtc.toFixed(2)} {t('common.perMonth')} {t('tariffs.ttcShort')} ({fixedAllInHt.toFixed(2)} € {t('tariffs.htShort')})
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Éditeur de plages HC */}
          {(form.mode === 'HP_HC' || form.mode === 'TEMPO') && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-emerald-400" />
                  {t('tariffs.hcSlotsTitle')}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {hcPresets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setForm({ ...form, hcSlots: preset.slots })}
                      className="rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                {form.hcSlots.map((slot, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{t('tariffs.from')}</span>
                    <input
                      type="time"
                      value={slot.start}
                      onChange={(e) => {
                        const next = [...form.hcSlots];
                        next[idx] = { ...slot, start: e.target.value };
                        setForm({ ...form, hcSlots: next });
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-white"
                    />
                    <span className="text-xs text-slate-400">{t('tariffs.to')}</span>
                    <input
                      type="time"
                      value={slot.end}
                      onChange={(e) => {
                        const next = [...form.hcSlots];
                        next[idx] = { ...slot, end: e.target.value };
                        setForm({ ...form, hcSlots: next });
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-white"
                    />
                    {form.hcSlots.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            hcSlots: form.hcSlots.filter((_, i) => i !== idx),
                          })
                        }
                        className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      hcSlots: [...form.hcSlots, { start: '12:30', end: '14:30' }],
                    })
                  }
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                >
                  {t('tariffs.addSlot')}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2 text-xs font-medium text-white"
            >
              {saving ? t('common.saving') : t('tariffs.saveBtn')}
            </button>
          </div>
        </form>
      )}

      {/* Frise chronologique des tarifs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {sortedTariffs.map((tariffItem) => {
            const isCurrent = activeTariff?.id === tariffItem.id;
            const vatPct = tariffItem.vatRatePct ?? DEFAULT_VAT_RATE_PCT;
            const subVatPct =
              tariffItem.subscriptionVatRatePct ?? DEFAULT_SUBSCRIPTION_VAT_RATE_PCT;
            const itemContribs = tariffItem.contributions ?? [];
            const itemContribSummary = summarizeTariffContributions(itemContribs);
            const ttcLabel = t('tariffs.ttcShort');
            const htLabel = t('tariffs.htShort');
            const formatKwhPair = (ttcVal: number) =>
              `${ttcVal.toFixed(4)} €/kWh ${ttcLabel} · ${kwhTtcToHt(ttcVal, vatPct).toFixed(4)} € ${htLabel}`;
            const subTtc = tariffItem.monthlySubscriptionEur ?? 0;
            const subHt = subscriptionTtcToHt(subTtc, subVatPct);
            const fixedMonthlyTotalTtc = subTtc + itemContribSummary.monthlyTtcEur;

            return (
              <div
                key={tariffItem.id}
                className={`rounded-2xl border p-5 transition ${isCurrent
                    ? 'border-emerald-500/40 bg-emerald-950/10'
                    : 'border-slate-800 bg-slate-900/70'
                  }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">{tariffItem.label}</h3>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${tariffItem.mode === 'TEMPO'
                            ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                            : tariffItem.mode === 'HP_HC'
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              : 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                          }`}
                      >
                        {tariffItem.mode === 'TEMPO'
                          ? 'TEMPO'
                          : tariffItem.mode === 'HP_HC'
                            ? 'HP / HC'
                            : 'BASE'}
                      </span>
                      <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-[10px] font-mono text-slate-300">
                        {t('tariffs.taxBadgeVat', { vat: vatPct })}
                        {subVatPct !== vatPct
                          ? ` · ${t('tariffs.taxBadgeSubVat', { vat: subVatPct })}`
                          : ''}
                        {itemContribSummary.perKwhTtcEur > 0
                          ? ` · +${itemContribSummary.perKwhTtcEur.toFixed(4)} €/kWh`
                          : ''}
                        {itemContribSummary.monthlyTtcEur > 0
                          ? ` · +${itemContribSummary.monthlyTtcEur.toFixed(2)} ${t('common.perMonth')}`
                          : ''}
                      </span>
                      {isCurrent && (
                        <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                          {t('tariffs.activeBadge')}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-400 flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {t('tariffs.fromDate')}{' '}
                      <span className="text-slate-200 font-mono">{tariffItem.startDate}</span>{' '}
                      {tariffItem.endDate ? (
                        <>
                          {t('tariffs.toDate')}{' '}
                          <span className="text-slate-200 font-mono">{tariffItem.endDate}</span>
                        </>
                      ) : (
                        <span className="text-emerald-400">{t('tariffs.ongoing')}</span>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => startEdit(tariffItem)}
                      className="rounded-lg border border-slate-700 bg-slate-800/80 p-2 text-slate-300 hover:text-white"
                      title={t('common.edit')}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(tariffItem.id)}
                      className="rounded-lg border border-slate-700 bg-slate-800/80 p-2 text-rose-400 hover:bg-rose-500/15"
                      title={t('common.delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-3 text-xs">
                  {tariffItem.mode === 'BASE' ? (
                    <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2">
                      <span className="text-slate-400">{t('tariffs.uniquePrice')} </span>
                      <span className="font-mono font-semibold text-white">
                        {(tariffItem.baseRateEur ?? 0).toFixed(4)} €/kWh {ttcLabel}
                      </span>
                      <span className="ml-2 font-mono text-[11px] text-slate-400">
                        ({kwhTtcToHt(tariffItem.baseRateEur ?? 0, vatPct).toFixed(4)} € {htLabel})
                      </span>
                      {itemContribSummary.perKwhTtcEur > 0 && (
                        <span className="ml-2 font-mono text-[11px] text-amber-300">
                          · {t('tariffs.allInShort')}{' '}
                          {((tariffItem.baseRateEur ?? 0) + itemContribSummary.perKwhTtcEur).toFixed(4)} € {ttcLabel}
                        </span>
                      )}
                    </div>
                  ) : tariffItem.mode === 'TEMPO' ? (
                    <>
                      <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2 font-mono text-[11px] text-slate-200 space-y-1">
                        <div>
                          <span className="text-slate-400 mr-1.5">{ttcLabel}:</span>
                          {t('tariffs.tempoRatesSummary', {
                            bHp: (tariffItem.tempoConfig?.blueHpRateEur ?? DEFAULT_TEMPO_CONFIG.blueHpRateEur).toFixed(4),
                            bHc: (tariffItem.tempoConfig?.blueHcRateEur ?? DEFAULT_TEMPO_CONFIG.blueHcRateEur).toFixed(4),
                            wHp: (tariffItem.tempoConfig?.whiteHpRateEur ?? DEFAULT_TEMPO_CONFIG.whiteHpRateEur).toFixed(4),
                            wHc: (tariffItem.tempoConfig?.whiteHcRateEur ?? DEFAULT_TEMPO_CONFIG.whiteHcRateEur).toFixed(4),
                            rHp: (tariffItem.tempoConfig?.redHpRateEur ?? DEFAULT_TEMPO_CONFIG.redHpRateEur).toFixed(4),
                            rHc: (tariffItem.tempoConfig?.redHcRateEur ?? DEFAULT_TEMPO_CONFIG.redHcRateEur).toFixed(4),
                          })}
                        </div>
                        <div className="text-slate-400">
                          <span className="mr-1.5">{htLabel}:</span>
                          {t('tariffs.tempoRatesSummary', {
                            bHp: kwhTtcToHt(tariffItem.tempoConfig?.blueHpRateEur ?? DEFAULT_TEMPO_CONFIG.blueHpRateEur, vatPct).toFixed(4),
                            bHc: kwhTtcToHt(tariffItem.tempoConfig?.blueHcRateEur ?? DEFAULT_TEMPO_CONFIG.blueHcRateEur, vatPct).toFixed(4),
                            wHp: kwhTtcToHt(tariffItem.tempoConfig?.whiteHpRateEur ?? DEFAULT_TEMPO_CONFIG.whiteHpRateEur, vatPct).toFixed(4),
                            wHc: kwhTtcToHt(tariffItem.tempoConfig?.whiteHcRateEur ?? DEFAULT_TEMPO_CONFIG.whiteHcRateEur, vatPct).toFixed(4),
                            rHp: kwhTtcToHt(tariffItem.tempoConfig?.redHpRateEur ?? DEFAULT_TEMPO_CONFIG.redHpRateEur, vatPct).toFixed(4),
                            rHc: kwhTtcToHt(tariffItem.tempoConfig?.redHcRateEur ?? DEFAULT_TEMPO_CONFIG.redHcRateEur, vatPct).toFixed(4),
                          })}
                        </div>
                        {itemContribSummary.perKwhTtcEur > 0 && (
                          <div className="text-amber-300">
                            <span className="mr-1.5">{t('tariffs.allInShort')} {ttcLabel}:</span>
                            {t('tariffs.tempoRatesSummary', {
                              bHp: ((tariffItem.tempoConfig?.blueHpRateEur ?? DEFAULT_TEMPO_CONFIG.blueHpRateEur) + itemContribSummary.perKwhTtcEur).toFixed(4),
                              bHc: ((tariffItem.tempoConfig?.blueHcRateEur ?? DEFAULT_TEMPO_CONFIG.blueHcRateEur) + itemContribSummary.perKwhTtcEur).toFixed(4),
                              wHp: ((tariffItem.tempoConfig?.whiteHpRateEur ?? DEFAULT_TEMPO_CONFIG.whiteHpRateEur) + itemContribSummary.perKwhTtcEur).toFixed(4),
                              wHc: ((tariffItem.tempoConfig?.whiteHcRateEur ?? DEFAULT_TEMPO_CONFIG.whiteHcRateEur) + itemContribSummary.perKwhTtcEur).toFixed(4),
                              rHp: ((tariffItem.tempoConfig?.redHpRateEur ?? DEFAULT_TEMPO_CONFIG.redHpRateEur) + itemContribSummary.perKwhTtcEur).toFixed(4),
                              rHc: ((tariffItem.tempoConfig?.redHcRateEur ?? DEFAULT_TEMPO_CONFIG.redHcRateEur) + itemContribSummary.perKwhTtcEur).toFixed(4),
                            })}
                          </div>
                        )}
                      </div>
                      <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2 text-slate-300">
                        {t('tariffs.hcSlotsList')}{' '}
                        <span className="font-mono">
                          {(tariffItem.hcSlots?.length ? tariffItem.hcSlots : [{ start: '22:00', end: '06:00' }])
                            .map((s) => `${s.start}–${s.end}`)
                            .join(', ')}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2">
                        <span className="text-amber-300">{t('tariffs.hpShort')} </span>
                        <span className="font-mono font-semibold text-white">
                          {formatKwhPair(tariffItem.hpRateEur ?? 0)}
                        </span>
                        {itemContribSummary.perKwhTtcEur > 0 && (
                          <span className="ml-2 font-mono text-[11px] text-amber-300">
                            · {t('tariffs.allInShort')}{' '}
                            {((tariffItem.hpRateEur ?? 0) + itemContribSummary.perKwhTtcEur).toFixed(4)} €
                          </span>
                        )}
                      </div>
                      <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2">
                        <span className="text-emerald-300">{t('tariffs.hcShort')} </span>
                        <span className="font-mono font-semibold text-white">
                          {formatKwhPair(tariffItem.hcRateEur ?? 0)}
                        </span>
                        {itemContribSummary.perKwhTtcEur > 0 && (
                          <span className="ml-2 font-mono text-[11px] text-amber-300">
                            · {t('tariffs.allInShort')}{' '}
                            {((tariffItem.hcRateEur ?? 0) + itemContribSummary.perKwhTtcEur).toFixed(4)} €
                          </span>
                        )}
                      </div>
                      <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2 text-slate-300">
                        {t('tariffs.hcSlotsList')}{' '}
                        <span className="font-mono">
                          {tariffItem.hcSlots.map((s) => `${s.start}–${s.end}`).join(', ')}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2 text-slate-400">
                    {t('tariffs.subscription')}{' '}
                    <span className="font-mono text-slate-200">
                      {subTtc.toFixed(2)} {t('common.perMonth')} {ttcLabel}
                    </span>
                    <span className="ml-1.5 font-mono text-[11px] text-slate-400">
                      ({subHt.toFixed(2)} € {htLabel})
                    </span>
                    {itemContribSummary.monthlyTtcEur > 0 && (
                      <span className="ml-2 font-mono text-[11px] text-sky-300">
                        · {t('tariffs.allInShort')} {fixedMonthlyTotalTtc.toFixed(2)} {t('common.perMonth')}
                      </span>
                    )}
                  </div>
                </div>

                {itemContribs.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="text-slate-400 font-medium flex items-center gap-1">
                      <Receipt className="h-3 w-3 text-amber-400" />
                      {t('tariffs.contributionsCardTitle')}
                    </span>
                    {itemContribs.map((c) => {
                      const cTtc = contributionHtToTtc(c.amountHtEur, c.vatRatePct);
                      const unitSuffix = c.kind === 'monthly' ? t('common.perMonth') : '€/kWh';
                      const dec = c.kind === 'monthly' ? 2 : 4;
                      const htDec = c.kind === 'per_kwh' && c.amountHtEur < 0.1 ? 5 : dec;
                      return (
                        <span
                          key={c.id}
                          className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 font-mono text-amber-100"
                        >
                          {c.name} : {cTtc.toFixed(dec)} {unitSuffix} {ttcLabel} ({c.amountHtEur.toFixed(htDec)} € {htLabel} · {c.vatRatePct}%)
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Comparateur instantané Base vs HP/HC vs EDF Tempo */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 h-fit space-y-4">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">{t('tariffs.simTitle')}</h3>
          </div>
          <p className="text-xs text-slate-400">
            {t('tariffs.simDesc', {
              kwh: comparator.totalKwh.toFixed(2),
              mode: comparator.exactFromBuckets ? t('tariffs.simExact') : t('tariffs.simEst35'),
            })}
          </p>
          {(comparator.perKwhContribTtc > 0 || comparator.fixedPeriodTtc > 0) && (
            <p className="text-[11px] text-amber-300/90">
              {t('tariffs.simIncludesTaxesNote', {
                fixed: comparator.fixedPeriodTtc.toFixed(2),
              })}
            </p>
          )}

          <div className="space-y-2.5 text-xs">
            <div
              className={`rounded-xl border p-3 flex justify-between items-center ${comparator.cheapest === 'BASE'
                  ? 'border-emerald-500/40 bg-emerald-950/15'
                  : 'border-slate-800 bg-slate-950/60'
                }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-indigo-300">{t('tariffs.simBaseLabel')}</span>
                  {comparator.cheapest === 'BASE' && (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                      {t('tariffs.simBestChoice')}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  {comparator.baseRate.toFixed(4)} €/kWh
                </div>
              </div>
              <div className="text-base font-bold font-mono text-white">
                {comparator.baseCost.toFixed(2)} €
              </div>
            </div>

            <div
              className={`rounded-xl border p-3 flex justify-between items-center ${comparator.cheapest === 'HP_HC'
                  ? 'border-emerald-500/40 bg-emerald-950/15'
                  : 'border-slate-800 bg-slate-950/60'
                }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-emerald-300">{t('tariffs.simHpHcLabel')}</span>
                  {comparator.cheapest === 'HP_HC' && (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                      {t('tariffs.simBestChoice')}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  {t('tariffs.simSubSplit', {
                    hcPct: comparator.hcPct.toFixed(0),
                    hcRate: comparator.hcRate.toFixed(4),
                    hpPct: (100 - comparator.hcPct).toFixed(0),
                    hpRate: comparator.hpRate.toFixed(4),
                  })}
                </div>
              </div>
              <div className="text-base font-bold font-mono text-white">
                {comparator.hpHcCost.toFixed(2)} €
              </div>
            </div>

            <div
              className={`rounded-xl border p-3 flex justify-between items-center ${comparator.cheapest === 'TEMPO'
                  ? 'border-emerald-500/40 bg-emerald-950/15'
                  : 'border-slate-800 bg-slate-950/60'
                }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sky-300">{t('tariffs.simTempoLabel')}</span>
                  {comparator.cheapest === 'TEMPO' && (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                      {t('tariffs.simBestChoice')}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  {t('tariffs.simTempoSub', {
                    hcRate: comparator.weightedTempoHc.toFixed(4),
                    hpRate: comparator.weightedTempoHp.toFixed(4),
                  })}
                </div>
              </div>
              <div className="text-base font-bold font-mono text-white">
                {comparator.tempoCost.toFixed(2)} €
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs flex items-center gap-2">
            <Euro className="h-4 w-4 text-indigo-400 shrink-0" />
            {comparator.cheapest === 'TEMPO' ? (
              <span className="text-sky-300">
                {t('tariffs.simTempoLabel')} · {t('tariffs.simBestChoice')} (−
                {comparator.bestSavingsVsBase.toFixed(2)} €)
              </span>
            ) : comparator.cheapest === 'HP_HC' ? (
              <span className="text-emerald-300">
                {t('tariffs.simSavingsHpHc', { diff: comparator.bestSavingsVsBase.toFixed(2) })}
              </span>
            ) : (
              <span className="text-indigo-200">
                {t('tariffs.simSavingsBase', {
                  diff: Math.max(
                    0,
                    Math.min(comparator.hpHcCost, comparator.tempoCost) - comparator.baseCost
                  ).toFixed(2),
                })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
