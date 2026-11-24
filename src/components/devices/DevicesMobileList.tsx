'use client';

import type { MutableRefObject } from 'react';
import { Link2, Pencil, Sliders, Trash2, Wifi, WifiOff } from 'lucide-react';
import { extractDaikinSummary } from '@/lib/vendors/daikin-display';
import { extractHomeConnectSummary } from '@/lib/vendors/home-connect-display';
import { VENDOR_REGISTRY } from '@/lib/vendors/registry';
import { extractSomfyDisplaySummary } from '@/lib/vendors/somfy-display';
import { extractXiaomiSummary } from '@/lib/vendors/xiaomi-display';
import { extractXSenseSummary } from '@/lib/vendors/xsense-display';
import { useI18n } from '@/components/I18nProvider';
import type { DeviceRecord, EnergyMode, RoomRecord } from '@/types';

interface DevicesMobileListProps {
  filteredDevices: DeviceRecord[];
  rooms: RoomRecord[];
  hasActiveFilters: boolean;
  onResetFilters: () => void;
  selectedDeviceIdSet: Set<string>;
  bulkSaving: boolean;
  lastShiftKeyRef: MutableRefObject<boolean>;
  onToggleSelectDevice: (deviceId: string, shiftKey: boolean) => void;
  onOpenEditManual: (device: DeviceRecord) => void;
  onDeleteManual: (device: DeviceRecord) => void;
  onOpenInspector: (device: DeviceRecord) => void;
  onOpenManageSystems: (device: DeviceRecord) => void;
  onUpdateDevice: (
    deviceId: string,
    updates: Partial<{
      customName: string | null;
      roomId: number | null;
      isMonitored: boolean;
      excludeFromTotals: boolean;
      energyMode: EnergyMode;
    }>
  ) => void;
}

export function DevicesMobileList({
  filteredDevices,
  rooms,
  hasActiveFilters,
  onResetFilters,
  selectedDeviceIdSet,
  bulkSaving,
  lastShiftKeyRef,
  onToggleSelectDevice,
  onOpenEditManual,
  onDeleteManual,
  onOpenInspector,
  onOpenManageSystems,
  onUpdateDevice,
}: DevicesMobileListProps) {
  const { t, locale } = useI18n();

  return (
    <div className="lg:hidden divide-y divide-slate-800/80">
      {filteredDevices.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-slate-500">
          <div>{t('devices.noMatchingDevices')}</div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="mt-2.5 inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-1 text-[11px] text-slate-200 transition"
            >
              {t('common.resetFilters')}
            </button>
          )}
        </div>
      ) : (
        filteredDevices.map((dev) => {
          const isManual = dev.id.startsWith('manual_');
          const isSelected = selectedDeviceIdSet.has(dev.id);
          return (
            <div
              key={dev.id}
              className={`p-4 space-y-3 text-xs transition-colors ${
                isSelected ? 'bg-indigo-500/10' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={bulkSaving}
                    onClick={(e) => {
                      lastShiftKeyRef.current = e.shiftKey;
                    }}
                    onChange={() => {
                      const shift = lastShiftKeyRef.current;
                      lastShiftKeyRef.current = false;
                      onToggleSelectDevice(dev.id, shift);
                    }}
                    aria-label={t('devices.selectDeviceAria', {
                      name: dev.customName || dev.name,
                    })}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500 shrink-0 cursor-pointer"
                  />
                  {dev.isOnline ? (
                    <Wifi className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium text-white truncate">{dev.name}</span>
                      {isManual && (
                        <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.2 text-[9.5px] font-medium text-emerald-300">
                          {t('devices.manualBadge')}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono truncate">
                      {dev.productName || dev.tuyaCategory || dev.id}
                    </div>
                  </div>
                </div>

                {isManual ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onOpenEditManual(dev)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] text-slate-200"
                    >
                      <Pencil className="h-3 w-3" />
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteManual(dev)}
                      title={t('devices.deleteManualTitle')}
                      className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300 p-1.5 text-slate-300"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenInspector(dev)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] text-slate-200 shrink-0"
                  >
                    <Sliders className="h-3 w-3" />
                    {t('devices.dpInspectorBtn')}
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {dev.systems.map((sys) => {
                  const meta = VENDOR_REGISTRY[sys];
                  return (
                    <span
                      key={sys}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                      {meta.label}
                    </span>
                  );
                })}
                <button
                  type="button"
                  onClick={() => onOpenManageSystems(dev)}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300"
                >
                  <Link2 className="h-2.5 w-2.5" />
                  {t('devices.linkBtn')}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">
                    {t('devices.customNameLabel')}
                  </label>
                  <input
                    key={`mob-name-${dev.id}-${dev.customName ?? ''}`}
                    type="text"
                    defaultValue={dev.customName ?? ''}
                    placeholder={dev.name}
                    onBlur={(e) => {
                      const val = e.target.value.trim();
                      if (val !== (dev.customName ?? '')) {
                        onUpdateDevice(dev.id, { customName: val || null });
                      }
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">
                    {t('devices.colIpMac')}
                  </label>
                  {(() => {
                    const somfyNet = extractSomfyDisplaySummary(dev, locale);
                    const ipLabel = dev.ipAddress || '—';
                    const macLabel =
                      dev.macAddress ||
                      (somfyNet?.gatewayId ? `GW ${somfyNet.gatewayId}` : '—');
                    return (
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 font-mono text-[11px] text-slate-300 truncate">
                        {ipLabel} · {macLabel}
                      </div>
                    );
                  })()}
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">
                    {t('devices.colRoom')}
                  </label>
                  <select
                    value={dev.roomId ?? ''}
                    onChange={(e) =>
                      onUpdateDevice(dev.id, {
                        roomId: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">{t('common.unassigned')}</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">
                    {t('devices.colKwhMode')}
                  </label>
                  <select
                    value={dev.energyMode}
                    onChange={(e) =>
                      onUpdateDevice(dev.id, {
                        energyMode: e.target.value as EnergyMode,
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="hybrid">{t('devices.energyHybrid')}</option>
                    <option value="add_ele">{t('devices.energyAddEle')}</option>
                    <option value="integration">{t('devices.energyIntegration')}</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                {(() => {
                  const hcSummary = extractHomeConnectSummary(dev.lastRawStatus, locale);
                  const dkSummary = extractDaikinSummary(dev.lastRawStatus, locale);
                  const somfySummary = extractSomfyDisplaySummary(dev, locale);
                  const xsSummary = extractXSenseSummary(dev.lastRawStatus, locale);
                  const miSummary = extractXiaomiSummary(dev.lastRawStatus, locale);
                  return (
                    <div className="flex flex-wrap gap-2 font-mono text-[11px] text-slate-300">
                      {somfySummary?.cover && (
                        <span
                          title={`${somfySummary.cover.kindLabel} (${somfySummary.protocol})`}
                          className={
                            somfySummary.cover.state === 'closed'
                              ? 'text-emerald-300'
                              : somfySummary.cover.state === 'open'
                                ? 'text-sky-300'
                                : 'text-amber-300'
                          }
                        >
                          {somfySummary.compactBadge}
                        </span>
                      )}
                      {dev.lastPowerW !== null && (
                        <span className="text-indigo-300">{dev.lastPowerW} W</span>
                      )}
                      {dev.lastTempC !== null && (
                        <span className="text-emerald-300">{dev.lastTempC} °C</span>
                      )}
                      {dev.lastHumidityPct !== null && (
                        <span className="text-sky-300">{dev.lastHumidityPct} %</span>
                      )}
                      {dev.lastContactOpen !== null && (
                        <span
                          className={dev.lastContactOpen ? 'text-amber-300' : 'text-emerald-300'}
                        >
                          {dev.lastContactOpen ? t('common.open') : t('common.closed')}
                        </span>
                      )}
                      {hcSummary?.operationLabel && (
                        <span
                          title={hcSummary.activeProgram ?? undefined}
                          className={
                            hcSummary.operationTone === 'cyan'
                              ? 'text-cyan-300'
                              : hcSummary.operationTone === 'emerald'
                                ? 'text-emerald-300'
                                : hcSummary.operationTone === 'amber'
                                  ? 'text-amber-300'
                                  : hcSummary.operationTone === 'rose'
                                    ? 'text-rose-300'
                                    : 'text-slate-400'
                          }
                        >
                          {hcSummary.operationLabel}
                          {hcSummary.progressPct !== null ? ` · ${hcSummary.progressPct}%` : ''}
                          {hcSummary.remainingLabel ? ` · ${hcSummary.remainingLabel}` : ''}
                        </span>
                      )}
                      {hcSummary?.tempsLabel && (
                        <span className="text-sky-300">{hcSummary.tempsLabel}</span>
                      )}
                      {hcSummary?.doorOpen && (
                        <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-300">
                          {t('common.doorOpen')}
                        </span>
                      )}
                      {dkSummary && (
                        <span
                          title={dkSummary.compactText}
                          className={
                            dkSummary.modeTone === 'amber'
                              ? 'text-amber-300'
                              : dkSummary.modeTone === 'sky'
                                ? 'text-sky-300'
                                : dkSummary.modeTone === 'indigo'
                                  ? 'text-indigo-300'
                                  : 'text-slate-400'
                          }
                        >
                          {dkSummary.compactText}
                        </span>
                      )}
                      {xsSummary && (
                        <span
                          title={xsSummary.compactText}
                          className={
                            xsSummary.isAlert
                              ? 'text-rose-300 font-semibold'
                              : xsSummary.alarmTone === 'amber'
                                ? 'text-amber-300'
                                : 'text-emerald-300'
                          }
                        >
                          {xsSummary.compactText}
                        </span>
                      )}
                      {miSummary && (
                        <span
                          title={miSummary.compactText}
                          className={
                            miSummary.isAlert ? 'text-rose-300 font-semibold' : 'text-orange-300'
                          }
                        >
                          {miSummary.compactText}
                        </span>
                      )}
                    </div>
                  );
                })()}

                <div className="flex items-center gap-4 text-[11px] text-slate-300">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dev.isMonitored}
                      onChange={(e) =>
                        onUpdateDevice(dev.id, { isMonitored: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-600"
                    />
                    {t('devices.colMonitored')}
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dev.excludeFromTotals}
                      onChange={(e) =>
                        onUpdateDevice(dev.id, { excludeFromTotals: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-amber-500"
                    />
                    {t('devices.colExclude')}
                  </label>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
