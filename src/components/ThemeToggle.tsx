'use client';

import { Moon, Sun } from 'lucide-react';
import { useI18n } from './I18nProvider';
import { useTheme } from './ThemeProvider';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const nextLabel = theme === 'dark' ? t('header.themeToLight') : t('header.themeToDark');

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={toggleTheme}
      aria-label={t('header.themeToggleAria')}
      title={nextLabel}
      className="rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 p-2 text-slate-300 transition"
    >
      {theme === 'dark' ? (
        <Sun className="h-3.5 w-3.5 text-amber-400" />
      ) : (
        <Moon className="h-3.5 w-3.5 text-indigo-400" />
      )}
    </button>
  );
}
