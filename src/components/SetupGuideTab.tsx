'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  CircleDashed,
  Copy,
  Check,
  Database,
  Cloud,
  Clock,
  Shield,
  Terminal,
  ExternalLink,
  AlertTriangle,
  KeyRound,
  Wrench,
  ArrowRight,
  Info,
} from 'lucide-react';
import { BackupRestoreCard } from '@/components/BackupRestoreCard';
import { useI18n } from '@/components/I18nProvider';
import { AlertBanner, Card } from '@/components/ui';
import type { DashboardPayload, GoogleHomeMode, TabId } from '@/types';

interface SetupGuideTabProps {
  data: DashboardPayload;
  onNavigateTab?: (tab: TabId) => void;
  onRefresh?: () => Promise<void>;
}

export function SetupGuideTab({ data, onNavigateTab, onRefresh }: SetupGuideTabProps) {
  const { t, locale } = useI18n();
  const { env } = data;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [googleGuideMode, setGoogleGuideMode] = useState<GoogleHomeMode>(
    env.googleHomeMode ?? 'mcp'
  );

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://votre-app.vercel.app';
  const scheduleUrl = `${origin}/api/schedule/collect`;
  const hcRedirectUri = `${origin}/api/vendors/home-connect/oauth/callback`;
  const localHcRedirectUri = 'http://localhost:3000/api/vendors/home-connect/oauth/callback';
  const daikinRedirectUri = `${origin}/api/vendors/daikin/oauth/callback`;
  const googleRedirectUri = `${origin}/api/vendors/google-home/oauth/callback`;
  const localGoogleRedirectUri = 'http://localhost:3000/api/vendors/google-home/oauth/callback';

  function copyText(key: string, text: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    }
  }

  const showKasa = env.kasaConfigured;
  const showHomeConnect = env.homeConnectConfigured;
  const showSomfy = env.somfyConfigured;
  const showDaikin = env.daikinConfigured;
  const showXSense = env.xsenseConfigured;
  const showXiaomi = env.xiaomiConfigured || env.xiaomiConnected;
  const showGoogleHomeApi = env.googleHomeApiEnabled;
  const showConsoApi = Boolean(env.consoApiConfigured || env.consoApiConnected);

  const oauthStatusLabel = (connected: boolean) =>
    connected ? t('guide.oauthConnected') : t('guide.oauthReady');

  const googleOAuthDetail = env.googleHomeConfigured
    ? `${t('guide.chkGoogleDefaultMode', { mode: env.googleHomeMode.toUpperCase() })} · ${oauthStatusLabel(env.googleHomeConnected)}${
        env.googleSdmProjectConfigured
          ? ` · ${t('guide.chkGoogleSdmPresent')}`
          : env.googleHomeMode === 'sdm'
            ? ` · ${t('guide.chkGoogleSdmMissing')}`
            : ''
      }`
    : t('guide.chkGoogleOpt');

  const checklist = [
    {
      label: t('guide.chkDbLabel'),
      ok: env.databaseConfigured,
      detail: env.databaseConfigured ? t('guide.chkDbConnected') : t('guide.chkDbDemo'),
    },
    {
      label: t('guide.chkTuyaLabel'),
      ok: env.tuyaConfigured,
      detail: env.tuyaConfigured
        ? t('guide.chkTuyaConfigured', { region: env.tuyaRegion.toUpperCase() })
        : t('guide.chkTuyaMissing'),
    },
    {
      label: t('guide.chkTuyaUidLabel'),
      ok: env.tuyaUserUidConfigured,
      detail: env.tuyaUserUidConfigured ? t('guide.chkTuyaUidSet') : t('guide.chkTuyaUidOpt'),
    },
    ...(showKasa
      ? [
          {
            label: t('guide.chkKasaLabel'),
            ok: env.kasaConfigured,
            detail: t('guide.chkKasaDetail', { region: env.kasaRegion.toUpperCase() }),
          },
        ]
      : []),
    ...(showHomeConnect
      ? [
          {
            label: t('guide.chkHcLabel'),
            ok: env.homeConnectConfigured,
            detail: t('guide.chkHcDetail', {
              env: env.homeConnectEnv.toUpperCase(),
              status: oauthStatusLabel(env.homeConnectConnected),
            }),
          },
        ]
      : []),
    ...(showSomfy
      ? [
          {
            label: t('guide.chkSomfyLabel'),
            ok: env.somfyConfigured,
            detail: t('guide.chkSomfyDetail', { region: env.somfyRegion.toUpperCase() }),
          },
        ]
      : []),
    ...(showDaikin
      ? [
          {
            label: t('guide.chkDaikinLabel'),
            ok: env.daikinConfigured,
            detail: oauthStatusLabel(env.daikinConnected),
          },
        ]
      : []),
    ...(showXSense
      ? [
          {
            label: t('guide.chkXSenseLabel'),
            ok: env.xsenseConfigured,
            detail: t('guide.chkXSenseDetail'),
          },
        ]
      : []),
    ...(showXiaomi
      ? [
          {
            label: t('guide.chkXiaomiLabel'),
            ok: env.xiaomiConnected || env.xiaomiConfigured,
            detail: env.xiaomiConnected
              ? t('guide.chkXiaomiConnected', { region: env.xiaomiRegion.toUpperCase() })
              : t('guide.chkXiaomiReady', { region: env.xiaomiRegion.toUpperCase() }),
          },
        ]
      : []),
    ...(showGoogleHomeApi
      ? [
          {
            label: t('guide.chkGoogleLabel'),
            ok:
              env.googleHomeConfigured &&
              (env.googleHomeMode !== 'sdm' || env.googleSdmProjectConfigured),
            detail: googleOAuthDetail,
          },
        ]
      : []),
    ...(showConsoApi
      ? [
          {
            label: t('guide.chkConsoLabel'),
            ok: Boolean(env.consoApiConfigured),
            detail: env.consoApiConnected
              ? t('guide.chkConsoConnected', { prm: env.consoApiPrmMasked ?? '—' })
              : t('guide.chkConsoConfigured', { prm: env.consoApiPrmMasked ?? '—' }),
          },
        ]
      : []),
    {
      label: t('guide.chkPwdLabel'),
      ok: env.appPasswordConfigured,
      detail: env.appPasswordConfigured ? t('guide.chkPwdActive') : t('guide.chkPwdOpen'),
    },
    {
      label: t('guide.chkCronLabel'),
      ok: env.scheduleSecretConfigured,
      detail: env.scheduleSecretConfigured ? t('guide.chkCronActive') : t('guide.chkCronMissing'),
    },
  ];

  return (
    <div className="space-y-6">
      {locale !== 'fr' && (
        <AlertBanner tone="info">{t('guide.langNote')}</AlertBanner>
      )}

      {/* Checklist dynamique */}
      <Card padded={false} className="p-6">
        <h2 className="text-base font-semibold text-white mb-1">
          {t('guide.checklistTitle')}
        </h2>
        <p className="text-xs text-slate-400 mb-4">
          {t('guide.checklistSub')}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {checklist.map((item) => (
            <div
              key={item.label}
              className={`flex items-start gap-3 rounded-xl border p-3.5 ${item.ok
                ? 'border-emerald-500/30 bg-emerald-500/10'
                : 'border-slate-800 bg-slate-950/60'
                }`}
            >
              {item.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <CircleDashed className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="text-xs font-semibold text-white">{item.label}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{item.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Sauvegarde & Restauration compressée (.json.gz) */}
      <BackupRestoreCard data={data} onRefresh={onRefresh} />

      {/* Étape 1 : Tuya IoT Cloud */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-indigo-500/15 p-2 text-indigo-400">
            <Cloud className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {t('guide.step1Title')}
            </h3>
            <p className="text-xs text-slate-400">
              {t('guide.step1Sub')}
            </p>
          </div>
        </div>

        <ol className="list-decimal list-inside space-y-2.5 text-xs text-slate-300 leading-relaxed">
          <li>
            Connectez-vous sur <strong>iot.tuya.com</strong> → <strong>Cloud</strong> →{' '}
            <strong>Development</strong> → <strong>Create Cloud Project</strong>.
          </li>
          <li>
            Choisissez <strong>Smart Home</strong> comme Industry et{' '}
            <strong>Smart Home</strong> comme Development Method.
          </li>
          <li>
            <strong>Data Center :</strong> sélectionnez <strong>Central Europe</strong> (<code>TUYA_REGION=eu</code>,
            le plus courant en France) ou <strong>Western Europe</strong> (<code>TUYA_REGION=weu</code>).
            <span className="text-amber-300"> Attention : le Data Center doit correspondre à votre pays dans l&apos;app Smart Life.</span>
          </li>
          <li>
            À l&apos;écran <em>Authorize API Services</em>, assurez-vous d&apos;activer ces APIs gratuites :
            <ul className="list-disc list-inside ml-5 mt-1 text-slate-400 space-y-0.5">
              <li><strong>IoT Core</strong> (indispensable : lecture des statuts en batch + pièces v2)</li>
              <li><strong>Authorization Token Management</strong></li>
              <li><strong>Smart Home Basic Service</strong> <em>(si disponible dans votre catalogue d&apos;APIs)</em></li>
            </ul>
          </li>
          <li>
            Dans l&apos;onglet <strong>Devices</strong> → <strong>Link Tuya App Account</strong> →{' '}
            <strong>Add App Account</strong>, scannez le QR code avec votre application mobile{' '}
            <em>Smart Life</em> ou <em>Tuya Smart</em>.
          </li>
          <li>
            Relevez votre <strong>UID</strong> affiché dans la liste des comptes liés (<code>TUYA_USER_UID</code>),
            ainsi que l&apos;<strong>Access ID</strong> et l&apos;<strong>Access Secret</strong> dans l&apos;onglet{' '}
            <strong>Overview</strong>.
          </li>
        </ol>
      </div>

      {/* Étape 2 : Neon Postgres */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-emerald-500/15 p-2 text-emerald-400">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {t('guide.step2Title')}
            </h3>
            <p className="text-xs text-slate-400">
              {t('guide.step2Sub')}
            </p>
          </div>
        </div>

        <ol className="list-decimal list-inside space-y-2 text-xs text-slate-300">
          <li>
            Créez un projet sur <strong>neon.tech</strong> (région <code>eu-central-1</code> Francfort) ou
            ajoutez l&apos;intégration <strong>Neon</strong> dans votre projet Vercel.
          </li>
          <li>
            Ajoutez <code>DATABASE_URL</code> dans vos variables d&apos;environnement Vercel (et dans{' '}
            <code>.env.local</code> en local).
          </li>
          <li>
            Exécutez une fois la commande suivante pour créer ou mettre à jour les 8 tables (
            <code>rooms</code>, <code>devices</code>, <code>metric_readings</code>,{' '}
            <code>tariff_periods</code>, <code>collection_logs</code>, <code>automations</code>,{' '}
            <code>vendor_connections</code>, <code>device_vendor_links</code>) :
          </li>
        </ol>

        <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 font-mono text-xs text-emerald-300">
          <span className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-slate-500" />
            npm run db:push
          </span>
          <button
            onClick={() => copyText('dbpush', 'npm run db:push')}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white flex items-center gap-1"
          >
            {copiedKey === 'dbpush' ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                {t('guide.copied')}
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                {t('guide.copy')}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Étape 3 : Schedule cron-job.org */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-amber-500/15 p-2 text-amber-400">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {t('guide.step3Title')}
            </h3>
            <p className="text-xs text-slate-400">
              {t('guide.step3Sub')}
            </p>
          </div>
        </div>

        <div className="space-y-3 text-xs text-slate-300">
          <p>
            Créez un job gratuit sur <strong>cron-job.org</strong> avec les paramètres suivants :
          </p>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5">
              <div>
                <div className="text-[10px] uppercase text-slate-500">URL à appeler (GET ou POST)</div>
                <div className="font-mono text-indigo-300 break-all">{scheduleUrl}</div>
              </div>
              <button
                onClick={() => copyText('url', scheduleUrl)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white flex items-center gap-1"
              >
                {copiedKey === 'url' ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    {t('guide.copied')}
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    {t('guide.copy')}
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5">
              <div>
                <div className="text-[10px] uppercase text-slate-500">Planification</div>
                <div className="font-mono text-slate-200">Every 30 minutes (*/30 * * * *)</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5">
              <div>
                <div className="text-[10px] uppercase text-slate-500 flex items-center gap-1">
                  <Shield className="h-3 w-3 text-emerald-400" /> Header HTTP personnalisé
                </div>
                <div className="font-mono text-emerald-300">
                  Authorization: Bearer VOTRE_SCHEDULE_SECRET
                </div>
              </div>
              <button
                onClick={() => copyText('header', 'Authorization: Bearer VOTRE_SCHEDULE_SECRET')}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white flex items-center gap-1"
              >
                {copiedKey === 'header' ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    {t('guide.copied')}
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    {t('guide.copy')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Étape Kasa Cloud (toujours visible dans Guide Setup, repliable) */}
      <div
        id="setup-kasa-cloud"
        className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4 scroll-mt-24"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-teal-500/15 p-2 text-teal-400">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {t('guide.kasaTitle')}
              </h3>
              <p className="text-xs text-slate-400">
                {t('guide.kasaSub')}
              </p>
            </div>
          </div>

          <span
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${env.kasaConfigured
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              : 'border-slate-700 bg-slate-800 text-slate-400'
              }`}
          >
            {env.kasaConfigured
              ? `${t('common.configured')} (${env.kasaRegion.toUpperCase()})`
              : t('guide.optionalNotConfigured')}
          </span>
        </div>

        <details
          id="setup-kasa-details"
          open={showKasa}
          className="group rounded-xl border border-slate-800/90 bg-slate-950/40 p-4"
        >
          <summary className="cursor-pointer select-none text-xs font-medium text-teal-300 hover:text-teal-200 flex items-center justify-between gap-2">
            <span>{t('guide.kasaSummary')}</span>
            <span className="text-[11px] text-slate-400 group-open:hidden">
              {t('guide.clickToExpand')}
            </span>
            <span className="text-[11px] text-slate-400 hidden group-open:inline">
              {t('guide.clickToCollapse')}
            </span>
          </summary>

          <div className="mt-4 space-y-4">
            <ol className="list-decimal list-inside space-y-2 text-xs text-slate-300 leading-relaxed">
              <li>
                Ajoutez vos identifiants de compte TP-Link / Kasa dans <code>.env.local</code> et
                sur Vercel : <code>KASA_EMAIL</code>, <code>KASA_PASSWORD</code> et{' '}
                <code>KASA_REGION=&quot;eu&quot;</code> (<code>eu</code>, <code>us</code>,{' '}
                <code>ap</code> ou <code>global</code>).
              </li>
              <li>
                <strong className="text-amber-300">Important (erreur -20675) :</strong> désactivez
                la double authentification (<strong>2FA / MFA</strong>) dans l&apos;application
                mobile Kasa/Tapo afin que l&apos;API cloud puisse authentifier votre session
                automatiquement.
              </li>
              <li>
                <strong>Mesures énergétiques &amp; multiprises :</strong> les prises équipées
                d&apos;un compteur (HS110, KP115, KP125, HS300) remontent automatiquement puissance
                (W), tension (V) et cumul kWh à chaque collecte, y compris chaque prise individuelle
                d&apos;une multiprise HS300.
              </li>
              <li>
                <strong>Pièces et groupes Kasa :</strong> si votre compte Kasa Cloud expose des
                groupes ou pièces, ils sont importés dans <strong>Pièces</strong>. À défaut,
                assignez librement la pièce de chaque appareil depuis <strong>Appareils</strong>.
              </li>
            </ol>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-teal-400" />
                  Variables d&apos;environnement TP-Link Kasa Cloud
                </span>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      'kasa-env',
                      'KASA_EMAIL="votre-email@exemple.com"\nKASA_PASSWORD="votre-mot-de-passe"\nKASA_REGION="eu"'
                    )
                  }
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white flex items-center gap-1"
                >
                  {copiedKey === 'kasa-env' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      {t('guide.copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      {t('guide.copy')}
                    </>
                  )}
                </button>
              </div>
              <pre className="font-mono text-[11px] text-teal-300 overflow-x-auto leading-relaxed">
                {`KASA_EMAIL="votre-email@exemple.com"
KASA_PASSWORD="votre-mot-de-passe"
KASA_REGION="eu" # eu, us, ap ou global`}
              </pre>
            </div>

            {onNavigateTab && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onNavigateTab('systems')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 px-3 py-1.5 text-xs font-medium text-white transition"
                >
                  {t('guide.syncKasaSystems')}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('rooms')}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition"
                >
                  {t('guide.syncKasaRooms')}
                  <ArrowRight className="h-3.5 w-3.5 text-teal-400" />
                </button>
              </div>
            )}
          </div>
        </details>
      </div>

      {/* Étape Siemens Home Connect (toujours visible dans Guide Setup, repliable) */}
      <div
        id="setup-home-connect"
        className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-5 scroll-mt-24"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-cyan-500/15 p-2 text-cyan-400">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {t('guide.hcTitle')}
              </h3>
              <p className="text-xs text-slate-400">
                {t('guide.hcSub')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {env.homeConnectConfigured ? (
              <>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 font-medium text-emerald-300">
                  Env : {env.homeConnectEnv.toUpperCase()}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 font-medium ${env.homeConnectConnected
                    ? 'border-cyan-500/30 bg-cyan-500/15 text-cyan-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    }`}
                >
                  Session OAuth : {env.homeConnectConnected ? t('common.connected') : t('common.readyOAuth')}
                </span>
              </>
            ) : (
              <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-[10px] font-semibold text-slate-400">
                {t('guide.optionalNotConfigured')}
              </span>
            )}
          </div>
        </div>

        <details
          id="setup-home-connect-details"
          open={showHomeConnect}
          className="group rounded-xl border border-slate-800/90 bg-slate-950/40 p-4"
        >
          <summary className="cursor-pointer select-none text-xs font-medium text-cyan-300 hover:text-cyan-200 flex items-center justify-between gap-2">
            <span>{t('guide.hcSummary')}</span>
            <span className="text-[11px] text-slate-400 group-open:hidden">
              {t('guide.clickToExpand')}
            </span>
            <span className="text-[11px] text-slate-400 hidden group-open:inline">
              {t('guide.clickToCollapse')}
            </span>
          </summary>

          <div className="mt-4 space-y-3 text-xs text-slate-300 leading-relaxed">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
              <div className="font-semibold text-white flex items-center justify-between gap-2">
                <span>Étape 1 — Créer / connecter votre compte développeur</span>
                <a
                  href="https://developer.home-connect.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-400 hover:text-cyan-300"
                >
                  developer.home-connect.com
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-slate-300">
                <li>
                  Ouvrez <strong>developer.home-connect.com</strong> puis cliquez sur{' '}
                  <strong>Sign up</strong> (ou <strong>Log in</strong>).
                </li>
                <li>
                  Dans votre profil, si le champ{' '}
                  <strong>Default Home Connect User Account for Testing</strong> apparaît, saisissez
                  l&apos;adresse e-mail exacte de votre application mobile{' '}
                  <strong>Home Connect (SingleKey ID)</strong>,{' '}
                  <strong className="text-amber-300">tout en minuscules</strong>.
                </li>
              </ol>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2.5">
              <div className="font-semibold text-white">
                Étape 2 — Enregistrer l&apos;application (Applications → Register Application)
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-300">
                <li>
                  <strong>Application ID :</strong> un nom libre sans caractères spéciaux (ex.{' '}
                  <code>HomeCockpit</code>).
                </li>
                <li>
                  <strong>OAuth Flow :</strong> sélectionnez obligatoirement{' '}
                  <strong className="text-cyan-300">Authorization Code Grant Flow</strong> (ne pas
                  utiliser Device Flow).
                </li>
                <li>
                  <strong>Home Connect User Account for Testing</strong> <em>(si présent)</em> :
                  e-mail en minuscules de votre compte mobile Home Connect où sont appairés vos
                  appareils Siemens.
                </li>
                <li>
                  <strong>One-Time Token :</strong> <strong>Off</strong> ·{' '}
                  <strong>Sync to China :</strong> <strong>Off</strong> (sauf appareils achetés en
                  Chine continentale) · <strong>Status :</strong> <strong>Enabled</strong>.
                </li>
                <li>
                  <strong>Redirect URIs :</strong> collez exactement l&apos;URL ci-dessous (aucun{' '}
                  <code>/</code> final), puis cliquez sur <strong>Save / Register</strong> :
                </li>
              </ul>

              <div className="space-y-2 pt-1">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase text-slate-500">Redirect URI actuelle</div>
                    <div className="font-mono text-xs text-cyan-300 break-all">{hcRedirectUri}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText('hc-uri', hcRedirectUri)}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white flex items-center gap-1 shrink-0"
                  >
                    {copiedKey === 'hc-uri' ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        {t('guide.copied')}
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        {t('guide.copy')}
                      </>
                    )}
                  </button>
                </div>
                {hcRedirectUri !== localHcRedirectUri && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase text-slate-500">Redirect URI locale</div>
                      <div className="font-mono text-xs text-slate-300 break-all">
                        {localHcRedirectUri}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyText('hc-uri-local', localHcRedirectUri)}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white flex items-center gap-1 shrink-0"
                    >
                      {copiedKey === 'hc-uri-local' ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          {t('guide.copied')}
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          {t('guide.copy')}
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-1.5">
              <div className="font-semibold text-white">
                Étape 3 — Récupérer Client ID &amp; Client Secret
              </div>
              <p className="text-slate-300">
                De retour sur <strong>Applications</strong>, cliquez sur <strong>Details</strong>{' '}
                sur votre application puis copiez immédiatement <strong>Client ID</strong> et{' '}
                <strong>Client Secret</strong>.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-cyan-400" />
                  Étape 4 — Renseigner .env.local (et Vercel) puis redémarrer
                </span>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      'hc-env',
                      'SIEMENS_HOME_CONNECT_CLIENT_ID="votre-client-id"\nSIEMENS_HOME_CONNECT_CLIENT_SECRET="votre-client-secret"\nSIEMENS_HOME_CONNECT_ENV="prod"'
                    )
                  }
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white flex items-center gap-1"
                >
                  {copiedKey === 'hc-env' ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copiedKey === 'hc-env' ? t('guide.copied') : t('guide.copy')}
                </button>
              </div>
              <pre className="font-mono text-[11px] text-cyan-300 overflow-x-auto leading-relaxed">
{`SIEMENS_HOME_CONNECT_CLIENT_ID="votre-client-id"
SIEMENS_HOME_CONNECT_CLIENT_SECRET="votre-client-secret"
SIEMENS_HOME_CONNECT_ENV="prod" # prod, simulator ou cn`}
              </pre>
              <p className="text-[11px] text-slate-400">
                Sauvegardez <code>.env.local</code> et redémarrez <code>npm run dev</code> (ou
                redéployez sur Vercel) pour prendre en compte les variables.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-1.5">
              <div className="font-semibold text-white">
                Étape 5 — Connecter (SingleKey ID) et synchroniser
              </div>
              <ol className="list-decimal list-inside space-y-1 text-slate-300">
                <li>
                  Ouvrez l&apos;onglet <strong>Appareils</strong> puis cliquez sur{' '}
                  <strong>Connecter Home Connect</strong>.
                </li>
                <li>
                  Authentifiez-vous avec votre <strong>SingleKey ID</strong> (compte mobile Home
                  Connect) et validez les droits demandés (<code>IdentifyAppliance</code>,{' '}
                  <code>Monitor</code>, <code>Settings</code> — zéro permission <code>Control</code>).
                </li>
                <li>
                  De retour sur le cockpit avec le badge vert <strong>Connecté</strong>, cliquez sur{' '}
                  <strong>Synchroniser Home Connect</strong>.
                </li>
              </ol>
            </div>
          </div>

          <details className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs">
            <summary className="cursor-pointer select-none font-semibold text-slate-200 flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5 text-amber-400" />
              Dépannage, pièges courants &amp; quotas Home Connect
            </summary>
            <ul className="mt-2.5 space-y-1.5 text-[11px] text-slate-300 list-disc list-inside leading-relaxed">
              <li>
                <code>redirect_uri_mismatch</code> : l&apos;URL saisie dans{' '}
                <strong>Redirect URIs</strong> doit être strictement identique (<code>http</code> vs{' '}
                <code>https</code>, port <code>:3000</code>, aucun <code>/</code> final).
              </li>
              <li>
                <code>unauthorized_client</code> : vérifiez que <strong>OAuth Flow</strong> est bien
                sur <strong>Authorization Code Grant Flow</strong> et <strong>Status</strong> sur{' '}
                <strong>Enabled</strong>.
              </li>
              <li>
                <strong>Délai d&apos;activation BSH :</strong> après avoir cliqué sur{' '}
                <strong>Save</strong> sur <code>developer.home-connect.com</code>, attendez 1 à 2
                minutes avant le premier test OAuth.
              </li>
              <li>
                <strong>Aucun appareil remonté :</strong> vérifiez que vos appareils Siemens sont bien
                appairés dans l&apos;application mobile Home Connect avec le même{' '}
                <strong>SingleKey ID</strong> (et en minuscules côté portail développeur).
              </li>
              <li>
                <strong>Quotas API BSH :</strong> limite de 1 000 requêtes/jour et 50 req/min. La
                collecte réutilise le jeton OAuth pendant 24 h et n&apos;interroge ni les appareils
                hors ligne ni les paramètres superflus lors du cron.
              </li>
              <li>
                <strong>Simulateur :</strong> basculez{' '}
                <code>SIEMENS_HOME_CONNECT_ENV=&quot;simulator&quot;</code> (ou le sélecteur avant
                connexion) pour tester des appareils virtuels Siemens sur{' '}
                <code>simulator.home-connect.com</code>.
              </li>
              <li>
                <strong>Énergie W/kWh :</strong> l&apos;API publique Home Connect n&apos;expose pas
                la puissance en watts ; si votre appareil est sur une prise Tuya/Kasa, utilisez{' '}
                <strong>Lier → Fusionner</strong> dans Appareils.
              </li>
              <li>
                <strong>IP / MAC Siemens :</strong> l&apos;adresse MAC est extraite automatiquement
                du <code>haId</code> BSH lorsqu&apos;il se termine par les 12 chiffres hexadécimaux (ex.{' '}
                <code>68:A4:0E:...</code>). L&apos;API cloud Home Connect n&apos;expose pas l&apos;IP
                locale ; vous pouvez la saisir manuellement via le bouton <strong>DP</strong> dans{' '}
                <strong>Appareils</strong> (en utilisant la MAC pour la repérer sur votre box/routeur), et elle sera conservée lors des synchronisations suivantes.
              </li>
            </ul>
          </details>

          {onNavigateTab && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigateTab('systems')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 text-xs font-medium text-white transition"
              >
                {t('guide.syncHcSystems')}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </details>
      </div>

      {/* Étape Somfy Cloud (toujours visible dans Guide Setup, repliable) */}
      <div
        id="setup-somfy"
        className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4 scroll-mt-24"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-amber-500/15 p-2 text-amber-400">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {t('guide.somfyTitle')}
              </h3>
              <p className="text-xs text-slate-400">
                {t('guide.somfySub')}
              </p>
            </div>
          </div>

          <span
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${env.somfyConfigured
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              : 'border-slate-700 bg-slate-800 text-slate-400'
              }`}
          >
            {env.somfyConfigured
              ? `${t('common.configured')} (${env.somfyRegion.toUpperCase()})`
              : t('guide.optionalNotConfigured')}
          </span>
        </div>

        <details
          id="setup-somfy-details"
          open={showSomfy}
          className="group rounded-xl border border-slate-800/90 bg-slate-950/40 p-4"
        >
          <summary className="cursor-pointer select-none text-xs font-medium text-amber-300 hover:text-amber-200 flex items-center justify-between gap-2">
            <span>{t('guide.somfySummary')}</span>
            <span className="text-[11px] text-slate-400 group-open:hidden">
              {t('guide.clickToExpand')}
            </span>
            <span className="text-[11px] text-slate-400 hidden group-open:inline">
              {t('guide.clickToCollapse')}
            </span>
          </summary>

          <div className="mt-4 space-y-4 text-xs text-slate-300 leading-relaxed">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-[11px] text-amber-100/90 space-y-1">
              <div>
                <strong>Architecture 100 % cloud &amp; lecture seule :</strong> le Kit de
                connectivité Somfy ne propose pas d&apos;API locale (réservée à TaHoma Switch). Le
                cockpit utilise donc uniquement <code>POST /login</code> (cookie{' '}
                <code>JSESSIONID</code> chiffré en AES-256-GCM en base pour éviter les blocages anti
                brute-force) puis <code>GET /setup</code>. Aucune commande d&apos;ouverture ou de
                fermeture (<code>/exec/apply</code>) n&apos;est jamais appelée.
              </div>
              <div>
                <strong>io-homecontrol vs RTS :</strong> les volets <strong>io</strong> remontent
                leur position exacte (%) et la qualité du signal ; les appareils <strong>RTS</strong>{' '}
                sont unidirectionnels (ils s&apos;affichent dans <strong>Volets &amp; Stores</strong>{' '}
                avec l&apos;indicateur <em>RTS unidirectionnel</em>). Les pièces TaHoma sont
                importables dans <strong>Pièces</strong> sans toucher à vos cibles °C/%.
              </div>
            </div>

            <ol className="list-decimal list-inside space-y-2">
              <li>
                Dans l&apos;application mobile <strong>TaHoma by Somfy</strong>, vérifiez que votre{' '}
                <strong>Kit de connectivité</strong> apparaît en ligne et que vos volets/stores sont
                affectés aux bonnes pièces.
              </li>
              <li>
                Utilisez votre adresse e-mail et votre mot de passe de compte <strong>Somfy</strong>.{' '}
                <span className="text-amber-300">
                  Note : si vous vous connectez habituellement via « Continuer avec Google / Apple »,
                  définissez d&apos;abord un mot de passe Somfy dédié via « Mot de passe oublié »
                  dans TaHoma ou sur somfy.fr.
                </span>
              </li>
              <li>
                Ajoutez les variables ci-dessous dans <code>.env.local</code> et sur Vercel (Project
                Settings → Environment Variables), puis redémarrez/redéployez.
              </li>
              <li>
                Dans l&apos;onglet <strong>Appareils</strong>, cliquez sur{' '}
                <strong>Synchroniser Somfy</strong> (et <strong>Synchroniser pièces Somfy</strong>{' '}
                dans <strong>Pièces</strong> si souhaité), puis consultez le nouvel onglet{' '}
                <strong>Volets &amp; Stores</strong>.
              </li>
            </ol>

            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-400">
                  <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                  Variables Somfy Cloud (.env.local / Vercel)
                </div>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      'somfy-env',
                      'SOMFY_EMAIL="votre-email@exemple.com"\nSOMFY_PASSWORD="votre-mot-de-passe"\nSOMFY_REGION="eu"'
                    )
                  }
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white flex items-center gap-1"
                >
                  {copiedKey === 'somfy-env' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      {t('guide.copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      {t('guide.copy')}
                    </>
                  )}
                </button>
              </div>
              <pre className="font-mono text-[11px] text-amber-300 overflow-x-auto leading-relaxed">
                {`SOMFY_EMAIL="votre-email@exemple.com"
SOMFY_PASSWORD="votre-mot-de-passe"
SOMFY_REGION="eu" # eu (Europe / France), na (Amérique du Nord) ou oc (Océanie)
# SOMFY_CLOUD_URL="" # Optionnel : surcharge l'URL Overkiz enduserAPI
# SOMFY_GATEWAY_IP="" # Optionnel : repli IP passerelle si Overkiz renvoie "N/A"
# SOMFY_GATEWAY_MAC="" # Optionnel : repli MAC passerelle si masquée par Overkiz`}
              </pre>
              <p className="text-[11px] text-slate-400">
                L&apos;adresse IP et l&apos;adresse MAC de la passerelle Kit de connectivité sont
                extraites automatiquement de <code>/setup</code> lorsqu&apos;Overkiz les expose ;
                renseignez <code>SOMFY_GATEWAY_IP</code> / <code>SOMFY_GATEWAY_MAC</code> en repli
                si Overkiz renvoie <code>N/A</code>.
              </p>
            </div>

            <details className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs">
              <summary className="cursor-pointer select-none font-semibold text-slate-200 flex items-center gap-2">
                <Wrench className="h-3.5 w-3.5 text-amber-400" />
                Dépannage Somfy / Overkiz Cloud
              </summary>
              <ul className="mt-2.5 space-y-1.5 text-[11px] text-slate-300 list-disc list-inside leading-relaxed">
                <li>
                  <code>HTTP 429 / TOO_MANY_REQUESTS</code> : Overkiz bloque temporairement les
                  connexions pendant 15 à 30 minutes en cas d&apos;appels <code>/login</code>{' '}
                  répétés. Attendez avant de relancer ; en fonctionnement normal, le cockpit réutilise
                  la session <code>JSESSIONID</code> chiffrée sans rappeler <code>/login</code>.
                </li>
                <li>
                  <code>AUTHENTICATION_ERROR / BAD_CREDENTIALS</code> : vérifiez que{' '}
                  <code>SOMFY_EMAIL</code> / <code>SOMFY_PASSWORD</code> fonctionnent dans
                  l&apos;application TaHoma et que <code>SOMFY_REGION</code> vaut bien{' '}
                  <code>eu</code> pour la France.
                </li>
                <li>
                  <strong>Aucun pourcentage sur stores RTS :</strong> comportement normal du
                  protocole radio Somfy RTS (unidirectionnel sans retour d&apos;état). Les volets{' '}
                  <strong>io</strong> et les moteurs tubulaires Tuya remontent bien leur %
                  d&apos;ouverture/fermeture.
                </li>
              </ul>
            </details>

            {onNavigateTab && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onNavigateTab('systems')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition"
                >
                  {t('guide.syncSomfySystems')}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('covers')}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition"
                >
                  {t('guide.openCovers')}
                  <ArrowRight className="h-3.5 w-3.5 text-amber-400" />
                </button>
              </div>
            )}
          </div>
        </details>
      </div>

      {/* Étape Daikin Onecta Cloud (toujours visible dans Guide Setup, repliable) */}
      <div
        id="setup-daikin"
        className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4 scroll-mt-24"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-blue-500/15 p-2 text-blue-400">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {t('guide.daikinTitle')}
              </h3>
              <p className="text-xs text-slate-400">
                {t('guide.daikinSub')}
              </p>
            </div>
          </div>

          <span
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${
              env.daikinConnected
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : env.daikinConfigured
                  ? 'border-blue-500/40 bg-blue-500/15 text-blue-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400'
            }`}
          >
            {env.daikinConnected
              ? t('common.connected')
              : env.daikinConfigured
                ? t('common.readyOAuth')
                : t('guide.optionalNotConfigured')}
          </span>
        </div>

        <details
          id="setup-daikin-details"
          open={showDaikin}
          className="group rounded-xl border border-slate-800/90 bg-slate-950/40 p-4"
        >
          <summary className="cursor-pointer select-none text-xs font-medium text-blue-300 hover:text-blue-200 flex items-center justify-between gap-2">
            <span>{t('guide.daikinSummary')}</span>
            <span className="text-[11px] text-slate-400 group-open:hidden">
              {t('guide.clickToExpand')}
            </span>
            <span className="text-[11px] text-slate-400 hidden group-open:inline">
              {t('guide.clickToCollapse')}
            </span>
          </summary>

          <div className="mt-4 space-y-4 text-xs text-slate-300 leading-relaxed">
            <ol className="list-decimal list-inside space-y-2">
              <li>
                Connectez-vous au{' '}
                <a
                  href="https://developer.cloud.daikineurope.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 underline"
                >
                  Portail Développeur Daikin Cloud
                  <ExternalLink className="h-3 w-3" />
                </a>{' '}
                avec le même compte Daikin Onecta que votre application mobile.
              </li>
              <li>
                Ouvrez <strong>My Apps → Create a new app</strong>, donnez un nom (ex.{' '}
                <code>Home Cockpit</code>) et renseignez une <strong>Redirect URI en HTTPS</strong>{' '}
                (ex. votre URL Vercel en <code>https://…</code> ci-dessous). Daikin refuse{' '}
                <code>http://localhost</code> en clair.
              </li>
              <li>
                Copiez le <strong>Client ID</strong> et le <strong>Client Secret</strong> dans{' '}
                <code>.env.local</code> et dans les variables d&apos;environnement Vercel.
              </li>
              <li>
                <strong>Connexion :</strong> sur Vercel HTTPS, cliquez simplement sur{' '}
                <strong>Connecter Daikin (OAuth)</strong> dans <strong>Appareils</strong>.{' '}
                <em>Astuce local (<code>http://localhost:3000</code>) :</em> lancez OAuth avec{' '}
                <code>DAIKIN_REDIRECT_URI</code> pointant vers une URL HTTPS (ex.{' '}
                <code>https://localhost:3000/api/vendors/daikin/oauth/callback</code> ou votre URL
                Vercel), puis après redirection copiez l&apos;URL de la barre d&apos;adresse et collez-la
                dans <strong>« Tester en local : coller l&apos;URL ou le code OAuth »</strong>.
              </li>
            </ol>

            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                  Redirect URI OAuth à déclarer chez Daikin (HTTPS requis)
                </span>
                <button
                  type="button"
                  onClick={() => copyText('daikin-redirect', daikinRedirectUri)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white flex items-center gap-1"
                >
                  {copiedKey === 'daikin-redirect' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      {t('guide.copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      {t('guide.copy')}
                    </>
                  )}
                </button>
              </div>
              <code className="block font-mono text-[11px] text-blue-300 break-all">
                {daikinRedirectUri}
              </code>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-400">
                  <KeyRound className="h-3.5 w-3.5 text-blue-400" />
                  Variables Daikin Onecta (.env.local / Vercel)
                </div>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      'daikin-env',
                      'DAIKIN_CLIENT_ID="votre_client_id_daikin"\nDAIKIN_CLIENT_SECRET="votre_client_secret_daikin"'
                    )
                  }
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white flex items-center gap-1"
                >
                  {copiedKey === 'daikin-env' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      {t('guide.copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      {t('guide.copy')}
                    </>
                  )}
                </button>
              </div>
              <pre className="font-mono text-[11px] text-blue-300 overflow-x-auto leading-relaxed">
                {`DAIKIN_CLIENT_ID="votre_client_id_daikin"
DAIKIN_CLIENT_SECRET="votre_client_secret_daikin"
# DAIKIN_REDIRECT_URI="" # Optionnel : surcharge HTTPS si vous testez en local`}
              </pre>
              <p className="text-[11px] text-slate-400">
                <strong>Quotas &amp; calculs :</strong> Daikin limite l&apos;API publique à{' '}
                <strong>200 requêtes/jour</strong>. Chaque collecte n&apos;effectue qu&apos;<strong>un seul appel</strong>{' '}
                <code>GET /v1/gateway-devices</code> (~48/jour avec le cron 30 min). Les relevés{' '}
                <code>kWh</code> et <code>°C / %</code> alimentent automatiquement <strong>Énergie</strong> et{' '}
                <strong>Climat</strong> (utilisez <strong>Exclure</strong> dans Appareils si vous avez déjà une sonde murale).
              </p>
            </div>

            {onNavigateTab && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onNavigateTab('systems')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition"
                >
                  {t('guide.connectDaikinSystems')}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('hvac')}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition"
                >
                  {t('guide.openHvac')}
                  <ArrowRight className="h-3.5 w-3.5 text-blue-400" />
                </button>
              </div>
            )}
          </div>
        </details>
      </div>

      {/* Étape X-Sense Home Security (repliable) */}
      <div
        id="setup-xsense"
        className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-5 scroll-mt-24"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-rose-500/15 p-2 text-rose-400">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                {t('guide.xsenseTitle')}
              </h3>
              <p className="text-xs text-slate-400">
                {t('guide.xsenseSub')}
              </p>
            </div>
          </div>

          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              env.xsenseConfigured
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {env.xsenseConfigured ? t('common.configured') : t('guide.optionalNotConfigured')}
          </span>
        </div>

        <details
          id="setup-xsense-details"
          open={showXSense}
          className="group rounded-xl border border-slate-800 bg-slate-950/60"
        >
          <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between text-xs font-medium text-slate-300 hover:text-white select-none">
            <span>{t('guide.xsenseSummary')}</span>
            <span className="text-[11px] text-slate-500 group-open:hidden">{t('guide.clickToExpand')}</span>
            <span className="text-[11px] text-slate-500 hidden group-open:inline">{t('guide.clickToCollapse')}</span>
          </summary>

          <div className="px-4 pb-4 pt-1 border-t border-slate-800/80 space-y-4">
            <ol className="list-decimal list-inside space-y-2 text-xs text-slate-300 leading-relaxed">
              <li>
                <strong>Important :</strong> X-Sense autorise une seule session active par compte.
                Créez un <strong>second compte e-mail gratuit</strong> dans l&apos;app X-Sense, puis
                partagez votre maison depuis votre compte principal (<em>Paramètres Maison → Membres</em>)
                afin de ne jamais déconnecter votre smartphone.
              </li>
              <li>
                Renseignez <code>XSENSE_EMAIL</code> et <code>XSENSE_PASSWORD</code> dans{' '}
                <code>.env.local</code> / Vercel, puis cliquez sur{' '}
                <strong>Synchroniser X-Sense</strong> dans <strong>Appareils</strong>.
              </li>
            </ol>

            <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-slate-400">
                  Variables X-Sense Security (.env.local / Vercel)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      'xsense-env',
                      'XSENSE_EMAIL="compte-invite@exemple.com"\nXSENSE_PASSWORD="votre_mot_de_passe"'
                    )
                  }
                  className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition"
                >
                  {copiedKey === 'xsense-env' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      {t('guide.copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      {t('guide.copy')}
                    </>
                  )}
                </button>
              </div>
              <pre className="font-mono text-[11px] text-rose-300 overflow-x-auto leading-relaxed">
                {`XSENSE_EMAIL="compte-invite@exemple.com"
XSENSE_PASSWORD="votre_mot_de_passe"`}
              </pre>
            </div>

            {onNavigateTab && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onNavigateTab('systems')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 px-3 py-1.5 text-xs font-medium text-white transition"
                >
                  {t('guide.syncXSenseSystems')}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('security')}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition"
                >
                  {t('guide.openSecurity')}
                  <ArrowRight className="h-3.5 w-3.5 text-rose-400" />
                </button>
              </div>
            )}
          </div>
        </details>
      </div>

      {/* Étape Xiaomi Home / Mi Cloud (repliable) */}
      <div
        id="setup-xiaomi"
        className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-5 scroll-mt-24"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-orange-500/15 p-2 text-orange-400">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                {t('guide.xiaomiTitle')}
              </h3>
              <p className="text-xs text-slate-400">
                {t('guide.xiaomiSub')} (<code>{env.xiaomiRegion.toUpperCase()}</code>)
              </p>
            </div>
          </div>

          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              env.xiaomiConnected
                ? 'bg-emerald-500/15 text-emerald-300'
                : env.xiaomiConfigured
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-slate-800 text-slate-400'
            }`}
          >
            {env.xiaomiConnected
              ? `${t('common.connected')} (${env.xiaomiRegion.toUpperCase()})`
              : env.xiaomiConfigured
                ? t('common.configured')
                : 'QR'}
          </span>
        </div>

        <details
          id="setup-xiaomi-details"
          open={showXiaomi}
          className="group rounded-xl border border-slate-800 bg-slate-950/60"
        >
          <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between text-xs font-medium text-slate-300 hover:text-white select-none">
            <span>{t('guide.xiaomiSummary')}</span>
            <span className="text-[11px] text-slate-500 group-open:hidden">{t('guide.clickToExpand')}</span>
            <span className="text-[11px] text-slate-500 hidden group-open:inline">{t('guide.clickToCollapse')}</span>
          </summary>

          <div className="px-4 pb-4 pt-1 border-t border-slate-800/80 space-y-4">
            <ol className="list-decimal list-inside space-y-2 text-xs text-slate-300 leading-relaxed">
              <li>
                <strong>Méthode la plus simple (QR Code) :</strong> dans l&apos;onglet{' '}
                <strong>Appareils</strong>, sélectionnez votre région (<code>de</code> pour Europe),
                cliquez sur <strong>Scanner QR Code Xiaomi</strong> et scannez le QR depuis l&apos;app
                mobile Xiaomi Home (<em>Profil → Scanner</em>). Les jetons sont chiffrés en base.
              </li>
              <li>
                <strong>Méthode alternative (.env + 2FA) :</strong> vous pouvez aussi renseigner{' '}
                <code>XIAOMI_USERNAME</code>, <code>XIAOMI_PASSWORD</code> et{' '}
                <code>XIAOMI_REGION=de</code> ci-dessous puis saisir le code 2FA si Xiaomi le demande.
              </li>
            </ol>

            <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-slate-400">
                  Variables optionnelles Xiaomi Home (.env.local / Vercel)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      'xiaomi-env',
                      'XIAOMI_USERNAME="votre-email@exemple.com"\nXIAOMI_PASSWORD="votre_mot_de_passe"\nXIAOMI_REGION="de"'
                    )
                  }
                  className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition"
                >
                  {copiedKey === 'xiaomi-env' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      {t('guide.copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      {t('guide.copy')}
                    </>
                  )}
                </button>
              </div>
              <pre className="font-mono text-[11px] text-orange-300 overflow-x-auto leading-relaxed">
                {`XIAOMI_USERNAME="votre-email@exemple.com"
XIAOMI_PASSWORD="votre_mot_de_passe"
XIAOMI_REGION="de" # de (Europe), cn, us, sg, ru ou i2`}
              </pre>
            </div>

            {onNavigateTab && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onNavigateTab('systems')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 hover:bg-orange-500 px-3 py-1.5 text-xs font-medium text-white transition"
                >
                  {t('guide.connectXiaomiSystems')}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('security')}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition"
                >
                  {t('guide.openSecurity')}
                  <ArrowRight className="h-3.5 w-3.5 text-orange-400" />
                </button>
              </div>
            )}
          </div>
        </details>
      </div>

      {/* Étape Linky / Conso API (toujours visible dans Guide Setup, repliable) */}
      <div
        id="setup-conso-api"
        className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4 scroll-mt-24"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-lime-500/15 p-2 text-lime-400">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">{t('guide.consoTitle')}</h3>
              <p className="text-xs text-slate-400">{t('guide.consoSub')}</p>
            </div>
          </div>

          <span
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${
              env.consoApiConfigured
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-slate-700 bg-slate-800 text-slate-400'
            }`}
          >
            {env.consoApiConfigured
              ? `${t('common.configured')}${env.consoApiPrmMasked ? ` (${env.consoApiPrmMasked})` : ''}`
              : t('guide.optionalNotConfigured')}
          </span>
        </div>

        <details
          id="setup-conso-api-details"
          open={showConsoApi}
          className="group rounded-xl border border-slate-800/90 bg-slate-950/40 p-4"
        >
          <summary className="cursor-pointer select-none text-xs font-medium text-lime-300 hover:text-lime-200 flex items-center justify-between gap-2">
            <span>{t('guide.consoSummary')}</span>
            <span className="text-[11px] text-slate-400 group-open:hidden">
              {t('guide.clickToExpand')}
            </span>
            <span className="text-[11px] text-slate-400 hidden group-open:inline">
              {t('guide.clickToCollapse')}
            </span>
          </summary>

          <div className="mt-4 space-y-4 text-xs text-slate-300 leading-relaxed">
            <div className="rounded-xl border border-lime-500/25 bg-lime-500/5 p-3.5 text-[11px] text-slate-300 space-y-1">
              <div>
                <strong>Compteur global &amp; « Autres / Non mesuré » :</strong> les relevés Linky
                alimentent automatiquement une table SQL dédiée (<code>meter_readings</code>). En vue
                globale, ils portent le total officiel du logement sur tous les jours publiés (≤ J-1)
                sans double comptage avec vos prises Tuya / Kasa / Daikin.
              </div>
              <div>
                <strong>Protection stricte anti-ban conso.boris.sh :</strong> 3 requêtes au premier
                import (365j quotidien, 365j puissance max VA, 7j courbe 30 min) puis au maximum{' '}
                <strong>1 synchro automatique par jour</strong> après 08h00 (Europe/Paris) si J-1
                manque.
              </div>
            </div>

            <ol className="list-decimal list-inside space-y-2">
              <li>
                Rendez-vous sur{' '}
                <a
                  href="https://conso.boris.sh/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-lime-300 underline inline-flex items-center gap-1"
                >
                  conso.boris.sh <ExternalLink className="h-3 w-3" />
                </a>{' '}
                et connectez votre compte client Enedis pour accorder le consentement et copier votre
                <strong> Token Bearer</strong> ainsi que votre <strong>PRM à 14 chiffres</strong>.
              </li>
              <li>
                Renseignez-les directement dans l&apos;onglet <strong>Systèmes</strong> (carte{' '}
                <em>Linky (Conso API)</em>, stockage chiffré AES-256-GCM en base) ou via variables
                d&apos;environnement (<code>CONSO_API_TOKEN</code>, <code>CONSO_API_PRM</code>,{' '}
                <code>CONSO_API_SUBSCRIBED_KVA</code>).
              </li>
              <li>
                Lancez une première synchronisation : vos 365 derniers jours et pics VA apparaissent
                dans <strong>Vue d&apos;ensemble</strong> et <strong>Énergie &amp; Coûts</strong>.
              </li>
            </ol>

            {onNavigateTab && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onNavigateTab('systems')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-lime-600 hover:bg-lime-500 px-3 py-1.5 text-xs font-medium text-white transition"
                >
                  {t('guide.syncConsoSystems')}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </details>
      </div>

      {/* Étape 4 : Google Home Multi-Vendors */}
      {showGoogleHomeApi && (
        <div
          id="setup-google-home"
          className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-5 scroll-mt-24"
        >
          {/* En-tête + badges d'état temps réel */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded-xl bg-sky-500/15 p-2 text-sky-400">
                <Cloud className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">
                  {t('guide.googleTitle')}
                </h3>
                <p className="text-xs text-slate-400">
                  {t('guide.googleSub')}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span
                className={`rounded-full border px-2.5 py-0.5 font-medium ${env.googleHomeConfigured
                  ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-700 bg-slate-950 text-slate-400'
                  }`}
              >
                OAuth Client : {env.googleHomeConfigured ? 'OK' : 'Manquant'}
              </span>
              <span
                className={`rounded-full border px-2.5 py-0.5 font-medium ${env.googleSdmProjectConfigured
                  ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-700 bg-slate-950 text-slate-400'
                  }`}
              >
                SDM Project ID : {env.googleSdmProjectConfigured ? 'OK' : 'Non défini'}
              </span>
              <span
                className={`rounded-full border px-2.5 py-0.5 font-medium ${env.googleHomeConnected
                  ? 'border-sky-500/30 bg-sky-500/15 text-sky-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                  }`}
              >
                Session OAuth : {env.googleHomeConnected ? 'Connectée' : 'À autoriser'}
              </span>
            </div>
          </div>

          {/* Sélecteur interactif de voie */}
          <div className="space-y-2.5">
            <div className="text-xs font-medium text-slate-300">
              Choisissez la voie adaptée à votre installation pour afficher le déroulé exact :
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setGoogleGuideMode('mcp')}
                className={`text-left rounded-xl border p-4 transition ${googleGuideMode === 'mcp'
                  ? 'border-sky-500/60 bg-sky-500/10 ring-1 ring-sky-500/30'
                  : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                  }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-white">
                    Voie A — Home MCP (<code>mcp</code>)
                  </span>
                  <span className="rounded-full border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-300">
                    Tous appareils
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 mt-1.5 leading-relaxed">
                  Remonte <strong>tous</strong> vos appareils Google Home (Nest, Matter, Tuya, Hue…)
                  avec pièces et états via <code>home.googleapis.com/mcp</code>.
                </p>
                <p className="text-[11px] text-amber-300 mt-1.5 leading-relaxed">
                  Prérequis : abonnement <strong>Google Home Premium Advanced</strong> (~20 $/mois ;
                  le palier Standard seul ne suffit pas officiellement) + compte éligible (early
                  access initialement limité aux comptes US/anglais).
                </p>
              </button>

              <button
                type="button"
                onClick={() => setGoogleGuideMode('sdm')}
                className={`text-left rounded-xl border p-4 transition ${googleGuideMode === 'sdm'
                  ? 'border-sky-500/60 bg-sky-500/10 ring-1 ring-sky-500/30'
                  : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                  }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-white">
                    Voie B — Nest SDM API (<code>sdm</code>)
                  </span>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                    5 $ unique · Sans abo
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 mt-1.5 leading-relaxed">
                  Remonte vos appareils <strong>Google Nest</strong> (thermostats, caméras, sonnettes,
                  hubs) et leurs pièces via l&apos;API Smart Device Management.
                </p>
                <p className="text-[11px] text-emerald-300 mt-1.5 leading-relaxed">
                  Prérequis : compte <code>@gmail.com</code> grand public + frais uniques de{' '}
                  <strong>5 $</strong> sur Device Access Console (disponible en France, aucun
                  abonnement mensuel).
                </p>
              </button>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-[11px] text-slate-400">
              <Info className="h-3.5 w-3.5 text-sky-400 shrink-0 mt-0.5" />
              <span>
                <strong>Note technique :</strong> il est inutile d&apos;activer{' '}
                <code>HomeGraph API</code> (<code>homegraph.googleapis.com</code>) dans Google Cloud
                : elle fonctionne dans le sens inverse (pour les fabricants qui poussent leurs
                appareils vers Google, pas pour lire votre maison).
              </span>
            </div>
          </div>

          {/* Déroulé opératoire numéroté */}
          <div className="space-y-3">
            {/* 4.1 */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-white">
                  4.1 — Créer le projet Google Cloud &amp; activer l&apos;API
                </div>
                <a
                  href="https://console.cloud.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300"
                >
                  Ouvrir Google Cloud Console
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-300 leading-relaxed">
                <li>
                  Créez ou sélectionnez un projet dans <strong>Google Cloud Console</strong> (avec le
                  compte Google qui possède ou gère votre maison Google Home).
                </li>
                <li>
                  Ouvrez le menu <strong>APIs &amp; Services → Library</strong> (<em>Bibliothèque</em>).
                </li>
                <li>
                  {googleGuideMode === 'mcp' ? (
                    <>
                      Recherchez <strong>Home API</strong> et cliquez sur <strong>Enable</strong>{' '}
                      (<em>Activer</em>).
                    </>
                  ) : (
                    <>
                      Recherchez <strong>Smart Device Management API</strong> et cliquez sur{' '}
                      <strong>Enable</strong> (<em>Activer</em>).
                    </>
                  )}
                </li>
              </ol>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2 text-[11px]">
                <div className="min-w-0">
                  <span className="text-slate-500 mr-2">Scope OAuth utilisé automatiquement :</span>
                  <code className="font-mono text-sky-300 break-all">
                    {googleGuideMode === 'mcp'
                      ? 'https://www.googleapis.com/auth/home.platform.v2'
                      : 'https://www.googleapis.com/auth/sdm.service'}
                  </code>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      'ghscope',
                      googleGuideMode === 'mcp'
                        ? 'https://www.googleapis.com/auth/home.platform.v2'
                        : 'https://www.googleapis.com/auth/sdm.service'
                    )
                  }
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-300 hover:text-white flex items-center gap-1 shrink-0"
                >
                  {copiedKey === 'ghscope' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      {t('guide.copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      {t('guide.copy')}
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 4.2 */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2.5">
              <div className="text-xs font-semibold text-white">
                4.2 — Configurer l&apos;écran de consentement OAuth (Google Auth Platform)
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-300 leading-relaxed">
                <li>
                  Dans Google Cloud Console, ouvrez <strong>Google Auth Platform</strong> (ou{' '}
                  <strong>APIs &amp; Services → OAuth consent screen</strong>) →{' '}
                  <strong>Overview / Branding</strong> → <strong>Get Started</strong>.
                </li>
                <li>
                  Choisissez l&apos;audience <strong>External</strong> (obligatoire pour un compte{' '}
                  <code>@gmail.com</code> personnel ; les comptes Google Workspace ne sont pas pris en
                  charge par Nest SDM).
                </li>
                <li>
                  Renseignez <em>App name</em> (ex. <code>Home Cockpit</code>),{' '}
                  <em>User support email</em> et <em>Developer contact email</em>, puis validez avec{' '}
                  <strong>Save</strong>.
                </li>
              </ol>
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 text-[11px] text-amber-200 leading-relaxed">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong>Point critique :</strong> ouvrez <strong>Audience → Test users → + Add users</strong>{' '}
                  et ajoutez <strong>l&apos;adresse Gmail exacte</strong> de votre maison Google Home
                  (sinon Google bloque avec <code>Error 403: access_denied</code>). En mode{' '}
                  <em>Testing</em>, le jeton expire tous les <strong>7 jours</strong> : cliquez sur{' '}
                  <strong>Publish app</strong> dans <em>Audience</em> pour éviter la reconnexion
                  hebdomadaire (aucune validation Google requise pour votre usage personnel).
                </div>
              </div>
            </div>

            {/* 4.3 */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2.5">
              <div className="text-xs font-semibold text-white">
                4.3 — Créer l&apos;identifiant OAuth 2.0 (Application Web)
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-300 leading-relaxed">
                <li>
                  Allez dans <strong>Google Auth Platform → Clients</strong> (ou{' '}
                  <strong>APIs &amp; Services → Credentials</strong>) →{' '}
                  <strong>+ Create Credentials → OAuth client ID</strong>.
                </li>
                <li>
                  Sélectionnez <em>Application type</em> : <strong>Web application</strong>.
                </li>
                <li>
                  Dans <strong>Authorized redirect URIs</strong>, ajoutez l&apos;URI exacte
                  ci-dessous (sans slash final <code>/</code> ; ajoutez à la fois l&apos;URI locale et
                  l&apos;URI Vercel si vous utilisez les deux environnements).
                </li>
                <li>
                  Cliquez sur <strong>Create</strong> puis copiez le <strong>Client ID</strong> (
                  <code>…apps.googleusercontent.com</code>) et le <strong>Client Secret</strong> (
                  <code>GOCSPX-…</code>).
                </li>
              </ol>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-2 text-xs">
                  <div>
                    <div className="text-[10px] uppercase text-slate-500">
                      Authorized Redirect URI (instance actuelle)
                    </div>
                    <div className="font-mono text-sky-300 break-all">{googleRedirectUri}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText('ghredirect', googleRedirectUri)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white flex items-center gap-1"
                  >
                    {copiedKey === 'ghredirect' ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        {t('guide.copied')}
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        {t('guide.copy')}
                      </>
                    )}
                  </button>
                </div>

                {googleRedirectUri !== localGoogleRedirectUri && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs">
                    <div>
                      <div className="text-[10px] uppercase text-slate-500">
                        Authorized Redirect URI (développement local)
                      </div>
                      <div className="font-mono text-slate-300 break-all">
                        {localGoogleRedirectUri}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyText('ghredirect-local', localGoogleRedirectUri)}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white flex items-center gap-1"
                    >
                      {copiedKey === 'ghredirect-local' ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          {t('guide.copied')}
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          {t('guide.copy')}
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 4.4 SDM uniquement */}
            {googleGuideMode === 'sdm' && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-white">
                    4.4 — Créer &amp; lier le projet Nest Device Access (5 $ unique)
                  </div>
                  <a
                    href="https://console.nest.google.com/device-access/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
                  >
                    Ouvrir Device Access Console
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-300 leading-relaxed">
                  <li>
                    Connectez-vous sur <strong>Device Access Console</strong> avec votre compte{' '}
                    <code>@gmail.com</code> grand public, acceptez les conditions et réglez les frais
                    uniques de <strong>5 $</strong>.
                  </li>
                  <li>
                    Cliquez sur <strong>Create project</strong> et donnez un nom (ex.{' '}
                    <code>Home Cockpit</code>).
                  </li>
                  <li>
                    À l&apos;étape <strong>OAuth Client ID</strong>, collez impérativement le{' '}
                    <strong>Client ID</strong> créé à l&apos;étape 4.3 (sinon l&apos;écran de liaison
                    Nest affichera une erreur).
                  </li>
                  <li>
                    Validez (<em>Pub/Sub</em> optionnel — non requis ici), puis copiez le{' '}
                    <strong>Project ID</strong> affiché (format UUID) → c&apos;est votre variable{' '}
                    <code>GOOGLE_SDM_PROJECT_ID</code>.
                  </li>
                </ol>
              </div>
            )}

            {/* 4.4 (mcp) / 4.5 (sdm) : Variables d'environnement & BDD */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <KeyRound className="h-3.5 w-3.5 text-sky-400" />
                {googleGuideMode === 'mcp' ? '4.4' : '4.5'} — Renseigner{' '}
                <code>.env.local</code> (et Vercel) + mettre à jour la BDD
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">
                    Variables à ajouter dans .env.local / Vercel ({googleGuideMode.toUpperCase()})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        'ghenv',
                        googleGuideMode === 'mcp'
                          ? [
                            'GOOGLE_CLIENT_ID="votre_client_id.apps.googleusercontent.com"',
                            'GOOGLE_CLIENT_SECRET="GOCSPX-votre_secret"',
                            'GOOGLE_HOME_MODE="mcp"',
                            'TOKEN_ENCRYPTION_KEY=""',
                          ].join('\n')
                          : [
                            'GOOGLE_CLIENT_ID="votre_client_id.apps.googleusercontent.com"',
                            'GOOGLE_CLIENT_SECRET="GOCSPX-votre_secret"',
                            'GOOGLE_HOME_MODE="sdm"',
                            'GOOGLE_SDM_PROJECT_ID="uuid-du-projet-device-access"',
                            'TOKEN_ENCRYPTION_KEY=""',
                          ].join('\n')
                      )
                    }
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white flex items-center gap-1"
                  >
                    {copiedKey === 'ghenv' ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        {t('guide.copied')}
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        {t('guide.copy')}
                      </>
                    )}
                  </button>
                </div>
                <pre className="font-mono text-[11px] text-sky-300 overflow-x-auto leading-relaxed">
                  {googleGuideMode === 'mcp'
                    ? `GOOGLE_CLIENT_ID="votre_client_id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-votre_secret"
GOOGLE_HOME_MODE="mcp"
TOKEN_ENCRYPTION_KEY="" # optionnel : clé AES-256 64 car. hex`
                    : `GOOGLE_CLIENT_ID="votre_client_id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-votre_secret"
GOOGLE_HOME_MODE="sdm"
GOOGLE_SDM_PROJECT_ID="uuid-du-projet-device-access"
TOKEN_ENCRYPTION_KEY="" # optionnel : clé AES-256 64 car. hex`}
                </pre>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-[11px]">
                <div className="min-w-0">
                  <div className="text-slate-400 mb-0.5">
                    Générer une clé <code>TOKEN_ENCRYPTION_KEY</code> dédiée (32 octets / hex) :
                  </div>
                  <code className="font-mono text-emerald-300 break-all">
                    node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;hex&apos;))&quot;
                  </code>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      'genkey',
                      "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
                    )
                  }
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white flex items-center gap-1 shrink-0"
                >
                  {copiedKey === 'genkey' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      {t('guide.copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      {t('guide.copy')}
                    </>
                  )}
                </button>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Les jetons OAuth sont chiffrés en <strong>AES-256-GCM</strong> en base dans la table{' '}
                <code>vendor_connections</code>. À défaut de <code>TOKEN_ENCRYPTION_KEY</code>,
                l&apos;app dérive automatiquement une clé depuis <code>APP_PASSWORD</code>,{' '}
                <code>SCHEDULE_SECRET</code> ou <code>TUYA_ACCESS_SECRET</code> — ne modifiez pas ce
                secret après la connexion OAuth. Pensez enfin à exécuter{' '}
                <code>npm run db:push</code> (si ce n&apos;est pas encore fait) puis à{' '}
                <strong>redémarrer <code>npm run dev</code></strong> en local ou{' '}
                <strong>redéployer sur Vercel</strong>.
              </p>
            </div>

            {/* 4.5 (mcp) / 4.6 (sdm) : Autoriser, synchroniser, fusionner */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-white">
                  {googleGuideMode === 'mcp' ? '4.5' : '4.6'} — Autoriser, synchroniser et fusionner
                  les doublons
                </div>
                {onNavigateTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateTab('systems')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 hover:bg-sky-500/25 px-2.5 py-1 text-[11px] font-medium text-sky-200 transition"
                  >
                    {t('guide.openSystems')}
                    <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-300 leading-relaxed">
                <li>
                  Rendez-vous dans l&apos;onglet <strong>Systèmes</strong>, carte{' '}
                  <strong>Google Home</strong>.
                </li>
                <li>
                  Vérifiez le sélecteur de mode (
                  <strong>
                    {googleGuideMode === 'mcp' ? 'Mode Home MCP' : 'Mode Nest SDM'}
                  </strong>
                  ) puis cliquez sur <strong>Connecter Google Home</strong>.
                </li>
                <li>
                  Sur l&apos;écran de consentement Google : si l&apos;avertissement{' '}
                  <em>« Application non validée par Google »</em> apparaît, cliquez sur{' '}
                  <strong>Paramètres avancés → Accéder à …</strong>.
                  {googleGuideMode === 'sdm' && (
                    <>
                      {' '}
                      Dans <strong>Partner Connections Manager</strong>, activez bien les
                      autorisations pour votre maison et vos appareils Nest avant de valider.
                    </>
                  )}
                </li>
                <li>
                  De retour sur le cockpit avec le badge vert <strong>Connecté</strong>, cliquez sur{' '}
                  <strong>Synchroniser Google Home</strong> (100 % lecture seule, zéro commande
                  envoyée).
                </li>
                <li>
                  Pour vos appareils Tuya également présents dans Google Home, utilisez{' '}
                  <strong>Fusionner en 1 clic</strong> dans le bandeau jaune des doublons détectés (ou
                  le bouton <strong>Systèmes &amp; Fusion</strong> sur chaque ligne) pour cumuler les
                  badges sans dupliquer l&apos;appareil.
                </li>
              </ol>
            </div>
          </div>

          {/* Dépannage rapide */}
          <details className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs">
            <summary className="cursor-pointer select-none font-semibold text-slate-200 flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5 text-amber-400" />
              Dépannage rapide (erreurs Google OAuth / API courantes)
            </summary>
            <ul className="mt-3 space-y-2 text-[11px] text-slate-300 leading-relaxed list-disc list-inside">
              <li>
                <code>redirect_uri_mismatch</code> : vérifiez que l&apos;URI enregistrée dans Google
                Cloud Console correspond au caractère près (<code>http</code> vs <code>https</code>,
                port <code>:3000</code>, domaine Vercel exact, aucun slash <code>/</code> final).
              </li>
              <li>
                <code>Error 403: access_denied</code> sur la page Google : votre adresse Gmail
                n&apos;a pas été ajoutée dans <strong>Audience → Test users</strong> (ou l&apos;app
                OAuth n&apos;est pas encore publiée).
              </li>
              <li>
                <code>403 Accès refusé par Google Home MCP</code> : vérifiez que{' '}
                <strong>Home API</strong> est bien activée dans Google Cloud, que votre compte
                possède <strong>Google Home Premium Advanced</strong> (Standard ne suffit pas) et que
                le compte est éligible à l&apos;accès anticipé MCP.
              </li>
              <li>
                <code>Can&apos;t link / No access to partner</code> (mode SDM) : le Client ID OAuth
                n&apos;a pas été collé dans le projet sur{' '}
                <code>console.nest.google.com/device-access</code>, ou un compte Google Workspace a
                été utilisé au lieu d&apos;un <code>@gmail.com</code> personnel.
              </li>
              <li>
                <strong>Session expirée après 7 jours :</strong> votre écran de consentement est
                resté en mode <em>Testing</em> — cliquez sur <strong>Publish app</strong> dans{' '}
                <em>Google Auth Platform → Audience</em> puis reconnectez Google Home une fois.
              </li>
              <li>
                <strong>Erreur de déchiffrement des tokens :</strong> ne changez pas{' '}
                <code>TOKEN_ENCRYPTION_KEY</code> (ou <code>APP_PASSWORD</code> si utilisée en
                repli) après la connexion ; sinon cliquez sur <strong>Déconnecter</strong> puis
                reconnectez Google Home.
              </li>
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
