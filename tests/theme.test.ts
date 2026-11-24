import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  THEME_COOKIE_NAME,
  THEME_STORAGE_KEY,
  normalizeTheme,
} from '@/lib/theme';

describe('theme helpers', () => {
  it('exposes dark as default theme and expected storage keys', () => {
    expect(DEFAULT_THEME).toBe('dark');
    expect(THEME_COOKIE_NAME).toBe('hc_theme');
    expect(THEME_STORAGE_KEY).toBe('hc_theme');
  });

  it('normalizes valid light values and falls back to dark', () => {
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme(' LIGHT ')).toBe('light');
    expect(normalizeTheme('dark')).toBe('dark');
    expect(normalizeTheme('')).toBe('dark');
    expect(normalizeTheme(null)).toBe('dark');
    expect(normalizeTheme(undefined)).toBe('dark');
    expect(normalizeTheme('sepia')).toBe('dark');
  });
});
