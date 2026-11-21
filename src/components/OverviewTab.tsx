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
import type { ComfortStatus, DashboardPayload } from '@/types';

interface OverviewTabProps {
  data: DashboardPayload;
  onSelectRoom: (roomId: string) => void;
  onNavigateTab: (
    tab: 'overview' | 'energy' | 'climate' | 'contacts' | 'tariffs' | 'devices' | 'guide'
  ) => void;
}

const COMFORT_BADGE_CLASSES: Record<ComfortStatus['tone'], string> = {
  emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  sky: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  rose: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  slate: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
};

const RANGE_LABELS: Record<string, string> = {
  '24h': '24 heures',
  '7d': '7 jours',
  '30d': '30 jours',
  '365d': '12 mois',
};

export function OverviewTab({ data, onSelectRoom, onNavigateTab }: OverviewTabProps) {
  const { kpis, roomSummaries, range } = data;
  const rangeLabel = RANGE_LABELS[range] ?? range;

  return (
    <div className="space-y-6">
      {/* 4 KPIs Globaux */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Puissance Instantanée
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
            {kpis.activePowerDevices} / {kpis.totalPowerDevices} prises actives (&gt; 2 W)
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Énergie &amp; Coût ({rangeLabel})
            </span>
            <div className="rounded-lg bg-emerald-500/15 p-2 text-emerald-400">
              <Euro className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="text-3xl font-bold tracking-tight text-white">
              {kpis.periodCostEur.toFixed(2)} €
            </span>
            <span className="text-sm font-medium text-emerald-400">
              {kpis.periodEnergyKwh.toFixed(2)} kWh
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Prix moyen : {kpis.effectiveRateEurPerKwh.toFixed(4)} €/kWh (hors abo.{' '}
            {kpis.subscriptionCostEur.toFixed(2)} €)
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Talon de Consommation (Veille)
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
            Plancher nocturne (02h–05h) ≈{' '}
            <span className="text-amber-300 font-medium">
              {kpis.standbyAnnualCostEur.toFixed(0)} €/an
            </span>
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Climat Intérieur Moyen
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
                  {kpis.climateAlertsCount} pièce(s) hors zone de confort
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-300">Toutes les pièces en zone optimale</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Grille des pièces */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white">Synthèse par Pièce</h2>
            <p className="text-xs text-slate-400">
              Cliquez sur une pièce pour filtrer les graphiques ou ajustez vos seuils dans Appareils &amp; Pièces.
            </p>
          </div>
          {data.selectedRoomId !== 'all' && (
            <button
              onClick={() => onSelectRoom('all')}
              className="rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-500/25 transition"
            >
              Afficher toutes les pièces
            </button>
          )}
        </div>

        {roomSummaries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center">
            <p className="text-sm text-slate-300">Aucune pièce configurée pour l&apos;instant.</p>
            <button
              onClick={() => onNavigateTab('devices')}
              className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500"
            >
              Créer des pièces &amp; synchroniser Tuya
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {roomSummaries.map((rs) => {
              const isSelected = data.selectedRoomId === String(rs.room.id);
              return (
                <div
                  key={rs.room.id}
                  onClick={() => onSelectRoom(isSelected ? 'all' : String(rs.room.id))}
                  className={`cursor-pointer rounded-2xl border p-5 transition ${
                    isSelected
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
                          {rs.devices.length} appareil(s)
                        </p>
                      </div>
                    </div>

                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                        COMFORT_BADGE_CLASSES[rs.comfort.tone]
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
                        Puissance
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
                        Temp.
                      </div>
                      <div className="mt-1 text-sm font-semibold text-white">
                        {rs.currentTempC !== null ? `${rs.currentTempC.toFixed(1)} °C` : '—'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {rs.dewPointC !== null ? `Rosée ${rs.dewPointC}°C` : `Cible ${rs.room.targetTempMin}-${rs.room.targetTempMax}°`}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center gap-1 text-[11px] text-slate-400">
                        <Droplets className="h-3 w-3 text-sky-400" />
                        Humidité
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
                      {rs.devices.map((dev) => (
                        <div
                          key={dev.id}
                          className="flex items-center justify-between text-xs rounded-lg bg-slate-950/40 px-2.5 py-1.5"
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
                          </div>
                          <div className="flex items-center gap-2 shrink-0 text-slate-400 font-mono text-[11px]">
                            {dev.lastPowerW !== null && (
                              <span className="text-indigo-300">{dev.lastPowerW.toFixed(0)}W</span>
                            )}
                            {dev.lastTempC !== null && (
                              <span className="text-emerald-300">{dev.lastTempC.toFixed(1)}°C</span>
                            )}
                            {dev.lastHumidityPct !== null && (
                              <span className="text-sky-300">{dev.lastHumidityPct.toFixed(0)}%</span>
                            )}
                            {dev.lastContactOpen !== null && (
                              <span
                                className={
                                  dev.lastContactOpen ? 'text-amber-300' : 'text-emerald-300'
                                }
                              >
                                {dev.lastContactOpen ? 'Ouvert' : 'Fermé'}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
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
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-sm text-amber-200">
            <Cpu className="h-4 w-4 text-amber-400 shrink-0" />
            <span>
              {data.devices.filter((d) => d.roomId === null).length} appareil(s) Tuya ne sont encore
              affectés à aucune pièce.
            </span>
          </div>
          <button
            onClick={() => onNavigateTab('devices')}
            className="rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-200 transition"
          >
            Affecter les appareils
          </button>
        </div>
      )}
    </div>
  );
}
