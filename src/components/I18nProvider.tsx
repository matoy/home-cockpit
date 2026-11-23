'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  detectBrowserLocale,
  formatDateTime as formatLocalizedDateTime,
  formatNumber as formatLocalizedNumber,
  getIntlLocale,
  normalizeLocale,
  translate,
  type AppLocale,
  type TranslationKey,
} from '@/lib/i18n';

interface I18nContextValue {
  locale: AppLocale;
  intlLocale: string;
  setLocale: (next: AppLocale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  formatDateTime: (
    value: string | number | Date | null | undefined,
    options?: Intl.DateTimeFormatOptions
  ) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readCookieLocale(): string | null {
  if (typeof document === 'undefined') return null;
  const escaped = LOCALE_COOKIE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function persistLocaleClient(locale: AppLocale) {
  if (typeof document !== 'undefined') {
    document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; path=/; max-age=31536000; SameSite=Lax`;
    document.documentElement.lang = locale;
    document.title = translate(locale, 'meta.title');
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Ignorer si le stockage local est indisponible
    }
  }
}

export function I18nProvider({
  initialLocale = DEFAULT_LOCALE,
  children,
}: {
  initialLocale?: AppLocale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale);

  useEffect(() => {
    const cookieVal = readCookieLocale();
    if (cookieVal) {
      const normalized = normalizeLocale(cookieVal);
      if (normalized !== locale) {
        setLocaleState(normalized);
      }
      persistLocaleClient(normalized);
      return;
    }

    let candidate: AppLocale | null = null;
    try {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored) {
        candidate = normalizeLocale(stored);
      }
    } catch {
      candidate = null;
    }

    if (!candidate && typeof navigator !== 'undefined') {
      const browserLangs = navigator.languages?.length
        ? navigator.languages.join(',')
        : navigator.language;
      candidate = detectBrowserLocale(browserLangs);
    }

    const resolved = candidate ?? initialLocale;
    if (resolved !== locale) {
      setLocaleState(resolved);
    }
    persistLocaleClient(resolved);
    // Intentionally run once on mount to reconcile client preferences without SSR hydration mismatch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((next: AppLocale) => {
    const normalized = normalizeLocale(next);
    setLocaleState(normalized);
    persistLocaleClient(normalized);
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
      document.title = translate(locale, 'meta.title');
    }
  }, [locale]);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) =>
      translate(locale, key, vars),
    [locale]
  );

  const formatDateTime = useCallback(
    (
      value: string | number | Date | null | undefined,
      options?: Intl.DateTimeFormatOptions
    ) => formatLocalizedDateTime(locale, value, options),
    [locale]
  );

  const formatNumber = useCallback(
    (value: number, options?: Intl.NumberFormatOptions) =>
      formatLocalizedNumber(locale, value, options),
    [locale]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      intlLocale: getIntlLocale(locale),
      setLocale,
      t,
      formatDateTime,
      formatNumber,
    }),
    [locale, setLocale, t, formatDateTime, formatNumber]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      locale: DEFAULT_LOCALE,
      intlLocale: getIntlLocale(DEFAULT_LOCALE),
      setLocale: () => {},
      t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
      formatDateTime: (value, options) =>
        formatLocalizedDateTime(DEFAULT_LOCALE, value, options),
      formatNumber: (value, options) =>
        formatLocalizedNumber(DEFAULT_LOCALE, value, options),
    };
  }
  return ctx;
}
