import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import './globals.css';
import { I18nProvider } from '@/components/I18nProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import {
  LOCALE_COOKIE_NAME,
  detectBrowserLocale,
  normalizeLocale,
  translate,
  type AppLocale,
} from '@/lib/i18n';
import { THEME_COOKIE_NAME, normalizeTheme, type AppTheme } from '@/lib/theme';

async function resolveServerLocale(): Promise<AppLocale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (cookieLocale) {
    return normalizeLocale(cookieLocale);
  }
  const headerStore = await headers();
  return detectBrowserLocale(headerStore.get('accept-language'));
}

async function resolveServerTheme(): Promise<AppTheme> {
  const cookieStore = await cookies();
  return normalizeTheme(cookieStore.get(THEME_COOKIE_NAME)?.value);
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f1f5f9' },
    { media: '(prefers-color-scheme: dark)', color: '#090d16' },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveServerLocale();
  return {
    title: translate(locale, 'meta.title'),
    description: translate(locale, 'meta.description'),
    icons: {
      icon: '/icon.svg',
      apple: '/icon.svg',
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: 'Home Cockpit',
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, theme] = await Promise.all([resolveServerLocale(), resolveServerTheme()]);

  return (
    <html lang={locale} className={theme}>
      <body className="min-h-screen bg-[#090d16] text-slate-100 font-sans antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
        <I18nProvider initialLocale={locale}>
          <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
