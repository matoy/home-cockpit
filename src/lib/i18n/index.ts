import { DEFAULT_LOCALE, LOCALE_META, type AppLocale } from './types';
import { fr, type TranslationKey } from './dictionaries/fr';
import { en } from './dictionaries/en';
import { es } from './dictionaries/es';
import { de } from './dictionaries/de';
import { it } from './dictionaries/it';

export type { AppLocale, TranslationKey };
export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  LOCALE_META,
  normalizeLocale,
  detectBrowserLocale,
} from './types';

export const DICTIONARIES: Record<AppLocale, Record<TranslationKey, string>> = {
  en,
  fr,
  es,
  de,
  it,
};

export function getDictionary(locale: AppLocale): Record<TranslationKey, string> {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

export function getIntlLocale(locale: AppLocale): string {
  return (LOCALE_META[locale] ?? LOCALE_META[DEFAULT_LOCALE]).intl;
}

export function translate(
  locale: AppLocale,
  key: TranslationKey,
  vars?: Record<string, string | number>
): string {
  const dict = getDictionary(locale);
  const template = dict[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? String(key);
  if (!vars) return template;

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, token)) {
      return String(vars[token]);
    }
    return match;
  });
}

export function formatDateTime(
  locale: AppLocale,
  value: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : '—';
  }
  return date.toLocaleString(getIntlLocale(locale), options);
}

export function formatNumber(
  locale: AppLocale,
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(getIntlLocale(locale), options);
}
