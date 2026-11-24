'use client';

import { BookOpen, ExternalLink, RefreshCw } from 'lucide-react';
import { VENDOR_REGISTRY } from '@/lib/vendors/registry';
import { useI18n } from '@/components/I18nProvider';
import type { GoogleHomeMode, VendorConnectionSummary } from '@/types';

interface GoogleHomeVendorCardProps {
  mode: 'live' | 'demo';
  summary?: VendorConnectionSummary;
  devicesCount: number;
  isConnected: boolean;
  googleHomeConfigured: boolean;
  selectedMode: GoogleHomeMode;
  onModeChange: (nextMode: GoogleHomeMode) => void;
  syncing: boolean;
  disconnecting: boolean;
  onSync: () => void;
  onDisconnect: () => void;
  onOpenGuide?: () => void;
}

export function GoogleHomeVendorCard({
  mode,
  summary,
  devicesCount,
  isConnected,
  googleHomeConfigured,
  selectedMode,
  onModeChange,
  syncing,
  disconnecting,
  onSync,
  onDisconnect,
  onOpenGuide,
}: GoogleHomeVendorCardProps) {
  const { t, intlLocale } = useI18n();

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="w-full">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_REGISTRY.google_home.badgeClass}`}
              >
                {VENDOR_REGISTRY.google_home.label}
              </span>
              <span className="text-xs text-slate-400">
                {t('common.devicesCount', {
                  count: summary?.devicesCount ?? devicesCount,
                })}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  isConnected
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {mode === 'demo'
                  ? t('common.demoMode')
                  : isConnected
                    ? `${t('common.connected')} (${(summary?.mode ?? selectedMode).toString().toUpperCase()})`
                    : googleHomeConfigured
                      ? t('common.readyOAuth')
                      : t('common.oauthNotConfigured')}
              </span>
            </div>

            {!isConnected && mode === 'live' && (
              <select
                value={selectedMode}
                onChange={(e) => onModeChange(e.target.value as GoogleHomeMode)}
                aria-label={t('systems.ghModeAria')}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
              >
                <option value="mcp">{t('systems.ghModeMcp')}</option>
                <option value="sdm">{t('systems.ghModeSdm')}</option>
              </select>
            )}
          </div>

          <p className="text-xs text-slate-400 mt-2">
            {VENDOR_REGISTRY.google_home.description}. {t('systems.ghDesc')}
          </p>

          {summary?.lastError && (
            <p className="text-[11px] text-rose-300 mt-1.5">{summary.lastError}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-[11px] text-slate-500">
          {summary?.lastSyncedAt
            ? t('common.syncedAt', {
                date: new Date(summary.lastSyncedAt).toLocaleString(intlLocale),
              })
            : mode === 'live' && !googleHomeConfigured
              ? t('systems.ghMissingEnv')
              : t('common.readOnlyZeroCmd')}
        </span>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenGuide && (
            <button
              type="button"
              onClick={onOpenGuide}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
              title={t('common.setupGuideBtn')}
            >
              <BookOpen className="h-3.5 w-3.5 text-sky-400" />
              {t('common.setupGuideBtn')}
            </button>
          )}
          {mode === 'live' && !isConnected ? (
            <a
              href={`/api/vendors/google-home/oauth/start?mode=${selectedMode}&returnTab=systems`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 px-3.5 py-2 text-xs font-medium text-white transition"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('systems.ghConnectBtn', { mode: selectedMode.toUpperCase() })}
            </a>
          ) : (
            <>
              <button
                type="button"
                onClick={onSync}
                disabled={syncing || disconnecting}
                className="inline-flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? t('common.syncing') : t('systems.syncGhBtn')}
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
