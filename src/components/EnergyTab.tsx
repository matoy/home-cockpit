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
import { Zap, Euro, Activity, Layers } from 'lucide-react';
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
  const [metric, setMetric] = useState<MetricType>('energy');
  const [groupBy, setGroupBy] = useState<GroupBy>('room');

  const breakdown = groupBy === 'room' ? data.energyByRoom : data.energyByDevice;
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

  return (
    <div className="space-y-6">
      {/* Barre de contrôles */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-400 mr-1 flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" /> Métrique :
          </span>
          {(
            [
              { id: 'energy', label: 'Énergie (kWh)' },
              { id: 'power', label: 'Puissance moyenne (W)' },
              { id: 'cost', label: 'Coût estimé (€)' },
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

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400 mr-1 flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" /> Ventilation :
          </span>
          <button
            onClick={() => setGroupBy('room')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              groupBy === 'room'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
            }`}
          >
            Par Pièce
          </button>
          <button
            onClick={() => setGroupBy('device')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              groupBy === 'device'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
            }`}
          >
            Par Appareil
          </button>
        </div>
      </div>

      {/* Graphique empilé principal */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Évolution {metric === 'energy' ? 'de la consommation (kWh)' : metric === 'power' ? 'de la puissance (W)' : 'du coût (€)'}{' '}
              {groupBy === 'room' ? 'par pièce' : 'par appareil'}
            </h3>
            <p className="text-xs text-slate-400">
              {data.timeSeries.length} points agrégés sur la période sélectionnée
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-white">
              Total :{' '}
              {metric === 'energy'
                ? `${data.kpis.periodEnergyKwh.toFixed(2)} kWh`
                : metric === 'cost'
                  ? `${data.kpis.periodCostEur.toFixed(2)} €`
                  : `${data.kpis.currentPowerW.toFixed(0)} W actuels`}
            </div>
          </div>
        </div>

        {chartData.length === 0 || seriesKeys.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-slate-500">
            Aucune donnée énergétique disponible pour cette sélection.
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
            Répartition {groupBy === 'room' ? 'par pièce' : 'par appareil'}
          </h3>
          <p className="text-xs text-slate-400 mb-4">Part relative de l&apos;énergie totale (kWh)</p>

          {breakdown.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-slate-500">
              Pas de données
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
            Classement des consommateurs
          </h3>
          <p className="text-xs text-slate-400 mb-4">Énergie, coût et pic de puissance</p>

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
                    <span>Part : {item.sharePct.toFixed(1)}%</span>
                    <span>
                      Moy : {item.avgPowerW.toFixed(0)} W · Max : {item.maxPowerW.toFixed(0)} W
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
              <h3 className="text-sm font-semibold text-white">Ventilation Tarifaire</h3>
              <Euro className="h-4 w-4 text-emerald-400" />
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Calcul dynamique selon l&apos;historique de vos tarifs configurés
            </p>

            <div className="space-y-3">
              {hasHpHc ? (
                <>
                  <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-amber-200">Heures Pleines (HP)</div>
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
                      <div className="text-xs font-medium text-emerald-200">Heures Creuses (HC)</div>
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
                    <div className="text-xs font-medium text-indigo-200">Tarif Base</div>
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

          <div className="mt-4 pt-4 border-t border-slate-800 space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Prix moyen effectif :</span>
              <span className="font-mono text-white font-medium">
                {data.kpis.effectiveRateEurPerKwh.toFixed(4)} €/kWh
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Abonnement proratisé :</span>
              <span className="font-mono text-slate-300">
                +{data.kpis.subscriptionCostEur.toFixed(2)} €
              </span>
            </div>
            <div className="flex justify-between text-slate-200 font-semibold pt-1">
              <span className="flex items-center gap-1">
                <Zap className="h-3.5 w-3.5 text-indigo-400" /> Total estimé facture :
              </span>
              <span className="text-emerald-400">
                {(data.kpis.periodCostEur + data.kpis.subscriptionCostEur).toFixed(2)} €
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
