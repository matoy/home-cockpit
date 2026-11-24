'use client';

import type { FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Plus, X } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { VENDOR_IDS, VENDOR_REGISTRY } from '@/lib/vendors/registry';
import type { DeviceCategory, RoomRecord, VendorId } from '@/types';

interface ManualDeviceModalProps {
  editingDeviceId: string | null;
  rooms: RoomRecord[];
  name: string;
  customName: string;
  productName: string;
  roomId: string;
  category: DeviceCategory;
  ipAddress: string;
  macAddress: string;
  systems: VendorId[];
  primaryVendor: VendorId;
  isOnline: boolean;
  isMonitored: boolean;
  excludeFromTotals: boolean;
  saving: boolean;
  feedback: { ok: boolean; text: string } | null;
  onChangeName: (value: string) => void;
  onChangeCustomName: (value: string) => void;
  onChangeProductName: (value: string) => void;
  onChangeRoomId: (value: string) => void;
  onChangeCategory: (value: DeviceCategory) => void;
  onChangeIpAddress: (value: string) => void;
  onChangeMacAddress: (value: string) => void;
  onToggleSystem: (vendor: VendorId) => void;
  onChangePrimaryVendor: (vendor: VendorId) => void;
  onChangeIsOnline: (value: boolean) => void;
  onChangeIsMonitored: (value: boolean) => void;
  onChangeExcludeFromTotals: (value: boolean) => void;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}

/**
 * Modale de création et d'édition d'un appareil déclaré manuellement dans le foyer.
 */
export function ManualDeviceModal({
  editingDeviceId,
  rooms,
  name,
  customName,
  productName,
  roomId,
  category,
  ipAddress,
  macAddress,
  systems,
  primaryVendor,
  isOnline,
  isMonitored,
  excludeFromTotals,
  saving,
  feedback,
  onChangeName,
  onChangeCustomName,
  onChangeProductName,
  onChangeRoomId,
  onChangeCategory,
  onChangeIpAddress,
  onChangeMacAddress,
  onToggleSystem,
  onChangePrimaryVendor,
  onChangeIsOnline,
  onChangeIsMonitored,
  onChangeExcludeFromTotals,
  onClose,
  onSubmit,
}: ManualDeviceModalProps) {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Plus className="h-4 w-4 text-emerald-400" />
              {editingDeviceId
                ? t('devices.manualModalEditTitle')
                : t('devices.manualModalCreateTitle')}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {t('devices.manualModalSubtitle')}
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

        {feedback && (
          <div
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${feedback.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              }`}
          >
            {feedback.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">
              {t('devices.manualNameLabel')} <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => onChangeName(e.target.value)}
              placeholder={t('devices.manualNamePlaceholder')}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">{t('devices.manualCustomNameLabel')}</label>
            <input
              type="text"
              value={customName}
              onChange={(e) => onChangeCustomName(e.target.value)}
              placeholder={t('devices.manualCustomNamePlaceholder')}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">{t('devices.manualModelLabel')}</label>
            <input
              type="text"
              value={productName}
              onChange={(e) => onChangeProductName(e.target.value)}
              placeholder={t('devices.manualModelPlaceholder')}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">{t('devices.colRoom')}</label>
            <select
              value={roomId}
              onChange={(e) => onChangeRoomId(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">{t('common.unassigned')}</option>
              {rooms.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">{t('devices.manualCategoryLabel')}</label>
            <select
              value={category}
              onChange={(e) => onChangeCategory(e.target.value as DeviceCategory)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="other">{t('devices.catOther')}</option>
              <option value="power">{t('devices.catPower')}</option>
              <option value="climate">{t('devices.catClimate')}</option>
              <option value="contact">{t('devices.catContact')}</option>
              <option value="hybrid">{t('devices.catHybrid')}</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">{t('devices.manualIpLabel')}</label>
            <input
              type="text"
              value={ipAddress}
              onChange={(e) => onChangeIpAddress(e.target.value)}
              placeholder="ex: 192.168.1.45"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-slate-400 mb-1">{t('devices.manualMacLabel')}</label>
            <input
              type="text"
              value={macAddress}
              onChange={(e) => onChangeMacAddress(e.target.value)}
              placeholder="ex: AA:BB:CC:DD:EE:FF"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Systèmes associés */}
        <div className="space-y-2 text-xs">
          <div className="text-slate-300 font-medium">{t('devices.manualSystemsTitle')}</div>
          <div className="flex flex-wrap items-center gap-3">
            {VENDOR_IDS.map((vId) => {
              const meta = VENDOR_REGISTRY[vId];
              const checked = systems.includes(vId);
              return (
                <label
                  key={vId}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 cursor-pointer transition ${checked
                    ? 'border-slate-600 bg-slate-950/90 text-white'
                    : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700'
                    }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleSystem(vId)}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-600"
                  />
                  <span className={`h-2 w-2 rounded-full ${meta.dotClass}`} />
                  <span>{meta.label}</span>
                </label>
              );
            })}
          </div>

          {systems.length > 1 && (
            <div className="pt-1">
              <label className="block text-slate-400 mb-1">{t('devices.manualPrimarySystemLabel')}</label>
              <select
                value={primaryVendor}
                onChange={(e) => onChangePrimaryVendor(e.target.value as VendorId)}
                className="w-full sm:w-64 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                {systems.map((vId) => (
                  <option key={vId} value={vId}>
                    {VENDOR_REGISTRY[vId].label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Options d'état et de suivi */}
        <div className="flex flex-wrap items-center gap-5 pt-1 text-xs text-slate-300">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isOnline}
              onChange={(e) => onChangeIsOnline(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-600"
            />
            {t('common.online')}
          </label>

          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isMonitored}
              onChange={(e) => onChangeIsMonitored(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-600"
            />
            {t('devices.manualMonitoredLabel')}
          </label>

          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={excludeFromTotals}
              onChange={(e) => onChangeExcludeFromTotals(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-amber-500"
            />
            {t('devices.manualExcludeLabel')}
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-xs font-medium text-white transition"
          >
            {saving
              ? t('common.saving')
              : editingDeviceId
                ? t('common.save')
                : t('devices.manualSubmitCreate')}
          </button>
        </div>
      </form>
    </div>
  );
}
