'use client';

import { X } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import type { DeviceRecord, DpConfig } from '@/types';

interface DpInspectorModalProps {
  device: DeviceRecord;
  inspectorIp: string;
  inspectorMac: string;
  dpDraft: DpConfig;
  savingDp: boolean;
  onChangeIp: (value: string) => void;
  onChangeMac: (value: string) => void;
  onChangeDpDraft: (next: DpConfig) => void;
  onClose: () => void;
  onSave: () => void;
}

/**
 * Modale d'inspection des métadonnées réseau, du mapping des points de données (DP) et du statut brut.
 */
export function DpInspectorModal({
  device,
  inspectorIp,
  inspectorMac,
  dpDraft,
  savingDp,
  onChangeIp,
  onChangeMac,
  onChangeDpDraft,
  onClose,
  onSave,
}: DpInspectorModalProps) {
  const { t } = useI18n();

  const scaleOptions = [
    { label: t('devices.scale1'), value: 1 },
    { label: t('devices.scale10'), value: 0.1 },
    { label: t('devices.scale100'), value: 0.01 },
    { label: t('devices.scale1000'), value: 0.001 },
  ];

  const dpFields = [
    { key: 'power', label: t('devices.dpFieldPower') },
    { key: 'addEle', label: t('devices.dpFieldAddEle') },
    { key: 'voltage', label: t('devices.dpFieldVoltage') },
    { key: 'temp', label: t('devices.dpFieldTemp') },
    { key: 'humidity', label: t('devices.dpFieldHumidity') },
    { key: 'battery', label: t('devices.dpFieldBattery') },
    { key: 'contact', label: t('devices.dpFieldContact') },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">
              {t('devices.dpModalTitle', { name: device.customName || device.name })}
            </h3>
            <p className="text-xs text-slate-400 font-mono">{device.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium text-slate-200">{t('devices.dpNetworkTitle')}</div>
            <span className="text-[11px] text-slate-400">
              {t('devices.dpNetworkSub')}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {t('devices.dpIpLabel')}
              </label>
              <input
                type="text"
                value={inspectorIp}
                onChange={(e) => onChangeIp(e.target.value)}
                placeholder="ex: 192.168.1.54"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">{t('devices.dpMacLabel')}</label>
              <input
                type="text"
                value={inspectorMac}
                onChange={(e) => onChangeMac(e.target.value)}
                placeholder="ex: 68:A4:0E:12:34:56"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
          {device.primaryVendor === 'home_connect' && (
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {t('devices.dpHcNote')}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {dpFields.map(({ key, label }) => {
            const current = dpDraft[key] ?? { code: '', scale: 1 };
            const isContact = key === 'contact';
            return (
              <div
                key={key}
                className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2"
              >
                <div className="font-medium text-slate-200">{label}</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder={isContact ? 'ex: doorcontact_state' : t('devices.dpCodePlaceholder')}
                    value={current.code}
                    onChange={(e) => {
                      const code = e.target.value.trim();
                      onChangeDpDraft({
                        ...dpDraft,
                        [key]: code ? { code, scale: current.scale || 1 } : undefined,
                      });
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-mono text-white"
                  />
                  <select
                    value={current.scale}
                    onChange={(e) =>
                      onChangeDpDraft({
                        ...dpDraft,
                        [key]: { code: current.code, scale: Number(e.target.value) },
                      })
                    }
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                  >
                    {isContact ? (
                      <>
                        <option value={1}>{t('devices.dpContactNormal')}</option>
                        <option value={-1}>{t('devices.dpContactInverted')}</option>
                      </>
                    ) : (
                      scaleOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <div className="text-xs font-medium text-slate-300 mb-1.5">
            {t('devices.dpRawStatusTitle')}
          </div>
          <pre className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-48">
            {JSON.stringify(device.lastRawStatus ?? [], null, 2)}
          </pre>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300 hover:bg-slate-800"
          >
            {t('common.close')}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={savingDp}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-medium text-white"
          >
            {savingDp ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
