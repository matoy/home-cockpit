export type AppTheme = 'dark' | 'light';

export const DEFAULT_THEME: AppTheme = 'dark';
export const THEME_COOKIE_NAME = 'hc_theme';
export const THEME_STORAGE_KEY = 'hc_theme';

export function normalizeTheme(raw: string | null | undefined): AppTheme {
  return raw?.trim().toLowerCase() === 'light' ? 'light' : 'dark';
}
