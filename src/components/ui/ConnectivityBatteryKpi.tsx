'use client';

import { Battery, BatteryWarning } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';

export interface ConnectivityBatterySensor {
  name: string;
  isOnline: boolean;
  batteryPct: number | null;
  isMains?: boolean;
}

export interface ConnectivityBatteryKpiProps {
  title: string;
  sensors: ConnectivityBatterySensor[];
  noActiveSensorLabel: string;
  mainsCountLabel: (count: number) => string;
  lowBatteryLabel: (count: number) => string;
  className?: string;
}

/**
 * Carte KPI standardisée Connectivité & Piles (Climat, Ouvertures, Sécurité).
 */
export function ConnectivityBatteryKpi({
  title,
  sensors,
  noActiveSensorLabel,
  mainsCountLabel,
  lowBatteryLabel,
  className,
}: ConnectivityBatteryKpiProps) {
  const { t } = useI18n();

  const totalCount = sensors.length;
  const onlineCount = sensors.filter((s) => s.isOnline).length;
  const withBattery = sensors.filter(
    (s): s is ConnectivityBatterySensor & { batteryPct: number } =>
      s.batteryPct !== null && Number.isFinite(s.batteryPct)
  );
  const mainsPoweredCount = sensors.filter(
    (s) => s.batteryPct === null && Boolean(s.isMains)
  ).length;
  const lowBatteryCount = withBattery.filter((s) => s.batteryPct <= 20).length;
  const avgBatteryPct =
    withBattery.length > 0
      ? Math.round(withBattery.reduce((sum, s) => sum + s.batteryPct, 0) / withBattery.length)
      : null;
  const minBatteryPct =
    withBattery.length > 0 ? Math.min(...withBattery.map((s) => s.batteryPct)) : null;

  return (
    <div className={cn('rounded-2xl border border-slate-800 bg-slate-900/70 p-5', className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
          {title}
        </span>
        <div
          className={`rounded-lg p-2 ${
            lowBatteryCount > 0
              ? 'bg-rose-500/15 text-rose-400'
              : 'bg-emerald-500/15 text-emerald-400'
          }`}
        >
          {lowBatteryCount > 0 ? (
            <BatteryWarning className="h-4 w-4" />
          ) : (
            <Battery className="h-4 w-4" />
          )}
        </div>
      </div>

      <div
        className="mt-3 flex items-baseline gap-2"
        title={
          sensors
            .map(
              (s) =>
                `${s.name} (${s.isOnline ? t('common.online') : t('common.offline')})`
            )
            .join(' • ') || noActiveSensorLabel
        }
      >
        <span className="text-3xl font-bold tracking-tight text-white">
          {onlineCount} / {totalCount}
        </span>
        <span className="text-xs text-slate-400">{t('climate.onlineWord')}</span>
      </div>

      <p
        className={`mt-2 text-xs ${
          lowBatteryCount > 0 ? 'text-rose-300' : 'text-slate-400'
        }`}
      >
        {lowBatteryCount > 0
          ? `${lowBatteryLabel(lowBatteryCount)}${
              mainsPoweredCount > 0
                ? t('climate.onMainsSuffix', { count: mainsPoweredCount })
                : ''
            }`
          : avgBatteryPct !== null
            ? `${t('climate.avgMinBattery', {
                avg: avgBatteryPct,
                min: minBatteryPct ?? 0,
              })}${
                mainsPoweredCount > 0
                  ? t('climate.onMainsSuffix', { count: mainsPoweredCount })
                  : ''
              }`
            : mainsPoweredCount > 0
              ? mainsCountLabel(mainsPoweredCount)
              : t('climate.noBatteryReported')}
      </p>
    </div>
  );
}
