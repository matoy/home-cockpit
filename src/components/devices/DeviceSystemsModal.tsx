'use client';

import { AlertCircle, CheckCircle2, GitMerge, Link2, Unlink, X } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { VENDOR_IDS, VENDOR_REGISTRY } from '@/lib/vendors/registry';
import type { DeviceRecord, RoomRecord, VendorId } from '@/types';

interface DeviceSystemsModalProps {
  device: DeviceRecord;
  rooms: RoomRecord[];
  mergeableCandidates: DeviceRecord[];
  mergeSourceId: string;
  savingLink: boolean;
  linkFeedback: { ok: boolean; text: string } | null;
  onChangeMergeSourceId: (value: string) => void;
  onToggleSystemTag: (deviceId: string, vendor: VendorId, enabled: boolean) => void;
  onMergeDevices: (targetDeviceId: string, sourceDeviceId: string) => void;
  onUnlinkVendor: (deviceId: string, vendor: VendorId) => void;
  onClose: () => void;
}

/**
 * Modale de gestion de la présence multi-systèmes, de fusion de doublons et des liens fournisseurs mémorisés.
 */
export function DeviceSystemsModal({
  device,
  rooms,
  mergeableCandidates,
  mergeSourceId,
  savingLink,
  linkFeedback,
  onChangeMergeSourceId,
  onToggleSystemTag,
  onMergeDevices,
  onUnlinkVendor,
  onClose,
}: DeviceSystemsModalProps) {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Link2 className="h-4 w-4 text-sky-400" />
              {t('devices.systemsModalTitle', {
                name: device.customName || device.name,
              })}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {t('devices.systemsModalPrimary')}{' '}
              <strong className="text-slate-200">
                {VENDOR_REGISTRY[device.primaryVendor].label}
              </strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {linkFeedback && (
          <div
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${linkFeedback.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              }`}
          >
            {linkFeedback.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>{linkFeedback.text}</span>
          </div>
        )}

        {/* Cases à cocher présence multi-systèmes */}
        <div className="space-y-2.5">
          <div className="text-xs font-semibold text-slate-200">
            {t('devices.systemsPresenceTitle')}
          </div>
          <div className="space-y-2">
            {VENDOR_IDS.map((vId) => {
              const meta = VENDOR_REGISTRY[vId];
              const isPrimary = device.primaryVendor === vId;
              const checked = device.systems.includes(vId);
              return (
                <label
                  key={vId}
                  className={`flex items-start justify-between gap-3 rounded-xl border p-3 text-xs transition ${checked
                    ? 'border-slate-700 bg-slate-950/80'
                    : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                    } ${isPrimary ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isPrimary || savingLink}
                      onChange={(e) =>
                        onToggleSystemTag(device.id, vId, e.target.checked)
                      }
                      className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <div className="flex items-center gap-2 font-medium text-white">
                        <span>{meta.label}</span>
                        {isPrimary && (
                          <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-300">
                            {t('devices.primaryBadge')}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {isPrimary
                          ? t('devices.primaryDesc')
                          : t('devices.secondaryDesc', { vendor: meta.label })}
                      </p>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Fusion d'un doublon existant */}
        <div className="space-y-2.5 pt-2 border-t border-slate-800">
          <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <GitMerge className="h-3.5 w-3.5 text-amber-400" />
            {t('devices.mergeSectionTitle')}
          </div>
          <p className="text-[11px] text-slate-400">
            {t('devices.mergeSectionDesc')}
          </p>

          {mergeableCandidates.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-[11px] text-slate-500">
              {t('devices.mergeEmpty')}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <select
                value={mergeSourceId}
                onChange={(e) => onChangeMergeSourceId(e.target.value)}
                className="flex-1 min-w-[200px] rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
              >
                <option value="">{t('devices.mergeChoose')}</option>
                {mergeableCandidates.map((cand) => {
                  const candRoom = rooms.find((r) => r.id === cand.roomId);
                  return (
                    <option key={cand.id} value={cand.id}>
                      [{VENDOR_REGISTRY[cand.primaryVendor].label}] {cand.customName || cand.name}
                      {candRoom ? ` (${candRoom.name})` : ''}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                disabled={!mergeSourceId || savingLink}
                onClick={() => onMergeDevices(device.id, mergeSourceId)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 px-3.5 py-2 text-xs font-semibold text-slate-950 transition"
              >
                <GitMerge className="h-3.5 w-3.5" />
                {t('devices.mergeBtn')}
              </button>
            </div>
          )}
        </div>

        {/* Liens mémorisés */}
        {(device.vendorLinks?.length ?? 0) > 0 && (
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <div className="text-xs font-semibold text-slate-200">
              {t('devices.savedLinksTitle')}
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {device.vendorLinks?.map((link) => {
                const meta = VENDOR_REGISTRY[link.vendor];
                const canUnlink =
                  link.vendor !== device.primaryVendor &&
                  device.systems.length > 1;
                return (
                  <div
                    key={link.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`rounded border px-1.5 py-0.2 text-[10px] ${meta.badgeClass}`}>
                          {meta.label}
                        </span>
                        <span className="text-slate-200 truncate">
                          {link.externalName || link.externalId}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-slate-500 truncate mt-0.5">
                        {link.externalId}
                      </div>
                    </div>
                    {canUnlink && (
                      <button
                        type="button"
                        disabled={savingLink}
                        onClick={() => onUnlinkVendor(device.id, link.vendor)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 hover:border-rose-500/40 hover:text-rose-300 px-2 py-1 text-[10px] text-slate-300 shrink-0"
                        title={t('devices.unlinkTitle')}
                      >
                        <Unlink className="h-3 w-3" />
                        {t('devices.unlinkBtn')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300 hover:bg-slate-800"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
