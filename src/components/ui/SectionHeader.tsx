import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SectionHeaderProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * En-tête de carte ou de section aligné à gauche/droite avec icône et actions.
 */
export function SectionHeader({
  icon,
  title,
  description,
  actions,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3',
        className
      )}
    >
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
          <span className="truncate">{title}</span>
        </h3>
        {description && (
          <p className="mt-1 text-xs text-slate-400 leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
