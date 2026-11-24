import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * État vide cohérent affiché lorsqu'aucune donnée n'est disponible sur un onglet ou un filtre.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center',
        className
      )}
    >
      {icon && (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800/80 text-slate-400">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
