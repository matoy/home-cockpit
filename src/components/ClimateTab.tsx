'use client';

import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
} from 'recharts';
import {
  Thermometer,
  Droplets,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
  Plug,
  Download,
} from 'lucide-react';
import { buildClimateStatsCsv, triggerCsvDownload } from '@/lib/csv-export';
import { isActiveClimateSensor } from '@/lib/device-utils';
import { useI18n } from '@/components/I18nProvider';
import { Card, ConnectivityBatteryKpi } from '@/components/ui';
import type { DashboardPayload } from '@/types';

interface ClimateTabProps {
  data: DashboardPayload;
}

export function ClimateTab({ data }: ClimateTabProps) {
  const { t } = useI18n();
  const climateRooms = useMemo(
    () => data.roomSummaries.filter((rs) => rs.currentTempC !== null || rs.currentHumidityPct !== null),
    [data.roomSummaries]
  );

  const [correlationRoomId, setCorrelationRoomId] = useState<string>(() => {
    const withBoth = data.roomSummaries.find(
      (rs) => rs.currentTempC !== null && rs.devices.some((d) => d.lastPowerW !== null)
    );
    return withBoth ? String(withBoth.room.id) : data.rooms[0] ? String(data.rooms[0].id) : '';
  });

  const tempChartData = useMemo(
    () =>
      data.timeSeries.map((pt) => {
        const row: Record<string, string | number | null> = { label: pt.label };
        for (const rs of climateRooms) {
          row[String(rs.room.id)] = pt.byRoomTemp[String(rs.room.id)] ?? null;
        }
        return row;
      }),
    [data.timeSeries, climateRooms]
  );

  const humidityChartData = useMemo(
    () =>
      data.timeSeries.map((pt) => {
        const row: Record<string, string | number | null> = { label: pt.label };
        for (const rs of climateRooms) {
          row[String(rs.room.id)] = pt.byRoomHumidity[String(rs.room.id)] ?? null;
        }
        return row;
      }),
    [data.timeSeries, climateRooms]
  );

  const correlationData = useMemo(() => {
    if (!correlationRoomId) return [];
    return data.timeSeries.map((pt) => ({
      label: pt.label,
      powerW: pt.byRoomPower[correlationRoomId] ?? 0,
      tempC: pt.byRoomTemp[correlationRoomId] ?? null,
    }));
  }, [data.timeSeries, correlationRoomId]);

  const activeCorrelationRoom = data.rooms.find((r) => String(r.id) === correlationRoomId);

  const climateSensors = useMemo(() => {
    return data.devices
      .filter((d) => {
        if (!isActiveClimateSensor(d)) return false;
        if (data.selectedSystem !== 'all' && !d.systems.includes(data.selectedSystem)) {
          return false;
        }
        if (data.selectedRoomId !== 'all' && String(d.roomId) !== data.selectedRoomId) {
          return false;
        }
        return true;
      })
      .map((d) => ({
        name: d.customName || d.name,
        isOnline: d.isOnline,
        batteryPct: d.lastBatteryPct,
        isMains: !d.dpConfig?.battery?.code && d.lastBatteryPct === null,
      }));
  }, [data.devices, data.selectedRoomId, data.selectedSystem]);

  const sortedRoomSummaries = useMemo(() => {
    const withSensor: DashboardPayload['roomSummaries'] = [];
    const withoutSensor: DashboardPayload['roomSummaries'] = [];
    for (const rs of data.roomSummaries) {
      const hasSensor =
        rs.devices.some((d) => isActiveClimateSensor(d)) ||
        rs.currentTempC !== null ||
        rs.currentHumidityPct !== null;
      if (hasSensor) {
        withSensor.push(rs);
      } else {
        withoutSensor.push(rs);
      }
    }
    return [...withSensor, ...withoutSensor];
  }, [data.roomSummaries]);

  const sortTooltipDesc = (item: { value?: unknown }) =>
    typeof item.value === 'number' && Number.isFinite(item.value)
      ? -item.value
      : Number.POSITIVE_INFINITY;

  const { kpis } = data;

  return (
    <div className="space-y-6">
      {/* 4 KPIs Climat & Piles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('climate.kpiAvgTemp')}
            </span>
            <div className="rounded-lg bg-emerald-500/15 p-2 text-emerald-400">
              <Thermometer className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {kpis.avgTempC !== null ? `${kpis.avgTempC.toFixed(1)} °C` : '—'}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {t('climate.equippedRooms', { count: climateRooms.length })}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('climate.kpiAvgHumidity')}
            </span>
            <div className="rounded-lg bg-sky-500/15 p-2 text-sky-400">
              <Droplets className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {kpis.avgHumidityPct !== null ? `${kpis.avgHumidityPct.toFixed(0)} %` : '—'}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {t('climate.healthyHumidityZone')}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('climate.kpiThermalComfort')}
            </span>
            <div
              className={`rounded-lg p-2 ${kpis.climateAlertsCount > 0
                ? 'bg-amber-500/15 text-amber-400'
                : 'bg-emerald-500/15 text-emerald-400'
                }`}
            >
              {kpis.climateAlertsCount > 0 ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-white">
              {kpis.climateAlertsCount > 0
                ? t('climate.alertsCount', { count: kpis.climateAlertsCount })
                : t('climate.optimalZone')}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {kpis.climateAlertsCount > 0
              ? t('climate.roomsOutOfTarget')
              : t('climate.allRoomsInTarget')}
          </p>
        </div>

        <ConnectivityBatteryKpi
          title={t('climate.kpiConnectivity')}
          sensors={climateSensors}
          noActiveSensorLabel={t('climate.noActiveSensor')}
          mainsCountLabel={(count) => t('climate.mainsCount', { count })}
          lowBatteryLabel={(count) => t('climate.lowBatteryCount', { count })}
        />
      </div>

      {/* Multi-courbes Température */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-emerald-400" />
              {t('climate.tempChartTitle')}
            </h3>
            <p className="text-xs text-slate-400">
              {t('climate.tempChartSub')}
            </p>
          </div>
        </div>

        {climateRooms.length === 0 || tempChartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-sm text-slate-500">
            {t('climate.noTempSensor')}
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={tempChartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <ReferenceArea y1={19} y2={22} fill="#10b981" fillOpacity={0.08} />
                <XAxis dataKey="label" stroke="#64748b" fontSize={11} minTickGap={24} />
                <YAxis stroke="#64748b" fontSize={11} domain={['auto', 'auto']} unit="°C" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '12px',
                    fontSize: '12px',
                  }}
                  itemSorter={sortTooltipDesc}
                  formatter={(val) => `${Number(val ?? 0).toFixed(1)} °C`}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                {climateRooms.map((rs) => (
                  <Line
                    key={rs.room.id}
                    type="monotone"
                    dataKey={String(rs.room.id)}
                    name={rs.room.name}
                    stroke={rs.room.color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Multi-courbes Humidité */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Droplets className="h-4 w-4 text-sky-400" />
            {t('climate.humidityChartTitle')}
          </h3>
          <p className="text-xs text-slate-400">
            {t('climate.humidityChartSub')}
          </p>
        </div>

        {climateRooms.length === 0 || humidityChartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-sm text-slate-500">
            {t('climate.noHumiditySensor')}
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={humidityChartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <ReferenceArea y1={40} y2={60} fill="#38bdf8" fillOpacity={0.08} />
                <XAxis dataKey="label" stroke="#64748b" fontSize={11} minTickGap={24} />
                <YAxis stroke="#64748b" fontSize={11} domain={[20, 95]} unit="%" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '12px',
                    fontSize: '12px',
                  }}
                  itemSorter={sortTooltipDesc}
                  formatter={(val) => `${Number(val ?? 0).toFixed(0)} %`}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                {climateRooms.map((rs) => (
                  <Line
                    key={rs.room.id}
                    type="monotone"
                    dataKey={String(rs.room.id)}
                    name={rs.room.name}
                    stroke={rs.room.color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Corrélation Puissance vs Température */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              {t('climate.correlationTitle')}
            </h3>
            <p className="text-xs text-slate-400">
              {t('climate.correlationSub')}
            </p>
          </div>

          <select
            value={correlationRoomId}
            onChange={(e) => setCorrelationRoomId(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
          >
            {data.rooms.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        {correlationData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-sm text-slate-500">
            {t('climate.notEnoughRoomData')}
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={correlationData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="label" stroke="#64748b" fontSize={11} minTickGap={24} />
                <YAxis
                  yAxisId="left"
                  stroke="#818cf8"
                  fontSize={11}
                  unit=" W"
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#34d399"
                  fontSize={11}
                  domain={['auto', 'auto']}
                  unit="°C"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '12px',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="powerW"
                  name={t('climate.powerLegend', { room: activeCorrelationRoom?.name ?? '' })}
                  stroke="#6366f1"
                  fill="#6366f1"
                  fillOpacity={0.25}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="tempC"
                  name={t('climate.tempLegend', { room: activeCorrelationRoom?.name ?? '' })}
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Tableau récapitulatif */}
      <Card padded={false} className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">{t('climate.statsTableTitle')}</h3>
          <button
            type="button"
            onClick={() =>
              triggerCsvDownload(
                `home-cockpit-climate-${data.range}.csv`,
                buildClimateStatsCsv(sortedRoomSummaries)
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition"
          >
            <Download className="h-3.5 w-3.5 text-emerald-400" />
            {t('climate.exportCsv')}
          </button>
        </div>
        <table className="w-full table-fixed text-left text-xs">
          <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider">
            <tr>
              <th className="w-[15%] px-3 py-3">{t('climate.colRoom')}</th>
              <th className="w-[10%] px-3 py-3">{t('climate.colCurrentTemp')}</th>
              <th className="w-[17%] px-3 py-3">{t('climate.colMinMaxAvg')}</th>
              <th className="w-[9%] px-3 py-3">{t('climate.colAmplitude')}</th>
              <th className="w-[14%] px-3 py-3">{t('climate.colHumidity')}</th>
              <th className="w-[9%] px-3 py-3">{t('climate.colDewPoint')}</th>
              <th className="w-[14%] px-3 py-3">{t('climate.colBatteries')}</th>
              <th className="w-[12%] px-3 py-3">{t('climate.colStatus')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {sortedRoomSummaries.map((rs) => {
              const amplitude =
                rs.maxTempC !== null && rs.minTempC !== null
                  ? (rs.maxTempC - rs.minTempC).toFixed(1)
                  : null;
              const roomClimateSensors = rs.devices.filter((d) => isActiveClimateSensor(d));
              return (
                <tr key={rs.room.id} className="hover:bg-slate-800/30">
                  <td className="px-3 py-3 font-medium text-white min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: rs.room.color }}
                      />
                      <span className="truncate">{rs.room.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-emerald-300 truncate">
                    {rs.currentTempC !== null ? `${rs.currentTempC.toFixed(1)} °C` : '—'}
                  </td>
                  <td className="px-3 py-3 font-mono text-slate-300 truncate">
                    {rs.minTempC !== null && rs.maxTempC !== null && rs.avgTempC !== null
                      ? `${rs.minTempC.toFixed(1)} / ${rs.maxTempC.toFixed(1)} / ${rs.avgTempC.toFixed(1)} °C`
                      : '—'}
                  </td>
                  <td className="px-3 py-3 font-mono text-slate-400 truncate">
                    {amplitude !== null ? `Δ ${amplitude} °C` : '—'}
                  </td>
                  <td className="px-3 py-3 font-mono text-sky-300 truncate">
                    {rs.avgHumidityPct !== null
                      ? `${rs.avgHumidityPct.toFixed(0)}% (${rs.minHumidityPct?.toFixed(0)}-${rs.maxHumidityPct?.toFixed(0)}%)`
                      : '—'}
                  </td>
                  <td className="px-3 py-3 font-mono text-slate-300 truncate">
                    {rs.dewPointC !== null ? `${rs.dewPointC.toFixed(1)} °C` : '—'}
                  </td>
                  <td className="px-3 py-3 font-mono min-w-0">
                    {roomClimateSensors.length === 0 ? (
                      <span className="text-slate-500">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {roomClimateSensors.map((s) => {
                          const pct = s.lastBatteryPct;
                          const isMains = pct === null && !s.dpConfig?.battery?.code;
                          const badgeColor =
                            pct === null
                              ? 'border-slate-700 bg-slate-800 text-slate-400'
                              : pct <= 20
                                ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                                : pct <= 40
                                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                                  : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300';
                          const sensorName = s.customName || s.name;
                          return (
                            <span
                              key={s.id}
                              title={
                                isMains
                                  ? t('climate.mainsTooltip', { name: sensorName })
                                  : sensorName
                              }
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${badgeColor}`}
                            >
                              {s.isOnline ? (
                                <Wifi className="h-2.5 w-2.5" />
                              ) : (
                                <WifiOff className="h-2.5 w-2.5" />
                              )}
                              {isMains && <Plug className="h-2.5 w-2.5" />}
                              {pct !== null ? `${pct}%` : isMains ? t('climate.mainsBadge') : 'N/A'}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 min-w-0">
                    <span className="inline-block max-w-full truncate rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] text-slate-200">
                      {rs.comfort.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
