'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BatteryWarning,
  Blinds,
  CheckCircle2,
  Home,
  Search,
  SlidersHorizontal,
  WifiOff,
} from 'lucide-react';
import {
  extractCoverSummary,
  type CoverKind,
  type CoverSummary,
} from '@/lib/covers-utils';
import type { DashboardPayload, DeviceRecord, RoomRecord, TabId } from '@/types';

interface CoversTabProps {
  data: DashboardPayload;
  onNavigateTab: (tab: TabId) => void;
  onResetGlobalFilters?: () => void;
}

interface CoverItem {
  device: DeviceRecord;
  summary: CoverSummary;
  room: RoomRecord | null;
}

type StateFilter = 'all' | 'open' | 'partial' | 'closed' | 'unknown';
type KindFilter = 'all' | CoverKind;

const KIND_LABELS: Record<CoverKind, string> = {
  shutter: 'Volets',
  blind: 'Stores / BSO',
  awning: 'Bannes / Pergolas',
  curtain: 'Rideaux',
  garage: 'Garages',
  gate: 'Portails',
  window: 'Fenêtres',
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

export function CoversTab({ data, onNavigateTab, onResetGlobalFilters }: CoversTabProps) {
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const roomById = useMemo(
    () => new Map(data.rooms.map((r) => [r.id, r])),
    [data.rooms]
  );

  const allCovers = useMemo<CoverItem[]>(() => {
    const items: CoverItem[] = [];
    for (const dev of data.devices) {
      const summary = extractCoverSummary(dev);
      if (!summary) continue;
      items.push({
        device: dev,
        summary,
        room: dev.roomId !== null ? (roomById.get(dev.roomId) ?? null) : null,
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
  }, [data.devices, roomById]);

  const scopedCovers = useMemo(() => {
    return allCovers.filter(({ device }) => {
      if (data.selectedSystem !== 'all' && !device.systems.includes(data.selectedSystem)) {
        return false;
      }
      if (data.selectedRoomId !== 'all' && String(device.roomId) !== data.selectedRoomId) {
        return false;
      }
      return true;
    });
  }, [allCovers, data.selectedSystem, data.selectedRoomId]);

  const stats = useMemo(() => {
    let openCount = 0;
    let partialCount = 0;
    let closedCount = 0;
    let unknownCount = 0;
    let onlineCount = 0;
    let lowBatteryCount = 0;
    let weakRssiCount = 0;
    let somfyCount = 0;
    let tuyaCount = 0;

    for (const { device, summary } of scopedCovers) {
      if (summary.state === 'open') openCount++;
      else if (summary.state === 'partial') partialCount++;
      else if (summary.state === 'closed') closedCount++;
      else unknownCount++;

      if (device.isOnline) onlineCount++;
      if (summary.batteryPct !== null && summary.batteryPct <= 20) lowBatteryCount++;
      if (summary.rssiPct !== null && summary.rssiPct < 30) weakRssiCount++;
      if (summary.source === 'somfy') somfyCount++;
      else tuyaCount++;
    }

    const alertCount =
      scopedCovers.length - onlineCount + lowBatteryCount + weakRssiCount;

    return {
      total: scopedCovers.length,
      openCount,
      partialCount,
      closedCount,
      unknownCount,
      onlineCount,
      offlineCount: scopedCovers.length - onlineCount,
      lowBatteryCount,
      weakRssiCount,
      alertCount,
      somfyCount,
      tuyaCount,
    };
  }, [scopedCovers]);

  const availableKinds = useMemo(() => {
    const set = new Set<CoverKind>();
    for (const item of scopedCovers) set.add(item.summary.kind);
    return [...set];
  }, [scopedCovers]);

  const effectiveStateFilter: StateFilter =
    stateFilter === 'unknown' && stats.unknownCount === 0 ? 'all' : stateFilter;
  const effectiveKindFilter: KindFilter =
    kindFilter !== 'all' && !availableKinds.includes(kindFilter) ? 'all' : kindFilter;

  const filteredCovers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return scopedCovers.filter(({ device, summary, room }) => {
      if (effectiveStateFilter !== 'all' && summary.state !== effectiveStateFilter) return false;
      if (effectiveKindFilter !== 'all' && summary.kind !== effectiveKindFilter) return false;
      if (q) {
        const haystack = [
          device.name,
          device.customName ?? '',
          device.productName ?? '',
          device.tuyaCategory ?? '',
          room?.name ?? '',
          summary.kindLabel,
          summary.stateLabel,
          summary.protocol,
          summary.source,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [scopedCovers, effectiveStateFilter, effectiveKindFilter, searchQuery]);

  const groupedByRoom = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; roomName: string; color: string; items: CoverItem[] }
    >();

    for (const item of filteredCovers) {
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
  }, [filteredCovers]);

  if (allCovers.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
          <Blinds className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold text-white">
          Aucun volet ou store détecté
        </h2>
        <p className="mx-auto mt-1 max-w-xl text-sm text-slate-400">
          Les volets roulants, stores bannes, BSO et moteurs tubulaires Tuya (
          <code className="text-slate-300">cl</code> /{' '}
          <code className="text-slate-300">clkg</code>) ainsi que vos équipements
          Somfy apparaîtront automatiquement ici après synchronisation dans{' '}
          <strong className="text-slate-200">Appareils</strong>.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab('devices')}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-500 transition"
          >
            Aller dans Appareils
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
    hasActiveGlobalFilter ||
    effectiveStateFilter !== 'all' ||
    effectiveKindFilter !== 'all' ||
    searchQuery.trim() !== '';

  function handleResetAllFilters() {
    setStateFilter('all');
    setKindFilter('all');
    setSearchQuery('');
    if (hasActiveGlobalFilter) {
      onResetGlobalFilters?.();
    }
  }

  return (
    <div className="space-y-5">
      {/* 4 cartes KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Équipements suivis</span>
            <Blinds className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white">{stats.total}</div>
          <p className="mt-1 text-xs text-slate-400">
            {stats.onlineCount} en ligne
            {stats.somfyCount > 0 ? ` · ${stats.somfyCount} Somfy` : ''}
            {stats.tuyaCount > 0 ? ` · ${stats.tuyaCount} Tuya` : ''}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Ouverts / Partiels</span>
            <SlidersHorizontal
              className={`h-4 w-4 ${
                stats.openCount + stats.partialCount > 0
                  ? 'text-sky-400'
                  : 'text-slate-500'
              }`}
            />
          </div>
          <div className="mt-2 text-2xl font-bold text-white">
            {stats.openCount + stats.partialCount}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {stats.openCount} ouverts · {stats.partialCount} intermédiaire(s)
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Fermés / Repliés</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white">{stats.closedCount}</div>
          <p className="mt-1 text-xs text-slate-400">
            {stats.unknownCount > 0
              ? `+ ${stats.unknownCount} RTS sans retour d'état`
              : 'Position fermée confirmée'}
          </p>
        </div>

        <div
          className={`rounded-2xl border p-4 ${
            stats.alertCount > 0
              ? 'border-rose-500/40 bg-rose-950/20'
              : 'border-slate-800 bg-slate-900/70'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Santé &amp; Signal</span>
            {stats.alertCount > 0 ? (
              <AlertTriangle className="h-4 w-4 text-rose-400" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            )}
          </div>
          <div
            className={`mt-2 text-2xl font-bold ${
              stats.alertCount > 0 ? 'text-rose-300' : 'text-emerald-300'
            }`}
          >
            {stats.alertCount > 0 ? stats.alertCount : 'OK'}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {stats.alertCount === 0
              ? 'Aucune alerte signal, batterie ou ligne'
              : `${stats.offlineCount} hors ligne · ${stats.lowBatteryCount} batt. faible · ${stats.weakRssiCount} signal faible`}
          </p>
        </div>
      </div>

      {/* Barre de filtres */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: `Tous (${stats.total})` },
              { id: 'open', label: `Ouverts (${stats.openCount})` },
              { id: 'partial', label: `Partiels (${stats.partialCount})` },
              { id: 'closed', label: `Fermés (${stats.closedCount})` },
              ...(stats.unknownCount > 0
                ? [
                    {
                      id: 'unknown' as const,
                      label: `RTS / Inconnu (${stats.unknownCount})`,
                    },
                  ]
                : []),
            ] as Array<{ id: StateFilter; label: string }>
          ).map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setStateFilter(pill.id)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                effectiveStateFilter === pill.id
                  ? 'bg-amber-600 text-white shadow'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {availableKinds.length > 1 && (
            <select
              value={effectiveKindFilter}
              onChange={(e) => setKindFilter(e.target.value as KindFilter)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="all">Tous types</option>
              {availableKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind] ?? kind}
                </option>
              ))}
            </select>
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher..."
              className="w-44 rounded-xl border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>
      </div>

      {/* Groupes par pièce */}
      {groupedByRoom.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center text-sm text-slate-400 space-y-3">
          <div>Aucun volet ou store ne correspond aux filtres actifs.</div>
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: group.color }}
                  />
                  <Home className="h-4 w-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-white">{group.roomName}</h3>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                    {group.items.length} équipement{group.items.length > 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.items.map(({ device, summary }) => {
                  const displayName = device.customName || device.name;
                  const barPct = summary.openPct ?? 0;
                  const stateToneClass =
                    summary.state === 'open'
                      ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                      : summary.state === 'partial'
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                        : summary.state === 'closed'
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-slate-700 bg-slate-800/80 text-slate-300';

                  const barColorClass =
                    summary.state === 'closed'
                      ? 'bg-emerald-500'
                      : summary.state === 'partial'
                        ? 'bg-amber-500'
                        : 'bg-sky-500';

                  return (
                    <div
                      key={device.id}
                      className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="truncate text-sm font-medium text-white">
                              {displayName}
                            </span>
                            {!device.isOnline && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">
                                <WifiOff className="h-2.5 w-2.5" /> Hors ligne
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                            <span>{summary.kindLabel}</span>
                            <span>·</span>
                            <span
                              className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                                summary.source === 'somfy'
                                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                                  : 'border-orange-500/40 bg-orange-500/15 text-orange-300'
                              }`}
                            >
                              {summary.source === 'somfy'
                                ? `Somfy ${summary.protocol}`
                                : 'Tuya Tubular'}
                            </span>
                            {summary.moving && (
                              <span className="rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300 animate-pulse">
                                En mouvement
                              </span>
                            )}
                          </div>
                        </div>

                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${stateToneClass}`}
                        >
                          {summary.stateLabel}
                        </span>
                      </div>

                      {/* Jauge d'ouverture / fermeture */}
                      <div className="space-y-1.5">
                        {summary.openPct !== null ? (
                          <>
                            <div className="flex items-center justify-between text-[11px] text-slate-400">
                              <span>Ouverture : {summary.openPct} %</span>
                              <span>
                                Fermeture : {summary.closurePct ?? 100 - summary.openPct} %
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                              <div
                                className={`h-full rounded-full transition-all ${barColorClass}`}
                                style={{ width: `${barPct}%` }}
                              />
                            </div>
                          </>
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/60 px-2.5 py-1.5 text-[11px] text-slate-400">
                            {summary.unidirectional
                              ? 'Protocole RTS unidirectionnel : pas de retour de position %.'
                              : 'Position exacte non remontée par le moteur.'}
                          </div>
                        )}
                      </div>

                      {/* Pied de carte technique */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2 text-[11px] text-slate-400">
                        <div className="flex flex-wrap items-center gap-2">
                          {summary.tiltPct !== null && (
                            <span className="rounded bg-slate-900 px-1.5 py-0.5 text-slate-300">
                              Lames {summary.tiltPct}%
                            </span>
                          )}
                          {(summary.rssiLevel || summary.rssiPct !== null) && (
                            <span className="rounded bg-slate-900 px-1.5 py-0.5 text-slate-300">
                              Signal :{' '}
                              {summary.rssiLevel ?? `${summary.rssiPct}%`}
                            </span>
                          )}
                          {summary.batteryPct !== null && (
                            <span
                              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
                                summary.batteryPct <= 20
                                  ? 'bg-rose-500/15 text-rose-300'
                                  : 'bg-slate-900 text-slate-300'
                              }`}
                            >
                              {summary.batteryPct <= 20 && (
                                <BatteryWarning className="h-3 w-3" />
                              )}
                              Batt. {summary.batteryPct}%
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
