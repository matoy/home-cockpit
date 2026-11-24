import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone =
  | 'slate'
  | 'emerald'
  | 'sky'
  | 'amber'
  | 'rose'
  | 'violet'
  | 'indigo'
  | 'cyan'
  | 'teal'
  | 'orange';

const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  slate: 'border-slate-700 bg-slate-800/80 text-slate-300',
  emerald: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  sky: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
  amber: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  rose: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
  violet: 'border-violet-500/40 bg-violet-500/15 text-violet-300',
  indigo: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300',
  cyan: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300',
  teal: 'border-teal-500/40 bg-teal-500/15 text-teal-300',
  orange: 'border-orange-500/40 bg-orange-500/15 text-orange-300',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: 'xs' | 'sm';
  children: ReactNode;
}

/**
 * Pastille de statut / système / métrique harmonisée.
 */
export function Badge({
  tone = 'slate',
  size = 'xs',
  children,
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap',
        size === 'xs' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        BADGE_TONE_CLASSES[tone],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
