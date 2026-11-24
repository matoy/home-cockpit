'use client';

import { BookOpen, QrCode, RefreshCw } from 'lucide-react';
import { VENDOR_REGISTRY } from '@/lib/vendors/registry';
import { useI18n } from '@/components/I18nProvider';
import type { VendorConnectionSummary } from '@/types';

interface XiaomiQrData {
  qrImageUrl: string;
  loginUrl: string;
  qrStateToken: string;
}

interface XiaomiVendorCardProps {
  mode: 'live' | 'demo';
  summary?: VendorConnectionSummary;
  devicesCount: number;
  isConnected: boolean;
  xiaomiConfigured: boolean;
  region: string;
  onRegionChange: (region: string) => void;
  showAuthBox: boolean;
  onToggleAuthBox: () => void;
  qrData: XiaomiQrData | null;
  onCancelQr: () => void;
  startingQr: boolean;
  onStartQr: () => void;
  username: string;
  onUsernameChange: (val: string) => void;
  password: string;
  onPasswordChange: (val: string) => void;
  loggingIn: boolean;
  onCredentialLogin: () => void;
  twoFaToken: string | null;
  twoFaCode: string;
  onTwoFaCodeChange: (val: string) => void;
  verifying2fa: boolean;
  onVerify2fa: () => void;
  syncing: boolean;
  disconnecting: boolean;
  onSync: () => void;
  onDisconnect: () => void;
  onOpenGuide?: () => void;
}

export function XiaomiVendorCard({
  mode,
  summary,
  devicesCount,
  isConnected,
  xiaomiConfigured,
  region,
  onRegionChange,
  showAuthBox,
  onToggleAuthBox,
  qrData,
  onCancelQr,
  startingQr,
  onStartQr,
  username,
  onUsernameChange,
  password,
  onPasswordChange,
  loggingIn,
  onCredentialLogin,
  twoFaToken,
  twoFaCode,
  onTwoFaCodeChange,
  verifying2fa,
  onVerify2fa,
  syncing,
  disconnecting,
  onSync,
  onDisconnect,
  onOpenGuide,
}: XiaomiVendorCardProps) {
  const { t, intlLocale } = useI18n();

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_REGISTRY.xiaomi.badgeClass}`}
          >
            {VENDOR_REGISTRY.xiaomi.label}
          </span>
          <span className="text-xs text-slate-400">
            {t('common.devicesCount', {
              count: summary?.devicesCount ?? devicesCount,
            })}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              mode === 'demo' || isConnected
                ? 'bg-emerald-500/15 text-emerald-300'
                : xiaomiConfigured
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-slate-800 text-slate-400'
            }`}
          >
            {mode === 'demo'
              ? t('common.demoMode')
              : isConnected
                ? `${t('common.connected')} (${region.toUpperCase()})`
                : xiaomiConfigured
                  ? t('systems.xiaomiReqAuth')
                  : t('systems.xiaomiQrOrEnv')}
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1.5">{t('systems.xiaomiDesc')}</p>
        {summary?.lastError && (
          <p className="text-[11px] text-amber-300 mt-1">{summary.lastError}</p>
        )}

        {(showAuthBox || !isConnected) && mode === 'live' && (
          <div className="mt-2.5 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={region}
                onChange={(e) => onRegionChange(e.target.value)}
                aria-label={t('systems.xiaomiServerAria')}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="de">{t('systems.xiaomiRegionDe')}</option>
                <option value="cn">{t('systems.xiaomiRegionCn')}</option>
                <option value="us">{t('systems.xiaomiRegionUs')}</option>
                <option value="sg">{t('systems.xiaomiRegionSg')}</option>
                <option value="ru">{t('systems.xiaomiRegionRu')}</option>
              </select>
              <button
                type="button"
                onClick={onStartQr}
                disabled={startingQr}
                className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/40 bg-orange-500/15 hover:bg-orange-500/25 px-2.5 py-1 text-[11px] font-medium text-orange-200 transition"
              >
                <QrCode className="h-3.5 w-3.5" />
                {startingQr ? t('systems.xiaomiQrGenerating') : t('systems.xiaomiQrScanBtn')}
              </button>
              <button
                type="button"
                onClick={onToggleAuthBox}
                className="text-[11px] text-slate-400 hover:text-slate-200 underline underline-offset-2"
              >
                {showAuthBox ? t('systems.xiaomiHideOpts') : t('systems.xiaomiAccountOpts')}
              </button>
            </div>

            {qrData && (
              <div className="rounded-xl border border-orange-500/30 bg-slate-950/80 p-3 flex flex-wrap items-center gap-3">
                <img
                  src={qrData.qrImageUrl}
                  alt="QR Code Xiaomi Home"
                  className="h-28 w-28 rounded-lg bg-white p-1"
                />
                <div className="space-y-1.5 text-[11px] text-slate-300 flex-1 min-w-[180px]">
                  <p className="font-medium text-orange-200">{t('systems.xiaomiQrTitle')}</p>
                  <p className="text-slate-400">{t('systems.xiaomiQrHelp')}</p>
                  <button
                    type="button"
                    onClick={onCancelQr}
                    className="text-slate-400 hover:text-white underline"
                  >
                    {t('systems.xiaomiQrCancel')}
                  </button>
                </div>
              </div>
            )}

            {showAuthBox && !qrData && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 space-y-2">
                {!twoFaToken ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => onUsernameChange(e.target.value)}
                      placeholder={t('systems.xiaomiUserPlaceholder')}
                      className="flex-1 min-w-[150px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white placeholder:text-slate-500"
                    />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => onPasswordChange(e.target.value)}
                      placeholder={t('systems.xiaomiPassPlaceholder')}
                      className="flex-1 min-w-[140px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      disabled={loggingIn}
                      onClick={onCredentialLogin}
                      className="rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 px-3 py-1.5 text-[11px] font-medium text-white transition"
                    >
                      {loggingIn ? t('systems.xiaomiConnecting') : t('systems.xiaomiConnectBtn')}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={twoFaCode}
                      onChange={(e) => onTwoFaCodeChange(e.target.value)}
                      placeholder={t('systems.xiaomi2faPlaceholder')}
                      className="flex-1 min-w-[180px] rounded-lg border border-orange-500/40 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      disabled={verifying2fa || !twoFaCode.trim()}
                      onClick={onVerify2fa}
                      className="rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 px-3 py-1.5 text-[11px] font-medium text-white transition"
                    >
                      {verifying2fa ? t('common.validating') : t('systems.xiaomi2faValidateBtn')}
                    </button>
                  </div>
                )}
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
            : t('systems.xiaomiFooterDefault')}
        </span>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenGuide && (
            <button
              type="button"
              onClick={onOpenGuide}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
            >
              <BookOpen className="h-3.5 w-3.5 text-orange-400" />
              {t('common.setupGuideBtn')}
            </button>
          )}
          {(mode === 'demo' || isConnected) && (
            <button
              type="button"
              onClick={onSync}
              disabled={syncing || disconnecting}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? t('common.syncing') : t('systems.syncXiaomiBtn')}
            </button>
          )}
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
        </div>
      </div>
    </div>
  );
}
