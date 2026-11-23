'use client';

import { useMemo, useState } from 'react';
import {
  Droplets,
  Flame,
  Home,
  Search,
  Snowflake,
  Thermometer,
  Wifi,
  WifiOff,
  Wind,
  Zap,
} from 'lucide-react';
import {
  extractDaikinSummary,
  isDaikinHvacDevice,
  type DaikinModeTone,
  type DaikinUnitSummary,
} from '@/lib/vendors/daikin-display';
import type {
  DashboardPayload,
  DeviceRecord,
  EnergyBreakdownItem,
  RoomRecord,
  TabId,
} from '@/types';

interface HvacTabProps {
  data: DashboardPayload;
  onNavigateTab: (tab: TabId) => void;
  onResetGlobalFilters?: () => void;
}

interface HvacItem {
  device: DeviceRecord;
  summary: DaikinUnitSummary | null;
  room: RoomRecord | null;
  energy: EnergyBreakdownItem | null;
}

type HvacFilter = 'all' | 'on' | 'off' | 'heating' | 'cooling' | 'auto';

const RANGE_LABELS: Record<string, string> = {
  '24h': '24h',
  '7d': '7 jours',
  '30d': '30 jours',
  '365d': '12 mois',
};

const MODE_BADGE_CLASSES: Record<DaikinModeTone, string> = {
  amber: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  sky: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
  indigo: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300',
  teal: 'border-teal-500/40 bg-teal-500/15 text-teal-300',
  slate: 'border-slate-700 bg-slate-800/80 text-slate-300',
};

function formatTimeShort(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export function HvacTab({ data, onNavigateTab, onResetGlobalFilters }: HvacTabProps) {
  const [hvacFilter, setHvacFilter] = useState<HvacFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const roomById = useMemo(
    () => new Map(data.rooms.map((r) => [r.id, r])),
    [data.rooms]
  );

  const energyByDeviceId = useMemo(
    () => new Map(data.energyByDevice.map((e) => [e.id, e])),
    [data.energyByDevice]
  );

  const rangeLabel =
    data.range === 'custom' && data.customFrom && data.customTo
      ? 'période'
      : RANGE_LABELS[data.range] ?? data.range;

  const allHvac = useMemo<HvacItem[]>(() => {
    const items: HvacItem[] = [];
    for (const dev of data.devices) {
      if (!isDaikinHvacDevice(dev)) continue;
      items.push({
        device: dev,
        summary: extractDaikinSummary(dev.lastRawStatus),
        room: dev.roomId !== null ? (roomById.get(dev.roomId) ?? null) : null,
        energy: energyByDeviceId.get(dev.id) ?? null,
      });
    }
    return items.sort((a, b) => {
      const roomA = a.room?.name ?? 'zzz';
      const roomB = b.room?.name ?? 'zzz';
      if (roomA !== roomB) return roomA.localeCompare(roomB, 'fr');
      return (a.device.customName || a.device.name).localeCompare(
        b.device.customName || b.device.name,
        'fr'
      );
    });
  }, [data.devices, roomById, energyByDeviceId]);

  const scopedHvac = useMemo(() => {
    return allHvac.filter(({ device }) => {
      if (data.selectedSystem !== 'all' && !device.systems.includes(data.selectedSystem)) {
        return false;
      }
      if (data.selectedRoomId !== 'all' && String(device.roomId) !== data.selectedRoomId) {
        return false;
      }
      return true;
    });
  }, [allHvac, data.selectedSystem, data.selectedRoomId]);

  const stats = useMemo(() => {
    let onCount = 0;
    let offCount = 0;
    let heatingCount = 0;
    let coolingCount = 0;
    let autoCount = 0;
    const roomTemps: number[] = [];
    const humidities: number[] = [];
    const targetTemps: number[] = [];
    const outdoorTemps: number[] = [];
    let todayKwh = 0;
    let hasTodayKwh = false;
    let periodEnergyKwh = 0;
    let periodCostEur = 0;

    for (const { device, summary, energy } of scopedHvac) {
      if (summary?.isOn) {
        onCount++;
        if (summary.operationMode === 'heating') heatingCount++;
        else if (summary.operationMode === 'cooling') coolingCount++;
        else if (summary.operationMode === 'auto') autoCount++;
      } else {
        offCount++;
      }

      const rt = summary?.roomTempC ?? device.lastTempC;
      if (rt !== null && Number.isFinite(rt)) roomTemps.push(rt);

      const rh = summary?.humidityPct ?? device.lastHumidityPct;
      if (rh !== null && Number.isFinite(rh)) humidities.push(rh);

      if (summary?.targetTempC !== null && summary?.targetTempC !== undefined) {
        targetTemps.push(summary.targetTempC);
      }

      if (summary?.outdoorTempC !== null && summary?.outdoorTempC !== undefined) {
        outdoorTemps.push(summary.outdoorTempC);
      }

      if (summary?.todayKwh !== null && summary?.todayKwh !== undefined) {
        todayKwh += summary.todayKwh;
        hasTodayKwh = true;
      }

      if (energy) {
        periodEnergyKwh += energy.energyKwh;
        periodCostEur += energy.costEur;
      }
    }

    return {
      total: scopedHvac.length,
      onCount,
      offCount,
      heatingCount,
      coolingCount,
      autoCount,
      avgRoomTempC: avg(roomTemps),
      avgHumidityPct: avg(humidities),
      avgTargetTempC: avg(targetTemps),
      avgOutdoorTempC: avg(outdoorTemps),
      minOutdoorTempC: outdoorTemps.length > 0 ? Math.min(...outdoorTemps) : null,
      maxOutdoorTempC: outdoorTemps.length > 0 ? Math.max(...outdoorTemps) : null,
      todayKwh: hasTodayKwh ? Math.round(todayKwh * 100) / 100 : null,
      periodEnergyKwh: Math.round(periodEnergyKwh * 100) / 100,
      periodCostEur: Math.round(periodCostEur * 100) / 100,
    };
  }, [scopedHvac]);

  const effectiveFilter: HvacFilter =
    (hvacFilter === 'heating' && stats.heatingCount === 0) ||
    (hvacFilter === 'cooling' && stats.coolingCount === 0) ||
    (hvacFilter === 'auto' && stats.autoCount === 0)
      ? 'all'
      : hvacFilter;

  const filteredHvac = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return scopedHvac.filter(({ device, summary, room }) => {
      if (effectiveFilter === 'on' && !summary?.isOn) return false;
      if (effectiveFilter === 'off' && summary?.isOn) return false;
      if (
        effectiveFilter === 'heating' &&
        (!summary?.isOn || summary.operationMode !== 'heating')
      ) {
        return false;
      }
      if (
        effectiveFilter === 'cooling' &&
        (!summary?.isOn || summary.operationMode !== 'cooling')
      ) {
        return false;
      }
      if (
        effectiveFilter === 'auto' &&
        (!summary?.isOn || summary.operationMode !== 'auto')
      ) {
        return false;
      }
      if (q) {
        const haystack = [
          device.name,
          device.customName ?? '',
          device.productName ?? '',
          room?.name ?? '',
          summary?.searchableText ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [scopedHvac, effectiveFilter, searchQuery]);

  const groupedByRoom = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; roomName: string; color: string; items: HvacItem[] }
    >();
    for (const item of filteredHvac) {
      const key = item.room ? `room_${item.room.id}` : 'unassigned';
      const existing = groups.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.set(key, {
          key,
          roomName: item.room?.name ?? 'Sans pièce',
          color: item.room?.color ?? '#64748b',
          items: [item],
        });
      }
    }
    return [...groups.values()];
  }, [filteredHvac]);

  if (allHvac.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-400">
          <Wind className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold text-white">
          Aucune unité Clim &amp; PAC Daikin détectée
        </h2>
        <p className="mx-auto mt-1 max-w-xl text-sm text-slate-400">
          Connectez votre compte <strong>Daikin Onecta Cloud</strong> en 100 % lecture seule
          pour retrouver ici vos splits, pompes à chaleur, consignes, températures extérieure /
          intérieure et consommations électriques kWh.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab('systems')}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 transition"
          >
            Aller dans Systèmes
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('guide')}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 transition"
          >
            Ouvrir Guide Setup
          </button>
        </div>
      </div>
    );
  }

  const hasActiveGlobalFilter =
    data.selectedSystem !== 'all' || data.selectedRoomId !== 'all';
  const hasAnyActiveFilter =
    hasActiveGlobalFilter || effectiveFilter !== 'all' || searchQuery.trim() !== '';

  function handleResetAllFilters() {
    setHvacFilter('all');
    setSearchQuery('');
    if (hasActiveGlobalFilter) {
      onResetGlobalFilters?.();
    }
  }

  return (
    <div className="space-y-5">
      {/* 4 cartes KPI Clim & PAC */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Unités actives</span>
            <Wind className="h-4 w-4 text-blue-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white">
            {stats.onCount} / {stats.total}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {stats.heatingCount} chauffage · {stats.coolingCount} clim · {stats.offCount} veille
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Intérieur vs Consigne</span>
            <Thermometer className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white">
            {stats.avgRoomTempC !== null ? `${stats.avgRoomTempC.toFixed(1)} °C` : '—'}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Consigne moy.{' '}
            {stats.avgTargetTempC !== null ? `${stats.avgTargetTempC.toFixed(1)} °C` : '—'}
            {stats.avgHumidityPct !== null
              ? ` · ${stats.avgHumidityPct.toFixed(0)} % hum.`
              : ''}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Température Extérieure</span>
            <Snowflake className="h-4 w-4 text-sky-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white">
            {stats.avgOutdoorTempC !== null ? `${stats.avgOutdoorTempC.toFixed(1)} °C` : '—'}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {stats.minOutdoorTempC !== null &&
            stats.maxOutdoorTempC !== null &&
            stats.minOutdoorTempC !== stats.maxOutdoorTempC
              ? `De ${stats.minOutdoorTempC.toFixed(1)} °C à ${stats.maxOutdoorTempC.toFixed(1)} °C`
              : 'Sonde groupe extérieur Daikin'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Énergie Clim ({rangeLabel})</span>
            <Zap className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white">
            {stats.periodEnergyKwh.toFixed(1)} kWh
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {stats.periodCostEur.toFixed(2)} € sur la période
            {stats.todayKwh !== null ? ` · ${stats.todayKwh.toFixed(1)} kWh auj.` : ''}
          </p>
        </div>
      </div>

      {/* Barre de filtres */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: `Toutes (${stats.total})` },
              { id: 'on', label: `En marche (${stats.onCount})` },
              { id: 'off', label: `Veille (${stats.offCount})` },
              ...(stats.heatingCount > 0
                ? [{ id: 'heating' as const, label: `Chauffage (${stats.heatingCount})` }]
                : []),
              ...(stats.coolingCount > 0
                ? [{ id: 'cooling' as const, label: `Clim (${stats.coolingCount})` }]
                : []),
              ...(stats.autoCount > 0
                ? [{ id: 'auto' as const, label: `Auto (${stats.autoCount})` }]
                : []),
            ] as Array<{ id: HvacFilter; label: string }>
          ).map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setHvacFilter(pill.id)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                effectiveFilter === pill.id
                  ? 'bg-blue-600 text-white shadow'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher..."
            className="w-48 rounded-xl border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Groupes par pièce */}
      {groupedByRoom.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center text-sm text-slate-400 space-y-3">
          <div>Aucune unité Daikin ne correspond aux filtres actifs.</div>
          {hasAnyActiveFilter && (
            <button
              type="button"
              onClick={handleResetAllFilters}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-medium text-slate-200 transition"
            >
              Réinitialiser les filtres
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByRoom.map((group) => (
            <div
              key={group.key}
              className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: group.color }}
                />
                <Home className="h-4 w-4 text-slate-400" />
                <h3 className="text-sm font-semibold text-white">{group.roomName}</h3>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                  {group.items.length} unité{group.items.length > 1 ? 's' : ''}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {group.items.map(({ device, summary, energy }) => {
                  const displayName = device.customName || device.name;
                  const roomTemp = summary?.roomTempC ?? device.lastTempC;
                  const roomHum = summary?.humidityPct ?? device.lastHumidityPct;
                  const modeBadgeClass = summary
                    ? MODE_BADGE_CLASSES[summary.modeTone]
                    : MODE_BADGE_CLASSES.slate;

                  return (
                    <div
                      key={device.id}
                      className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {device.isOnline ? (
                              <Wifi className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                            ) : (
                              <WifiOff className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                            )}
                            <span className="truncate text-sm font-medium text-white">
                              {displayName}
                            </span>
                            {device.excludeFromTotals && (
                              <span
                                title="Exclu des moyennes Climat et totaux Énergie"
                                className="rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.2 text-[9.5px] text-amber-300"
                              >
                                Exclu totaux
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                            <span>{summary?.unitTypeLabel ?? 'Unité Daikin'}</span>
                            {summary?.model && (
                              <>
                                <span>·</span>
                                <span className="font-mono text-slate-300">{summary.model}</span>
                              </>
                            )}
                          </div>
                        </div>

                        <span
                          className={`inline-flex items-center gap-1 shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${modeBadgeClass}`}
                        >
                          {summary?.isOn && summary.operationMode === 'heating' && (
                            <Flame className="h-3 w-3" />
                          )}
                          {summary?.isOn && summary.operationMode === 'cooling' && (
                            <Snowflake className="h-3 w-3" />
                          )}
                          {summary?.modeLabel ?? (device.isOnline ? 'Connecté' : 'Hors ligne')}
                        </span>
                      </div>

                      {/* Grille thermique 3 colonnes */}
                      <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 text-xs">
                        <div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Thermometer className="h-3 w-3 text-emerald-400" />
                            Intérieur
                          </div>
                          <div className="mt-0.5 font-semibold text-white font-mono">
                            {roomTemp !== null ? `${roomTemp.toFixed(1)} °C` : '—'}
                          </div>
                          {roomHum !== null && (
                            <div className="text-[10px] text-sky-300 flex items-center gap-1 mt-0.5">
                              <Droplets className="h-2.5 w-2.5" />
                              {roomHum.toFixed(0)} %
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="text-[10px] text-slate-400">Consigne</div>
                          <div className="mt-0.5 font-semibold text-blue-300 font-mono">
                            {summary?.targetTempC !== null && summary?.targetTempC !== undefined
                              ? `${summary.targetTempC.toFixed(1)} °C`
                              : '—'}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {summary?.isOn ? 'Régulation active' : 'En veille'}
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] text-slate-400">Extérieur</div>
                          <div className="mt-0.5 font-semibold text-sky-300 font-mono">
                            {summary?.outdoorTempC !== null && summary?.outdoorTempC !== undefined
                              ? `${summary.outdoorTempC.toFixed(1)} °C`
                              : '—'}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {summary?.fanLabel ?? 'Ventil. —'}
                          </div>
                        </div>
                      </div>

                      {/* Énergie + options actives + Wi-Fi */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2 text-[11px] text-slate-400">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {summary?.todayKwh !== null && summary?.todayKwh !== undefined && (
                            <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-amber-300">
                              Auj. {summary.todayKwh.toFixed(1)} kWh
                            </span>
                          )}
                          {summary?.weekKwh !== null && summary?.weekKwh !== undefined && (
                            <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-slate-300">
                              Sem. {summary.weekKwh.toFixed(1)} kWh
                            </span>
                          )}
                          {energy && (
                            <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-indigo-300">
                              Période {energy.energyKwh.toFixed(1)} kWh ({energy.costEur.toFixed(2)} €)
                            </span>
                          )}
                          {summary?.swingLabel && (
                            <span className="rounded bg-slate-900 px-1.5 py-0.5 text-slate-300">
                              Volets {summary.swingLabel}
                            </span>
                          )}
                          {summary?.econo && (
                            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">
                              Econo
                            </span>
                          )}
                          {summary?.powerful && (
                            <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300">
                              Powerful
                            </span>
                          )}
                          {summary?.streamer && (
                            <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-cyan-300">
                              Streamer
                            </span>
                          )}
                          {summary?.wifiRssiDbm !== null && summary?.wifiRssiDbm !== undefined && (
                            <span
                              title={summary.wifiSsid ? `SSID : ${summary.wifiSsid}` : undefined}
                              className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-slate-300"
                            >
                              Wi-Fi {summary.wifiRssiDbm} dBm
                            </span>
                          )}
                        </div>

                        <span className="text-[10px] text-slate-500">
                          {formatTimeShort(device.lastSeenAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
