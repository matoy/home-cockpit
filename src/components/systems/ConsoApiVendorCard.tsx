'use client';

import { useState } from 'react';
import { BookOpen, Gauge, KeyRound, RefreshCw, Unplug } from 'lucide-react';
import { VENDOR_REGISTRY } from '@/lib/vendors/registry';
import { useI18n } from '@/components/I18nProvider';
import type { LinkyMeterSummary, VendorConnectionSummary } from '@/types';

const SUBSCRIBED_KVA_OPTIONS = [3, 6, 9, 12, 15, 18, 24, 30, 36] as const;

interface ConsoApiVendorCardProps {
  mode: 'live' | 'demo';
  summary?: VendorConnectionSummary;
  configured: boolean;
  connected: boolean;
  prmMasked: string | null;
  subscribedKva: number | null;
  meter?: LinkyMeterSummary;
  syncing: boolean;
  disconnecting: boolean;
  savingConfig: boolean;
  onSaveConfig: (input: { prm: string; token?: string; subscribedKva: number | null }) => Promise<boolean>;
  onSync: () => void;
  onDisconnect: () => void;
  onOpenGuide?: () => void;
}

export function ConsoApiVendorCard({
  mode,
  summary,
  configured,
  connected,
  prmMasked,
  subscribedKva,
  meter,
  syncing,
  disconnecting,
  savingConfig,
  onSaveConfig,
  onSync,
  onDisconnect,
  onOpenGuide,
}: ConsoApiVendorCardProps) {
  const { t, intlLocale } = useI18n();
  const [showConfigBox, setShowConfigBox] = useState(!configured && mode === 'live');
  const [prmInput, setPrmInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [kvaInput, setKvaInput] = useState<string>(subscribedKva ? String(subscribedKva) : '');

  const meta = VENDOR_REGISTRY.conso_api;
  const effectiveConnected = mode === 'demo' ? connected : Boolean(configured && connected);

  async function handleSubmitConfig(e: React.FormEvent) {
    e.preventDefault();
    const ok = await onSaveConfig({
      prm: prmInput.trim(),
      token: tokenInput.trim() || undefined,
      subscribedKva: kvaInput ? Number(kvaInput) : null,
    });
    if (ok) {
      setTokenInput('');
      setShowConfigBox(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}>
            {meta.label}
          </span>
          {prmMasked && (
            <span className="text-[11px] font-mono text-slate-300">
              PRM {prmMasked}
            </span>
          )}
          {subscribedKva && (
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[10px] font-mono text-slate-300">
              <Gauge className="h-2.5 w-2.5 text-lime-400" />
              {subscribedKva} kVA
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              effectiveConnected
                ? 'bg-emerald-500/15 text-emerald-300'
                : configured
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-slate-800 text-slate-400'
            }`}
          >
            {mode === 'demo'
              ? t('common.demoMode')
              : effectiveConnected
                ? t('common.connected')
                : configured
                  ? t('common.configured')
                  : t('common.notConfigured')}
          </span>
        </div>

        <p className="text-xs text-slate-400">{t('consoApi.cardDesc')}</p>

        {meter?.lastPublishedDate && (
          <p className="text-[11px] text-lime-300">
            {t('consoApi.lastPublishedLabel', { date: meter.lastPublishedDate })}
            {meter.measuredCoveragePct !== null && (
              <span className="text-slate-400">
                {' '}
                · {t('consoApi.coverageInline', { pct: meter.measuredCoveragePct.toFixed(0) })}
              </span>
            )}
          </p>
        )}

        {summary?.lastError && (
          <p className="text-[11px] text-amber-300">{summary.lastError}</p>
        )}

        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowConfigBox((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-lime-300 hover:text-lime-200 underline underline-offset-2"
          >
            <KeyRound className="h-3 w-3" />
            {showConfigBox ? t('consoApi.hideConfigBtn') : t('consoApi.showConfigBtn')}
          </button>

          {showConfigBox && (
            <form
              onSubmit={(e) => void handleSubmitConfig(e)}
              className="mt-2.5 space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    {t('consoApi.prmLabel')}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={14}
                    value={prmInput}
                    onChange={(e) => setPrmInput(e.target.value.replace(/\D/g, '').slice(0, 14))}
                    placeholder={prmMasked || '12345678901234'}
                    required
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-mono text-white placeholder:text-slate-500 focus:border-lime-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    {t('consoApi.kvaLabel')}
                  </label>
                  <select
                    value={kvaInput}
                    onChange={(e) => setKvaInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-lime-500 focus:outline-none"
                  >
                    <option value="">{t('consoApi.kvaOptional')}</option>
                    {SUBSCRIBED_KVA_OPTIONS.map((kva) => (
                      <option key={kva} value={String(kva)}>
                        {kva} kVA
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  {t('consoApi.tokenLabel')}
                </label>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder={configured ? t('consoApi.tokenKeepPlaceholder') : t('consoApi.tokenPlaceholder')}
                  required={!configured}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-mono text-white placeholder:text-slate-500 focus:border-lime-500 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <span className="text-[10.5px] text-slate-500">{t('consoApi.quotaHint')}</span>
                <button
                  type="submit"
                  disabled={savingConfig || prmInput.trim().length !== 14}
                  className="rounded-lg bg-lime-600 hover:bg-lime-500 disabled:opacity-40 px-3 py-1.5 text-[11px] font-medium text-white transition"
                >
                  {savingConfig ? t('common.saving') : t('consoApi.saveConfigBtn')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-[11px] text-slate-500">
          {summary?.lastSyncedAt
            ? t('common.syncedAt', {
                date: new Date(summary.lastSyncedAt).toLocaleString(intlLocale),
              })
            : t('consoApi.footerDefault')}
        </span>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenGuide && (
            <button
              type="button"
              onClick={onOpenGuide}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
            >
              <BookOpen className="h-3.5 w-3.5 text-lime-400" />
              {t('common.setupGuideBtn')}
            </button>
          )}

          {mode === 'live' && configured && (
            <button
              type="button"
              onClick={onDisconnect}
              disabled={disconnecting}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-50 px-3 py-2 text-xs text-slate-300 transition"
            >
              <Unplug className="h-3.5 w-3.5" />
              {t('common.disconnect')}
            </button>
          )}

          {(configured || mode === 'demo') && (
            <button
              type="button"
              onClick={onSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 rounded-xl bg-lime-600 hover:bg-lime-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? t('common.syncing') : t('consoApi.syncBtn')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
