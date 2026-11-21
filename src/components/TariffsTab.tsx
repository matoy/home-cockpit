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
} from 'lucide-react';
import { isTimeInHcSlot } from '@/lib/tariff-engine';
import type { DashboardPayload, HcSlot, TariffMode, TariffPeriodRecord } from '@/types';

interface TariffsTabProps {
  data: DashboardPayload;
  onRefresh: () => Promise<void>;
}

const HC_PRESETS: Array<{ label: string; slots: HcSlot[] }> = [
  { label: 'Nuit classique (22h00 – 06h00)', slots: [{ start: '22:00', end: '06:00' }] },
  { label: 'Nuit tardive (23h00 – 07h00)', slots: [{ start: '23:00', end: '07:00' }] },
  {
    label: 'Méridienne + Nuit (12h30–14h30 & 01h30–07h30)',
    slots: [
      { start: '12:30', end: '14:30' },
      { start: '01:30', end: '07:30' },
    ],
  },
];

interface TariffFormState {
  id: number | null;
  label: string;
  startDate: string;
  endDate: string;
  mode: TariffMode;
  baseRateEur: string;
  hpRateEur: string;
  hcRateEur: string;
  hcSlots: HcSlot[];
  monthlySubscriptionEur: string;
}

function emptyForm(): TariffFormState {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: null,
    label: '',
    startDate: today,
    endDate: '',
    mode: 'BASE',
    baseRateEur: '0.2016',
    hpRateEur: '0.2146',
    hcRateEur: '0.1696',
    hcSlots: [{ start: '22:00', end: '06:00' }],
    monthlySubscriptionEur: '14.18',
  };
}

export function TariffsTab({ data, onRefresh }: TariffsTabProps) {
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

  // Comparateur instantané Base vs HP/HC sur la consommation de la période
  const comparator = useMemo(() => {
    const totalKwh = data.kpis.periodEnergyKwh;
    const baseRate = activeTariff?.baseRateEur ?? 0.2016;
    const hpRate = activeTariff?.hpRateEur ?? 0.2146;
    const hcRate = activeTariff?.hcRateEur ?? 0.1696;
    const slots = activeTariff?.hcSlots?.length ? activeTariff.hcSlots : [{ start: '22:00', end: '06:00' }];

    let hcKwh = 0;
    let hpKwh = 0;
    let exactFromBuckets = false;

    if ((data.range === '24h' || data.range === '7d') && data.timeSeries.length > 0) {
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

    const baseCost = totalKwh * baseRate;
    const hpHcCost = hpKwh * hpRate + hcKwh * hcRate;
    const diff = baseCost - hpHcCost;

    return {
      totalKwh,
      hcKwh,
      hpKwh,
      hcPct: totalKwh > 0 ? (hcKwh / totalKwh) * 100 : 0,
      baseRate,
      hpRate,
      hcRate,
      baseCost,
      hpHcCost,
      diff,
      exactFromBuckets,
    };
  }, [data.kpis.periodEnergyKwh, data.range, data.timeSeries, activeTariff]);

  function startEdit(t: TariffPeriodRecord) {
    setForm({
      id: t.id,
      label: t.label,
      startDate: t.startDate,
      endDate: t.endDate ?? '',
      mode: t.mode,
      baseRateEur: String(t.baseRateEur ?? 0.2016),
      hpRateEur: String(t.hpRateEur ?? 0.2146),
      hcRateEur: String(t.hcRateEur ?? 0.1696),
      hcSlots: t.hcSlots?.length ? t.hcSlots : [{ start: '22:00', end: '06:00' }],
      monthlySubscriptionEur: String(t.monthlySubscriptionEur ?? 0),
    });
    setShowForm(true);
    setError(null);
  }

  function startNew() {
    setForm(emptyForm());
    setShowForm(true);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      id: form.id ?? undefined,
      label: form.label.trim(),
      startDate: form.startDate,
      endDate: form.endDate.trim() || null,
      mode: form.mode,
      baseRateEur: Number(form.baseRateEur) || null,
      hpRateEur: Number(form.hpRateEur) || null,
      hcRateEur: Number(form.hcRateEur) || null,
      hcSlots: form.mode === 'HP_HC' ? form.hcSlots : [],
      monthlySubscriptionEur: Number(form.monthlySubscriptionEur) || 0,
    };

    try {
      const res = await fetch('/api/tariffs', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Erreur lors de la sauvegarde');
      }
      setShowForm(false);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
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
            Historique &amp; Plages Tarifaires (kWh)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Gérez l&apos;évolution annuelle de vos prix du kWh (Base ou HP/HC). Lorsqu&apos;un nouveau tarif
            commence sans date de fin, le tarif précédent est clôturé automatiquement la veille.
          </p>
        </div>

        <button
          onClick={startNew}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-medium text-white transition"
        >
          <Plus className="h-4 w-4" />
          Nouveau tarif / changement de prix
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
              {form.id ? 'Modifier la période tarifaire' : 'Ajouter une nouvelle période tarifaire'}
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
                Nom du tarif *
              </label>
              <input
                type="text"
                required
                placeholder="ex: Tarif Bleu EDF Fév. 2026"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Date de début *
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
                Date de fin (vide = en cours)
              </label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Sélecteur visuel Base vs HP/HC */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-2">
              Option tarifaire
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, mode: 'BASE' })}
                className={`rounded-xl border p-3.5 text-left transition ${
                  form.mode === 'BASE'
                    ? 'border-indigo-500 bg-indigo-500/15 text-white'
                    : 'border-slate-700 bg-slate-950/60 text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">Option Base (Tarif unique 24h/24)</span>
                  {form.mode === 'BASE' && <Check className="h-4 w-4 text-indigo-400" />}
                </div>
                <p className="mt-1 text-[11px] opacity-80">
                  Un seul prix fixe par kWh quelle que soit l&apos;heure.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setForm({ ...form, mode: 'HP_HC' })}
                className={`rounded-xl border p-3.5 text-left transition ${
                  form.mode === 'HP_HC'
                    ? 'border-emerald-500 bg-emerald-500/15 text-white'
                    : 'border-slate-700 bg-slate-950/60 text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">Heures Pleines / Heures Creuses</span>
                  {form.mode === 'HP_HC' && <Check className="h-4 w-4 text-emerald-400" />}
                </div>
                <p className="mt-1 text-[11px] opacity-80">
                  Tarif réduit pendant vos plages horaires creuses configurées.
                </p>
              </button>
            </div>
          </div>

          {/* Prix du kWh selon le mode */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {form.mode === 'BASE' ? (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Prix Base TTC (€ / kWh) *
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
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-amber-300 mb-1.5">
                    Prix Heures Pleines (€ / kWh) *
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
                </div>
                <div>
                  <label className="block text-xs font-medium text-emerald-300 mb-1.5">
                    Prix Heures Creuses (€ / kWh) *
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
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Abonnement mensuel (€ / mois)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.monthlySubscriptionEur}
                onChange={(e) => setForm({ ...form, monthlySubscriptionEur: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Éditeur de plages HC */}
          {form.mode === 'HP_HC' && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-emerald-400" />
                  Plages d&apos;Heures Creuses (gère le passage à minuit)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {HC_PRESETS.map((preset) => (
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
                    <span className="text-xs text-slate-400">De</span>
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
                    <span className="text-xs text-slate-400">à</span>
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
                  + Ajouter une plage horaire
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
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2 text-xs font-medium text-white"
            >
              {saving ? 'Enregistrement...' : 'Enregistrer le tarif'}
            </button>
          </div>
        </form>
      )}

      {/* Frise chronologique des tarifs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {sortedTariffs.map((t) => {
            const isCurrent = activeTariff?.id === t.id;
            return (
              <div
                key={t.id}
                className={`rounded-2xl border p-5 transition ${
                  isCurrent
                    ? 'border-emerald-500/40 bg-emerald-950/10'
                    : 'border-slate-800 bg-slate-900/70'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">{t.label}</h3>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                          t.mode === 'HP_HC'
                            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                            : 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                        }`}
                      >
                        {t.mode === 'HP_HC' ? 'HP / HC' : 'BASE'}
                      </span>
                      {isCurrent && (
                        <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                          Tarif actif
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-400 flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      Du <span className="text-slate-200 font-mono">{t.startDate}</span>{' '}
                      {t.endDate ? (
                        <>
                          au <span className="text-slate-200 font-mono">{t.endDate}</span>
                        </>
                      ) : (
                        <span className="text-emerald-400">(en cours)</span>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => startEdit(t)}
                      className="rounded-lg border border-slate-700 bg-slate-800/80 p-2 text-slate-300 hover:text-white"
                      title="Modifier"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="rounded-lg border border-slate-700 bg-slate-800/80 p-2 text-rose-400 hover:bg-rose-500/15"
                      title="Supprimer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-4 text-xs">
                  {t.mode === 'BASE' ? (
                    <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2">
                      <span className="text-slate-400">Prix unique : </span>
                      <span className="font-mono font-semibold text-white">
                        {(t.baseRateEur ?? 0).toFixed(4)} €/kWh
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2">
                        <span className="text-amber-300">HP : </span>
                        <span className="font-mono font-semibold text-white">
                          {(t.hpRateEur ?? 0).toFixed(4)} €/kWh
                        </span>
                      </div>
                      <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2">
                        <span className="text-emerald-300">HC : </span>
                        <span className="font-mono font-semibold text-white">
                          {(t.hcRateEur ?? 0).toFixed(4)} €/kWh
                        </span>
                      </div>
                      <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2 text-slate-300">
                        Plages HC :{' '}
                        <span className="font-mono">
                          {t.hcSlots.map((s) => `${s.start}–${s.end}`).join(', ')}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2 text-slate-400">
                    Abonnement :{' '}
                    <span className="font-mono text-slate-200">
                      {(t.monthlySubscriptionEur ?? 0).toFixed(2)} €/mois
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Comparateur instantané Base vs HP/HC */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 h-fit space-y-4">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Simulateur Base vs HP/HC</h3>
          </div>
          <p className="text-xs text-slate-400">
            Comparaison sur vos{' '}
            <span className="text-white font-semibold">{comparator.totalKwh.toFixed(2)} kWh</span>{' '}
            mesurés sur la période ({comparator.exactFromBuckets ? 'horodatage réel' : 'estimation 35% HC'}).
          </p>

          <div className="space-y-2.5 text-xs">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex justify-between items-center">
              <div>
                <div className="font-medium text-indigo-300">Option Base</div>
                <div className="text-[11px] text-slate-500">
                  {comparator.baseRate.toFixed(4)} €/kWh
                </div>
              </div>
              <div className="text-base font-bold font-mono text-white">
                {comparator.baseCost.toFixed(2)} €
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex justify-between items-center">
              <div>
                <div className="font-medium text-emerald-300">Option HP / HC</div>
                <div className="text-[11px] text-slate-500">
                  {comparator.hcPct.toFixed(0)}% HC ({comparator.hcRate.toFixed(4)}€) ·{' '}
                  {(100 - comparator.hcPct).toFixed(0)}% HP ({comparator.hpRate.toFixed(4)}€)
                </div>
              </div>
              <div className="text-base font-bold font-mono text-white">
                {comparator.hpHcCost.toFixed(2)} €
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs flex items-center gap-2">
            <Euro className="h-4 w-4 text-indigo-400 shrink-0" />
            {comparator.diff > 0.01 ? (
              <span className="text-emerald-300">
                Le mode HP/HC économiserait{' '}
                <strong>{comparator.diff.toFixed(2)} €</strong> sur cette période.
              </span>
            ) : (
              <span className="text-indigo-200">
                L&apos;option <strong>Base</strong> est plus avantageuse de{' '}
                <strong>{Math.abs(comparator.diff).toFixed(2)} €</strong> sur cette période.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
