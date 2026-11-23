'use client';

import { Globe } from 'lucide-react';
import {
  LOCALE_META,
  SUPPORTED_LOCALES,
  type AppLocale,
} from '@/lib/i18n';
import { useI18n } from './I18nProvider';

interface LanguageSwitcherProps {
  compact?: boolean;
}

export function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200"
      title={t('lang.label')}
    >
      <Globe className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as AppLocale)}
        aria-label={t('lang.ariaLabel')}
        className="bg-transparent text-xs font-medium text-slate-200 focus:outline-none cursor-pointer"
      >
        {SUPPORTED_LOCALES.map((loc) => {
          const meta = LOCALE_META[loc];
          return (
            <option key={loc} value={loc} className="bg-slate-900 text-slate-100">
              {compact ? meta.code : `${meta.code} · ${meta.label}`}
            </option>
          );
        })}
      </select>
    </div>
  );
}
