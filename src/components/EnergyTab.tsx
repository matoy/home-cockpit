'use client';

import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Zap, Euro, Activity, Layers, Download, TrendingUp, Calendar, Gauge } from 'lucide-react';
import { buildEnergyTimeSeriesCsv, triggerCsvDownload } from '@/lib/csv-export';
import { useI18n } from '@/components/I18nProvider';
import type { DashboardPayload } from '@/types';

interface EnergyTabProps {
  data: DashboardPayload;
}

type MetricType = 'energy' | 'power' | 'cost';
type GroupBy = 'room' | 'device';

const DEVICE_PALETTE = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#38bdf8',
  '#a855f7',
  '#f43f5e',
  '#14b8a6',
];

export function EnergyTab({ data }: EnergyTabProps) {
  const { t, intlLocale } = useI18n();
  const [metric, setMetric] = useState<MetricType>('energy');
  const [groupBy, setGroupBy] = useState<GroupBy>('room');

  const rawBreakdown = groupBy === 'room' ? data.energyByRoom : data.energyByDevice;
  const breakdown = rawBreakdown.map((item) => ({
    ...item,
    name: item.isUnmeasured ? t('energy.unmeasuredLabel') : item.name,
  }));
  const seriesKeys = breakdown.map((item, idx) => ({
    key: item.id,
    name: item.name,
    color: groupBy === 'room' ? item.color : DEVICE_PALETTE[idx % DEVICE_PALETTE.length],
  }));

  const chartData = data.timeSeries.map((pt) => {
    const row: Record<string, string | number> = { label: pt.label };
    for (const s of seriesKeys) {
      if (groupBy === 'room') {
        row[s.key] =
          metric === 'energy'
            ? pt.byRoomEnergy[s.key] ?? 0
            : metric === 'power'
              ? pt.byRoomPower[s.key] ?? 0
              : pt.byRoomCost[s.key] ?? 0;
      } else {
        row[s.key] =
          metric === 'energy'
            ? pt.byDeviceEnergy[s.key] ?? 0
            : metric === 'power'
              ? pt.byDevicePower[s.key] ?? 0
              : pt.byDeviceCost[s.key] ?? 0;
      }
    }
    return row;
  });

  const unit = metric === 'energy' ? 'kWh' : metric === 'power' ? 'W' : '€';
  const hasHpHc = data.kpis.hpEnergyKwh > 0 || data.kpis.hcEnergyKwh > 0;
  const sortTooltipDesc = (item: { value?: unknown }) =>
    typeof item.value === 'number' && Number.isFinite(item.value)
      ? -item.value
      : Number.POSITIVE_INFINITY;

  return (
    <div className="space-y-6">
      {/* Barre de contrôles */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-400 mr-1 flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" /> {t('energy.metricLabel')}
          </span>
          {(
            [
              { id: 'energy', label: t('energy.metricEnergy') },
              { id: 'power', label: t('energy.metricPower') },
              { id: 'cost', label: t('energy.metricCost') },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              onClick={() => setMetric(item.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                metric === item.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-400 mr-1 flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" /> {t('energy.breakdownLabel')}
          </span>
          <button
            onClick={() => setGroupBy('room')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              groupBy === 'room'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {t('energy.byRoom')}
          </button>
          <button
            onClick={() => setGroupBy('device')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              groupBy === 'device'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {t('energy.byDevice')}
          </button>
          <button
            type="button"
            onClick={() =>
              triggerCsvDownload(
                `home-cockpit-energy-${data.range}.csv`,
                buildEnergyTimeSeriesCsv(data)
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition"
          >
            <Download className="h-3.5 w-3.5 text-indigo-400" />
            {t('energy.exportCsv')}
          </button>
        </div>
      </div>

      {/* Bandeau Compteur Linky (Conso API) : Couverture & Puissance max */}
      {data.meter?.activeInCurrentView && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-lime-500/30 bg-slate-900/70 p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-lime-500/40 bg-lime-500/15 px-2 py-0.5 text-[10px] font-semibold text-lime-300">
                  Linky
                </span>
                <span className="text-xs font-semibold text-white">
                  {t('energy.meterTitle')}
                </span>
              </div>
              {data.meter.lastPublishedDate && (
                <span className="text-[11px] text-slate-400">
                  {t('energy.meterUntil', { date: data.meter.lastPublishedDate })}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
              <div>
                <span className="text-slate-400">{t('energy.meterTotalLabel')} </span>
                <span className="font-mono font-bold text-white">
                  {data.meter.periodMeterEnergyKwh.toFixed(2)} kWh
                </span>
                <span className="text-emerald-400 font-mono ml-1">
                  ({data.meter.periodMeterCostEur.toFixed(2)} €)
                </span>
              </div>
              <div>
                <span className="text-slate-400">{t('energy.meterMeasuredLabel')} </span>
                <span className="font-mono font-semibold text-indigo-300">
                  {data.meter.periodMeasuredEnergyKwh.toFixed(2)} kWh
                  {data.meter.measuredCoveragePct !== null
                    ? ` (${data.meter.measuredCoveragePct.toFixed(0)}%)`
                    : ''}
                </span>
              </div>
              <div>
                <span className="text-slate-400">{t('energy.meterUnmeasuredShort')} </span>
                <span className="font-mono font-semibold text-slate-200">
                  {data.meter.periodUnmeasuredEnergyKwh.toFixed(2)} kWh
                </span>
              </div>
            </div>

            {data.meter.todayLiveMeasuredKwh > 0 && (
              <p className="text-[11px] text-slate-400">
                {t('energy.meterTodayLiveNote', {
                  kwh: data.meter.todayLiveMeasuredKwh.toFixed(2),
                })}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Gauge className="h-4 w-4 text-lime-400" />
                {t('energy.meterMaxPowerTitle')}
              </div>
              {data.meter.subscribedPowerKva && (
                <span className="text-[11px] font-mono text-slate-400">
                  {t('energy.meterSubscribed', { kva: data.meter.subscribedPowerKva })}
                </span>
              )}
            </div>

            {data.meter.periodMaxPowerVa !== null ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold font-mono text-white">
                      {data.meter.periodMaxPowerVa.toLocaleString(intlLocale)} VA
                    </span>
                    {data.meter.periodMaxPowerAt && (
                      <span className="text-[11px] text-slate-400">
                        ({new Date(data.meter.periodMaxPowerAt).toLocaleDateString(intlLocale)})
                      </span>
                    )}
                  </div>
                  {data.meter.subscribedPowerKva && (() => {
                    const pct = Math.round(
                      (data.meter.periodMaxPowerVa / (data.meter.subscribedPowerKva * 1000)) * 100
                    );
                    return (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          pct >= 85
                            ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                            : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                        }`}
                      >
                        {t('energy.meterLoadPct', { pct })}
                      </span>
                    );
                  })()}
                </div>
                {data.meter.subscribedPowerKva && (
                  <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        data.meter.periodMaxPowerVa / (data.meter.subscribedPowerKva * 1000) >= 0.85
                          ? 'bg-amber-400'
                          : 'bg-lime-400'
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            3,
                            Math.round(
                              (data.meter.periodMaxPowerVa / (data.meter.subscribedPowerKva * 1000)) *
                                100
                            )
                          )
                        )}%`,
                      }}
                    />
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-500">{t('energy.meterNoMaxPower')}</p>
            )}
          </div>
        </div>
      )}

      {/* Comparaison période précédente & projection fin de mois */}
      {((data.kpis.energyDeltaPct !== null && data.kpis.energyDeltaPct !== undefined) ||
        (data.kpis.projectedMonthCostEur !== null &&
          data.kpis.projectedMonthCostEur !== undefined)) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-indigo-400" />
                {t('energy.compTitle')}
              </div>
              {data.kpis.prevPeriodEnergyKwh !== null &&
              data.kpis.prevPeriodEnergyKwh !== undefined ? (
                <div className="text-xs text-slate-300">
                  {t('energy.compPrevPeriod', {
                    kwh: data.kpis.prevPeriodEnergyKwh.toFixed(2),
                    cost: (data.kpis.prevPeriodCostEur ?? 0).toFixed(2),
                  })}
                </div>
              ) : (
                <div className="text-xs text-slate-500">{t('energy.compNoPrev')}</div>
              )}
            </div>
            {data.kpis.energyDeltaPct !== null && data.kpis.energyDeltaPct !== undefined && (
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold shrink-0 ${
                  data.kpis.energyDeltaPct > 0
                    ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                    : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                }`}
              >
                {data.kpis.energyDeltaPct > 0 ? '+' : ''}
                {data.kpis.energyDeltaPct.toFixed(1)}%
              </span>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-emerald-400" />
                {t('energy.projTitle')}
              </div>
              <div className="text-xs text-slate-400">{t('energy.projSub')}</div>
            </div>
            {data.kpis.projectedMonthCostEur !== null &&
              data.kpis.projectedMonthCostEur !== undefined && (
                <div className="text-right shrink-0">
                  <div className="text-base font-bold text-white font-mono">
                    {data.kpis.projectedMonthCostEur.toFixed(2)} €
                  </div>
                  <div className="text-[11px] text-emerald-400 font-mono">
                    {(data.kpis.projectedMonthEnergyKwh ?? 0).toFixed(0)} kWh
                  </div>
                </div>
              )}
          </div>
        </div>
      )}

      {/* Graphique empilé principal */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">
              {metric === 'energy'
                ? t('energy.chartTitleEnergy')
                : metric === 'power'
                  ? t('energy.chartTitlePower')
                  : t('energy.chartTitleCost')}{' '}
              {groupBy === 'room' ? t('energy.chartSubRoom') : t('energy.chartSubDevice')}
            </h3>
            <p className="text-xs text-slate-400">
              {t('energy.pointsAggregated', { count: data.timeSeries.length })}
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-white">
              {t('energy.totalLabel')}{' '}
              {metric === 'energy'
                ? `${data.kpis.periodEnergyKwh.toFixed(2)} kWh`
                : metric === 'cost'
                  ? `${data.kpis.periodCostEur.toFixed(2)} €`
                  : t('energy.currentWatts', { watts: data.kpis.currentPowerW.toFixed(0) })}
            </div>
          </div>
        </div>

        {chartData.length === 0 || seriesKeys.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-slate-500">
            {t('energy.noData')}
          </div>
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {metric === 'power' ? (
                <AreaChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={11} minTickGap={24} />
                  <YAxis stroke="#64748b" fontSize={11} unit={` ${unit}`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '12px',
                      fontSize: '12px',
                    }}
                    itemSorter={sortTooltipDesc}
                    formatter={(val) => `${Number(val ?? 0).toFixed(1)} ${unit}`}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  {seriesKeys.map((s) => (
                    <Area
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.name}
                      stackId="1"
                      stroke={s.color}
                      fill={s.color}
                      fillOpacity={0.45}
                    />
                  ))}
                </AreaChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={11} minTickGap={24} />
                  <YAxis stroke="#64748b" fontSize={11} unit={` ${unit}`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '12px',
                      fontSize: '12px',
                    }}
                    itemSorter={sortTooltipDesc}
                    formatter={(val) =>
                      `${Number(val ?? 0).toFixed(metric === 'energy' ? 3 : 2)} ${unit}`
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  {seriesKeys.map((s) => (
                    <Bar key={s.key} dataKey={s.key} name={s.name} stackId="1" fill={s.color} />
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Répartition + Ventilation tarifaire */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Donut chart */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h3 className="text-sm font-semibold text-white mb-1">
            {t('energy.shareTitle', {
              scope: groupBy === 'room' ? t('energy.chartSubRoom') : t('energy.chartSubDevice'),
            })}
          </h3>
          <p className="text-xs text-slate-400 mb-4">{t('energy.shareSubtitle')}</p>

          {breakdown.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-slate-500">
              {t('common.noData')}
            </div>
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={breakdown}
                    dataKey="energyKwh"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={82}
                    paddingAngle={3}
                  >
                    {breakdown.map((entry, idx) => (
                      <Cell
                        key={entry.id}
                        fill={
                          groupBy === 'room'
                            ? entry.color
                            : DEVICE_PALETTE[idx % DEVICE_PALETTE.length]
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '12px',
                      fontSize: '12px',
                    }}
                    formatter={(value, name) => [
                      `${Number(value ?? 0).toFixed(2)} kWh`,
                      String(name ?? ''),
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Top consommateurs */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h3 className="text-sm font-semibold text-white mb-1">
            {t('energy.rankingTitle')}
          </h3>
          <p className="text-xs text-slate-400 mb-4">{t('energy.rankingSubtitle')}</p>

          <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
            {breakdown.map((item, idx) => {
              const color =
                groupBy === 'room' ? item.color : DEVICE_PALETTE[idx % DEVICE_PALETTE.length];
              return (
                <div key={item.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="font-medium text-slate-200 truncate">{item.name}</span>
                      {item.excludeFromTotals && (
                        <span
                          title={t('energy.cascadeTitle')}
                          className="rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-300 shrink-0"
                        >
                          {t('energy.cascadeBadge')}
                        </span>
                      )}
                      {item.roomName && (
                        <span className="text-[10px] text-slate-500">({item.roomName})</span>
                      )}
                    </div>
                    <div className="font-mono text-slate-300 shrink-0">
                      {item.energyKwh.toFixed(2)} kWh ·{' '}
                      <span className="text-emerald-400">{item.costEur.toFixed(2)} €</span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(2, item.sharePct))}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>{t('energy.sharePct', { pct: item.sharePct.toFixed(1) })}</span>
                    <span>
                      {t('energy.avgMaxPower', {
                        avg: item.avgPowerW.toFixed(0),
                        max: item.maxPowerW.toFixed(0),
                      })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Encart Ventilation Tarifaire */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-white">{t('energy.tariffBreakdownTitle')}</h3>
              <Euro className="h-4 w-4 text-emerald-400" />
            </div>
            <p className="text-xs text-slate-400 mb-4">
              {t('energy.tariffBreakdownSubtitle')}
            </p>

            <div className="space-y-3">
              {hasHpHc ? (
                <>
                  <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-amber-200">{t('energy.hpLabel')}</div>
                      <div className="text-[11px] text-amber-300/70">
                        {data.kpis.hpEnergyKwh.toFixed(2)} kWh
                      </div>
                    </div>
                    <div className="text-sm font-bold text-amber-300">
                      {data.kpis.hpCostEur.toFixed(2)} €
                    </div>
                  </div>

                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-emerald-200">{t('energy.hcLabel')}</div>
                      <div className="text-[11px] text-emerald-300/70">
                        {data.kpis.hcEnergyKwh.toFixed(2)} kWh
                      </div>
                    </div>
                    <div className="text-sm font-bold text-emerald-300">
                      {data.kpis.hcCostEur.toFixed(2)} €
                    </div>
                  </div>
                </>
              ) : null}

              {data.kpis.baseEnergyKwh > 0 && (
                <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/10 p-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium text-indigo-200">{t('energy.baseLabel')}</div>
                    <div className="text-[11px] text-indigo-300/70">
                      {data.kpis.baseEnergyKwh.toFixed(2)} kWh
                    </div>
                  </div>
                  <div className="text-sm font-bold text-indigo-300">
                    {data.kpis.baseCostEur.toFixed(2)} €
                  </div>
                </div>
              )}
            </div>
          </div>

          {(() => {
            const energyCostEur = data.kpis.energyCostEur ?? data.kpis.periodCostEur;
            const energyCostHtEur = data.kpis.energyCostHtEur ?? 0;
            const subCostEur = data.kpis.subscriptionCostEur;
            const subCostHtEur = data.kpis.subscriptionCostHtEur ?? 0;
            const contribsCostEur = data.kpis.contributionsCostEur ?? 0;
            const contribsCostHtEur = data.kpis.contributionsCostHtEur ?? 0;
            const totalHtEur =
              data.kpis.totalPeriodCostHtEur ?? energyCostHtEur + subCostHtEur + contribsCostHtEur;
            const totalVatEur = data.kpis.totalPeriodVatEur ?? 0;
            const totalTtcEur =
              data.kpis.totalPeriodCostEur ?? energyCostEur + subCostEur + contribsCostEur;
            const contribsItems = data.kpis.contributionsBreakdown ?? [];

            return (
              <div className="mt-4 pt-4 border-t border-slate-800 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>{t('energy.effectiveRateLabel')}</span>
                  <span className="font-mono text-white font-medium">
                    {data.kpis.effectiveRateEurPerKwh.toFixed(4)} €/kWh
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>{t('energy.invoiceEnergyLabel')}</span>
                  <span className="font-mono text-slate-200">
                    {energyCostEur.toFixed(2)} €{' '}
                    <span className="text-slate-500">({energyCostHtEur.toFixed(2)} € HT)</span>
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>{t('energy.proratedSubLabel')}</span>
                  <span className="font-mono text-slate-200">
                    +{subCostEur.toFixed(2)} €{' '}
                    <span className="text-slate-500">({subCostHtEur.toFixed(2)} € HT)</span>
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>{t('energy.invoiceContributionsLabel')}</span>
                  <span className="font-mono text-amber-300">
                    +{contribsCostEur.toFixed(2)} €{' '}
                    <span className="text-slate-500">({contribsCostHtEur.toFixed(2)} € HT)</span>
                  </span>
                </div>
                {contribsItems.length > 0 && (
                  <div className="pl-3 space-y-0.5 border-l border-slate-800 text-[11px] text-slate-400">
                    {contribsItems.map((item) => (
                      <div key={`${item.id}-${item.kind}`} className="flex justify-between gap-2">
                        <span className="truncate">
                          {item.name} ({item.vatRatePct}%)
                        </span>
                        <span className="font-mono text-slate-300 shrink-0">
                          +{item.costTtcEur.toFixed(2)} €
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="pt-1.5 mt-1 border-t border-slate-800/80 flex justify-between text-[11px] text-slate-400">
                  <span>
                    {t('energy.invoiceTotalHtLabel')}:{' '}
                    <span className="font-mono text-slate-300">{totalHtEur.toFixed(2)} €</span>
                  </span>
                  <span>
                    {t('energy.invoiceVatLabel')}:{' '}
                    <span className="font-mono text-slate-300">{totalVatEur.toFixed(2)} €</span>
                  </span>
                </div>
                <div className="flex justify-between text-slate-200 font-semibold pt-0.5">
                  <span className="flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5 text-indigo-400" /> {t('energy.invoiceTotalTtcLabel')}
                  </span>
                  <span className="text-emerald-400 font-mono">{totalTtcEur.toFixed(2)} €</span>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
