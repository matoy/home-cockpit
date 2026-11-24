'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BatteryWarning,
  Bell,
  BellOff,
  CheckCircle2,
  HeartPulse,
  PlugZap,
  ShieldAlert,
  Thermometer,
  WifiOff,
  Wind,
  Workflow,
} from 'lucide-react';
import { computeHomeHealth } from '@/lib/home-health';
import { useI18n } from './I18nProvider';
import type { DashboardPayload, TabId } from '@/types';

interface HealthTabProps {
  data: DashboardPayload;
  onNavigateTab: (tab: TabId) => void;
  onRefresh?: () => Promise<void>;
}

export function HealthTab({ data, onNavigateTab, onRefresh }: HealthTabProps) {
  const { t, locale, formatDateTime } = useI18n();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const report = useMemo(() => computeHomeHealth(data, locale), [data, locale]);

  async function handleToggleOfflineExempt(deviceId: string, ignoreOfflineAlert: boolean) {
    setTogglingId(deviceId);
    try {
      const res = await fetch('/api/devices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deviceId, ignoreOfflineAlert }),
      });
      if (res.ok && onRefresh) {
        await onRefresh();
      }
    } finally {
      setTogglingId(null);
    }
  }

  const crossAndSystemCount =
    report.safetyAlerts.length +
    report.openWithHvacRooms.length +
    report.vendorIssues.length +
    report.comfortAlerts.length +
    report.automationWarningsCount;

  const statusTone =
    report.status === 'critical'
      ? {
          card: 'border-rose-500/40 bg-rose-950/20',
          iconWrap: 'bg-rose-500/15 text-rose-400',
          text: 'text-rose-300',
          label: t('health.statusCritical'),
        }
      : report.status === 'warning'
        ? {
            card: 'border-amber-500/40 bg-amber-950/15',
            iconWrap: 'bg-amber-500/15 text-amber-400',
            text: 'text-amber-300',
            label: t('health.statusWarning'),
          }
        : {
            card: 'border-emerald-500/30 bg-slate-900/70',
            iconWrap: 'bg-emerald-500/15 text-emerald-400',
            text: 'text-emerald-300',
            label: t('health.statusHealthy'),
          };

  return (
    <div className="space-y-6">
      {/* 4 KPIs Santé du logement */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={`rounded-2xl border p-5 ${statusTone.card}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('health.kpiStatus')}
            </span>
            <div className={`rounded-lg p-2 ${statusTone.iconWrap}`}>
              <HeartPulse className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className={`text-2xl font-bold tracking-tight ${statusTone.text}`}>
              {statusTone.label}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {report.totalIssues > 0
              ? t('health.issuesCount', { count: report.totalIssues })
              : t('health.noIssuesSub')}
          </p>
        </div>

        <div
          className={`rounded-2xl border p-5 ${
            report.lowBatteryDevices.length > 0
              ? 'border-rose-500/40 bg-rose-950/15'
              : 'border-slate-800 bg-slate-900/70'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('health.kpiLowBattery')}
            </span>
            <div
              className={`rounded-lg p-2 ${
                report.lowBatteryDevices.length > 0
                  ? 'bg-rose-500/15 text-rose-400'
                  : 'bg-emerald-500/15 text-emerald-400'
              }`}
            >
              <BatteryWarning className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {report.lowBatteryDevices.length}
            </span>
          </div>
          <p
            className={`mt-2 text-xs ${
              report.lowBatteryDevices.length > 0 ? 'text-rose-300' : 'text-slate-400'
            }`}
          >
            {report.lowBatteryDevices.length > 0
              ? t('health.lowBatterySub', { count: report.lowBatteryDevices.length })
              : t('health.allBatteriesOk')}
          </p>
        </div>

        <div
          className={`rounded-2xl border p-5 ${
            report.offlineDevices.length > 0
              ? 'border-amber-500/40 bg-amber-950/15'
              : 'border-slate-800 bg-slate-900/70'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('health.kpiOffline')}
            </span>
            <div
              className={`rounded-lg p-2 ${
                report.offlineDevices.length > 0
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-emerald-500/15 text-emerald-400'
              }`}
            >
              <WifiOff className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {report.offlineDevices.length}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {report.offlineDevices.length > 0
              ? t('health.offlineSub', { count: report.offlineDevices.length })
              : t('health.allOnlineSub')}
            {report.exemptedOfflineDevices.length > 0 && (
              <span className="text-slate-500">
                {' '}
                · {t('health.exemptedCountNote', { count: report.exemptedOfflineDevices.length })}
              </span>
            )}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('health.kpiCrossAlerts')}
            </span>
            <div
              className={`rounded-lg p-2 ${
                crossAndSystemCount > 0
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-emerald-500/15 text-emerald-400'
              }`}
            >
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {crossAndSystemCount}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {t('health.crossAlertsSub', {
              safety: report.safetyAlerts.length,
              cross: report.openWithHvacRooms.length,
              vendors: report.vendorIssues.length,
            })}
          </p>
        </div>
      </div>

      {report.totalIssues === 0 ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/15 p-10 text-center space-y-2.5">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold text-white">{t('health.healthyTitle')}</h2>
          <p className="mx-auto max-w-xl text-xs text-slate-400 leading-relaxed">
            {t('health.healthyDesc')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Alertes Sécurité actives */}
          {report.safetyAlerts.length > 0 && (
            <section className="rounded-2xl border border-rose-500/40 bg-rose-950/20 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-rose-200 flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-rose-400" />
                  {t('health.sectionSafety', { count: report.safetyAlerts.length })}
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigateTab('security')}
                  className="rounded-lg border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 px-3 py-1 text-xs font-medium text-rose-200 transition"
                >
                  {t('health.btnOpenSecurity')}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {report.safetyAlerts.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-slate-950/70 px-3.5 py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: item.roomColor }}
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-white truncate">{item.name}</div>
                        <div className="text-[11px] text-slate-400 truncate">{item.roomName}</div>
                      </div>
                    </div>
                    <span className="rounded-full border border-rose-500/40 bg-rose-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-rose-200 shrink-0">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Anomalie croisée : ouverture ouverte + clim active */}
          {report.openWithHvacRooms.length > 0 && (
            <section className="rounded-2xl border border-amber-500/40 bg-amber-950/15 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-amber-200 flex items-center gap-2">
                  <Wind className="h-4 w-4 text-amber-400" />
                  {t('health.sectionOpenWithHvac', { count: report.openWithHvacRooms.length })}
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigateTab('contacts')}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 px-3 py-1 text-xs font-medium text-amber-200 transition"
                  >
                    {t('health.btnOpenContacts')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('hvac')}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 px-3 py-1 text-xs font-medium text-amber-200 transition"
                  >
                    {t('health.btnOpenHvac')}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {report.openWithHvacRooms.map((item) => (
                  <div
                    key={item.roomId}
                    className="rounded-xl border border-amber-500/30 bg-slate-950/70 px-3.5 py-2.5 text-xs space-y-1"
                  >
                    <div className="flex items-center gap-2 font-semibold text-white">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: item.roomColor }}
                      />
                      <span>{item.roomName}</span>
                    </div>
                    <div className="text-[11px] text-amber-200/90">
                      {t('health.openSensorsLabel', { list: item.openSensors.join(', ') })}
                    </div>
                    <div className="text-[11px] text-sky-300">
                      {t('health.activeHvacLabel', { list: item.activeHvacUnits.join(', ') })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Erreurs connecteurs / synchro */}
          {report.vendorIssues.length > 0 && (
            <section className="rounded-2xl border border-rose-500/30 bg-slate-900/70 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <PlugZap className="h-4 w-4 text-rose-400" />
                  {t('health.sectionVendors', { count: report.vendorIssues.length })}
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigateTab('systems')}
                  className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1 text-xs font-medium text-slate-200 transition"
                >
                  {t('health.btnOpenSystems')}
                </button>
              </div>
              <div className="space-y-2">
                {report.vendorIssues.map((v) => (
                  <div
                    key={v.vendor}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-2.5 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-white">{v.label}</div>
                      <div className="text-[11px] text-rose-300">
                        {v.lastError || t('health.vendorNotConnected')}
                      </div>
                    </div>
                    {v.lastSyncedAt && (
                      <span className="text-[11px] text-slate-500 font-mono">
                        {formatDateTime(v.lastSyncedAt)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Piles faibles */}
          {report.lowBatteryDevices.length > 0 && (
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <BatteryWarning className="h-4 w-4 text-rose-400" />
                  {t('health.sectionLowBattery', { count: report.lowBatteryDevices.length })}
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigateTab('devices')}
                  className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1 text-xs font-medium text-slate-200 transition"
                >
                  {t('health.btnOpenDevices')}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {report.lowBatteryDevices.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: d.roomColor }}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-100 truncate">{d.name}</div>
                        <div className="text-[11px] text-slate-500 truncate">{d.roomName}</div>
                      </div>
                    </div>
                    <span className="rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-mono font-semibold text-rose-300 shrink-0">
                      {d.batteryPct}%
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Pièces hors zone de confort (placées au-dessus des appareils hors ligne) */}
          {report.comfortAlerts.length > 0 && (
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Thermometer className="h-4 w-4 text-sky-400" />
                  {t('health.sectionComfort', { count: report.comfortAlerts.length })}
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigateTab('climate')}
                  className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1 text-xs font-medium text-slate-200 transition"
                >
                  {t('health.btnOpenClimate')}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {report.comfortAlerts.map((rs) => (
                  <div
                    key={rs.roomId}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: rs.roomColor }}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-100 truncate">{rs.roomName}</div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {rs.currentTempC !== null ? `${rs.currentTempC.toFixed(1)} °C` : '—'} ·{' '}
                          {rs.currentHumidityPct !== null
                            ? `${rs.currentHumidityPct.toFixed(0)} %`
                            : '—'}
                        </div>
                      </div>
                    </div>
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-300 shrink-0">
                      {rs.label}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Appareils hors ligne */}
          {report.offlineDevices.length > 0 && (
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <WifiOff className="h-4 w-4 text-amber-400" />
                  {t('health.sectionOffline', { count: report.offlineDevices.length })}
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigateTab('devices')}
                  className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1 text-xs font-medium text-slate-200 transition"
                >
                  {t('health.btnOpenDevices')}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {report.offlineDevices.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: d.roomColor }}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-100 truncate">{d.name}</div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {d.roomName} ·{' '}
                          {d.lastSeenAt
                            ? t('health.lastSeenLabel', { date: formatDateTime(d.lastSeenAt) })
                            : t('health.neverSeen')}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleToggleOfflineExempt(d.id, true)}
                      disabled={togglingId === d.id}
                      title={t('health.exemptOfflineTitle')}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 disabled:opacity-50 px-2 py-1 text-[11px] font-medium text-slate-300 transition shrink-0"
                    >
                      <BellOff className="h-3 w-3 text-slate-400" />
                      {t('health.exemptOfflineBtn')}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Avertissements automatisations */}
          {report.automationWarningsCount > 0 && (
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-indigo-400" />
                  {t('health.sectionAutomations', { count: report.automationWarningsCount })}
                </h3>
                <p className="text-xs text-slate-400">
                  {t('health.automationsDesc', { count: report.automationWarningsCount })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('automations')}
                className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition"
              >
                {t('health.btnOpenAutomations')}
              </button>
            </section>
          )}
        </div>
      )}

      {/* Appareils exemptés d'alerte hors ligne */}
      {report.exemptedDevices.length > 0 && (
        <section className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <BellOff className="h-3.5 w-3.5 text-slate-400" />
              {t('health.exemptedSectionTitle', { count: report.exemptedDevices.length })}
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('devices')}
              className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1 text-xs font-medium text-slate-200 transition"
            >
              {t('health.btnOpenDevices')}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {report.exemptedDevices.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3.5 py-2.5 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: d.roomColor }}
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-slate-200 truncate">{d.name}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {d.roomName} · {d.isOnline ? t('common.online') : t('common.offline')}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleToggleOfflineExempt(d.id, false)}
                  disabled={togglingId === d.id}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-2 py-1 text-[11px] font-medium text-slate-200 transition shrink-0"
                >
                  <Bell className="h-3 w-3 text-indigo-400" />
                  {t('health.reenableOfflineBtn')}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
