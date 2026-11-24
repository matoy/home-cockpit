import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'ghost' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'border border-sky-500/40 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30',
  secondary:
    'border border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700/80 hover:text-white',
  subtle:
    'border border-slate-800 bg-slate-900/80 text-slate-300 hover:border-slate-700 hover:bg-slate-800',
  ghost:
    'border border-transparent bg-transparent text-slate-300 hover:bg-slate-800/70 hover:text-white',
  danger:
    'border border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'rounded-lg px-2.5 py-1 text-[11px]',
  sm: 'rounded-lg px-3 py-1.5 text-xs',
  md: 'rounded-xl px-4 py-2 text-xs',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

/**
 * Bouton interactif homogène pour toutes les actions du dashboard.
 */
export function Button({
  variant = 'secondary',
  size = 'sm',
  type = 'button',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
