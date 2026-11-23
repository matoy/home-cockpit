export type AppLocale = 'en' | 'fr' | 'es' | 'de' | 'it';

export const SUPPORTED_LOCALES: readonly AppLocale[] = ['en', 'fr', 'es', 'de', 'it'] as const;

export const DEFAULT_LOCALE: AppLocale = 'fr';

export const LOCALE_COOKIE_NAME = 'hc_locale';
export const LOCALE_STORAGE_KEY = 'hc_locale';

export const LOCALE_META: Record<
  AppLocale,
  { code: string; label: string; intl: string }
> = {
  en: { code: 'EN', label: 'English', intl: 'en-GB' },
  fr: { code: 'FR', label: 'Français', intl: 'fr-FR' },
  es: { code: 'ES', label: 'Español', intl: 'es-ES' },
  de: { code: 'DE', label: 'Deutsch', intl: 'de-DE' },
  it: { code: 'IT', label: 'Italiano', intl: 'it-IT' },
};

/**
 * Normalise une chaîne de langue ou un tag BCP-47 (ex. `en-US`, `de-AT`, `es_ES`)
 * vers l'une des locales supportées, avec repli sur `fr`.
 */
export function normalizeLocale(raw: string | null | undefined): AppLocale {
  if (!raw || typeof raw !== 'string') return DEFAULT_LOCALE;
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return DEFAULT_LOCALE;

  const primary = cleaned.split(/[-_]/)[0];
  if (
    primary === 'en' ||
    primary === 'fr' ||
    primary === 'es' ||
    primary === 'de' ||
    primary === 'it'
  ) {
    return primary;
  }
  return DEFAULT_LOCALE;
}

/**
 * Détecte la meilleure locale supportée depuis un en-tête `Accept-Language`
 * ou `navigator.language`, avec repli sur `fr`.
 */
export function detectBrowserLocale(acceptOrNavigator: string | null | undefined): AppLocale {
  if (!acceptOrNavigator || typeof acceptOrNavigator !== 'string') {
    return DEFAULT_LOCALE;
  }

  const candidates = acceptOrNavigator
    .split(',')
    .map((part) => part.split(';')[0]?.trim())
    .filter((tag): tag is string => Boolean(tag));

  for (const tag of candidates) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (
      primary === 'en' ||
      primary === 'fr' ||
      primary === 'es' ||
      primary === 'de' ||
      primary === 'it'
    ) {
      return primary;
    }
  }

  return DEFAULT_LOCALE;
}
