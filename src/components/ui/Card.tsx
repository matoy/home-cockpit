import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padded?: boolean;
}

/**
 * Carte principale standardisée Home Cockpit (`rounded-2xl`, bordure `slate-800`, fond `slate-900/70`).
 */
export function Card({ children, padded = true, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-800 bg-slate-900/70',
        padded && 'p-5',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Sous-carte ou tuile imbriquée standardisée (`rounded-xl`, fond `slate-950/60`).
 */
export function SubCard({ children, padded = true, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-800/80 bg-slate-950/60',
        padded && 'p-3.5',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
