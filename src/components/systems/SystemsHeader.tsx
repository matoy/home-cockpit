'use client';

import { Cpu, Plug } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';

interface SystemsHeaderProps {
  mode: 'live' | 'demo';
  connectedSystemsCount: number;
  visibleSyncCardsCount: number;
  totalDevicesCount: number;
  onOpenDevicesTab?: () => void;
}

/**
 * En-tête synthétique de l'onglet Systèmes affichant le mode actif et les compteurs connectés.
 */
export function SystemsHeader({
  mode,
  connectedSystemsCount,
  visibleSyncCardsCount,
  totalDevicesCount,
  onOpenDevicesTab,
}: SystemsHeaderProps) {
  const { t } = useI18n();

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 shrink-0">
          <Plug className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">
            {t('systems.headerTitle')}
          </h2>
          <p className="text-xs text-slate-400">
            {t('systems.headerSub', {
              connected: connectedSystemsCount,
              active: visibleSyncCardsCount,
              devices: totalDevicesCount,
            })}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${mode === 'live'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            }`}
        >
          {mode === 'live' ? t('common.liveModeReadOnly') : t('common.demoMode')}
        </span>

        {onOpenDevicesTab && (
          <button
            type="button"
            onClick={onOpenDevicesTab}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition"
          >
            <Cpu className="h-3.5 w-3.5 text-indigo-400" />
            {t('systems.viewDevicesBtn')}
          </button>
        )}
      </div>
    </div>
  );
}
