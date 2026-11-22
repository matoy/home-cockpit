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
import type { DashboardPayload, GoogleHomeMode, TabId } from '@/types';

interface SetupGuideTabProps {
  data: DashboardPayload;
  onNavigateTab?: (tab: TabId) => void;
}

export function SetupGuideTab({ data, onNavigateTab }: SetupGuideTabProps) {
  const { env } = data;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [googleGuideMode, setGoogleGuideMode] = useState<GoogleHomeMode>(
    env.googleHomeMode ?? 'mcp'
  );

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://votre-app.vercel.app';
  const scheduleUrl = `${origin}/api/schedule/collect`;
  const googleRedirectUri = `${origin}/api/vendors/google-home/oauth/callback`;
  const localGoogleRedirectUri = 'http://localhost:3000/api/vendors/google-home/oauth/callback';

  function copyText(key: string, text: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    }
  }

  const showGoogleHomeApi = env.googleHomeApiEnabled;

  const googleOAuthDetail = env.googleHomeConfigured
    ? `Mode par défaut : ${env.googleHomeMode.toUpperCase()} · ${
        env.googleHomeConnected ? 'OAuth connecté' : 'Prêt pour connexion OAuth'
      }${
        env.googleHomeMode === 'sdm'
          ? env.googleSdmProjectConfigured
            ? ' · GOOGLE_SDM_PROJECT_ID renseigné'
            : ' · GOOGLE_SDM_PROJECT_ID manquant'
          : env.googleSdmProjectConfigured
            ? ' · GOOGLE_SDM_PROJECT_ID renseigné'
            : ''
      }`
    : 'Optionnel — ajoutez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET pour Google Home';

  const checklist = [
    {
      label: 'Base Neon Postgres (DATABASE_URL)',
      ok: env.databaseConfigured,
      detail: env.databaseConfigured
        ? 'Connectée (mode persistant actif)'
        : 'Non configurée (mode démo en mémoire actif)',
    },
    {
      label: 'Projet Tuya IoT Cloud (TUYA_ACCESS_ID & SECRET)',
      ok: env.tuyaConfigured,
      detail: env.tuyaConfigured
        ? `Région configurée : ${env.tuyaRegion.toUpperCase()}`
        : 'Identifiants absents',
    },
    {
      label: 'UID Utilisateur Smart Life (TUYA_USER_UID)',
      ok: env.tuyaUserUidConfigured,
      detail: env.tuyaUserUidConfigured
        ? 'Renseigné pour liste directe /v1.0/users/{uid}/devices'
        : 'Optionnel (repli sur associated-users)',
    },
    ...(showGoogleHomeApi
      ? [
          {
            label: 'Google Home OAuth (GOOGLE_CLIENT_ID & SECRET)',
            ok:
              env.googleHomeConfigured &&
              (env.googleHomeMode !== 'sdm' || env.googleSdmProjectConfigured),
            detail: googleOAuthDetail,
          },
        ]
      : []),
    {
      label: 'Protection Dashboard (APP_PASSWORD)',
      ok: env.appPasswordConfigured,
      detail: env.appPasswordConfigured ? 'Mot de passe actif' : 'Dashboard actuellement ouvert',
    },
    {
      label: 'Secret cron-job.org (SCHEDULE_SECRET)',
      ok: env.scheduleSecretConfigured,
      detail: env.scheduleSecretConfigured
        ? 'Route /api/schedule/collect protégée par Bearer token'
        : 'Ajoutez SCHEDULE_SECRET pour sécuriser la collecte',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Checklist dynamique */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <h2 className="text-base font-semibold text-white mb-1">
          État de la configuration actuelle
        </h2>
        <p className="text-xs text-slate-400 mb-4">
          Détection automatique des variables d&apos;environnement sur votre instance Vercel ou locale.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {checklist.map((item) => (
            <div
              key={item.label}
              className={`flex items-start gap-3 rounded-xl border p-3.5 ${
                item.ok
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
      </div>

      {/* Étape 1 : Tuya IoT Cloud */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-indigo-500/15 p-2 text-indigo-400">
            <Cloud className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              Étape 1 — Créer le projet dédié sur Tuya IoT Platform (iot.tuya.com)
            </h3>
            <p className="text-xs text-slate-400">
              Plan gratuit « IoT Core » suffisant largement pour un relevé batch toutes les 30 min.
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
              Étape 2 — Créer la base Neon Postgres &amp; pousser le schéma
            </h3>
            <p className="text-xs text-slate-400">
              Tier gratuit 500 Mo sur neon.tech ou via l&apos;onglet Storage de Vercel.
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
            {copiedKey === 'dbpush' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            Copier
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
              Étape 3 — Planifier la collecte toutes les 30 minutes avec cron-job.org
            </h3>
            <p className="text-xs text-slate-400">
              Contourne la limite à 1 cron/jour du plan Hobby de Vercel de façon 100% gratuite.
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
                {copiedKey === 'url' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                Copier
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
                {copiedKey === 'header' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                Copier
              </button>
            </div>
          </div>
        </div>
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
                Étape 4 (Optionnel) — Déroulé opératoire Google Home (MCP ou Nest SDM)
              </h3>
              <p className="text-xs text-slate-400">
                Synchronisez vos appareils Google Home / Nest en 100 % lecture seule et fusionnez
                les doublons Tuya sans duplication.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span
              className={`rounded-full border px-2.5 py-0.5 font-medium ${
                env.googleHomeConfigured
                  ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-700 bg-slate-950 text-slate-400'
              }`}
            >
              OAuth Client : {env.googleHomeConfigured ? 'OK' : 'Manquant'}
            </span>
            <span
              className={`rounded-full border px-2.5 py-0.5 font-medium ${
                env.googleSdmProjectConfigured
                  ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-700 bg-slate-950 text-slate-400'
              }`}
            >
              SDM Project ID : {env.googleSdmProjectConfigured ? 'OK' : 'Non défini'}
            </span>
            <span
              className={`rounded-full border px-2.5 py-0.5 font-medium ${
                env.googleHomeConnected
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
              className={`text-left rounded-xl border p-4 transition ${
                googleGuideMode === 'mcp'
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
              className={`text-left rounded-xl border p-4 transition ${
                googleGuideMode === 'sdm'
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
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                Copier
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
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  Copier
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
                      <Check className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    Copier
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
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  Copier bloc .env
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
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                Copier
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
                  onClick={() => onNavigateTab('devices')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 hover:bg-sky-500/25 px-2.5 py-1 text-[11px] font-medium text-sky-200 transition"
                >
                  Ouvrir « Appareils »
                  <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </div>
            <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-300 leading-relaxed">
              <li>
                Rendez-vous dans l&apos;onglet <strong>Appareils</strong>, carte{' '}
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
