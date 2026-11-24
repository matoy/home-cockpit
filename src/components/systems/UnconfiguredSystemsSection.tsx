'use client';

import { BookOpen } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { VENDOR_REGISTRY } from '@/lib/vendors/registry';
import type { VendorId } from '@/types';

export interface UnconfiguredSystemItem {
  vendor: VendorId;
  scope: string;
  onOpenGuide?: () => void;
}

interface UnconfiguredSystemsSectionProps {
  items: UnconfiguredSystemItem[];
}

/**
 * Grille listant les écosystèmes supportés qui ne sont pas encore configurés dans l'environnement.
 */
export function UnconfiguredSystemsSection({ items }: UnconfiguredSystemsSectionProps) {
  const { t } = useI18n();

  if (items.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">{t('systems.otherTitle')}</h3>
          <p className="text-xs text-slate-400">
            {t('systems.otherSub')}
          </p>
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-0.5 text-[11px] text-slate-300">
          {t('systems.otherCount', { count: items.length })}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((item) => {
          const meta = VENDOR_REGISTRY[item.vendor];
          return (
            <div
              key={item.vendor}
              className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-4 flex flex-col justify-between gap-3"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}
                  >
                    {meta.label}
                  </span>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                    {t('common.notConfigured')}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{item.scope}</p>
              </div>

              {item.onOpenGuide && (
                <button
                  type="button"
                  onClick={item.onOpenGuide}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:text-white transition"
                >
                  <BookOpen className="h-3.5 w-3.5 text-indigo-400" />
                  {t('systems.configureGuideBtn')}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
