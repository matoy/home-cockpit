'use client';

import { GitMerge } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { VENDOR_REGISTRY } from '@/lib/vendors/registry';
import type { DuplicateCandidate } from '@/types';

interface DuplicatesBannerProps {
  candidates: DuplicateCandidate[];
  mergingId: string | null;
  bulkMergingAll: boolean;
  onMergeOne: (targetDeviceId: string, sourceDeviceId: string) => void;
  onBulkMergeAll: () => void;
  onDismiss: (sourceDeviceId: string) => void;
}

/**
 * Bannière affichant les doublons potentiels détectés entre écosystèmes avec fusion rapide.
 */
export function DuplicatesBanner({
  candidates,
  mergingId,
  bulkMergingAll,
  onMergeOne,
  onBulkMergeAll,
  onDismiss,
}: DuplicatesBannerProps) {
  const { t } = useI18n();

  if (candidates.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-200">
          <GitMerge className="h-4 w-4 text-amber-400 shrink-0" />
          {t('devices.duplicatesTitle', { count: candidates.length })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-amber-300/80">
            {t('devices.duplicatesHint')}
          </span>
          {candidates.length > 1 && (
            <button
              type="button"
              disabled={bulkMergingAll || mergingId !== null}
              onClick={onBulkMergeAll}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition shrink-0"
            >
              <GitMerge className="h-3.5 w-3.5" />
              {bulkMergingAll
                ? t('devices.merging')
                : t('devices.mergeAll', { count: candidates.length })}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {candidates.map((cand) => (
          <div
            key={cand.sourceDeviceId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-slate-950/60 px-3.5 py-2.5 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${VENDOR_REGISTRY[cand.sourceVendor].badgeClass}`}
              >
                {VENDOR_REGISTRY[cand.sourceVendor].label}
              </span>
              <span className="font-medium text-white">{cand.sourceName}</span>
              <span className="text-slate-500">→</span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${VENDOR_REGISTRY[cand.targetVendor].badgeClass}`}
              >
                {VENDOR_REGISTRY[cand.targetVendor].label}
              </span>
              <span className="font-medium text-white">{cand.targetName}</span>
              <span className="text-[11px] text-slate-400">
                ({cand.reason}
                {cand.roomName ? ` · ${cand.roomName}` : ''})
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={mergingId === cand.sourceDeviceId || bulkMergingAll}
                onClick={() => onMergeOne(cand.targetDeviceId, cand.sourceDeviceId)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition"
              >
                <GitMerge className="h-3.5 w-3.5" />
                {mergingId === cand.sourceDeviceId ? t('devices.mergingOne') : t('devices.mergeOneClick')}
              </button>
              <button
                type="button"
                onClick={() => onDismiss(cand.sourceDeviceId)}
                className="rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-2.5 py-1.5 text-[11px] text-slate-300 transition"
              >
                {t('devices.ignore')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
