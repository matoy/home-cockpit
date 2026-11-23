'use client';

import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  BatteryWarning,
  Blinds,
  CheckCircle2,
  Filter,
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
import type {
  CoverEventItem,
  CoverHistoryState,
  DashboardPayload,
  DeviceRecord,
  RoomRecord,
  TabId,
} from '@/types';

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

function formatPrevStateShort(
  state: CoverHistoryState,
  openPct: number | null
): string {
  if (state === 'closed') return openPct !== null ? `Fermé (${openPct}%)` : 'Fermé';
  if (state === 'open') return openPct !== null ? `Ouvert (${openPct}%)` : 'Ouvert';
  if (state === 'partial') return openPct !== null ? `Partiel (${openPct}%)` : 'Partiel';
  return 'Inconnu';
}

function formatCoverEventBadge(ev: CoverEventItem): string {
  if (ev.isTransition && ev.prevState !== null) {
    const prevText = formatPrevStateShort(ev.prevState, ev.prevOpenPct);
    const deltaStr =
      ev.deltaPct !== null && ev.deltaPct !== 0
        ? ` · ${ev.deltaPct > 0 ? '+' : ''}${ev.deltaPct}%`
        : '';
    return `${prevText} → ${ev.stateLabel}${deltaStr}`;
  }
  return ev.stateLabel;
}

export function CoversTab({ data, onNavigateTab, onResetGlobalFilters }: CoversTabProps) {
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedHistoryDeviceId, setSelectedHistoryDeviceId] = useState<string>('all');
  const [transitionsOnly, setTransitionsOnly] = useState<boolean>(true);

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

  const effectiveHistoryDeviceId =
    selectedHistoryDeviceId !== 'all' &&
    scopedCovers.some((c) => c.device.id === selectedHistoryDeviceId)
      ? selectedHistoryDeviceId
      : 'all';

  const visibleCoverEvents = useMemo(() => {
    const events = data.covers?.events ?? [];
    return events.filter((ev) => {
      if (effectiveHistoryDeviceId !== 'all' && ev.deviceId !== effectiveHistoryDeviceId) {
        return false;
      }
      if (transitionsOnly && !ev.isTransition) return false;
      return true;
    });
  }, [data.covers?.events, effectiveHistoryDeviceId, transitionsOnly]);

  const coverActivitySeries = data.covers?.activitySeries ?? [];

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
          <strong className="text-slate-200">Systèmes</strong>.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab('systems')}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-500 transition"
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
                  const historyStat = data.covers?.byDevice?.[device.id];
                  const isHistorySelected = effectiveHistoryDeviceId === device.id;
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
                      onClick={() =>
                        setSelectedHistoryDeviceId(isHistorySelected ? 'all' : device.id)
                      }
                      title="Cliquer pour filtrer l'historique ci-dessous sur cet équipement"
                      className={`cursor-pointer rounded-xl border bg-slate-950/70 p-3.5 flex flex-col justify-between gap-3 transition ${
                        isHistorySelected
                          ? 'border-amber-500 ring-1 ring-amber-500/40'
                          : 'border-slate-800 hover:border-slate-700'
                      }`}
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
                          {historyStat && historyStat.movementsCount > 0 && (
                            <span
                              className="rounded bg-slate-900 px-1.5 py-0.5 text-amber-300/90"
                              title={
                                historyStat.lastMovedAt
                                  ? `Dernier changement : ${formatTimeShort(historyStat.lastMovedAt)}`
                                  : undefined
                              }
                            >
                              {historyStat.movementsCount} mouv.
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

      {/* Activité + Historique chronologique des changements d'état & positions */}
      {(scopedCovers.length > 0 || coverActivitySeries.length > 0 || visibleCoverEvents.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Activity className="h-4 w-4 text-amber-400" />
                Activité des volets &amp; stores sur la période
              </h3>
              <p className="text-xs text-slate-400">
                Nombre de mouvements détectés et de relevés en position ouverte / partielle
              </p>
            </div>

            {coverActivitySeries.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-xs text-slate-500">
                Pas encore d&apos;historique collecté pour ces équipements sur la période.
              </div>
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={coverActivitySeries}
                    margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={11} minTickGap={24} />
                    <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderRadius: '12px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar
                      dataKey="transitionsCount"
                      name="Mouvements / changements"
                      fill="#f59e0b"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="openCount"
                      name="Relevés ouverts"
                      fill="#38bdf8"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Filter className="h-4 w-4 text-amber-400" />
                  Historique des changements ({visibleCoverEvents.length})
                </h3>
                <p className="text-xs text-slate-400">
                  Journal horodaté des mouvements et positions relevées
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={effectiveHistoryDeviceId}
                  onChange={(e) => setSelectedHistoryDeviceId(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
                >
                  <option value="all">Tous les équipements</option>
                  {scopedCovers.map(({ device }) => (
                    <option key={device.id} value={device.id}>
                      {device.customName || device.name}
                    </option>
                  ))}
                </select>

                <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={transitionsOnly}
                    onChange={(e) => setTransitionsOnly(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 text-amber-500"
                  />
                  Transitions seules
                </label>
              </div>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {visibleCoverEvents.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  {transitionsOnly
                    ? 'Aucun changement de position détecté sur cette période (décochez « Transitions seules » pour voir tous les relevés).'
                    : 'Aucun relevé historique sur cette période.'}
                </div>
              ) : (
                visibleCoverEvents.map((ev) => {
                  const badgeToneClass =
                    ev.state === 'open'
                      ? 'border-sky-500/30 bg-sky-500/15 text-sky-300'
                      : ev.state === 'partial'
                        ? 'border-amber-500/30 bg-amber-500/15 text-amber-300'
                        : ev.state === 'closed'
                          ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                          : 'border-slate-700 bg-slate-800/80 text-slate-300';

                  return (
                    <div
                      key={ev.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 px-3.5 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Blinds className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium text-slate-200 truncate">
                            {ev.deviceName}
                          </div>
                          <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: ev.roomColor }}
                            />
                            <span>{ev.roomName}</span>
                            <span>·</span>
                            <span className="font-mono">{formatTimeShort(ev.recordedAt)}</span>
                          </div>
                        </div>
                      </div>

                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold shrink-0 border ${badgeToneClass}`}
                      >
                        {formatCoverEventBadge(ev)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
