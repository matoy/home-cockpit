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
  DEFAULT_THEME,
  THEME_COOKIE_NAME,
  THEME_STORAGE_KEY,
  normalizeTheme,
  type AppTheme,
} from '@/lib/theme';

interface ThemeContextValue {
  theme: AppTheme;
  setTheme: (next: AppTheme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readCookieTheme(): string | null {
  if (typeof document === 'undefined') return null;
  const escaped = THEME_COOKIE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function persistThemeClient(theme: AppTheme) {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
    document.cookie = `${THEME_COOKIE_NAME}=${encodeURIComponent(theme)}; path=/; max-age=31536000; SameSite=Lax`;
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignorer si le stockage local est indisponible
    }
  }
}

export function ThemeProvider({
  initialTheme = DEFAULT_THEME,
  children,
}: {
  initialTheme?: AppTheme;
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState<AppTheme>(initialTheme);

  useEffect(() => {
    let active = true;
    const cookieVal = readCookieTheme();
    if (cookieVal) {
      const normalized = normalizeTheme(cookieVal);
      if (normalized !== initialTheme) {
        queueMicrotask(() => {
          if (active) setThemeState(normalized);
        });
      }
      persistThemeClient(normalized);
      return () => {
        active = false;
      };
    }

    let candidate: AppTheme | null = null;
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored) {
        candidate = normalizeTheme(stored);
      }
    } catch {
      candidate = null;
    }

    const resolved = candidate ?? initialTheme;
    if (resolved !== initialTheme) {
      queueMicrotask(() => {
        if (active) setThemeState(resolved);
      });
    }
    persistThemeClient(resolved);
    return () => {
      active = false;
    };
  }, [initialTheme]);

  const setTheme = useCallback((next: AppTheme) => {
    const normalized = normalizeTheme(next);
    setThemeState(normalized);
    persistThemeClient(normalized);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: AppTheme = prev === 'dark' ? 'light' : 'dark';
      persistThemeClient(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.classList.remove('dark', 'light');
      root.classList.add(theme);
    }
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme,
    }),
    [theme, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: DEFAULT_THEME,
      setTheme: () => {},
      toggleTheme: () => {},
    };
  }
  return ctx;
}
