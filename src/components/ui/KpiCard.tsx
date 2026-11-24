import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type KpiTone =
  | 'slate'
  | 'emerald'
  | 'sky'
  | 'amber'
  | 'rose'
  | 'violet'
  | 'cyan'
  | 'indigo'
  | 'teal'
  | 'orange';

const TONE_VALUE_CLASS: Record<KpiTone, string> = {
  slate: 'text-white',
  emerald: 'text-emerald-300',
  sky: 'text-sky-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
  violet: 'text-violet-300',
  cyan: 'text-cyan-300',
  indigo: 'text-indigo-300',
  teal: 'text-teal-300',
  orange: 'text-orange-300',
};

const TONE_ICON_BG_CLASS: Record<KpiTone, string> = {
  slate: 'bg-slate-800 text-slate-300',
  emerald: 'bg-emerald-500/15 text-emerald-400',
  sky: 'bg-sky-500/15 text-sky-400',
  amber: 'bg-amber-500/15 text-amber-400',
  rose: 'bg-rose-500/15 text-rose-400',
  violet: 'bg-violet-500/15 text-violet-400',
  cyan: 'bg-cyan-500/15 text-cyan-400',
  indigo: 'bg-indigo-500/15 text-indigo-400',
  teal: 'bg-teal-500/15 text-teal-400',
  orange: 'bg-orange-500/15 text-orange-400',
};

export interface KpiCardProps {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  tone?: KpiTone;
  highlight?: boolean;
  action?: ReactNode;
  className?: string;
}

/**
 * Tuile KPI homogène utilisée en tête des onglets du tableau de bord.
 */
export function KpiCard({
  icon,
  label,
  value,
  sublabel,
  tone = 'slate',
  highlight = false,
  action,
  className,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border bg-slate-900/70 p-4 transition-colors',
        highlight ? 'border-rose-500/50 bg-rose-950/20' : 'border-slate-800',
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          {label}
        </span>
        {icon && (
          <span
            className={cn(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
              TONE_ICON_BG_CLASS[tone]
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <div className={cn('mt-2 text-2xl font-bold tabular-nums', TONE_VALUE_CLASS[tone])}>
        {value}
      </div>
      {(sublabel || action) && (
        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-slate-400">
          <div className="min-w-0 truncate">{sublabel}</div>
          {action}
        </div>
      )}
    </div>
  );
}
