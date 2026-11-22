'use client';

import { useCallback, useEffect, useState } from 'react';
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
  CalendarRange,
  Workflow,
  Home,
  Blinds,
} from 'lucide-react';
import { OverviewTab } from './OverviewTab';
import { EnergyTab } from './EnergyTab';
import { ClimateTab } from './ClimateTab';
import { ContactsTab } from './ContactsTab';
import { CoversTab } from './CoversTab';
import { extractCoverSummary } from '@/lib/covers-utils';
import { AutomationsTab } from './AutomationsTab';
import { TariffsTab } from './TariffsTab';
import { DevicesRoomsTab } from './DevicesRoomsTab';
import { RoomsTab } from './RoomsTab';
import { SetupGuideTab } from './SetupGuideTab';
import type { DashboardPayload, SystemFilter, TabId, TimeRange } from '@/types';

interface DashboardAppProps {
  initialData: DashboardPayload;
}

const RANGES: Array<{ id: Exclude<TimeRange, 'custom'>; label: string }> = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7 jours' },
  { id: '30d', label: '30 jours' },
  { id: '365d', label: '12 mois' },
];

function toLocalDateTimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DashboardApp({ initialData }: DashboardAppProps) {
  const router = useRouter();
  const [data, setData] = useState<DashboardPayload>(initialData);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [range, setRange] = useState<TimeRange>(initialData.range);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [customFromInput, setCustomFromInput] = useState<string>(() => {
    if (initialData.customFrom) return toLocalDateTimeInput(new Date(initialData.customFrom));
    return toLocalDateTimeInput(new Date(Date.now() - 24 * 3_600_000));
  });
  const [customToInput, setCustomToInput] = useState<string>(() => {
    if (initialData.customTo) return toLocalDateTimeInput(new Date(initialData.customTo));
    return toLocalDateTimeInput(new Date());
  });
  const [appliedCustom, setAppliedCustom] = useState<{ from: string; to: string } | null>(() =>
    initialData.customFrom && initialData.customTo
      ? { from: initialData.customFrom, to: initialData.customTo }
      : null
  );
  const [roomId, setRoomId] = useState<string>(initialData.selectedRoomId);
  const [devicesRoomFilter, setDevicesRoomFilter] = useState<string | null>(null);
  const [systemFilter, setSystemFilter] = useState<SystemFilter>(
    initialData.selectedSystem ?? 'all'
  );
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    const ghStatus = params.get('gh');
    const ghMode = params.get('gh_mode');
    const ghError = params.get('gh_error');
    const hcStatus = params.get('hc');
    const hcEnv = params.get('hc_env');
    const hcError = params.get('hc_error');

    if (tabParam === 'devices') {
      setActiveTab('devices');
    } else if (tabParam === 'rooms') {
      setActiveTab('rooms');
    }
    if (ghStatus === 'connected') {
      const targetLabel = tabParam === 'rooms' ? 'Pièces' : 'Appareils';
      setToast(
        `Google Home connecté (${(ghMode || 'mcp').toUpperCase()}). Cliquez sur « Synchroniser » dans ${targetLabel}.`
      );
      setTimeout(() => setToast(null), 6000);
    } else if (ghError) {
      setToast(`Erreur Google Home : ${ghError}`);
      setTimeout(() => setToast(null), 7000);
    } else if (hcStatus === 'connected') {
      setToast(
        `Siemens Home Connect connecté (${(hcEnv || 'prod').toUpperCase()}). Cliquez sur « Synchroniser Home Connect ».`
      );
      setTimeout(() => setToast(null), 6000);
    } else if (hcError) {
      setToast(`Erreur Siemens Home Connect : ${hcError}`);
      setTimeout(() => setToast(null), 7000);
    }

    if (tabParam || ghStatus || ghError || hcStatus || hcError) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const fetchDashboard = useCallback(
    async (
      nextRange: TimeRange = range,
      nextRoomId: string = roomId,
      customBounds: { from: string; to: string } | null = appliedCustom,
      nextSystem: SystemFilter = systemFilter
    ) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          range: nextRange,
          roomId: nextRoomId,
          system: nextSystem,
        });
        if (nextRange === 'custom' && customBounds) {
          params.set('from', customBounds.from);
          params.set('to', customBounds.to);
        }
        const res = await fetch(`/api/dashboard?${params.toString()}`, {
          cache: 'no-store',
        });
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
    [range, roomId, appliedCustom, systemFilter, router]
  );

  async function handleRangeChange(nextRange: Exclude<TimeRange, 'custom'>) {
    setRange(nextRange);
    setShowCustomPicker(false);
    await fetchDashboard(nextRange, roomId, null, systemFilter);
  }

  async function applyCustomBounds(fromLocal: string, toLocal: string) {
    const d1 = new Date(fromLocal);
    const d2 = new Date(toLocal);
    if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return;
    const bounds = { from: d1.toISOString(), to: d2.toISOString() };
    setAppliedCustom(bounds);
    setRange('custom');
    setShowCustomPicker(false);
    await fetchDashboard('custom', roomId, bounds, systemFilter);
  }

  function applyQuickCustomPreset(preset: 'today' | 'yesterday' | 'thisMonth' | 'last7d') {
    const now = new Date();
    let fromDate: Date;
    let toDate: Date = now;

    if (preset === 'today') {
      fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    } else if (preset === 'yesterday') {
      fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
      toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 0);
    } else if (preset === 'thisMonth') {
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    } else {
      fromDate = new Date(now.getTime() - 7 * 24 * 3_600_000);
    }

    const fromStr = toLocalDateTimeInput(fromDate);
    const toStr = toLocalDateTimeInput(toDate);
    setCustomFromInput(fromStr);
    setCustomToInput(toStr);
    void applyCustomBounds(fromStr, toStr);
  }

  async function handleRoomChange(nextRoomId: string) {
    setRoomId(nextRoomId);
    await fetchDashboard(range, nextRoomId, appliedCustom, systemFilter);
  }

  async function handleSystemChange(nextSystem: SystemFilter) {
    setSystemFilter(nextSystem);
    await fetchDashboard(range, roomId, appliedCustom, nextSystem);
  }

  async function handleResetGlobalFilters() {
    setRoomId('all');
    setSystemFilter('all');
    await fetchDashboard(range, 'all', appliedCustom, 'all');
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

  function handleOpenGoogleGuide() {
    setActiveTab('guide');
    setTimeout(() => {
      document
        .getElementById('setup-google-home')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }

  function handleOpenHomeConnectGuide() {
    setActiveTab('guide');
    setTimeout(() => {
      const detailsEl = document.getElementById('setup-home-connect-details');
      if (detailsEl instanceof HTMLDetailsElement) detailsEl.open = true;
      document
        .getElementById('setup-home-connect')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }

  function handleOpenSomfyGuide() {
    setActiveTab('guide');
    setTimeout(() => {
      const detailsEl = document.getElementById('setup-somfy-details');
      if (detailsEl instanceof HTMLDetailsElement) detailsEl.open = true;
      document
        .getElementById('setup-somfy')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }

  function handleOpenRoomDevices(targetRoomId: string) {
    setDevicesRoomFilter(targetRoomId);
    setActiveTab('devices');
  }

  const lastLog = data.logs[0];
  const activeSystem = data.selectedSystem;
  const systemScopedDevices =
    activeSystem === 'all'
      ? data.devices
      : data.devices.filter((d) => d.systems.includes(activeSystem));
  const roomDeviceCounts = new Map<number, number>();
  for (const dev of systemScopedDevices) {
    if (dev.roomId !== null) {
      roomDeviceCounts.set(dev.roomId, (roomDeviceCounts.get(dev.roomId) ?? 0) + 1);
    }
  }
  const openCoversCount = data.devices.filter((d) => {
    if (data.selectedSystem !== 'all' && !d.systems.includes(data.selectedSystem)) {
      return false;
    }
    if (data.selectedRoomId !== 'all' && String(d.roomId) !== data.selectedRoomId) {
      return false;
    }
    const cover = extractCoverSummary(d);
    return cover !== null && (cover.state === 'open' || cover.state === 'partial');
  }).length;

  const tabs: Array<{
    id: TabId;
    label: string;
    title?: string;
    icon: typeof LayoutGrid;
    badge?: number;
  }> = [
    { id: 'overview', label: 'Synthèse', title: 'Synthèse & Pièces', icon: LayoutGrid },
    { id: 'energy', label: 'Énergie', title: 'Énergie & Puissance', icon: BarChart3 },
    { id: 'climate', label: 'Climat', title: 'Climat (°C / %)', icon: Thermometer },
    {
      id: 'contacts',
      label: 'Ouvertures',
      icon: DoorOpen,
      badge: data.contacts.summary.openCountNow,
    },
    {
      id: 'covers',
      label: 'Volets & Stores',
      icon: Blinds,
      badge: openCoversCount > 0 ? openCoversCount : undefined,
    },
    {
      id: 'automations',
      label: 'Automatisations',
      icon: Workflow,
      badge: data.automations.summary.warningCount,
    },
    { id: 'devices', label: 'Appareils', icon: Cpu },
    { id: 'rooms', label: 'Pièces', icon: Home },
    { id: 'tariffs', label: 'Tarifs kWh', icon: Euro },
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
                  Home Cockpit · Multi-Vendors
                </h1>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${data.env.mode === 'live'
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
            <div className="flex flex-wrap rounded-xl border border-slate-800 bg-slate-900 p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => void handleRangeChange(r.id)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${range === r.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                    }`}
                >
                  {r.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowCustomPicker((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition ${range === 'custom' || showCustomPicker
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
                  }`}
              >
                <CalendarRange className="h-3.5 w-3.5" />
                Personnalisé
              </button>
            </div>

            {/* Filtre système */}
            <select
              value={systemFilter}
              onChange={(e) => void handleSystemChange(e.target.value as SystemFilter)}
              aria-label="Filtrer par système"
              className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="all">Tous les systèmes ({data.devices.length})</option>
              {data.vendors
                .filter((v) => {
                  if (v.vendor === 'tuya' || systemFilter === v.vendor) return true;
                  if (v.vendor === 'kasa') {
                    return data.env.kasaConfigured || (data.env.mode === 'live' && v.devicesCount > 0);
                  }
                  if (v.vendor === 'home_connect') {
                    return (
                      data.env.homeConnectConfigured ||
                      (data.env.mode === 'live' && v.devicesCount > 0)
                    );
                  }
                  if (v.vendor === 'somfy') {
                    return (
                      data.env.somfyConfigured ||
                      (data.env.mode === 'live' && v.devicesCount > 0)
                    );
                  }
                  if (v.vendor === 'google_home') {
                    return (
                      data.env.googleHomeApiEnabled ||
                      (data.env.mode === 'live' && v.devicesCount > 0)
                    );
                  }
                  return true;
                })
                .map((v) => (
                  <option key={v.vendor} value={v.vendor}>
                    {v.label} ({v.devicesCount})
                  </option>
                ))}
            </select>

            {/* Filtre pièce */}
            <select
              value={roomId}
              onChange={(e) => void handleRoomChange(e.target.value)}
              aria-label="Filtrer par pièce"
              className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="all">Toutes les pièces ({systemScopedDevices.length})</option>
              {data.rooms.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.name} ({roomDeviceCounts.get(r.id) ?? 0})
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

        {/* Sélecteur de créneau personnalisé */}
        {showCustomPicker && (
          <div className="mx-auto max-w-7xl px-4 sm:px-6 pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-500/30 bg-slate-900/95 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-400 font-medium">Du</span>
                <input
                  type="datetime-local"
                  value={customFromInput}
                  onChange={(e) => setCustomFromInput(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />
                <span className="text-slate-400 font-medium">Au</span>
                <input
                  type="datetime-local"
                  value={customToInput}
                  onChange={(e) => setCustomToInput(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void applyCustomBounds(customFromInput, customToInput)}
                  className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1 font-medium text-white transition"
                >
                  Appliquer
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => applyQuickCustomPreset('today')}
                  className="rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300"
                >
                  Aujourd&apos;hui
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickCustomPreset('yesterday')}
                  className="rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300"
                >
                  Hier
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickCustomPreset('last7d')}
                  className="rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300"
                >
                  7 derniers jours
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickCustomPreset('thisMonth')}
                  className="rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300"
                >
                  Ce mois-ci
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Navigation par onglets */}
        <nav
          aria-label="Navigation principale"
          className="mx-auto max-w-7xl px-4 sm:px-6 flex flex-wrap items-center gap-x-1 gap-y-0.5 border-t border-slate-800/60"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.title ?? tab.label}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2.5 text-xs font-medium transition ${active
                  ? 'border-indigo-500 bg-indigo-500/10 rounded-t-lg text-white'
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
        </nav>
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
        {activeTab === 'covers' && (
          <CoversTab
            data={data}
            onNavigateTab={setActiveTab}
            onResetGlobalFilters={() => void handleResetGlobalFilters()}
          />
        )}
        {activeTab === 'automations' && (
          <AutomationsTab data={data} onRefresh={() => fetchDashboard(range, roomId)} />
        )}
        {activeTab === 'devices' && (
          <DevicesRoomsTab
            data={data}
            onRefresh={() => fetchDashboard(range, roomId)}
            initialRoomFilter={devicesRoomFilter}
            onOpenRoomsTab={() => setActiveTab('rooms')}
            onOpenGoogleGuide={data.env.googleHomeApiEnabled ? handleOpenGoogleGuide : undefined}
            onOpenHomeConnectGuide={
              data.env.homeConnectConfigured ? handleOpenHomeConnectGuide : undefined
            }
            onOpenSomfyGuide={data.env.somfyConfigured ? handleOpenSomfyGuide : undefined}
          />
        )}
        {activeTab === 'rooms' && (
          <RoomsTab
            data={data}
            onRefresh={() => fetchDashboard(range, roomId)}
            onOpenRoomDevices={handleOpenRoomDevices}
            onOpenGoogleGuide={data.env.googleHomeApiEnabled ? handleOpenGoogleGuide : undefined}
          />
        )}
        {activeTab === 'tariffs' && (
          <TariffsTab data={data} onRefresh={() => fetchDashboard(range, roomId)} />
        )}
        {activeTab === 'guide' && <SetupGuideTab data={data} onNavigateTab={setActiveTab} />}
      </main>
    </div>
  );
}
