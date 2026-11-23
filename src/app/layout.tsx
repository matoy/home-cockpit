import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import './globals.css';
import { I18nProvider } from '@/components/I18nProvider';
import {
  LOCALE_COOKIE_NAME,
  detectBrowserLocale,
  normalizeLocale,
  translate,
  type AppLocale,
} from '@/lib/i18n';

async function resolveServerLocale(): Promise<AppLocale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (cookieLocale) {
    return normalizeLocale(cookieLocale);
  }
  const headerStore = await headers();
  return detectBrowserLocale(headerStore.get('accept-language'));
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveServerLocale();
  return {
    title: translate(locale, 'meta.title'),
    description: translate(locale, 'meta.description'),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await resolveServerLocale();

  return (
    <html lang={locale} className="dark">
      <body className="min-h-screen bg-[#090d16] text-slate-100 font-sans antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
