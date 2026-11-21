'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Zap,
  Thermometer,
  LayoutGrid,
  BarChart3,
  Euro,
  Cpu,
  BookOpen,
  RefreshCw,
  LogOut,
  Database,
  Play,
  DoorOpen,
} from 'lucide-react';
import { OverviewTab } from './OverviewTab';
import { EnergyTab } from './EnergyTab';
import { ClimateTab } from './ClimateTab';
import { ContactsTab } from './ContactsTab';
import { TariffsTab } from './TariffsTab';
import { DevicesRoomsTab } from './DevicesRoomsTab';
import { SetupGuideTab } from './SetupGuideTab';
import type { DashboardPayload, TimeRange } from '@/types';

type TabId = 'overview' | 'energy' | 'climate' | 'contacts' | 'tariffs' | 'devices' | 'guide';

interface DashboardAppProps {
  initialData: DashboardPayload;
}

const RANGES: Array<{ id: TimeRange; label: string }> = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7 jours' },
  { id: '30d', label: '30 jours' },
  { id: '365d', label: '12 mois' },
];

export function DashboardApp({ initialData }: DashboardAppProps) {
  const router = useRouter();
  const [data, setData] = useState<DashboardPayload>(initialData);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [range, setRange] = useState<TimeRange>(initialData.range);
  const [roomId, setRoomId] = useState<string>(initialData.selectedRoomId);
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const fetchDashboard = useCallback(
    async (nextRange: TimeRange = range, nextRoomId: string = roomId) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/dashboard?range=${encodeURIComponent(nextRange)}&roomId=${encodeURIComponent(nextRoomId)}`,
          { cache: 'no-store' }
        );
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        if (res.ok) {
          const payload = (await res.json()) as DashboardPayload;
          setData(payload);
        }
      } finally {
        setLoading(false);
      }
    },
    [range, roomId, router]
  );

  async function handleRangeChange(nextRange: TimeRange) {
    setRange(nextRange);
    await fetchDashboard(nextRange, roomId);
  }

  async function handleRoomChange(nextRoomId: string) {
    setRoomId(nextRoomId);
    await fetchDashboard(range, nextRoomId);
  }

  async function handleCollectNow() {
    setCollecting(true);
    setToast(null);
    try {
      const res = await fetch('/api/schedule/collect?trigger=manual', { method: 'POST' });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        log?: { readingsInserted: number; errorMessage: string | null };
      };
      if (!res.ok || !json.ok) {
        setToast(json.log?.errorMessage || json.error || 'Échec de collecte');
      } else {
        setToast(
          `Collecte effectuée : ${json.log?.readingsInserted ?? 0} mesure(s) enregistrée(s).`
        );
        await fetchDashboard(range, roomId);
      }
    } finally {
      setCollecting(false);
      setTimeout(() => setToast(null), 4000);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const lastLog = data.logs[0];

  const tabs: Array<{ id: TabId; label: string; icon: typeof LayoutGrid; badge?: number }> = [
    { id: 'overview', label: 'Synthèse & Pièces', icon: LayoutGrid },
    { id: 'energy', label: 'Énergie & Puissance', icon: BarChart3 },
    { id: 'climate', label: 'Climat (°C / %)', icon: Thermometer },
    {
      id: 'contacts',
      label: 'Ouvertures',
      icon: DoorOpen,
      badge: data.contacts.summary.openCountNow,
    },
    { id: 'tariffs', label: 'Tarifs kWh', icon: Euro },
    { id: 'devices', label: 'Appareils & Pièces', icon: Cpu },
    { id: 'guide', label: 'Guide Setup', icon: BookOpen },
  ];

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#090d16]/85 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white">
                  Tuya Home Energy &amp; Climate
                </h1>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${
                    data.env.mode === 'live'
                      ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                      : 'border-amber-500/30 bg-amber-500/15 text-amber-300'
                  }`}
                >
                  <Database className="h-2.5 w-2.5" />
                  {data.env.mode === 'live' ? 'Neon Postgres' : 'Mode Démo'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {lastLog
                  ? `Dernière collecte (${lastLog.trigger}) : ${new Date(
                      lastLog.executedAt
                    ).toLocaleString('fr-FR')}`
                  : 'Collecte planifiée toutes les 30 minutes'}
              </p>
            </div>
          </div>

          {/* Contrôles droite */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Période */}
            <div className="flex rounded-xl border border-slate-800 bg-slate-900 p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => void handleRangeChange(r.id)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    range === r.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Filtre pièce */}
            <select
              value={roomId}
              onChange={(e) => void handleRoomChange(e.target.value)}
              className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="all">Toutes les pièces</option>
              {data.rooms.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.name}
                </option>
              ))}
            </select>

            <button
              onClick={() => void handleCollectNow()}
              disabled={collecting}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-emerald-300 transition"
            >
              <Play className={`h-3.5 w-3.5 ${collecting ? 'animate-pulse' : ''}`} />
              {collecting ? 'Collecte...' : 'Collecter'}
            </button>

            <button
              onClick={() => void fetchDashboard(range, roomId)}
              disabled={loading}
              title="Rafraîchir l'affichage"
              className="rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 p-2 text-slate-300 transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {data.env.appPasswordConfigured && (
              <button
                onClick={() => void handleLogout()}
                title="Déconnexion"
                className="rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 p-2 text-slate-400 hover:text-rose-300 transition"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Navigation par onglets */}
        <div className="mx-auto max-w-7xl px-4 sm:px-6 flex gap-1 overflow-x-auto border-t border-slate-800/60">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-xs font-medium transition ${
                  active
                    ? 'border-indigo-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.2 text-[10px] font-semibold text-amber-300">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Contenu principal */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-5">
        {data.env.mode === 'demo' && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>Aperçu Démo interactif :</strong> <code>DATABASE_URL</code> n&apos;est pas encore
              configuré. Les graphiques affichent 30 jours de mesures simulées au pas de 30 minutes.
            </span>
            <button
              onClick={() => setActiveTab('guide')}
              className="rounded-lg border border-amber-400/40 bg-amber-400/15 px-3 py-1 font-medium text-amber-100 hover:bg-amber-400/25"
            >
              Configurer Neon &amp; Tuya →
            </button>
          </div>
        )}

        {toast && (
          <div className="rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-4 py-2.5 text-xs text-indigo-200">
            {toast}
          </div>
        )}

        {activeTab === 'overview' && (
          <OverviewTab
            data={data}
            onSelectRoom={(id) => void handleRoomChange(id)}
            onNavigateTab={setActiveTab}
          />
        )}
        {activeTab === 'energy' && <EnergyTab data={data} />}
        {activeTab === 'climate' && <ClimateTab data={data} />}
        {activeTab === 'contacts' && (
          <ContactsTab data={data} onNavigateTab={setActiveTab} />
        )}
        {activeTab === 'tariffs' && (
          <TariffsTab data={data} onRefresh={() => fetchDashboard(range, roomId)} />
        )}
        {activeTab === 'devices' && (
          <DevicesRoomsTab data={data} onRefresh={() => fetchDashboard(range, roomId)} />
        )}
        {activeTab === 'guide' && <SetupGuideTab data={data} />}
      </main>
    </div>
  );
}
