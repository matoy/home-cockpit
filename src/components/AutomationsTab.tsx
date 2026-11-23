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
  Workflow,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Clock,
  CloudSun,
  Hand,
  MapPin,
  Cpu,
  Wifi,
  WifiOff,
  BatteryWarning,
  ArrowRight,
  Search,
  Code2,
  ShieldCheck,
  Bell,
  Timer,
  Layers,
} from 'lucide-react';
import { useI18n } from './I18nProvider';
import type { TranslationKey } from '@/lib/i18n/dictionaries/fr';
import type {
  AutomationActionCategory,
  AutomationConditionCategory,
  DashboardPayload,
  EnrichedAutomation,
} from '@/types';

interface AutomationsTabProps {
  data: DashboardPayload;
  onRefresh: () => Promise<void>;
}

type TypeFilter = 'all' | 'automation' | 'scene';
type StatusFilter = 'all' | 'enabled' | 'disabled' | 'warning';
type TriggerFilter = 'all' | 'device' | 'timer' | 'weather' | 'manual';

function formatLoops(loops: string, t: (k: TranslationKey) => string): string {
  if (!loops || loops === '1111111') return t('automations.everyDay');
  if (loops === '0111110') return t('automations.weekdays');
  if (loops === '1000001') return t('automations.weekend');
  const dayKeys: TranslationKey[] = [
    'automations.day0',
    'automations.day1',
    'automations.day2',
    'automations.day3',
    'automations.day4',
    'automations.day5',
    'automations.day6',
  ];
  const active = dayKeys.filter((_, idx) => loops[idx] === '1').map((k) => t(k));
  return active.length > 0 ? active.join(', ') : t('automations.noDays');
}

function TriggerIcon({ category }: { category: AutomationConditionCategory | 'manual' }) {
  if (category === 'timer') return <Clock className="h-3.5 w-3.5 text-sky-400 shrink-0" />;
  if (category === 'weather') return <CloudSun className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
  if (category === 'geofence') return <MapPin className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
  if (category === 'manual') return <Hand className="h-3.5 w-3.5 text-indigo-400 shrink-0" />;
  return <Cpu className="h-3.5 w-3.5 text-indigo-400 shrink-0" />;
}

function ActionIcon({ category }: { category: AutomationActionCategory }) {
  if (category === 'delay') return <Timer className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
  if (category === 'notification') return <Bell className="h-3.5 w-3.5 text-sky-400 shrink-0" />;
  if (category === 'rule') return <Workflow className="h-3.5 w-3.5 text-purple-400 shrink-0" />;
  return <Zap className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
}

export function AutomationsTab({ data, onRefresh }: AutomationsTabProps) {
  const { t } = useI18n();
  const { automations } = data;
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all');
  const [focusRuleId, setFocusRuleId] = useState<string | null>(null);
  const [expandedJsonIds, setExpandedJsonIds] = useState<Record<string, boolean>>({});

  const deviceById = useMemo(
    () => new Map(data.devices.map((d) => [d.id, d])),
    [data.devices]
  );

  const roomById = useMemo(
    () => new Map(data.rooms.map((r) => [r.id, r])),
    [data.rooms]
  );

  const filteredRules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return automations.rules.filter((rule) => {
      if (focusRuleId && rule.id !== focusRuleId) return false;
      if (typeFilter !== 'all' && rule.ruleType !== typeFilter) return false;
      if (statusFilter === 'enabled' && !rule.enabled) return false;
      if (statusFilter === 'disabled' && rule.enabled) return false;
      if (statusFilter === 'warning' && rule.health !== 'warning') return false;
      if (triggerFilter !== 'all' && rule.primaryTriggerCategory !== triggerFilter) return false;
      if (q) {
        const haystack = [
          rule.name,
          ...rule.rooms.map((r) => r.name),
          ...rule.triggerDevices.map((d) => d.name),
          ...rule.targetDevices.map((d) => d.name),
          ...rule.conditions.map((c) => c.summary),
          ...rule.actions.map((a) => a.summary),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [automations.rules, focusRuleId, typeFilter, statusFilter, triggerFilter, searchQuery]);

  async function handleSyncAutomations() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/tuya/automations/sync', { method: 'POST' });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(json.error || t('automations.syncError'));
      setSyncMsg({ ok: true, text: json.message || t('automations.syncDone') });
      await onRefresh();
    } catch (err) {
      setSyncMsg({
        ok: false,
        text: err instanceof Error ? err.message : t('automations.syncError'),
      });
    } finally {
      setSyncing(false);
    }
  }

  function toggleRawJson(ruleId: string) {
    setExpandedJsonIds((prev) => ({ ...prev, [ruleId]: !prev[ruleId] }));
  }

  const { summary } = automations;

  return (
    <div className="space-y-6">
      {/* En-tête + bouton de synchronisation */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-white">
              {t('automations.title')}
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-300">
              <ShieldCheck className="h-3 w-3" /> {t('common.readOnly')}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {t('automations.subtitle')}
          </p>
        </div>

        <button
          onClick={() => void handleSyncAutomations()}
          disabled={syncing}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 text-xs font-medium text-white transition"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? t('common.syncing') : t('automations.syncBtn')}
        </button>
      </div>

      {syncMsg && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs ${
            syncMsg.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          }`}
        >
          {syncMsg.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          <span>{syncMsg.text}</span>
        </div>
      )}

      {/* 4 KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('automations.kpiActive')}
            </span>
            <div className="rounded-lg bg-indigo-500/15 p-2 text-indigo-400">
              <Workflow className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {summary.enabledCount}
            </span>
            <span className="text-sm text-slate-400">/ {summary.totalCount}</span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {t('automations.kpiActiveSub', {
              autos: summary.automationsCount,
              scenes: summary.scenesCount,
            })}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('automations.kpiHealth')}
            </span>
            <div
              className={`rounded-lg p-2 ${
                summary.warningCount > 0
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-emerald-500/15 text-emerald-400'
              }`}
            >
              {summary.warningCount > 0 ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {summary.healthyCount}
            </span>
            <span className="text-xs text-emerald-400">{t('automations.healthyWord')}</span>
          </div>
          <p
            className={`mt-2 text-xs ${
              summary.warningCount > 0 ? 'text-amber-300' : 'text-slate-400'
            }`}
          >
            {summary.warningCount > 0
              ? t('automations.warningRules', { count: summary.warningCount })
              : t('automations.pausedRules', { count: summary.disabledCount })}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('automations.kpiConflicts')}
            </span>
            <div
              className={`rounded-lg p-2 ${
                summary.conflictsCount > 0
                  ? 'bg-rose-500/15 text-rose-400'
                  : 'bg-emerald-500/15 text-emerald-400'
              }`}
            >
              <Layers className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {summary.conflictsCount}
            </span>
            <span className="text-xs text-slate-400">{t('automations.sharedTargets')}</span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {summary.conflictsCount > 0
              ? t('automations.conflictsSub')
              : t('automations.noConflictsSub')}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {t('automations.kpiCoverage')}
            </span>
            <div className="rounded-lg bg-sky-500/15 p-2 text-sky-400">
              <Cpu className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {summary.coveredDevicesCount}
            </span>
            <span className="text-sm text-slate-400">
              / {summary.totalDevicesCount} {t('automations.devicesShort')}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {t('automations.roomsAutomated', {
              covered: summary.coveredRoomsCount,
              total: data.rooms.length,
            })}
          </p>
        </div>
      </div>

      {automations.rules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-12 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-400">
            <Workflow className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-white">{t('automations.emptyTitle')}</h3>
          <p className="mx-auto max-w-lg text-xs text-slate-400">
            {t('automations.emptyDesc')}
          </p>
        </div>
      ) : (
        <>
          {/* Insights & Graphiques */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Audit & Diagnostics */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    {t('automations.insightsTitle', { count: automations.insights.length })}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {t('automations.insightsSub')}
                  </p>
                </div>
                {focusRuleId && (
                  <button
                    onClick={() => setFocusRuleId(null)}
                    className="rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1 text-[11px] text-indigo-300"
                  >
                    {t('automations.resetFocus')}
                  </button>
                )}
              </div>

              {automations.insights.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-8 text-center text-xs text-emerald-300 gap-2">
                  <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                  <span>{t('automations.allHealthy')}</span>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {automations.insights.map((ins) => {
                    const isFocused = focusRuleId === ins.ruleId;
                    return (
                      <button
                        key={ins.id}
                        type="button"
                        onClick={() => setFocusRuleId(isFocused ? null : ins.ruleId)}
                        className={`w-full text-left rounded-xl border p-3 text-xs transition ${
                          isFocused
                            ? 'border-indigo-500 bg-indigo-950/30'
                            : ins.severity === 'warning'
                              ? 'border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15'
                              : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-white">{ins.ruleName}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              ins.kind === 'potential_conflict'
                                ? 'bg-rose-500/20 text-rose-300'
                                : ins.severity === 'warning'
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : 'bg-sky-500/20 text-sky-300'
                            }`}
                          >
                            {ins.kind === 'potential_conflict'
                              ? t('automations.kindConflict')
                              : ins.kind === 'offline_dependency'
                                ? t('automations.kindOffline')
                                : ins.kind === 'low_battery_dependency'
                                  ? t('automations.kindLowBattery')
                                  : ins.kind === 'missing_device'
                                    ? t('automations.kindMissingDevice')
                                    : t('automations.kindInfo')}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-300">{ins.message}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Déclencheurs + Top Appareils pivots */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-white mb-1">
                  {t('automations.breakdownTitle')}
                </h3>
                <p className="text-xs text-slate-400">
                  {t('automations.breakdownSub')}
                </p>
              </div>

              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={automations.triggerBreakdown}
                    margin={{ top: 5, right: 12, left: -16, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={11} />
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
                      dataKey="count"
                      name={t('automations.seriesCount')}
                      fill="#6366f1"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {automations.topDevices.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-slate-800">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    {t('automations.topDevicesTitle')}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {automations.topDevices.slice(0, 6).map((td) => (
                      <div
                        key={td.deviceId}
                        className="flex items-center justify-between rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: td.roomColor }}
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-200">{td.name}</div>
                            <div className="text-[10px] text-slate-500 truncate">{td.roomName}</div>
                          </div>
                        </div>
                        <div className="font-mono text-[10px] text-slate-300 shrink-0 ml-2">
                          <span className="text-sky-300" title={t('automations.ifTooltip')}>
                            {t('automations.ifBadge', { count: td.asTriggerCount })}
                          </span>
                          {' · '}
                          <span className="text-emerald-300" title={t('automations.thenTooltip')}>
                            {t('automations.thenBadge', { count: td.asActionCount })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Couverture par pièce */}
          {automations.roomCoverage.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-400 mr-1">
                {t('automations.roomCoverage')}
              </span>
              {automations.roomCoverage.map((rc) => (
                <span
                  key={rc.roomId}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs text-slate-200"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: rc.roomColor }}
                  />
                  <span>{rc.roomName}</span>
                  <span className="font-mono text-[11px] text-indigo-300">
                    {rc.activeRulesCount}/{rc.rulesCount}
                  </span>
                </span>
              ))}
            </div>
          )}

          {/* Barre de filtres */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                placeholder={t('automations.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-slate-200 focus:border-indigo-500 focus:outline-none"
              >
                <option value="all">{t('automations.allTypes')}</option>
                <option value="automation">
                  {t('automations.typeAutomations', { count: summary.automationsCount })}
                </option>
                <option value="scene">
                  {t('automations.typeScenes', { count: summary.scenesCount })}
                </option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-slate-200 focus:border-indigo-500 focus:outline-none"
              >
                <option value="all">{t('automations.allStates')}</option>
                <option value="enabled">
                  {t('automations.stateEnabled', { count: summary.enabledCount })}
                </option>
                <option value="disabled">
                  {t('automations.stateDisabled', { count: summary.disabledCount })}
                </option>
                <option value="warning">
                  {t('automations.stateWarning', { count: summary.warningCount })}
                </option>
              </select>

              <select
                value={triggerFilter}
                onChange={(e) => setTriggerFilter(e.target.value as TriggerFilter)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-slate-200 focus:border-indigo-500 focus:outline-none"
              >
                <option value="all">{t('automations.allTriggers')}</option>
                <option value="device">{t('automations.trigDevice')}</option>
                <option value="timer">{t('automations.trigTimer')}</option>
                <option value="weather">{t('automations.trigWeather')}</option>
                <option value="manual">{t('automations.trigManual')}</option>
              </select>
            </div>
          </div>

          {/* Liste détaillée des scénarios */}
          <div className="space-y-4">
            {filteredRules.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-xs text-slate-500">
                {t('automations.noMatchingRules')}
              </div>
            ) : (
              filteredRules.map((rule: EnrichedAutomation) => {
                const jsonOpen = Boolean(expandedJsonIds[rule.id]);
                return (
                  <div
                    key={rule.id}
                    className={`rounded-2xl border p-5 space-y-4 transition ${
                      !rule.enabled
                        ? 'border-slate-800/70 bg-slate-900/40 opacity-80'
                        : rule.health === 'warning'
                          ? 'border-amber-500/40 bg-slate-900/80'
                          : 'border-slate-800 bg-slate-900/70'
                    }`}
                  >
                    {/* Header de la carte */}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-white">{rule.name}</h3>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${
                              rule.ruleType === 'scene'
                                ? 'border-purple-500/30 bg-purple-500/15 text-purple-300'
                                : 'border-indigo-500/30 bg-indigo-500/15 text-indigo-300'
                            }`}
                          >
                            {rule.ruleType === 'scene'
                              ? t('automations.badgeScene')
                              : t('automations.badgeAutomation')}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${
                              rule.enabled
                                ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                                : 'border-slate-700 bg-slate-800 text-slate-400'
                            }`}
                          >
                            {rule.enabled ? t('common.active') : t('automations.badgeDisabled')}
                          </span>
                          {rule.health === 'warning' && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-amber-300">
                              <AlertTriangle className="h-3 w-3" /> {t('automations.badgeWarning')}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                          {rule.ruleType === 'automation' && (
                            <span className="rounded bg-slate-800/80 px-2 py-0.5 text-slate-300">
                              {rule.matchType === 'all'
                                ? t('automations.matchAll')
                                : t('automations.matchAny')}
                            </span>
                          )}
                          {rule.effectiveTime && !rule.effectiveTime.allDay && (
                            <span className="inline-flex items-center gap-1 rounded bg-slate-800/80 px-2 py-0.5 text-sky-300">
                              <Clock className="h-3 w-3" />
                              {rule.effectiveTime.startTime} – {rule.effectiveTime.endTime} (
                              {formatLoops(rule.effectiveTime.loops, t)})
                            </span>
                          )}
                          {rule.rooms.map((rm) => (
                            <span
                              key={rm.id}
                              className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] text-slate-300"
                            >
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: rm.color }}
                              />
                              {rm.name}
                            </span>
                          ))}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleRawJson(rule.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300"
                      >
                        <Code2 className="h-3.5 w-3.5" />
                        {jsonOpen ? t('automations.hideJson') : t('automations.showJson')}
                      </button>
                    </div>

                    {/* Flux SI -> ALORS */}
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
                      {/* Conditions (SI) */}
                      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">
                          {t('automations.ifHeader', { count: rule.conditions.length })}
                        </div>
                        {rule.ruleType === 'scene' ? (
                          <div className="flex items-center gap-2 text-xs text-slate-300">
                            <Hand className="h-3.5 w-3.5 text-indigo-400" />
                            <span>{t('automations.manualTapDesc')}</span>
                          </div>
                        ) : rule.conditions.length === 0 ? (
                          <div className="text-xs text-slate-500">{t('automations.noConditions')}</div>
                        ) : (
                          <div className="space-y-1.5">
                            {rule.conditions.map((cond, idx) => {
                              const dev = cond.entityId ? deviceById.get(cond.entityId) : undefined;
                              const rm = dev?.roomId ? roomById.get(dev.roomId) : undefined;
                              const displayName =
                                dev?.customName || dev?.name || cond.entityName || cond.entityId;
                              return (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/90 px-2.5 py-1.5 text-xs"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <TriggerIcon category={cond.category} />
                                    <div className="min-w-0">
                                      {displayName && cond.category === 'device' && (
                                        <div className="font-medium text-slate-200 truncate flex items-center gap-1.5">
                                          <span>{displayName}</span>
                                          {rm && (
                                            <span className="text-[10px] text-slate-500">
                                              ({rm.name})
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      <div className="text-[11px] font-mono text-sky-300 truncate">
                                        {cond.summary}
                                      </div>
                                    </div>
                                  </div>

                                  {dev && (
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {dev.lastBatteryPct !== null && dev.lastBatteryPct <= 20 && (
                                        <span
                                          title={t('automations.lowBatteryTooltip', {
                                            pct: dev.lastBatteryPct,
                                          })}
                                          className="inline-flex items-center gap-0.5 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300"
                                        >
                                          <BatteryWarning className="h-2.5 w-2.5" />
                                          {dev.lastBatteryPct}%
                                        </span>
                                      )}
                                      {dev.isOnline ? (
                                        <Wifi className="h-3 w-3 text-emerald-400" />
                                      ) : (
                                        <WifiOff className="h-3 w-3 text-rose-400" />
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Flèche */}
                      <div className="hidden lg:flex items-center justify-center px-1 text-slate-600">
                        <ArrowRight className="h-5 w-5" />
                      </div>

                      {/* Actions (ALORS) */}
                      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                          {t('automations.thenHeader', { count: rule.actions.length })}
                        </div>
                        {rule.actions.length === 0 ? (
                          <div className="text-xs text-slate-500">{t('automations.noActions')}</div>
                        ) : (
                          <div className="space-y-1.5">
                            {rule.actions.map((act, idx) => {
                              const dev = act.entityId ? deviceById.get(act.entityId) : undefined;
                              const rm = dev?.roomId ? roomById.get(dev.roomId) : undefined;
                              const displayName =
                                dev?.customName || dev?.name || act.entityName || act.entityId;
                              return (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/90 px-2.5 py-1.5 text-xs"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <ActionIcon category={act.category} />
                                    <div className="min-w-0">
                                      {displayName && act.category === 'device' && (
                                        <div className="font-medium text-slate-200 truncate flex items-center gap-1.5">
                                          <span>{displayName}</span>
                                          {rm && (
                                            <span className="text-[10px] text-slate-500">
                                              ({rm.name})
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      <div className="text-[11px] font-mono text-emerald-300 truncate">
                                        {act.summary}
                                      </div>
                                    </div>
                                  </div>

                                  {dev && (
                                    <div className="shrink-0">
                                      {dev.isOnline ? (
                                        <Wifi className="h-3 w-3 text-emerald-400" />
                                      ) : (
                                        <WifiOff className="h-3 w-3 text-rose-400" />
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Diagnostics inline */}
                    {rule.diagnostics.length > 0 && (
                      <div className="space-y-1.5">
                        {rule.diagnostics.map((d) => (
                          <div
                            key={d.id}
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                              d.severity === 'warning'
                                ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                                : 'border-sky-500/30 bg-sky-500/10 text-sky-200'
                            }`}
                          >
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            <span>{d.message}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* JSON brut Tuya */}
                    {jsonOpen && (
                      <pre className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-64">
                        {JSON.stringify(rule.rawPayload ?? rule, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
