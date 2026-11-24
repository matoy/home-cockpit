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
  DoorOpen,
  DoorClosed,
  Battery,
  BatteryWarning,
  Clock,
  Activity,
  ShieldCheck,
  ShieldAlert,
  Wifi,
  WifiOff,
  Filter,
} from 'lucide-react';
import { useI18n } from './I18nProvider';
import type { DashboardPayload, TabId } from '@/types';

interface ContactsTabProps {
  data: DashboardPayload;
  onNavigateTab: (tab: TabId) => void;
}

type StateFilter = 'all' | 'open' | 'closed';

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}

export function ContactsTab({ data, onNavigateTab }: ContactsTabProps) {
  const { t, intlLocale } = useI18n();
  const { contacts } = data;
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('all');
  const [transitionsOnly, setTransitionsOnly] = useState<boolean>(true);

  const visibleSensors = useMemo(() => {
    return contacts.sensors.filter((s) => {
      if (stateFilter === 'open') return s.isOpen === true;
      if (stateFilter === 'closed') return s.isOpen === false;
      return true;
    });
  }, [contacts.sensors, stateFilter]);

  const visibleEvents = useMemo(() => {
    return contacts.events.filter((ev) => {
      if (selectedDeviceId !== 'all' && ev.deviceId !== selectedDeviceId) return false;
      if (transitionsOnly && !ev.isTransition) return false;
      return true;
    });
  }, [contacts.events, selectedDeviceId, transitionsOnly]);

  const contactHealth = useMemo(() => {
    const deviceById = new Map(data.devices.map((d) => [d.id, d]));
    const sensors = contacts.sensors;
    const withBattery = sensors.filter(
      (s): s is typeof s & { batteryPct: number } =>
        s.batteryPct !== null && Number.isFinite(s.batteryPct)
    );
    const mainsPoweredCount = sensors.filter(
      (s) => s.batteryPct === null && !deviceById.get(s.deviceId)?.dpConfig?.battery?.code
    ).length;
    const lowBatteryCount = withBattery.filter((s) => s.batteryPct <= 20).length;
    const avgBatteryPct =
      withBattery.length > 0
        ? Math.round(withBattery.reduce((sum, s) => sum + s.batteryPct, 0) / withBattery.length)
        : null;
    const minBatteryPct =
      withBattery.length > 0 ? Math.min(...withBattery.map((s) => s.batteryPct)) : null;

    return {
      sensors,
      totalCount: contacts.summary.totalSensors,
      onlineCount: contacts.summary.onlineCount,
      mainsPoweredCount,
      lowBatteryCount,
      avgBatteryPct,
      minBatteryPct,
    };
  }, [contacts.sensors, contacts.summary.onlineCount, contacts.summary.totalSensors, data.devices]);

  if (contacts.summary.totalSensors === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 p-12 text-center space-y-3">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-400">
          <DoorOpen className="h-6 w-6" />
        </div>
        <h2 className="text-base font-semibold text-white">{t('contacts.emptyTitle')}</h2>
        <p className="mx-auto max-w-md text-xs text-slate-400">
          {t('contacts.emptyDesc')}
        </p>
        <div className="flex flex-wrap justify-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigateTab('systems')}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-medium text-white transition"
          >
            {t('contacts.openSystems')}
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('devices')}
            className="rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 transition"
          >
            {t('contacts.openDevices')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 4 KPIs Ouvertures */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('contacts.kpiState')}
            </span>
            <div
              className={`rounded-lg p-2 ${
                contacts.summary.openCountNow > 0
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-emerald-500/15 text-emerald-400'
              }`}
            >
              {contacts.summary.openCountNow > 0 ? (
                <ShieldAlert className="h-4 w-4" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-white">
              {contacts.summary.openCountNow > 0
                ? t('contacts.openCountNow', { count: contacts.summary.openCountNow })
                : t('contacts.allClosed')}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {t('contacts.closedAndTotal', {
              closed: contacts.summary.closedCountNow,
              total: contacts.summary.totalSensors,
            })}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('contacts.kpiOpenings')}
            </span>
            <div className="rounded-lg bg-indigo-500/15 p-2 text-indigo-400">
              <DoorOpen className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {contacts.summary.totalOpenEventsPeriod}
            </span>
            <span className="text-xs text-slate-400">{t('contacts.eventsUnit')}</span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {t('contacts.transitionsHint')}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('contacts.kpiCumulativeDuration')}
            </span>
            <div className="rounded-lg bg-sky-500/15 p-2 text-sky-400">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {formatDuration(contacts.summary.totalOpenMinutesPeriod)}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {t('contacts.cumulativeHint')}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('contacts.kpiConnectivity')}
            </span>
            <div
              className={`rounded-lg p-2 ${
                contactHealth.lowBatteryCount > 0
                  ? 'bg-rose-500/15 text-rose-400'
                  : 'bg-emerald-500/15 text-emerald-400'
              }`}
            >
              {contactHealth.lowBatteryCount > 0 ? (
                <BatteryWarning className="h-4 w-4" />
              ) : (
                <Battery className="h-4 w-4" />
              )}
            </div>
          </div>
          <div
            className="mt-3 flex items-baseline gap-2"
            title={
              contactHealth.sensors
                .map(
                  (s) =>
                    `${s.name} (${s.isOnline ? t('common.online') : t('common.offline')})`
                )
                .join(' • ') || t('contacts.noActiveSensor')
            }
          >
            <span className="text-3xl font-bold tracking-tight text-white">
              {contactHealth.onlineCount} / {contactHealth.totalCount}
            </span>
            <span className="text-xs text-slate-400">{t('climate.onlineWord')}</span>
          </div>
          <p
            className={`mt-2 text-xs ${
              contactHealth.lowBatteryCount > 0 ? 'text-rose-300' : 'text-slate-400'
            }`}
          >
            {contactHealth.lowBatteryCount > 0
              ? `${t('contacts.lowBatteryCount', { count: contactHealth.lowBatteryCount })}${
                  contactHealth.mainsPoweredCount > 0
                    ? t('climate.onMainsSuffix', { count: contactHealth.mainsPoweredCount })
                    : ''
                }`
              : contactHealth.avgBatteryPct !== null
                ? `${t('climate.avgMinBattery', {
                    avg: contactHealth.avgBatteryPct,
                    min: contactHealth.minBatteryPct ?? 0,
                  })}${
                    contactHealth.mainsPoweredCount > 0
                      ? t('climate.onMainsSuffix', { count: contactHealth.mainsPoweredCount })
                      : ''
                  }`
                : contactHealth.mainsPoweredCount > 0
                  ? t('contacts.mainsCount', { count: contactHealth.mainsPoweredCount })
                  : t('climate.noBatteryReported')}
          </p>
        </div>
      </div>

      {/* État temps réel des capteurs */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white">{t('contacts.liveTitle')}</h2>
            <p className="text-xs text-slate-400">
              {t('contacts.liveSub')}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: 'all', label: t('contacts.filterAll', { count: contacts.sensors.length }) },
                { id: 'open', label: t('contacts.filterOpen', { count: contacts.summary.openCountNow }) },
                { id: 'closed', label: t('contacts.filterClosed', { count: contacts.summary.closedCountNow }) },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setStateFilter(opt.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  stateFilter === opt.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleSensors.map((sensor) => {
            const isOpen = sensor.isOpen === true;
            const isUnknown = sensor.isOpen === null;
            const isSelected = selectedDeviceId === sensor.deviceId;
            return (
              <div
                key={sensor.deviceId}
                onClick={() =>
                  setSelectedDeviceId(isSelected ? 'all' : sensor.deviceId)
                }
                className={`cursor-pointer rounded-2xl border p-5 transition ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-950/25 ring-1 ring-indigo-500/40'
                    : isOpen
                      ? 'border-amber-500/40 bg-amber-950/15 hover:border-amber-500/60'
                      : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                        isOpen
                          ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      }`}
                    >
                      {isOpen ? (
                        <DoorOpen className="h-4 w-4" />
                      ) : (
                        <DoorClosed className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-white truncate">{sensor.name}</h3>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: sensor.roomColor }}
                        />
                        <span className="truncate">{sensor.roomName}</span>
                      </div>
                    </div>
                  </div>

                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold shrink-0 ${
                      isUnknown
                        ? 'border-slate-600/40 bg-slate-700/40 text-slate-300'
                        : isOpen
                          ? 'border-amber-500/40 bg-amber-500/20 text-amber-300'
                          : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                    }`}
                  >
                    {isUnknown ? t('contacts.badgeUnknown') : isOpen ? t('contacts.badgeOpen') : t('contacts.badgeClosed')}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-slate-800/80 bg-slate-950/50 p-3 text-xs">
                  <div>
                    <div className="text-[10px] text-slate-400">{t('contacts.openingsLabel')}</div>
                    <div className="mt-0.5 font-semibold text-white font-mono">
                      {sensor.openEventsCount}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">{t('contacts.openDurationLabel')}</div>
                    <div className="mt-0.5 font-semibold text-white font-mono">
                      {formatDuration(sensor.openMinutes)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">{t('contacts.batteryStatusLabel')}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 font-mono text-slate-200">
                      {sensor.isOnline ? (
                        <Wifi className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <WifiOff className="h-3 w-3 text-slate-500" />
                      )}
                      <span>{sensor.batteryPct !== null ? `${sensor.batteryPct}%` : '—'}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    {t('contacts.lastOpening', {
                      value: sensor.lastOpenedAt
                        ? new Date(sensor.lastOpenedAt).toLocaleString(intlLocale, {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : t('contacts.noneOnPeriod'),
                    })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Graphique d'activité + Historique chronologique */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Activity className="h-4 w-4 text-amber-400" />
              {t('contacts.activityTitle')}
            </h3>
            <p className="text-xs text-slate-400">
              {t('contacts.activitySub')}
            </p>
          </div>

          {contacts.activitySeries.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-xs text-slate-500">
              {t('contacts.noActivity')}
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={contacts.activitySeries}
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
                    dataKey="openCount"
                    name={t('contacts.openReadingsSeries')}
                    fill="#f59e0b"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="transitionsCount"
                    name={t('contacts.transitionsSeries')}
                    fill="#6366f1"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Journal historique des ouvertures / fermetures */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Filter className="h-4 w-4 text-indigo-400" />
                {t('contacts.historyTitle', { count: visibleEvents.length })}
              </h3>
              <p className="text-xs text-slate-400">
                {t('contacts.historySub')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
              >
                <option value="all">{t('contacts.allSensors')}</option>
                {contacts.sensors.map((s) => (
                  <option key={s.deviceId} value={s.deviceId}>
                    {s.name}
                  </option>
                ))}
              </select>

              <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={transitionsOnly}
                  onChange={(e) => setTransitionsOnly(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 text-indigo-600"
                />
                {t('contacts.transitionsOnly')}
              </label>
            </div>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {visibleEvents.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                {t('contacts.noMatchingEvents')}
              </div>
            ) : (
              visibleEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 px-3.5 py-2 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {ev.isOpen ? (
                      <DoorOpen className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    ) : (
                      <DoorClosed className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-slate-200 truncate">{ev.deviceName}</div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: ev.roomColor }}
                        />
                        <span>{ev.roomName}</span>
                        <span>·</span>
                        <span className="font-mono">
                          {new Date(ev.recordedAt).toLocaleString(intlLocale, {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold shrink-0 border ${
                      ev.isOpen
                        ? 'border-amber-500/30 bg-amber-500/15 text-amber-300'
                        : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                    }`}
                  >
                    {ev.isTransition && ev.prevIsOpen !== null && ev.prevIsOpen !== undefined
                      ? ev.prevIsOpen
                        ? t('contacts.transOpenToClosed')
                        : t('contacts.transClosedToOpen')
                      : ev.isOpen
                        ? t('contacts.badgeOpen')
                        : t('contacts.badgeClosed')}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
