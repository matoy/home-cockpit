'use client';

import { Clock } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import type { CollectionLogRecord } from '@/types';

interface CollectionLogsCardProps {
  logs: CollectionLogRecord[];
}

/**
 * Journal des collectes périodiques et manuelles de télémétrie.
 */
export function CollectionLogsCard({ logs }: CollectionLogsCardProps) {
  const { t, intlLocale } = useI18n();

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4 text-slate-400" />
        {t('systems.logsTitle')}
      </h3>
      <div className="space-y-2 max-h-56 overflow-y-auto">
        {logs.map((log) => (
          <div
            key={log.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 px-3.5 py-2 text-xs"
          >
            <div className="flex items-center gap-2.5">
              <span
                className={`h-2 w-2 rounded-full ${log.status === 'success' ? 'bg-emerald-400' : 'bg-rose-400'}`}
              />
              <span className="font-mono text-slate-300">
                {new Date(log.executedAt).toLocaleString(intlLocale)}
              </span>
              <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] uppercase text-slate-300">
                {log.trigger}
              </span>
            </div>
            <div className="text-slate-400">
              {log.status === 'success' ? (
                <span>
                  {t('systems.logReadingsRow', {
                    readings: log.readingsInserted,
                    devices: log.devicesCount,
                    ms: log.durationMs ?? 0,
                  })}
                </span>
              ) : (
                <span className="text-rose-300">{log.errorMessage}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
