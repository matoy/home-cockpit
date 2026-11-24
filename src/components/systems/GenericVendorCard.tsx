'use client';

import { RefreshCw } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { VENDOR_REGISTRY } from '@/lib/vendors/registry';
import type { VendorConnectionSummary, VendorId } from '@/types';

interface GenericVendorCardProps {
  vendorId: VendorId;
  summary: VendorConnectionSummary | undefined;
  devicesCount: number;
  mode: 'live' | 'demo';
  isSyncing: boolean;
  isDisconnecting: boolean;
  onSync: (vendorId: VendorId) => void;
  onDisconnect: (vendorId: VendorId) => void;
}

/**
 * Carte générique de synchronisation et déconnexion pour tout nouveau fournisseur modulaire.
 */
export function GenericVendorCard({
  vendorId,
  summary,
  devicesCount,
  mode,
  isSyncing,
  isDisconnecting,
  onSync,
  onDisconnect,
}: GenericVendorCardProps) {
  const { t, intlLocale } = useI18n();
  const meta = VENDOR_REGISTRY[vendorId];
  const isConnected = Boolean(summary?.connected);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}
          >
            {meta.label}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${isConnected
              ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
              : 'border-slate-700 bg-slate-950/60 text-slate-400'
              }`}
          >
            {isConnected ? t('common.connected') : t('common.configured')}
          </span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
            {t('common.devicesCount', { count: devicesCount })}
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1">{meta.description}</p>
        {summary?.lastError && (
          <p className="text-[11px] text-rose-300">{summary.lastError}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-[11px] text-slate-500">
          {summary?.lastSyncedAt
            ? t('common.syncedAt', {
              date: new Date(summary.lastSyncedAt).toLocaleString(intlLocale),
            })
            : t('common.readOnlyZeroCmd')}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onSync(vendorId)}
            disabled={isSyncing || isDisconnecting}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing
              ? t('common.syncing')
              : t('systems.syncVendorBtn', { vendor: meta.shortLabel })}
          </button>
          {mode === 'live' &&
            isConnected &&
            meta.capabilities.supportsDisconnect &&
            meta.disconnectEndpoint && (
              <button
                type="button"
                onClick={() => onDisconnect(vendorId)}
                disabled={isDisconnecting || isSyncing}
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
