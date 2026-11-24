'use client';

import { BookOpen, ExternalLink, RefreshCw } from 'lucide-react';
import { VENDOR_REGISTRY } from '@/lib/vendors/registry';
import { useI18n } from '@/components/I18nProvider';
import type { VendorConnectionSummary } from '@/types';

interface DaikinVendorCardProps {
  mode: 'live' | 'demo';
  summary?: VendorConnectionSummary;
  devicesCount: number;
  isConnected: boolean;
  showLocalBox: boolean;
  onToggleLocalBox: () => void;
  exchangeInput: string;
  onExchangeInputChange: (val: string) => void;
  exchanging: boolean;
  onExchangeCode: () => void;
  syncing: boolean;
  disconnecting: boolean;
  onSync: () => void;
  onDisconnect: () => void;
  onOpenGuide?: () => void;
}

export function DaikinVendorCard({
  mode,
  summary,
  devicesCount,
  isConnected,
  showLocalBox,
  onToggleLocalBox,
  exchangeInput,
  onExchangeInputChange,
  exchanging,
  onExchangeCode,
  syncing,
  disconnecting,
  onSync,
  onDisconnect,
  onOpenGuide,
}: DaikinVendorCardProps) {
  const { t, intlLocale } = useI18n();

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_REGISTRY.daikin.badgeClass}`}
          >
            {VENDOR_REGISTRY.daikin.label}
          </span>
          <span className="text-xs text-slate-400">
            {t('common.devicesCount', {
              count: summary?.devicesCount ?? devicesCount,
            })}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isConnected || mode === 'demo'
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {mode === 'demo'
              ? t('common.demoMode')
              : isConnected
                ? t('systems.daikinConnectedOAuth')
                : t('common.readyOAuth')}
          </span>
        </div>
        <p className="text-xs text-slate-400">
          {VENDOR_REGISTRY.daikin.description}. {t('systems.daikinDesc')}
        </p>
        {summary?.lastError && (
          <p className="text-[11px] text-amber-300">{summary.lastError}</p>
        )}
        {mode === 'live' && !isConnected && (
          <div className="pt-1">
            <button
              type="button"
              onClick={onToggleLocalBox}
              className="text-[11px] font-medium text-blue-300 hover:text-blue-200 underline underline-offset-2"
            >
              {showLocalBox ? t('systems.daikinLocalHide') : t('systems.daikinLocalShow')}
            </button>
            {showLocalBox && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
                <input
                  type="text"
                  value={exchangeInput}
                  onChange={(e) => onExchangeInputChange(e.target.value)}
                  placeholder={t('systems.daikinExchangePlaceholder')}
                  className="flex-1 min-w-[200px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={exchanging || !exchangeInput.trim()}
                  onClick={onExchangeCode}
                  className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-3 py-1.5 text-[11px] font-medium text-white transition"
                >
                  {exchanging ? t('common.validating') : t('common.validate')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-[11px] text-slate-500">
          {summary?.lastSyncedAt
            ? t('common.syncedAt', {
                date: new Date(summary.lastSyncedAt).toLocaleString(intlLocale),
              })
            : t('systems.daikinFooterDefault')}
        </span>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenGuide && (
            <button
              type="button"
              onClick={onOpenGuide}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
              title={t('common.setupGuideBtn')}
            >
              <BookOpen className="h-3.5 w-3.5 text-blue-400" />
              {t('common.setupGuideBtn')}
            </button>
          )}

          {mode === 'live' && !isConnected ? (
            <a
              href="/api/vendors/daikin/oauth/start?returnTab=systems"
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 px-3.5 py-2 text-xs font-medium text-white transition"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('systems.daikinConnectBtn')}
            </a>
          ) : (
            <>
              <button
                type="button"
                onClick={onSync}
                disabled={syncing || disconnecting}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? t('common.syncing') : t('systems.syncDaikinBtn')}
              </button>
              {mode === 'live' && isConnected && (
                <button
                  type="button"
                  onClick={onDisconnect}
                  disabled={disconnecting || syncing}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 disabled:opacity-50 px-3 py-2 text-xs text-slate-300 transition"
                >
                  {t('common.disconnect')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
