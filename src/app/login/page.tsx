'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Zap, Thermometer, ArrowRight, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AlertBanner, Card } from '@/components/ui';

interface AuthProvidersState {
  passwordEnabled: boolean;
  oidcEnabled: boolean;
  oidcProviderName: string | null;
}

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<AuthProvidersState>({
    passwordEnabled: true,
    oidcEnabled: false,
    oidcProviderName: null,
  });

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const errCode = params.get('error');
    if (errCode) {
      queueMicrotask(() => {
        if (!active) return;
        if (errCode === 'oidc_denied') setError(t('login.oidcErrorDenied'));
        else if (errCode === 'oidc_csrf') setError(t('login.oidcErrorCsrf'));
        else if (errCode === 'oidc_unauthorized') setError(t('login.oidcErrorUnauthorized'));
        else if (errCode === 'oidc_config') setError(t('login.oidcErrorConfig'));
        else setError(t('login.oidcErrorFailed'));
      });
    }

    fetch('/api/auth/providers', { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<AuthProvidersState>) : null))
      .then((data) => {
        if (active && data) {
          setProviders(data);
        }
      })
      .catch(() => {
        // Garde le repli formulaire mot de passe en cas d'erreur réseau
      });

    return () => {
      active = false;
    };
  }, [t]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || t('login.invalidPassword'));
        setLoading(false);
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError(t('login.networkError'));
      setLoading(false);
    }
  }

  const providerLabel = providers.oidcProviderName || 'SSO';

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#090d16] px-4">
      <Card padded={false} className="w-full max-w-md bg-slate-900/80 p-8 shadow-2xl backdrop-blur">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 shrink-0">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">{t('login.title')}</h1>
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                <Thermometer className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                {t('login.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <LanguageSwitcher compact />
            <ThemeToggle />
          </div>
        </div>

        <div className="space-y-4">
          {providers.oidcEnabled && (
            <a
              href="/api/auth/oidc/start"
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-indigo-400/30 bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition"
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              {t('login.ssoButton', { provider: providerLabel })}
            </a>
          )}

          {providers.oidcEnabled && providers.passwordEnabled && (
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <div className="h-px flex-1 bg-slate-800" />
              <span>{t('login.orSeparator')}</span>
              <div className="h-px flex-1 bg-slate-800" />
            </div>
          )}

          {providers.passwordEnabled && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1.5">
                  {t('login.passwordLabel')}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('login.passwordPlaceholder')}
                    required
                    autoFocus={!providers.oidcEnabled}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950/70 pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              {error && <AlertBanner tone="error">{error}</AlertBanner>}

              <button
                type="submit"
                disabled={loading}
                className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition disabled:opacity-50 ${
                  providers.oidcEnabled
                    ? 'border border-slate-700 bg-slate-800 hover:bg-slate-700'
                    : 'bg-indigo-600 hover:bg-indigo-500'
                }`}
              >
                {loading ? t('login.submitting') : t('login.submit')}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          )}

          {!providers.passwordEnabled && error && <AlertBanner tone="error">{error}</AlertBanner>}
        </div>

        <p className="mt-5 text-center text-xs text-slate-500">
          {providers.oidcEnabled && providers.passwordEnabled
            ? t('login.footerBoth', { provider: providerLabel, envVar: 'APP_PASSWORD' })
            : providers.oidcEnabled
              ? t('login.footerOidcOnly', { provider: providerLabel })
              : t('login.footerNote', { envVar: 'APP_PASSWORD' })}
        </p>
      </Card>
    </div>
  );
}
