'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
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
  Wind,
  ShieldAlert,
  Plug,
  User,
  HeartPulse,
} from 'lucide-react';
import { OverviewTab } from './OverviewTab';
import { extractCoverSummary } from '@/lib/covers-utils';
import { computeHomeHealth } from '@/lib/home-health';
import { extractDaikinSummary, isDaikinHvacDevice } from '@/lib/vendors/daikin-display';
import { extractXSenseSummary, isXSenseSecurityDevice } from '@/lib/vendors/xsense-display';
import { extractXiaomiSummary, isXiaomiSecurityOrHomeDevice } from '@/lib/vendors/xiaomi-display';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { useI18n } from './I18nProvider';
import { AlertBanner, Button } from './ui';
import type { SessionUser } from '@/lib/auth';
import type { DashboardPayload, SystemFilter, TabId, TimeRange } from '@/types';

function TabLoadingFallback() {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 animate-pulse space-y-4">
      <div className="h-5 w-48 rounded bg-slate-800" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="h-24 rounded-xl bg-slate-800/70" />
        <div className="h-24 rounded-xl bg-slate-800/70" />
        <div className="h-24 rounded-xl bg-slate-800/70" />
      </div>
      <div className="h-48 rounded-xl bg-slate-800/50" />
    </div>
  );
}

const EnergyTab = dynamic(() => import('./EnergyTab').then((m) => m.EnergyTab), {
  loading: () => <TabLoadingFallback />,
});
const HealthTab = dynamic(() => import('./HealthTab').then((m) => m.HealthTab), {
  loading: () => <TabLoadingFallback />,
});
const ClimateTab = dynamic(() => import('./ClimateTab').then((m) => m.ClimateTab), {
  loading: () => <TabLoadingFallback />,
});
const ContactsTab = dynamic(() => import('./ContactsTab').then((m) => m.ContactsTab), {
  loading: () => <TabLoadingFallback />,
});
const CoversTab = dynamic(() => import('./CoversTab').then((m) => m.CoversTab), {
  loading: () => <TabLoadingFallback />,
});
const HvacTab = dynamic(() => import('./HvacTab').then((m) => m.HvacTab), {
  loading: () => <TabLoadingFallback />,
});
const SecurityTab = dynamic(() => import('./SecurityTab').then((m) => m.SecurityTab), {
  loading: () => <TabLoadingFallback />,
});
const AutomationsTab = dynamic(() => import('./AutomationsTab').then((m) => m.AutomationsTab), {
  loading: () => <TabLoadingFallback />,
});
const TariffsTab = dynamic(() => import('./TariffsTab').then((m) => m.TariffsTab), {
  loading: () => <TabLoadingFallback />,
});
const DevicesRoomsTab = dynamic(
  () => import('./DevicesRoomsTab').then((m) => m.DevicesRoomsTab),
  { loading: () => <TabLoadingFallback /> }
);
const RoomsTab = dynamic(() => import('./RoomsTab').then((m) => m.RoomsTab), {
  loading: () => <TabLoadingFallback />,
});
const SystemsTab = dynamic(() => import('./SystemsTab').then((m) => m.SystemsTab), {
  loading: () => <TabLoadingFallback />,
});
const SetupGuideTab = dynamic(() => import('./SetupGuideTab').then((m) => m.SetupGuideTab), {
  loading: () => <TabLoadingFallback />,
});

const AUTO_REFRESH_STORAGE_KEY = 'hc_auto_refresh_ms';

interface DashboardAppProps {
  initialData: DashboardPayload;
  initialTab?: TabId;
  sessionUser?: SessionUser | null;
}

function toLocalDateTimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DashboardApp({
  initialData,
  initialTab = 'overview',
  sessionUser = null,
}: DashboardAppProps) {
  const router = useRouter();
  const { t, locale, formatDateTime } = useI18n();
  const [data, setData] = useState<DashboardPayload>(initialData);
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [autoRefreshMs, setAutoRefreshMs] = useState<number>(0);
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
  const fetchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      fetchAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let stored = 0;
    try {
      const raw = window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
      const parsed = raw ? Number(raw) : 0;
      if (parsed === 60_000 || parsed === 300_000 || parsed === 900_000) {
        stored = parsed;
      }
    } catch {
      stored = 0;
    }
    if (stored <= 0) return;
    const timer = window.setTimeout(() => {
      setAutoRefreshMs(stored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

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
    const dkStatus = params.get('dk');
    const dkError = params.get('dk_error');

    const hasOAuthParams = Boolean(
      ghStatus || ghError || hcStatus || hcError || dkStatus || dkError
    );
    if (!hasOAuthParams) return;

    let cancelled = false;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;

    const initTimer = window.setTimeout(() => {
      if (cancelled) return;

      if (tabParam === 'systems') {
        setActiveTab('systems');
      } else if (tabParam === 'devices') {
        setActiveTab('devices');
      } else if (tabParam === 'rooms') {
        setActiveTab('rooms');
      } else if (ghStatus || ghError || hcStatus || hcError || dkStatus || dkError) {
        setActiveTab('systems');
      }

      if (ghStatus === 'connected') {
        const targetLabel =
          tabParam === 'rooms'
            ? t('nav.rooms')
            : tabParam === 'devices'
              ? t('nav.devices')
              : t('nav.systems');
        setToast(
          t('header.oauthGhConnected', {
            mode: (ghMode || 'mcp').toUpperCase(),
            target: targetLabel,
          })
        );
        toastTimer = setTimeout(() => setToast(null), 6000);
      } else if (ghError) {
        setToast(t('header.oauthGhError', { error: ghError }));
        toastTimer = setTimeout(() => setToast(null), 7000);
      } else if (hcStatus === 'connected') {
        setToast(t('header.oauthHcConnected', { env: (hcEnv || 'prod').toUpperCase() }));
        toastTimer = setTimeout(() => setToast(null), 6000);
      } else if (hcError) {
        setToast(t('header.oauthHcError', { error: hcError }));
        toastTimer = setTimeout(() => setToast(null), 7000);
      } else if (dkStatus === 'connected') {
        setToast(t('header.oauthDkConnected'));
        toastTimer = setTimeout(() => setToast(null), 6000);
      } else if (dkError) {
        setToast(t('header.oauthDkError', { error: dkError }));
        toastTimer = setTimeout(() => setToast(null), 7000);
      }

      window.history.replaceState({}, '', window.location.pathname);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(initTimer);
      if (toastTimer) clearTimeout(toastTimer);
    };
  }, [t]);

  const fetchDashboard = useCallback(
    async (
      nextRange: TimeRange = range,
      nextRoomId: string = roomId,
      customBounds: { from: string; to: string } | null = appliedCustom,
      nextSystem: SystemFilter = systemFilter
    ) => {
      fetchAbortRef.current?.abort();
      const controller = new AbortController();
      fetchAbortRef.current = controller;
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
          signal: controller.signal,
        });
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        if (res.ok) {
          const payload = (await res.json()) as DashboardPayload;
          if (fetchAbortRef.current === controller) {
            setData(payload);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
      } finally {
        if (fetchAbortRef.current === controller) {
          setLoading(false);
        }
      }
    },
    [range, roomId, appliedCustom, systemFilter, router]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const currentParams = new URLSearchParams(window.location.search);
    if (
      currentParams.has('gh') ||
      currentParams.has('gh_error') ||
      currentParams.has('hc') ||
      currentParams.has('hc_error') ||
      currentParams.has('dk') ||
      currentParams.has('dk_error')
    ) {
      return;
    }

    const nextParams = new URLSearchParams();
    if (activeTab !== 'overview') nextParams.set('tab', activeTab);
    if (range !== '24h') nextParams.set('range', range);
    if (range === 'custom' && appliedCustom) {
      nextParams.set('from', appliedCustom.from);
      nextParams.set('to', appliedCustom.to);
    }
    if (roomId !== 'all') nextParams.set('roomId', roomId);
    if (systemFilter !== 'all') nextParams.set('system', systemFilter);

    const qs = nextParams.toString();
    const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(window.history.state, '', nextUrl);
    }
  }, [activeTab, range, roomId, systemFilter, appliedCustom]);

  useEffect(() => {
    if (autoRefreshMs <= 0) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !loading) {
        void fetchDashboard(range, roomId, appliedCustom, systemFilter);
      }
    }, autoRefreshMs);
    return () => window.clearInterval(id);
  }, [autoRefreshMs, loading, fetchDashboard, range, roomId, appliedCustom, systemFilter]);

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
        setToast(json.log?.errorMessage || json.error || t('header.collectFailed'));
      } else {
        setToast(t('header.collectSuccess', { count: json.log?.readingsInserted ?? 0 }));
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

  function handleOpenKasaGuide() {
    setActiveTab('guide');
    setTimeout(() => {
      const detailsEl = document.getElementById('setup-kasa-details');
      if (detailsEl instanceof HTMLDetailsElement) detailsEl.open = true;
      document
        .getElementById('setup-kasa-cloud')
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

  function handleOpenDaikinGuide() {
    setActiveTab('guide');
    setTimeout(() => {
      const detailsEl = document.getElementById('setup-daikin-details');
      if (detailsEl instanceof HTMLDetailsElement) detailsEl.open = true;
      document
        .getElementById('setup-daikin')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }

  function handleOpenXSenseGuide() {
    setActiveTab('guide');
    setTimeout(() => {
      const detailsEl = document.getElementById('setup-xsense-details');
      if (detailsEl instanceof HTMLDetailsElement) detailsEl.open = true;
      document
        .getElementById('setup-xsense')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }

  function handleOpenXiaomiGuide() {
    setActiveTab('guide');
    setTimeout(() => {
      const detailsEl = document.getElementById('setup-xiaomi-details');
      if (detailsEl instanceof HTMLDetailsElement) detailsEl.open = true;
      document
        .getElementById('setup-xiaomi')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }

  function handleOpenRoomDevices(targetRoomId: string) {
    setDevicesRoomFilter(targetRoomId);
    setActiveTab('devices');
  }

  function handleOpenBackupSection() {
    setActiveTab('guide');
    setTimeout(() => {
      document
        .getElementById('setup-backup-restore')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }

  const lastLog = data.logs[0];
  const {
    connectedSystemsCount,
    systemScopedDevices,
    roomDeviceCounts,
    openCoversCount,
    activeHvacCount,
    activeSecurityAlertsCount,
  } = useMemo(() => {
    const connectedCount = data.vendors.filter((v) => v.connected).length;
    const activeSystem = data.selectedSystem;
    const scopedDevices =
      activeSystem === 'all'
        ? data.devices
        : data.devices.filter((d) => d.systems.includes(activeSystem));

    const roomCounts = new Map<number, number>();
    for (const dev of scopedDevices) {
      if (dev.roomId !== null) {
        roomCounts.set(dev.roomId, (roomCounts.get(dev.roomId) ?? 0) + 1);
      }
    }

    let coversOpen = 0;
    let hvacActive = 0;
    let securityAlerts = 0;

    for (const d of data.devices) {
      if (data.selectedSystem !== 'all' && !d.systems.includes(data.selectedSystem)) {
        continue;
      }
      if (data.selectedRoomId !== 'all' && String(d.roomId) !== data.selectedRoomId) {
        continue;
      }

      const cover = extractCoverSummary(d, locale);
      if (cover !== null && (cover.state === 'open' || cover.state === 'partial')) {
        coversOpen++;
      }

      if (isDaikinHvacDevice(d)) {
        const summary = extractDaikinSummary(d.lastRawStatus, locale);
        if (summary?.isOn) {
          hvacActive++;
        }
      }

      if (isXSenseSecurityDevice(d) || isXiaomiSecurityOrHomeDevice(d)) {
        const xs = extractXSenseSummary(d.lastRawStatus, locale);
        const mi = extractXiaomiSummary(d.lastRawStatus, locale);
        if (xs?.isAlert || mi?.isAlert) {
          securityAlerts++;
        }
      }
    }

    return {
      connectedSystemsCount: connectedCount,
      systemScopedDevices: scopedDevices,
      roomDeviceCounts: roomCounts,
      openCoversCount: coversOpen,
      activeHvacCount: hvacActive,
      activeSecurityAlertsCount: securityAlerts,
    };
  }, [data.devices, data.vendors, data.selectedSystem, data.selectedRoomId, locale]);

  const healthIssuesCount = useMemo(
    () => computeHomeHealth(data, locale).totalIssues,
    [data, locale]
  );

  const rangeOptions: Array<{ id: Exclude<TimeRange, 'custom'>; label: string }> = [
    { id: '24h', label: t('header.range24h') },
    { id: '7d', label: t('header.range7d') },
    { id: '30d', label: t('header.range30d') },
    { id: '365d', label: t('header.range365d') },
  ];

  type NavTabItem = {
    id: TabId;
    label: string;
    title?: string;
    icon: typeof LayoutGrid;
    badge?: number;
  };

  const tabGroups: Array<{ id: string; label: string; tabs: NavTabItem[] }> = [
    {
      id: 'monitoring',
      label: t('nav.groupMonitoring'),
      tabs: [
        { id: 'overview', label: t('nav.overview'), icon: LayoutGrid },
        {
          id: 'health',
          label: t('nav.health'),
          icon: HeartPulse,
          badge: healthIssuesCount > 0 ? healthIssuesCount : undefined,
        },
        { id: 'energy', label: t('nav.energy'), icon: BarChart3 },
        {
          id: 'climate',
          label: t('nav.climate'),
          icon: Thermometer,
          badge: data.kpis.climateAlertsCount > 0 ? data.kpis.climateAlertsCount : undefined,
        },
        {
          id: 'contacts',
          label: t('nav.contacts'),
          icon: DoorOpen,
          badge: data.contacts.summary.openCountNow,
        },
      ],
    },
    {
      id: 'equipment',
      label: t('nav.groupEquipment'),
      tabs: [
        {
          id: 'covers',
          label: t('nav.covers'),
          icon: Blinds,
          badge: openCoversCount > 0 ? openCoversCount : undefined,
        },
        {
          id: 'hvac',
          label: t('nav.hvac'),
          icon: Wind,
          badge: activeHvacCount > 0 ? activeHvacCount : undefined,
        },
        {
          id: 'security',
          label: t('nav.security'),
          icon: ShieldAlert,
          badge: activeSecurityAlertsCount > 0 ? activeSecurityAlertsCount : undefined,
        },
      ],
    },
    {
      id: 'management',
      label: t('nav.groupManagement'),
      tabs: [
        {
          id: 'devices',
          label: t('nav.devices'),
          icon: Cpu,
          badge: data.devices.length > 0 ? data.devices.length : undefined,
        },
        {
          id: 'rooms',
          label: t('nav.rooms'),
          icon: Home,
          badge: data.rooms.length > 0 ? data.rooms.length : undefined,
        },
        {
          id: 'systems',
          label: t('nav.systems'),
          icon: Plug,
          badge: connectedSystemsCount > 0 ? connectedSystemsCount : undefined,
        },
        {
          id: 'automations',
          label: t('nav.automations'),
          icon: Workflow,
          badge: data.automations.summary.warningCount,
        },
        { id: 'tariffs', label: t('nav.tariffs'), icon: Euro },
        { id: 'guide', label: t('nav.guide'), icon: BookOpen },
      ],
    },
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
                  {t('header.appTitle')}
                </h1>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${data.env.mode === 'live'
                    ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                    : 'border-amber-500/30 bg-amber-500/15 text-amber-300'
                    }`}
                >
                  <Database className="h-2.5 w-2.5" />
                  {data.env.mode === 'live' ? t('common.liveMode') : t('common.demoMode')}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {lastLog
                  ? `${t('header.lastCollection', { date: formatDateTime(lastLog.executedAt) })} (${lastLog.trigger})`
                  : t('common.noRecentSync')}
              </p>
            </div>
          </div>

          {/* Contrôles droite */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Période */}
            <div className="flex flex-wrap rounded-xl border border-slate-800 bg-slate-900 p-0.5">
              {rangeOptions.map((r) => (
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
                {t('header.rangeCustom')}
              </button>
            </div>

            {/* Filtre système */}
            <select
              value={systemFilter}
              onChange={(e) => void handleSystemChange(e.target.value as SystemFilter)}
              aria-label={t('header.filterSystemAria')}
              className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="all">{t('header.allSystemsCount', { count: data.devices.length })}</option>
              {data.vendors
                .filter((v) => {
                  if (v.vendor === 'tuya' || systemFilter === v.vendor) return true;
                  if (v.vendor === 'google_home') {
                    return (
                      data.env.googleHomeApiEnabled ||
                      (data.env.mode === 'live' && v.devicesCount > 0)
                    );
                  }
                  return (
                    v.configured ||
                    v.connected ||
                    (data.env.mode === 'live' && v.devicesCount > 0)
                  );
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
              aria-label={t('header.filterRoomAria')}
              className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="all">{t('header.allRoomsCount', { count: systemScopedDevices.length })}</option>
              {data.rooms.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.name} ({roomDeviceCounts.get(r.id) ?? 0})
                </option>
              ))}
            </select>

            <LanguageSwitcher compact />
            <ThemeToggle />

            <button
              onClick={() => void handleCollectNow()}
              disabled={collecting}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-emerald-300 transition"
            >
              <Play className={`h-3.5 w-3.5 ${collecting ? 'animate-pulse' : ''}`} />
              {collecting ? t('header.collecting') : t('header.collectNow')}
            </button>

            <button
              onClick={() => void fetchDashboard(range, roomId)}
              disabled={loading}
              title={t('header.refreshTitle')}
              className="rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 p-2 text-slate-300 transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <select
              value={String(autoRefreshMs)}
              onChange={(e) => {
                const next = Number(e.target.value);
                setAutoRefreshMs(next);
                try {
                  window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(next));
                } catch {
                  // ignore storage errors
                }
              }}
              aria-label={t('header.autoRefreshAria')}
              title={t('header.autoRefreshAria')}
              className="rounded-xl border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none"
            >
              <option value="0">{t('header.autoRefreshOff')}</option>
              <option value="60000">{t('header.autoRefresh1m')}</option>
              <option value="300000">{t('header.autoRefresh5m')}</option>
              <option value="900000">{t('header.autoRefresh15m')}</option>
            </select>

            {(sessionUser?.name || sessionUser?.email) && (
              <span
                title={t('header.signedInAs', {
                  user: sessionUser.email || sessionUser.name || 'SSO',
                })}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-300 max-w-[180px] truncate"
              >
                <User className="h-3 w-3 text-indigo-400 shrink-0" />
                <span className="truncate">{sessionUser.name || sessionUser.email}</span>
              </span>
            )}

            {(data.env.appPasswordConfigured || data.env.oidcConfigured || Boolean(sessionUser)) && (
              <button
                onClick={() => void handleLogout()}
                title={t('header.logoutTitle')}
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
                <span className="text-slate-400 font-medium">{t('header.from')}</span>
                <input
                  type="datetime-local"
                  value={customFromInput}
                  onChange={(e) => setCustomFromInput(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />
                <span className="text-slate-400 font-medium">{t('header.to')}</span>
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
                  {t('header.apply')}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => applyQuickCustomPreset('today')}
                  className="rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300"
                >
                  {t('header.presetToday')}
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickCustomPreset('yesterday')}
                  className="rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300"
                >
                  {t('header.presetYesterday')}
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickCustomPreset('last7d')}
                  className="rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300"
                >
                  {t('header.presetLast7d')}
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickCustomPreset('thisMonth')}
                  className="rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300"
                >
                  {t('header.presetThisMonth')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Navigation par onglets */}
        <nav
          aria-label={t('nav.ariaLabel')}
          className="mx-auto max-w-7xl px-4 sm:px-6 py-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-slate-800/60"
        >
          {tabGroups.map((group) => (
            <div
              key={group.id}
              className="flex flex-wrap items-center gap-x-0.5 gap-y-0.5"
            >
              <span className="hidden xl:inline-flex items-center justify-center min-w-[82px] rounded-md border border-slate-800/80 bg-slate-900/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-1 select-none shrink-0">
                {group.label}
              </span>
              {group.tabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    title={tab.title ?? tab.label}
                    className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-xs font-medium transition ${active
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
            </div>
          ))}
        </nav>
      </header>

      {/* Contenu principal */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-5">
        {data.env.mode === 'demo' && (
          <AlertBanner
            tone="warning"
            className="rounded-2xl px-4 py-3"
            action={
              <Button
                size="sm"
                onClick={() => setActiveTab('guide')}
                className="border-amber-400/40 bg-amber-400/15 text-amber-100 hover:bg-amber-400/25"
              >
                {t('common.openGuideSetup')}
              </Button>
            }
          >
            <strong>{t('header.demoBannerTitle')}</strong> {t('header.demoBannerBody')}
          </AlertBanner>
        )}

        {toast && <AlertBanner tone="info">{toast}</AlertBanner>}

        {activeTab === 'overview' && (
          <OverviewTab
            data={data}
            onSelectRoom={(id) => void handleRoomChange(id)}
            onNavigateTab={setActiveTab}
          />
        )}
        {activeTab === 'health' && (
          <HealthTab
            data={data}
            onNavigateTab={setActiveTab}
            onRefresh={() => fetchDashboard(range, roomId)}
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
        {activeTab === 'hvac' && (
          <HvacTab
            data={data}
            onNavigateTab={setActiveTab}
            onResetGlobalFilters={() => void handleResetGlobalFilters()}
          />
        )}
        {activeTab === 'security' && (
          <SecurityTab
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
            onOpenSystemsTab={() => setActiveTab('systems')}
            onOpenBackupSection={handleOpenBackupSection}
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
        {activeTab === 'systems' && (
          <SystemsTab
            data={data}
            onRefresh={() => fetchDashboard(range, roomId)}
            onOpenDevicesTab={() => setActiveTab('devices')}
            onOpenKasaGuide={handleOpenKasaGuide}
            onOpenHomeConnectGuide={handleOpenHomeConnectGuide}
            onOpenSomfyGuide={handleOpenSomfyGuide}
            onOpenDaikinGuide={handleOpenDaikinGuide}
            onOpenXSenseGuide={handleOpenXSenseGuide}
            onOpenXiaomiGuide={handleOpenXiaomiGuide}
            onOpenGoogleGuide={handleOpenGoogleGuide}
          />
        )}
        {activeTab === 'tariffs' && (
          <TariffsTab data={data} onRefresh={() => fetchDashboard(range, roomId)} />
        )}
        {activeTab === 'guide' && (
          <SetupGuideTab
            data={data}
            onNavigateTab={setActiveTab}
            onRefresh={() => fetchDashboard(range, roomId)}
          />
        )}
      </main>
    </div>
  );
}
