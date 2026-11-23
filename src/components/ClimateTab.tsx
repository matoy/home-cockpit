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
  Battery,
  BatteryWarning,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
  Plug,
} from 'lucide-react';
import { isActiveClimateSensor } from '@/lib/device-utils';
import { useI18n } from '@/components/I18nProvider';
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

  const climateHealth = useMemo(() => {
    const sensors = data.devices.filter((d) => {
      if (!isActiveClimateSensor(d)) return false;
      if (data.selectedSystem !== 'all' && !d.systems.includes(data.selectedSystem)) {
        return false;
      }
      if (data.selectedRoomId !== 'all' && String(d.roomId) !== data.selectedRoomId) {
        return false;
      }
      return true;
    });

    const onlineCount = sensors.filter((d) => d.isOnline).length;
    const withBattery = sensors.filter(
      (d): d is typeof d & { lastBatteryPct: number } =>
        d.lastBatteryPct !== null && Number.isFinite(d.lastBatteryPct)
    );
    const mainsPoweredCount = sensors.filter(
      (d) => !d.dpConfig?.battery?.code && d.lastBatteryPct === null
    ).length;
    const lowBatteryCount = withBattery.filter((d) => d.lastBatteryPct <= 20).length;
    const avgBatteryPct =
      withBattery.length > 0
        ? Math.round(withBattery.reduce((s, d) => s + d.lastBatteryPct, 0) / withBattery.length)
        : null;
    const minBatteryPct =
      withBattery.length > 0 ? Math.min(...withBattery.map((d) => d.lastBatteryPct)) : null;

    return {
      sensors,
      totalCount: sensors.length,
      onlineCount,
      mainsPoweredCount,
      lowBatteryCount,
      avgBatteryPct,
      minBatteryPct,
    };
  }, [data.devices, data.selectedRoomId]);

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
              className={`rounded-lg p-2 ${
                kpis.climateAlertsCount > 0
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

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('climate.kpiConnectivity')}
            </span>
            <div
              className={`rounded-lg p-2 ${
                climateHealth.lowBatteryCount > 0
                  ? 'bg-rose-500/15 text-rose-400'
                  : 'bg-emerald-500/15 text-emerald-400'
              }`}
            >
              {climateHealth.lowBatteryCount > 0 ? (
                <BatteryWarning className="h-4 w-4" />
              ) : (
                <Battery className="h-4 w-4" />
              )}
            </div>
          </div>
          <div
            className="mt-3 flex items-baseline gap-2"
            title={
              climateHealth.sensors
                .map(
                  (s) =>
                    `${s.customName || s.name} (${s.isOnline ? t('common.online') : t('common.offline')})`
                )
                .join(' • ') || t('climate.noActiveSensor')
            }
          >
            <span className="text-3xl font-bold tracking-tight text-white">
              {climateHealth.onlineCount} / {climateHealth.totalCount}
            </span>
            <span className="text-xs text-slate-400">{t('climate.onlineWord')}</span>
          </div>
          <p
            className={`mt-2 text-xs ${
              climateHealth.lowBatteryCount > 0 ? 'text-rose-300' : 'text-slate-400'
            }`}
          >
            {climateHealth.lowBatteryCount > 0
              ? `${t('climate.lowBatteryCount', { count: climateHealth.lowBatteryCount })}${
                  climateHealth.mainsPoweredCount > 0
                    ? t('climate.onMainsSuffix', { count: climateHealth.mainsPoweredCount })
                    : ''
                }`
              : climateHealth.avgBatteryPct !== null
                ? `${t('climate.avgMinBattery', {
                    avg: climateHealth.avgBatteryPct,
                    min: climateHealth.minBatteryPct ?? 0,
                  })}${
                    climateHealth.mainsPoweredCount > 0
                      ? t('climate.onMainsSuffix', { count: climateHealth.mainsPoweredCount })
                      : ''
                  }`
                : climateHealth.mainsPoweredCount > 0
                  ? t('climate.mainsCount', { count: climateHealth.mainsPoweredCount })
                  : t('climate.noBatteryReported')}
          </p>
        </div>
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
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-white">{t('climate.statsTableTitle')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">{t('climate.colRoom')}</th>
                <th className="px-4 py-3">{t('climate.colCurrentTemp')}</th>
                <th className="px-4 py-3">{t('climate.colMinMaxAvg')}</th>
                <th className="px-4 py-3">{t('climate.colAmplitude')}</th>
                <th className="px-4 py-3">{t('climate.colHumidity')}</th>
                <th className="px-4 py-3">{t('climate.colDewPoint')}</th>
                <th className="px-4 py-3">{t('climate.colBatteries')}</th>
                <th className="px-4 py-3">{t('climate.colStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {data.roomSummaries.map((rs) => {
                const amplitude =
                  rs.maxTempC !== null && rs.minTempC !== null
                    ? (rs.maxTempC - rs.minTempC).toFixed(1)
                    : null;
                const roomClimateSensors = rs.devices.filter((d) => isActiveClimateSensor(d));
                return (
                  <tr key={rs.room.id} className="hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-medium text-white flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: rs.room.color }}
                      />
                      {rs.room.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-emerald-300">
                      {rs.currentTempC !== null ? `${rs.currentTempC.toFixed(1)} °C` : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">
                      {rs.minTempC !== null && rs.maxTempC !== null && rs.avgTempC !== null
                        ? `${rs.minTempC.toFixed(1)} / ${rs.maxTempC.toFixed(1)} / ${rs.avgTempC.toFixed(1)} °C`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-400">
                      {amplitude !== null ? `Δ ${amplitude} °C` : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-sky-300">
                      {rs.avgHumidityPct !== null
                        ? `${rs.avgHumidityPct.toFixed(0)}% (${rs.minHumidityPct?.toFixed(0)}-${rs.maxHumidityPct?.toFixed(0)}%)`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">
                      {rs.dewPointC !== null ? `${rs.dewPointC.toFixed(1)} °C` : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {roomClimateSensors.length === 0 ? (
                        <span className="text-slate-500">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
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
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] text-slate-200">
                        {rs.comfort.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
