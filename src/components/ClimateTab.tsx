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
import { Thermometer, Droplets, Zap } from 'lucide-react';
import type { DashboardPayload } from '@/types';

interface ClimateTabProps {
  data: DashboardPayload;
}

export function ClimateTab({ data }: ClimateTabProps) {
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

  return (
    <div className="space-y-6">
      {/* Multi-courbes Température */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-emerald-400" />
              Comparatif Température par Pièce (°C)
            </h3>
            <p className="text-xs text-slate-400">
              Bande verte : plage de confort thermique recommandée (19°C – 22°C)
            </p>
          </div>
        </div>

        {climateRooms.length === 0 || tempChartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-sm text-slate-500">
            Aucun capteur de température détecté sur la période.
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
            Comparatif Humidité Relative par Pièce (%)
          </h3>
          <p className="text-xs text-slate-400">
            Bande bleue : zone hygrométrique saine (40% – 60%)
          </p>
        </div>

        {climateRooms.length === 0 || humidityChartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-sm text-slate-500">
            Aucun capteur d&apos;humidité détecté sur la période.
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
              Corrélation Chauffage / Équipement &amp; Température
            </h3>
            <p className="text-xs text-slate-400">
              Superpose la puissance électrique tirée dans la pièce (W) avec la courbe de température (°C)
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
            Pas assez de données pour cette pièce.
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
                  name={`Puissance ${activeCorrelationRoom?.name ?? ''}`}
                  stroke="#6366f1"
                  fill="#6366f1"
                  fillOpacity={0.25}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="tempC"
                  name={`Température ${activeCorrelationRoom?.name ?? ''}`}
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
          <h3 className="text-sm font-semibold text-white">Statistiques Climatiques par Pièce</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Pièce</th>
                <th className="px-4 py-3">Temp. Actuelle</th>
                <th className="px-4 py-3">Min / Max / Moy</th>
                <th className="px-4 py-3">Amplitude</th>
                <th className="px-4 py-3">Humidité (Moy / Min-Max)</th>
                <th className="px-4 py-3">Point de rosée</th>
                <th className="px-4 py-3">État</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {data.roomSummaries.map((rs) => {
                const amplitude =
                  rs.maxTempC !== null && rs.minTempC !== null
                    ? (rs.maxTempC - rs.minTempC).toFixed(1)
                    : null;
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
