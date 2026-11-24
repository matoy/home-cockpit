import { describe, expect, it } from 'vitest';
import {
  DICTIONARIES,
  SUPPORTED_LOCALES,
  detectBrowserLocale,
  formatDateTime,
  formatNumber,
  getDictionary,
  getIntlLocale,
  normalizeLocale,
  translate,
  type TranslationKey,
} from '@/lib/i18n';

function extractPlaceholders(str: string): string[] {
  return [...str.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();
}

describe('i18n 5-language support (en, fr, es, de, it)', () => {
  it('keeps strict key and placeholder parity across all 5 dictionaries', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'fr', 'es', 'de', 'it']);
    const baseKeys = Object.keys(DICTIONARIES.fr).sort() as TranslationKey[];
    expect(baseKeys.length).toBeGreaterThan(200);

    for (const locale of SUPPORTED_LOCALES) {
      const dict = getDictionary(locale);
      expect(Object.keys(dict).sort()).toEqual(baseKeys);
      for (const key of baseKeys) {
        expect(typeof dict[key]).toBe('string');
        expect(dict[key].trim().length).toBeGreaterThan(0);
        expect(extractPlaceholders(dict[key])).toEqual(extractPlaceholders(DICTIONARIES.fr[key]));
      }
    }
  });

  it('normalizes tags, detects browser Accept-Language, and interpolates translations', () => {
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('de_AT')).toBe('de');
    expect(normalizeLocale('unknown')).toBe('fr');

    expect(detectBrowserLocale('es-ES,es;q=0.9,en;q=0.8')).toBe('es');
    expect(detectBrowserLocale('ja-JP,it-IT;q=0.7')).toBe('it');
    expect(detectBrowserLocale(undefined)).toBe('fr');

    expect(getIntlLocale('en')).toBe('en-GB');
    expect(getIntlLocale('fr')).toBe('fr-FR');

    expect(translate('en', 'nav.systems')).toBe('Systems');
    expect(translate('de', 'header.collectSuccess', { count: 12 })).toContain('12');
    expect(formatDateTime('en', null)).toBe('—');
    expect(formatNumber('fr', NaN)).toBe('—');
    expect(formatNumber('en', 12.345, { maximumFractionDigits: 1 })).toBe('12.3');
  });
});
