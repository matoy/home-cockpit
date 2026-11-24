import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AlertTone = 'success' | 'error' | 'warning' | 'info';

const ALERT_CLASSES: Record<AlertTone, string> = {
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  error: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
};

function DefaultAlertIcon({ tone }: { tone: AlertTone }) {
  if (tone === 'success') return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />;
  if (tone === 'error') return <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />;
  if (tone === 'warning') return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />;
  return <Info className="h-4 w-4 shrink-0 text-sky-400" />;
}

export interface AlertBannerProps {
  tone: AlertTone;
  icon?: ReactNode;
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * Bannière d'information, succès, avertissement ou erreur standardisée.
 */
export function AlertBanner({
  tone,
  icon,
  title,
  children,
  action,
  className,
}: AlertBannerProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs',
        ALERT_CLASSES[tone],
        className
      )}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        {icon ?? <DefaultAlertIcon tone={tone} />}
        <div className="min-w-0">
          {title && <p className="font-semibold mb-0.5">{title}</p>}
          <div className="leading-relaxed">{children}</div>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
