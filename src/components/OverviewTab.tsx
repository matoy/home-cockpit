'use client';

import {
  Zap,
  Euro,
  Moon,
  Thermometer,
  Droplets,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { hasValidHumidityMeasurement, hasValidTempMeasurement } from '@/lib/device-utils';
import { useI18n } from '@/components/I18nProvider';
import { AlertBanner, Button, EmptyState } from '@/components/ui';
import { extractDaikinSummary } from '@/lib/vendors/daikin-display';
import { extractHomeConnectSummary } from '@/lib/vendors/home-connect-display';
import { extractSomfyDisplaySummary } from '@/lib/vendors/somfy-display';
import { extractXSenseSummary } from '@/lib/vendors/xsense-display';
import { extractXiaomiSummary } from '@/lib/vendors/xiaomi-display';
import { VENDOR_REGISTRY } from '@/lib/vendors/registry';
import type { ComfortStatus, DashboardPayload, TabId } from '@/types';

interface OverviewTabProps {
  data: DashboardPayload;
  onSelectRoom: (roomId: string) => void;
  onNavigateTab: (tab: TabId) => void;
}

const COMFORT_BADGE_CLASSES: Record<ComfortStatus['tone'], string> = {
  emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  sky: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  rose: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  slate: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
};

export function OverviewTab({ data, onSelectRoom, onNavigateTab }: OverviewTabProps) {
  const { t, locale, intlLocale } = useI18n();
  const { kpis, roomSummaries, range, customFrom, customTo } = data;
  const rangeLabel =
    range === 'custom' && customFrom && customTo
      ? `${new Date(customFrom).toLocaleDateString(intlLocale, { day: '2-digit', month: '2-digit' })} → ${new Date(customTo).toLocaleDateString(intlLocale, { day: '2-digit', month: '2-digit' })}`
      : range === '24h'
        ? t('overview.range24h')
        : range === '7d'
          ? t('overview.range7d')
          : range === '30d'
            ? t('overview.range30d')
            : range === '365d'
              ? t('overview.range365d')
              : range;

  return (
    <div className="space-y-6">
      {/* 4 KPIs Globaux */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('overview.kpiPower')}
            </span>
            <div className="rounded-lg bg-indigo-500/15 p-2 text-indigo-400">
              <Zap className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {kpis.currentPowerW.toFixed(0)}
            </span>
            <span className="text-sm font-medium text-slate-400">W</span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {t('overview.activePlugs', {
              active: kpis.activePowerDevices,
              total: kpis.totalPowerDevices,
            })}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {t('overview.kpiEnergyCost', { range: rangeLabel })}
              </span>
              {data.meter?.activeInCurrentView && (
                <span className="rounded-full border border-lime-500/40 bg-lime-500/15 px-2 py-0.5 text-[9.5px] font-semibold text-lime-300">
                  Linky
                </span>
              )}
            </div>
            <div className="rounded-lg bg-emerald-500/15 p-2 text-emerald-400">
              <Euro className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-2.5">
            <span className="text-3xl font-bold tracking-tight text-white">
              {kpis.periodCostEur.toFixed(2)} €
            </span>
            <span className="text-sm font-medium text-emerald-400">
              {kpis.periodEnergyKwh.toFixed(2)} kWh
            </span>
            {kpis.energyDeltaPct !== null && kpis.energyDeltaPct !== undefined && (
              <span
                title={t('overview.vsPrevPeriod')}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  kpis.energyDeltaPct > 0
                    ? 'bg-rose-500/15 text-rose-300'
                    : 'bg-emerald-500/15 text-emerald-300'
                }`}
              >
                {kpis.energyDeltaPct > 0 ? '+' : ''}
                {kpis.energyDeltaPct.toFixed(1)}%
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {t('overview.avgPrice', {
              rate: kpis.effectiveRateEurPerKwh.toFixed(4),
              sub: kpis.subscriptionCostEur.toFixed(2),
            })}
          </p>
          {kpis.projectedMonthCostEur !== null && kpis.projectedMonthCostEur !== undefined && (
            <p className="mt-1 text-[11px] font-medium text-indigo-300">
              {t('overview.projectedMonth', {
                cost: kpis.projectedMonthCostEur.toFixed(0),
                kwh: (kpis.projectedMonthEnergyKwh ?? 0).toFixed(0),
              })}
            </p>
          )}
          {data.meter?.activeInCurrentView && (
            <p className="mt-1 text-[11px] text-lime-300/90">
              {data.meter.measuredCoveragePct !== null
                ? t('overview.meterCoverage', {
                    pct: data.meter.measuredCoveragePct.toFixed(0),
                    date: data.meter.lastPublishedDate ?? '—',
                  })
                : t('overview.meterUntil', { date: data.meter.lastPublishedDate ?? '—' })}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('overview.kpiStandby')}
            </span>
            <div className="rounded-lg bg-amber-500/15 p-2 text-amber-400">
              <Moon className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {kpis.standbyPowerW.toFixed(0)}
            </span>
            <span className="text-sm font-medium text-slate-400">W</span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {t('overview.standbyHint')}{' '}
            <span className="text-amber-300 font-medium">
              {t('overview.standbyPerYear', { cost: kpis.standbyAnnualCostEur.toFixed(0) })}
            </span>
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('overview.kpiClimate')}
            </span>
            <div className="rounded-lg bg-sky-500/15 p-2 text-sky-400">
              <Thermometer className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="text-3xl font-bold tracking-tight text-white">
              {kpis.avgTempC !== null ? `${kpis.avgTempC.toFixed(1)}°C` : '—'}
            </span>
            <span className="text-sm font-medium text-sky-400">
              {kpis.avgHumidityPct !== null ? `${kpis.avgHumidityPct.toFixed(0)} %` : '—'}
            </span>
          </div>
          <p className="mt-2 text-xs flex items-center gap-1.5">
            {kpis.climateAlertsCount > 0 ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-amber-300">
                  {t('overview.roomsOutOfComfort', { count: kpis.climateAlertsCount })}
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-300">{t('overview.allRoomsOptimal')}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Grille des pièces */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white">{t('overview.roomsTitle')}</h2>
            <p className="text-xs text-slate-400">
              {t('overview.roomsSubtitle')}
            </p>
          </div>
          {data.selectedRoomId !== 'all' && (
            <button
              onClick={() => onSelectRoom('all')}
              className="rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-500/25 transition"
            >
              {t('overview.showAllRooms')}
            </button>
          )}
        </div>

        {roomSummaries.length === 0 ? (
          <EmptyState
            icon={<Cpu className="h-5 w-5" />}
            title={t('overview.noRooms')}
            action={
              <Button variant="primary" size="md" onClick={() => onNavigateTab('rooms')}>
                {t('overview.createOrSyncRooms')}
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {roomSummaries.map((rs) => {
              const isSelected = data.selectedRoomId === String(rs.room.id);
              return (
                <div
                  key={rs.room.id}
                  onClick={() => onSelectRoom(isSelected ? 'all' : String(rs.room.id))}
                  className={`cursor-pointer rounded-2xl border p-5 transition ${isSelected
                    ? 'border-indigo-500 bg-indigo-950/25 ring-1 ring-indigo-500/40'
                    : 'border-slate-800 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-3.5 w-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: rs.room.color }}
                      />
                      <div>
                        <h3 className="text-sm font-semibold text-white">{rs.room.name}</h3>
                        <p className="text-[11px] text-slate-400">
                          {t('common.devicesCount', { count: rs.devices.length })}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${COMFORT_BADGE_CLASSES[rs.comfort.tone]
                        }`}
                    >
                      {rs.comfort.label}
                    </span>
                  </div>

                  {/* Métriques principales de la pièce */}
                  <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-slate-800/80 bg-slate-950/50 p-3">
                    <div>
                      <div className="flex items-center gap-1 text-[11px] text-slate-400">
                        <Zap className="h-3 w-3 text-indigo-400" />
                        {t('overview.metricPower')}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-white">
                        {rs.currentPowerW.toFixed(0)} W
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {rs.periodEnergyKwh.toFixed(2)} kWh
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center gap-1 text-[11px] text-slate-400">
                        <Thermometer className="h-3 w-3 text-emerald-400" />
                        {t('overview.metricTemp')}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-white">
                        {rs.currentTempC !== null ? `${rs.currentTempC.toFixed(1)} °C` : '—'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {rs.dewPointC !== null
                          ? t('overview.dewPoint', { value: rs.dewPointC })
                          : t('overview.targetRange', {
                              min: rs.room.targetTempMin,
                              max: rs.room.targetTempMax,
                            })}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center gap-1 text-[11px] text-slate-400">
                        <Droplets className="h-3 w-3 text-sky-400" />
                        {t('overview.metricHumidity')}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-white">
                        {rs.currentHumidityPct !== null ? `${rs.currentHumidityPct.toFixed(0)} %` : '—'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {rs.periodCostEur.toFixed(2)} €
                      </div>
                    </div>
                  </div>

                  {/* Appareils de la pièce */}
                  {rs.devices.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {rs.devices.map((dev) => {
                        const dkSummary = extractDaikinSummary(dev.lastRawStatus, locale);
                        const hcSummary = extractHomeConnectSummary(dev.lastRawStatus, locale);
                        const somfySummary = extractSomfyDisplaySummary(dev, locale);
                        const xsSummary = extractXSenseSummary(dev.lastRawStatus, locale);
                        const miSummary = extractXiaomiSummary(dev.lastRawStatus, locale);
                        return (
                          <div
                            key={dev.id}
                            className="flex items-center justify-between gap-2 text-xs rounded-lg bg-slate-950/40 px-2.5 py-1.5"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {dev.isOnline ? (
                                <Wifi className="h-3 w-3 text-emerald-400 shrink-0" />
                              ) : (
                                <WifiOff className="h-3 w-3 text-slate-500 shrink-0" />
                              )}
                              <span className="truncate text-slate-300">
                                {dev.customName || dev.name}
                              </span>
                              {dev.systems.map((sys) => {
                                const meta = VENDOR_REGISTRY[sys];
                                return (
                                  <span
                                    key={sys}
                                    title={meta.label}
                                    className={`shrink-0 rounded border px-1 py-0.2 text-[9px] font-semibold uppercase ${meta.badgeClass}`}
                                  >
                                    {meta.shortLabel}
                                  </span>
                                );
                              })}
                            </div>
                            <div className="flex items-center gap-2 shrink-0 text-slate-400 font-mono text-[11px]">
                              {dev.lastPowerW !== null && (
                                <span
                                  className={
                                    dev.excludeFromTotals ? 'text-amber-300/80' : 'text-indigo-300'
                                  }
                                  title={
                                    dev.excludeFromTotals
                                      ? t('overview.cascadeTitle')
                                      : undefined
                                  }
                                >
                                  {dev.lastPowerW.toFixed(0)}W
                                  {dev.excludeFromTotals ? ` ${t('overview.cascadeSuffix')}` : ''}
                                </span>
                              )}
                              {dev.lastTempC !== null && hasValidTempMeasurement(dev) && (
                                <span className="text-emerald-300">{dev.lastTempC.toFixed(1)}°C</span>
                              )}
                              {dev.lastHumidityPct !== null && hasValidHumidityMeasurement(dev) && (
                                <span className="text-sky-300">{dev.lastHumidityPct.toFixed(0)}%</span>
                              )}
                              {dev.lastContactOpen !== null && (
                                <span
                                  className={
                                    dev.lastContactOpen ? 'text-amber-300' : 'text-emerald-300'
                                  }
                                >
                                  {dev.lastContactOpen ? t('common.open') : t('common.closed')}
                                </span>
                              )}
                              {somfySummary?.cover && (
                                <span
                                  className={
                                    somfySummary.cover.state === 'closed'
                                      ? 'text-emerald-300'
                                      : somfySummary.cover.state === 'open'
                                        ? 'text-sky-300'
                                        : 'text-amber-300'
                                  }
                                  title={somfySummary.cover.kindLabel}
                                >
                                  {somfySummary.compactBadge}
                                </span>
                              )}
                              {hcSummary && (hcSummary.compactText || hcSummary.doorOpen) && (
                                <span
                                  className={
                                    hcSummary.doorOpen
                                      ? 'text-amber-300'
                                      : hcSummary.operationTone === 'cyan'
                                        ? 'text-cyan-300'
                                        : hcSummary.operationTone === 'emerald'
                                          ? 'text-emerald-300'
                                          : 'text-slate-300'
                                  }
                                  title={hcSummary.activeProgram ?? undefined}
                                >
                                  {hcSummary.compactText}
                                  {hcSummary.doorOpen
                                    ? `${hcSummary.compactText ? ' · ' : ''}${t('common.doorOpen')}`
                                    : ''}
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
                                  {dkSummary.modeLabel}
                                  {dkSummary.targetTempC !== null ? ` (${dkSummary.targetTempC}°C)` : ''}
                                  {dkSummary.outdoorTempC !== null
                                    ? ` · ${t('overview.extTemp', { value: dkSummary.outdoorTempC })}`
                                    : ''}
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
                                  {xsSummary.alarmLabel}
                                  {xsSummary.coPpm !== null ? ` · ${xsSummary.coPpm} ppm` : ''}
                                </span>
                              )}
                              {miSummary &&
                                (miSummary.pm25 !== null ||
                                  miSummary.vacuumState ||
                                  miSummary.alertLabel) && (
                                  <span
                                    title={miSummary.compactText}
                                    className={
                                      miSummary.isAlert ? 'text-rose-300 font-semibold' : 'text-orange-300'
                                    }
                                  >
                                    {miSummary.alertLabel
                                      ? miSummary.alertLabel
                                      : miSummary.pm25 !== null
                                        ? `PM2.5 ${miSummary.pm25}`
                                        : miSummary.vacuumState}
                                  </span>
                                )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Appareils non assignés si présents */}
      {data.devices.some((d) => d.roomId === null) && (
        <AlertBanner
          tone="warning"
          icon={<Cpu className="h-4 w-4 text-amber-400 shrink-0" />}
          className="rounded-2xl p-4 text-sm"
          action={
            <Button
              size="sm"
              onClick={() => onNavigateTab('devices')}
              className="border-amber-500/40 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
            >
              {t('overview.assignDevices')}
            </Button>
          }
        >
          {t('overview.unassignedAlert', {
            count: data.devices.filter((d) => d.roomId === null).length,
          })}
        </AlertBanner>
      )}
    </div>
  );
}
