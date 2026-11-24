'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Battery,
  CheckCircle2,
  Droplets,
  Flame,
  Home,
  Radio,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Wifi,
  WifiOff,
  Wind,
} from 'lucide-react';
import { VENDOR_REGISTRY } from '@/lib/vendors/registry';
import {
  extractXSenseSummary,
  isXSenseSecurityDevice,
  type XSenseAlarmTone,
  type XSenseDeviceSummary,
} from '@/lib/vendors/xsense-display';
import {
  extractXiaomiSummary,
  isXiaomiSecurityOrHomeDevice,
  type XiaomiDeviceSummary,
} from '@/lib/vendors/xiaomi-display';
import { useI18n } from './I18nProvider';
import type { DashboardPayload, DeviceRecord, RoomRecord, TabId } from '@/types';

interface SecurityTabProps {
  data: DashboardPayload;
  onNavigateTab: (tab: TabId) => void;
  onResetGlobalFilters?: () => void;
}

type SecurityFilter =
  | 'all'
  | 'alerts'
  | 'smoke_co'
  | 'water_leak'
  | 'stations'
  | 'xiaomi_home'
  | 'low_battery';

interface SecurityItem {
  device: DeviceRecord;
  room: RoomRecord | null;
  xsense: XSenseDeviceSummary | null;
  xiaomi: XiaomiDeviceSummary | null;
  isAlert: boolean;
  isLowBattery: boolean;
}

const ALARM_BADGE_CLASSES: Record<XSenseAlarmTone, string> = {
  emerald: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  rose: 'border-rose-500/50 bg-rose-500/20 text-rose-200 animate-pulse',
  amber: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  slate: 'border-slate-700 bg-slate-800/80 text-slate-300',
};

function formatTimeShort(iso: string | null, intlLocale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(intlLocale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isSecurityOrHomeRelevant(dev: DeviceRecord): boolean {
  if (isXSenseSecurityDevice(dev) || isXiaomiSecurityOrHomeDevice(dev)) return true;
  const hay = `${dev.name} ${dev.customName ?? ''} ${dev.productName ?? ''} ${dev.tuyaCategory ?? ''}`.toLowerCase();
  return (
    hay.includes('fumee') ||
    hay.includes('fumée') ||
    hay.includes('smoke') ||
    hay.includes('monoxyde') ||
    hay.includes('fuite') ||
    hay.includes('leak') ||
    hay.includes('purif') ||
    hay.includes('sbs50')
  );
}

export function SecurityTab({
  data,
  onNavigateTab,
  onResetGlobalFilters,
}: SecurityTabProps) {
  const { t, locale, intlLocale } = useI18n();
  const [filter, setFilter] = useState<SecurityFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const roomById = useMemo(
    () => new Map(data.rooms.map((r) => [r.id, r])),
    [data.rooms]
  );

  const systemScopedAll = useMemo(() => {
    const targetVendor = data.selectedSystem;
    if (targetVendor === 'all') return data.devices;
    return data.devices.filter((d) => d.systems.includes(targetVendor));
  }, [data.devices, data.selectedSystem]);

  const roomScopedAll = useMemo(() => {
    if (data.selectedRoomId === 'all') return systemScopedAll;
    if (data.selectedRoomId === 'unassigned') {
      return systemScopedAll.filter((d) => d.roomId === null);
    }
    const numId = Number(data.selectedRoomId);
    return Number.isFinite(numId)
      ? systemScopedAll.filter((d) => d.roomId === numId)
      : systemScopedAll;
  }, [systemScopedAll, data.selectedRoomId]);

  const allItems = useMemo<SecurityItem[]>(() => {
    const items: SecurityItem[] = [];
    for (const dev of roomScopedAll) {
      if (!isSecurityOrHomeRelevant(dev)) continue;
      const xs = extractXSenseSummary(dev.lastRawStatus, locale);
      const mi = extractXiaomiSummary(dev.lastRawStatus, locale);
      const isAlert = Boolean(xs?.isAlert || mi?.isAlert);
      const isLowBattery = dev.lastBatteryPct !== null && dev.lastBatteryPct < 20;
      items.push({
        device: dev,
        room: dev.roomId !== null ? roomById.get(dev.roomId) ?? null : null,
        xsense: xs,
        xiaomi: mi,
        isAlert,
        isLowBattery,
      });
    }
    return items.sort((a, b) => {
      if (a.isAlert !== b.isAlert) return a.isAlert ? -1 : 1;
      return (a.device.customName || a.device.name).localeCompare(
        b.device.customName || b.device.name,
        intlLocale
      );
    });
  }, [roomScopedAll, roomById, locale, intlLocale]);

  const kpis = useMemo(() => {
    const total = allItems.length;
    const online = allItems.filter((i) => i.device.isOnline).length;
    const activeAlerts = allItems.filter((i) => i.isAlert).length;
    const smokeCoCount = allItems.filter(
      (i) =>
        i.xsense?.unitType === 'smokeCoDetector' ||
        i.xiaomi?.unitType === 'smokeSensor' ||
        i.xiaomi?.unitType === 'gasSensor'
    ).length;
    const waterLeakCount = allItems.filter(
      (i) =>
        i.xsense?.unitType === 'waterLeakSensor' || i.xiaomi?.unitType === 'waterLeakSensor'
    ).length;
    const stationsAndHomeCount = allItems.filter(
      (i) =>
        i.xsense?.unitType === 'baseStation' ||
        i.xiaomi?.unitType === 'airPurifier' ||
        i.xiaomi?.unitType === 'robotVacuum'
    ).length;
    const batteryItems = allItems.filter((i) => i.device.lastBatteryPct !== null);
    const lowBatteryCount = batteryItems.filter((i) => i.isLowBattery).length;
    const avgBatteryPct =
      batteryItems.length > 0
        ? Math.round(
            batteryItems.reduce((s, i) => s + (i.device.lastBatteryPct ?? 0), 0) /
              batteryItems.length
          )
        : null;

    return {
      total,
      online,
      activeAlerts,
      smokeCoCount,
      waterLeakCount,
      stationsAndHomeCount,
      batteryCount: batteryItems.length,
      lowBatteryCount,
      avgBatteryPct,
    };
  }, [allItems]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allItems.filter((item) => {
      if (filter === 'alerts' && !item.isAlert) return false;
      if (
        filter === 'smoke_co' &&
        item.xsense?.unitType !== 'smokeCoDetector' &&
        item.xiaomi?.unitType !== 'smokeSensor' &&
        item.xiaomi?.unitType !== 'gasSensor'
      ) {
        return false;
      }
      if (
        filter === 'water_leak' &&
        item.xsense?.unitType !== 'waterLeakSensor' &&
        item.xiaomi?.unitType !== 'waterLeakSensor'
      ) {
        return false;
      }
      if (
        filter === 'stations' &&
        item.xsense?.unitType !== 'baseStation' &&
        item.xsense?.unitType !== 'thermoHygrometer'
      ) {
        return false;
      }
      if (filter === 'xiaomi_home' && item.device.primaryVendor !== 'xiaomi' && !item.xiaomi) {
        return false;
      }
      if (filter === 'low_battery' && !item.isLowBattery) return false;

      if (!q) return true;
      const haystack = [
        item.device.customName || item.device.name,
        item.device.productName,
        item.room?.name,
        item.xsense?.searchableText,
        item.xiaomi?.searchableText,
        item.device.ipAddress,
        item.device.macAddress,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [allItems, filter, searchQuery]);

  const groupedByRoom = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; title: string; color: string; items: SecurityItem[] }
    >();
    for (const item of filteredItems) {
      const key = item.room ? String(item.room.id) : 'unassigned';
      const existing = groups.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.set(key, {
          key,
          title: item.room ? item.room.name : t('security.unassignedRoom'),
          color: item.room?.color ?? '#64748b',
          items: [item],
        });
      }
    }
    return Array.from(groups.values()).sort((a, b) => a.title.localeCompare(b.title, intlLocale));
  }, [filteredItems, intlLocale, t]);

  const hasGlobalScope =
    data.selectedSystem !== 'all' || data.selectedRoomId !== 'all';

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          className={`rounded-2xl border p-4 ${
            kpis.activeAlerts > 0
              ? 'border-rose-500/50 bg-rose-950/30'
              : 'border-slate-800 bg-slate-900/70'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{t('security.kpiStatus')}</span>
            {kpis.activeAlerts > 0 ? (
              <ShieldAlert className="h-4 w-4 text-rose-400" />
            ) : (
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
            )}
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-xl font-bold ${
                kpis.activeAlerts > 0 ? 'text-rose-300' : 'text-emerald-300'
              }`}
            >
              {kpis.activeAlerts > 0
                ? t('security.alertsCount', { count: kpis.activeAlerts })
                : t('security.noAlert')}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {t('security.statusSub', { online: kpis.online, total: kpis.total })}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{t('security.kpiDetectors')}</span>
            <Flame className="h-4 w-4 text-rose-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">
              {kpis.smokeCoCount + kpis.waterLeakCount}
            </span>
            <span className="text-xs text-slate-400">{t('security.activeUnit')}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {t('security.detectorsSub', { smoke: kpis.smokeCoCount, leak: kpis.waterLeakCount })}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{t('security.kpiStations')}</span>
            <Sparkles className="h-4 w-4 text-orange-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">
              {kpis.stationsAndHomeCount}
            </span>
            <span className="text-xs text-slate-400">{t('security.unitsWord')}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {t('security.stationsSub')}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{t('security.kpiBatteries')}</span>
            <Battery
              className={`h-4 w-4 ${
                kpis.lowBatteryCount > 0 ? 'text-amber-400' : 'text-emerald-400'
              }`}
            />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">
              {kpis.avgBatteryPct !== null ? `${kpis.avgBatteryPct} %` : '—'}
            </span>
            <span className="text-xs text-slate-400">{t('security.avgWord')}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {kpis.lowBatteryCount > 0
              ? t('security.lowBatteriesSub', { count: kpis.lowBatteryCount })
              : t('security.okBatteriesSub', { count: kpis.batteryCount })}
          </p>
        </div>
      </div>

      {/* Barre de filtres */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['all', t('security.filterAll', { count: allItems.length })],
              ['smoke_co', t('security.filterSmokeCo', { count: kpis.smokeCoCount })],
              ['water_leak', t('security.filterWaterLeak', { count: kpis.waterLeakCount })],
              ['stations', t('security.filterStations')],
              ['xiaomi_home', t('security.filterXiaomi')],
              ['low_battery', t('security.filterLowBattery', { count: kpis.lowBatteryCount })],
            ] as Array<[SecurityFilter, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium border transition ${
                filter === key
                  ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-200'
                  : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[210px] max-w-xs">
          <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('security.searchPlaceholder')}
            className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Contenu ou état vide */}
      {groupedByRoom.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center space-y-3">
          <ShieldCheck className="h-8 w-8 text-slate-500 mx-auto" />
          <p className="text-sm font-medium text-slate-200">
            {allItems.length === 0
              ? t('security.emptyNone')
              : t('security.emptyNoMatch')}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {hasGlobalScope && onResetGlobalFilters && (
              <button
                type="button"
                onClick={onResetGlobalFilters}
                className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-medium text-slate-200 transition"
              >
                {t('common.resetFilters')}
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigateTab('systems')}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3.5 py-2 text-xs font-medium text-white transition"
            >
              {t('security.configureBtn')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedByRoom.map((group) => (
            <section key={group.key} className="space-y-3">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: group.color }}
                />
                <Home className="h-4 w-4 text-slate-400" />
                <h3 className="text-sm font-semibold text-white">{group.title}</h3>
                <span className="text-xs text-slate-500">({group.items.length})</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {group.items.map(({ device, xsense, xiaomi, isAlert, isLowBattery }) => {
                  const displayName = device.customName || device.name;
                  const meta = VENDOR_REGISTRY[device.primaryVendor];
                  const rssi = xsense?.wifiRssiDbm ?? xiaomi?.wifiRssiDbm ?? null;

                  return (
                    <div
                      key={device.id}
                      className={`rounded-2xl border p-4 space-y-3 transition ${
                        isAlert
                          ? 'border-rose-500/60 bg-rose-950/25'
                          : 'border-slate-800 bg-slate-900/70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}
                            >
                              {meta.shortLabel}
                            </span>
                            <h4 className="text-sm font-semibold text-white truncate">
                              {displayName}
                            </h4>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                            {xsense?.unitTypeLabel ?? xiaomi?.unitTypeLabel ?? device.productName ?? t('security.defaultSensor')}
                            {device.productName ? ` · ${device.productName}` : ''}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {xsense && (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                                ALARM_BADGE_CLASSES[xsense.alarmTone]
                              }`}
                            >
                              {xsense.isAlert ? (
                                <AlertTriangle className="h-3 w-3" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3" />
                              )}
                              {xsense.alarmLabel}
                            </span>
                          )}
                          {xiaomi?.alertLabel && (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                                xiaomi.isAlert
                                  ? ALARM_BADGE_CLASSES.rose
                                  : ALARM_BADGE_CLASSES.emerald
                              }`}
                            >
                              {xiaomi.isAlert ? (
                                <AlertTriangle className="h-3 w-3" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3" />
                              )}
                              {xiaomi.alertLabel}
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                              device.isOnline
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {device.isOnline ? (
                              <Wifi className="h-3 w-3" />
                            ) : (
                              <WifiOff className="h-3 w-3" />
                            )}
                            {device.isOnline ? t('common.online') : t('common.offline')}
                          </span>
                        </div>
                      </div>

                      {/* Métriques principales */}
                      <div className="grid grid-cols-3 gap-2">
                        {device.lastTempC !== null && (
                          <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2.5">
                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Thermometer className="h-3 w-3 text-amber-400" />
                              {t('security.tempLabel')}
                            </span>
                            <p className="text-sm font-semibold text-white mt-0.5">
                              {device.lastTempC.toFixed(1)} °C
                            </p>
                          </div>
                        )}
                        {device.lastHumidityPct !== null && (
                          <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2.5">
                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Droplets className="h-3 w-3 text-sky-400" />
                              {t('security.humidityLabel')}
                            </span>
                            <p className="text-sm font-semibold text-white mt-0.5">
                              {Math.round(device.lastHumidityPct)} %
                            </p>
                          </div>
                        )}
                        {xsense?.coPpm !== null && xsense?.coPpm !== undefined && (
                          <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2.5">
                            <span className="text-[10px] text-slate-500">{t('security.coPpmLabel')}</span>
                            <p className="text-sm font-semibold text-white mt-0.5">
                              {xsense.coPpm} ppm
                            </p>
                          </div>
                        )}
                        {xiaomi?.pm25 !== null && xiaomi?.pm25 !== undefined && (
                          <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2.5">
                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Wind className="h-3 w-3 text-emerald-400" />
                              {t('security.pm25Label')}
                            </span>
                            <p className="text-sm font-semibold text-white mt-0.5">
                              {xiaomi.pm25} µg/m³
                            </p>
                          </div>
                        )}
                        {device.lastPowerW !== null && (
                          <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2.5">
                            <span className="text-[10px] text-slate-500">{t('security.powerLabel')}</span>
                            <p className="text-sm font-semibold text-amber-300 mt-0.5">
                              {Math.round(device.lastPowerW)} W
                            </p>
                          </div>
                        )}
                        {device.lastContactOpen !== null && (
                          <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2.5">
                            <span className="text-[10px] text-slate-500">{t('security.openingLabel')}</span>
                            <p
                              className={`text-sm font-semibold mt-0.5 ${
                                device.lastContactOpen ? 'text-amber-300' : 'text-emerald-300'
                              }`}
                            >
                              {device.lastContactOpen ? t('common.open') : t('common.closed')}
                            </p>
                          </div>
                        )}
                        {device.lastBatteryPct !== null && (
                          <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2.5">
                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Battery className="h-3 w-3" />
                              {t('security.batteryLabel')}
                            </span>
                            <p
                              className={`text-sm font-semibold mt-0.5 ${
                                isLowBattery ? 'text-amber-300' : 'text-emerald-300'
                              }`}
                            >
                              {Math.round(device.lastBatteryPct)} %
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Badges radio / passerelle / modes Xiaomi */}
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                        {xsense?.stationName && (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-950/80 border border-slate-800 px-2 py-0.5">
                            <Radio className="h-3 w-3 text-rose-400" />
                            {xsense.stationName}
                            {xsense.rfLevel !== null ? ` (RF ${xsense.rfLevel}/3)` : ''}
                          </span>
                        )}
                        {xiaomi?.mode && (
                          <span className="rounded-lg bg-slate-950/80 border border-slate-800 px-2 py-0.5">
                            {t('security.modePrefix', { mode: xiaomi.mode })}
                          </span>
                        )}
                        {xiaomi?.filterLifePct !== null && xiaomi?.filterLifePct !== undefined && (
                          <span className="rounded-lg bg-slate-950/80 border border-slate-800 px-2 py-0.5">
                            {t('security.filterPrefix', { pct: xiaomi.filterLifePct })}
                          </span>
                        )}
                        {xiaomi?.vacuumState && (
                          <span className="rounded-lg bg-slate-950/80 border border-slate-800 px-2 py-0.5">
                            {t('security.robotPrefix', { state: xiaomi.vacuumState })}
                          </span>
                        )}
                        {rssi !== null && (
                          <span className="rounded-lg bg-slate-950/80 border border-slate-800 px-2 py-0.5">
                            Wi-Fi {rssi} dBm
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/70 text-[10px] text-slate-500">
                        <span className="truncate font-mono">
                          {device.ipAddress
                            ? device.ipAddress
                            : device.macAddress
                              ? device.macAddress
                              : t('security.cloudSensor')}
                        </span>
                        <span className="shrink-0">{formatTimeShort(device.lastSeenAt, intlLocale)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
