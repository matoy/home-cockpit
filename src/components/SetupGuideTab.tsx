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
} from 'lucide-react';
import type { DashboardPayload } from '@/types';

interface SetupGuideTabProps {
  data: DashboardPayload;
}

export function SetupGuideTab({ data }: SetupGuideTabProps) {
  const { env } = data;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://votre-app.vercel.app';
  const scheduleUrl = `${origin}/api/schedule/collect`;

  function copyText(key: string, text: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    }
  }

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
              <li><strong>IoT Core</strong> (indispensable pour lire les statuts en batch)</li>
              <li><strong>Authorization Token Management</strong></li>
              <li><strong>Smart Home Family Management</strong> (requis pour importer vos pièces et affectations Smart Life)</li>
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
            Exécutez une fois la commande suivante pour créer les 5 tables (<code>rooms</code>,{' '}
            <code>devices</code>, <code>metric_readings</code>, <code>tariff_periods</code>,{' '}
            <code>collection_logs</code>) :
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
    </div>
  );
}
