'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  RefreshCw,
  Plus,
  Trash2,
  Pencil,
  Sliders,
  CheckCircle2,
  AlertCircle,
  X,
  Home,
  Wifi,
  WifiOff,
  Clock,
  Layers,
  Link2,
  GitMerge,
  Unlink,
  ExternalLink,
  Search,
  BookOpen,
  ArrowRight,
} from 'lucide-react';
import { VENDOR_IDS, VENDOR_REGISTRY } from '@/lib/vendors/registry';
import type {
  DashboardPayload,
  DeviceCategory,
  DeviceRecord,
  DpConfig,
  EnergyMode,
  GoogleHomeMode,
  SystemFilter,
  VendorId,
} from '@/types';

interface DevicesRoomsTabProps {
  data: DashboardPayload;
  onRefresh: () => Promise<void>;
  initialRoomFilter?: string | null;
  onOpenRoomsTab?: () => void;
  onOpenGoogleGuide?: () => void;
}

const SCALE_OPTIONS = [
  { label: '× 1 (brut)', value: 1 },
  { label: '÷ 10 (× 0.1)', value: 0.1 },
  { label: '÷ 100 (× 0.01)', value: 0.01 },
  { label: '÷ 1000 (× 0.001)', value: 0.001 },
];

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function buildDeviceSearchHaystack(dev: DeviceRecord, roomName?: string): string {
  const parts: Array<string | number | null | undefined> = [
    dev.id,
    dev.id.startsWith('manual_') ? 'manuel manual' : null,
    dev.name,
    dev.customName,
    dev.productName,
    dev.tuyaCategory,
    dev.category,
    dev.ipAddress,
    dev.macAddress,
    dev.macAddress ? dev.macAddress.replace(/[^a-zA-Z0-9]/g, '') : null,
    roomName ?? 'non assignée sans pièce',
    dev.systems.length > 1 ? 'multi-systèmes multi' : null,
    ...dev.systems.flatMap((s) => [s, VENDOR_REGISTRY[s].label]),
    ...(dev.vendorLinks ?? []).flatMap((l) => [l.externalId, l.externalName]),
    dev.energyMode,
    dev.energyMode === 'hybrid'
      ? 'hybride'
      : dev.energyMode === 'add_ele'
        ? 'compteur'
        : 'integration',
    dev.isOnline ? 'en ligne online' : 'hors ligne offline',
    dev.excludeFromTotals ? 'exclu cascade' : null,
    dev.isMonitored ? 'suivi' : 'non suivi ignore',
    ...Object.values(dev.dpConfig ?? {}).map((f) => f?.code),
    dev.lastPowerW !== null ? `${dev.lastPowerW}w` : null,
    dev.lastTempC !== null ? `${dev.lastTempC}°c` : null,
    dev.lastHumidityPct !== null ? `${dev.lastHumidityPct}%` : null,
    dev.lastBatteryPct !== null ? `${dev.lastBatteryPct}%` : null,
  ];

  return normalizeSearchText(parts.filter((p) => p !== null && p !== undefined && p !== '').join(' '));
}

export function DevicesRoomsTab({
  data,
  onRefresh,
  initialRoomFilter,
  onOpenRoomsTab,
  onOpenGoogleGuide,
}: DevicesRoomsTabProps) {
  const showGoogleHomeApi = data.env.googleHomeApiEnabled;
  const [syncingTuya, setSyncingTuya] = useState(false);
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);
  const [selectedGoogleMode, setSelectedGoogleMode] = useState<GoogleHomeMode>(
    data.env.googleHomeMode ?? 'mcp'
  );
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dismissedDuplicates, setDismissedDuplicates] = useState<string[]>([]);
  const [mergingId, setMergingId] = useState<string | null>(null);

  // Inspecteur DP
  const [inspectDevice, setInspectDevice] = useState<DeviceRecord | null>(null);
  const [dpDraft, setDpDraft] = useState<DpConfig>({});
  const [savingDp, setSavingDp] = useState(false);

  // Modale Systèmes & Fusion
  const [manageSystemsDeviceId, setManageSystemsDeviceId] = useState<string | null>(null);
  const [mergeSourceId, setMergeSourceId] = useState<string>('');
  const [savingLink, setSavingLink] = useState(false);
  const [linkFeedback, setLinkFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Modale Déclaration / Édition appareil manuel
  const [showManualModal, setShowManualModal] = useState(false);
  const [editingManualDeviceId, setEditingManualDeviceId] = useState<string | null>(null);
  const [manualName, setManualName] = useState('');
  const [manualCustomName, setManualCustomName] = useState('');
  const [manualProductName, setManualProductName] = useState('');
  const [manualRoomId, setManualRoomId] = useState<string>('');
  const [manualCategory, setManualCategory] = useState<DeviceCategory>('other');
  const [manualSystems, setManualSystems] = useState<VendorId[]>(['google_home']);
  const [manualPrimaryVendor, setManualPrimaryVendor] = useState<VendorId>('google_home');
  const [manualIpAddress, setManualIpAddress] = useState('');
  const [manualMacAddress, setManualMacAddress] = useState('');
  const [manualIsOnline, setManualIsOnline] = useState(true);
  const [manualIsMonitored, setManualIsMonitored] = useState(true);
  const [manualExcludeFromTotals, setManualExcludeFromTotals] = useState(false);
  const [savingManualDevice, setSavingManualDevice] = useState(false);
  const [manualFeedback, setManualFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Filtres des appareils (système, pièce, recherche textuelle)
  const [systemFilter, setSystemFilter] = useState<SystemFilter | 'multi'>(
    data.selectedSystem ?? 'all'
  );
  const [roomFilter, setRoomFilter] = useState<string>(initialRoomFilter ?? 'all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setSystemFilter(data.selectedSystem ?? 'all');
  }, [data.selectedSystem]);

  useEffect(() => {
    if (initialRoomFilter) {
      setRoomFilter(initialRoomFilter);
    }
  }, [initialRoomFilter]);

  function openCreateManualDeviceModal() {
    setEditingManualDeviceId(null);
    setManualName('');
    setManualCustomName('');
    setManualProductName('');
    setManualRoomId(roomFilter !== 'all' && roomFilter !== 'unassigned' ? roomFilter : '');
    setManualCategory('other');
    setManualSystems(['google_home']);
    setManualPrimaryVendor('google_home');
    setManualIpAddress('');
    setManualMacAddress('');
    setManualIsOnline(true);
    setManualIsMonitored(true);
    setManualExcludeFromTotals(false);
    setManualFeedback(null);
    setShowManualModal(true);
  }

  function openEditManualDeviceModal(dev: DeviceRecord) {
    setEditingManualDeviceId(dev.id);
    setManualName(dev.name);
    setManualCustomName(dev.customName ?? '');
    setManualProductName(dev.productName ?? '');
    setManualRoomId(dev.roomId !== null ? String(dev.roomId) : '');
    setManualCategory(dev.category);
    const nextSystems: VendorId[] = dev.systems.length > 0 ? [...dev.systems] : [dev.primaryVendor];
    setManualSystems(nextSystems);
    setManualPrimaryVendor(
      nextSystems.includes(dev.primaryVendor) ? dev.primaryVendor : nextSystems[0]
    );
    setManualIpAddress(dev.ipAddress ?? '');
    setManualMacAddress(dev.macAddress ?? '');
    setManualIsOnline(dev.isOnline);
    setManualIsMonitored(dev.isMonitored);
    setManualExcludeFromTotals(dev.excludeFromTotals);
    setManualFeedback(null);
    setShowManualModal(true);
  }

  function closeManualModal() {
    if (savingManualDevice) return;
    setShowManualModal(false);
    setEditingManualDeviceId(null);
    setManualFeedback(null);
  }

  function handleToggleManualSystem(vId: VendorId) {
    setManualSystems((prev) => {
      if (prev.includes(vId)) {
        if (prev.length === 1) return prev;
        const next = prev.filter((item) => item !== vId);
        if (manualPrimaryVendor === vId) {
          setManualPrimaryVendor(next[0]);
        }
        return next;
      }
      return [...prev, vId];
    });
  }

  async function handleSaveManualDevice(e: FormEvent) {
    e.preventDefault();
    const trimmedName = manualName.trim();
    if (!trimmedName) {
      setManualFeedback({ ok: false, text: "Le nom de l'appareil est requis." });
      return;
    }

    const activeSystems: VendorId[] =
      manualSystems.length > 0 ? manualSystems : [manualPrimaryVendor];
    const effectivePrimary: VendorId = activeSystems.includes(manualPrimaryVendor)
      ? manualPrimaryVendor
      : activeSystems[0];

    setSavingManualDevice(true);
    setManualFeedback(null);
    try {
      const payload = {
        ...(editingManualDeviceId ? { id: editingManualDeviceId } : {}),
        name: trimmedName,
        customName: manualCustomName.trim() || null,
        productName: manualProductName.trim() || null,
        roomId: manualRoomId ? Number(manualRoomId) : null,
        category: manualCategory,
        systems: activeSystems,
        primaryVendor: effectivePrimary,
        ipAddress: manualIpAddress.trim() || null,
        macAddress: manualMacAddress.trim() || null,
        isOnline: manualIsOnline,
        isMonitored: manualIsMonitored,
        excludeFromTotals: manualExcludeFromTotals,
      };

      const res = await fetch('/api/devices', {
        method: editingManualDeviceId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error || "Échec de l'enregistrement de l'appareil.");
      }

      setShowManualModal(false);
      setEditingManualDeviceId(null);
      setSyncMessage({
        ok: true,
        text: editingManualDeviceId
          ? `Appareil « ${trimmedName} » mis à jour.`
          : `Appareil manuel « ${trimmedName} » déclaré.`,
      });
      await onRefresh();
    } catch (err) {
      setManualFeedback({
        ok: false,
        text: err instanceof Error ? err.message : "Erreur lors de l'enregistrement.",
      });
    } finally {
      setSavingManualDevice(false);
    }
  }

  async function handleDeleteManualDevice(dev: DeviceRecord) {
    const label = dev.customName || dev.name;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Supprimer l'appareil manuel « ${label} » ?`)
    ) {
      return;
    }

    setSyncMessage(null);
    try {
      const res = await fetch(`/api/devices?id=${encodeURIComponent(dev.id)}`, {
        method: 'DELETE',
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error || "Échec de la suppression de l'appareil.");
      }
      setSyncMessage({
        ok: true,
        text: `Appareil manuel « ${label} » supprimé.`,
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur lors de la suppression.',
      });
    }
  }

  const manageSystemsDevice = useMemo(
    () =>
      manageSystemsDeviceId
        ? data.devices.find((d) => d.id === manageSystemsDeviceId) ?? null
        : null,
    [data.devices, manageSystemsDeviceId]
  );

  const mergeableCandidatesForModal = useMemo(() => {
    if (!manageSystemsDevice) return [];
    return data.devices.filter((other) => {
      if (other.id === manageSystemsDevice.id) return false;
      return other.primaryVendor !== manageSystemsDevice.primaryVendor;
    });
  }, [data.devices, manageSystemsDevice]);

  const visibleDuplicateCandidates = useMemo(
    () => data.duplicateCandidates.filter((c) => !dismissedDuplicates.includes(c.sourceDeviceId)),
    [data.duplicateCandidates, dismissedDuplicates]
  );

  const { systemCounts, unassignedCount, roomDeviceCounts, filteredDevices } = useMemo(() => {
    const sysCounts = {
      all: data.devices.length,
      tuya: 0,
      google_home: 0,
      multi: 0,
    };

    const roomNameById = new Map<number, string>(data.rooms.map((r) => [r.id, r.name]));
    const searchTokens = normalizeSearchText(searchQuery).trim().split(/\s+/).filter(Boolean);

    const matchesSystem = (dev: DeviceRecord): boolean => {
      if (systemFilter === 'all') return true;
      if (systemFilter === 'multi') return dev.systems.length > 1;
      return dev.systems.includes(systemFilter);
    };

    const matchesSearch = (dev: DeviceRecord): boolean => {
      if (searchTokens.length === 0) return true;
      const haystack = buildDeviceSearchHaystack(
        dev,
        dev.roomId !== null ? roomNameById.get(dev.roomId) : undefined
      );
      return searchTokens.every((token) => haystack.includes(token));
    };

    const counts = new Map<number, number>();
    let unassigned = 0;

    for (const dev of data.devices) {
      if (dev.systems.includes('tuya')) sysCounts.tuya += 1;
      if (dev.systems.includes('google_home')) sysCounts.google_home += 1;
      if (dev.systems.length > 1) sysCounts.multi += 1;

      if (!matchesSystem(dev) || !matchesSearch(dev)) continue;

      if (dev.roomId === null) {
        unassigned += 1;
      } else {
        counts.set(dev.roomId, (counts.get(dev.roomId) ?? 0) + 1);
      }
    }

    const filtered = data.devices.filter((dev) => {
      if (!matchesSystem(dev) || !matchesSearch(dev)) return false;
      if (roomFilter === 'all') return true;
      if (roomFilter === 'unassigned') return dev.roomId === null;
      return String(dev.roomId) === roomFilter;
    });

    return {
      systemCounts: sysCounts,
      unassignedCount: unassigned,
      roomDeviceCounts: counts,
      filteredDevices: filtered,
    };
  }, [data.devices, data.rooms, roomFilter, systemFilter, searchQuery]);

  async function handleSyncTuya() {
    setSyncingTuya(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/tuya/sync', { method: 'POST' });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(json.error || 'Échec de synchronisation Tuya');
      setSyncMessage({ ok: true, text: json.message || 'Synchronisation Tuya terminée.' });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur Tuya',
      });
    } finally {
      setSyncingTuya(false);
    }
  }

  async function handleSyncGoogleHome() {
    setSyncingGoogle(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/vendors/google-home/sync', { method: 'POST' });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(json.error || 'Échec de synchronisation Google Home');
      setSyncMessage({
        ok: true,
        text: json.message || 'Synchronisation Google Home terminée.',
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur Google Home',
      });
    } finally {
      setSyncingGoogle(false);
    }
  }

  async function handleDisconnectGoogleHome() {
    setDisconnectingGoogle(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/vendors/google-home/disconnect', { method: 'POST' });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Échec de déconnexion Google Home');
      setSyncMessage({ ok: true, text: 'Google Home déconnecté.' });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur déconnexion',
      });
    } finally {
      setDisconnectingGoogle(false);
    }
  }

  async function handleMergeDevices(targetDeviceId: string, sourceDeviceId: string) {
    setMergingId(sourceDeviceId);
    setSavingLink(true);
    setLinkFeedback(null);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/devices/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge', targetDeviceId, sourceDeviceId }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Échec de fusion des appareils');
      setMergeSourceId('');
      setLinkFeedback({
        ok: true,
        text: 'Doublon fusionné et liaison mémorisée pour les futures synchronisations.',
      });
      setSyncMessage({
        ok: true,
        text: 'Appareils fusionnés sans doublon. La liaison Google Home ↔ Tuya est mémorisée.',
      });
      await onRefresh();
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Erreur fusion';
      setLinkFeedback({ ok: false, text });
      setSyncMessage({ ok: false, text });
    } finally {
      setMergingId(null);
      setSavingLink(false);
    }
  }

  async function handleToggleSystemTag(deviceId: string, vendor: VendorId, enabled: boolean) {
    setSavingLink(true);
    setLinkFeedback(null);
    try {
      const res = await fetch('/api/devices/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_system', deviceId, vendor, enabled }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Échec mise à jour des systèmes');
      setLinkFeedback({ ok: true, text: 'Systèmes mis à jour.' });
      await onRefresh();
    } catch (err) {
      setLinkFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur mise à jour',
      });
    } finally {
      setSavingLink(false);
    }
  }

  async function handleUnlinkVendor(deviceId: string, vendor: VendorId) {
    setSavingLink(true);
    setLinkFeedback(null);
    try {
      const res = await fetch(
        `/api/devices/links?deviceId=${encodeURIComponent(deviceId)}&vendor=${encodeURIComponent(vendor)}`,
        { method: 'DELETE' }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Échec dissociation');
      setLinkFeedback({ ok: true, text: 'Liaison système supprimée.' });
      await onRefresh();
    } catch (err) {
      setLinkFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur dissociation',
      });
    } finally {
      setSavingLink(false);
    }
  }

  function openManageSystems(dev: DeviceRecord) {
    setManageSystemsDeviceId(dev.id);
    setMergeSourceId('');
    setLinkFeedback(null);
  }

  async function handleDeviceUpdate(
    deviceId: string,
    updates: Partial<{
      customName: string | null;
      roomId: number | null;
      isMonitored: boolean;
      excludeFromTotals: boolean;
      energyMode: EnergyMode;
      dpConfig: DpConfig;
    }>
  ) {
    await fetch('/api/devices', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deviceId, ...updates }),
    });
    await onRefresh();
  }

  function openInspector(dev: DeviceRecord) {
    setInspectDevice(dev);
    setDpDraft(structuredClone(dev.dpConfig ?? {}));
  }

  async function saveInspector() {
    if (!inspectDevice) return;
    setSavingDp(true);
    try {
      await handleDeviceUpdate(inspectDevice.id, { dpConfig: dpDraft });
      setInspectDevice(null);
    } finally {
      setSavingDp(false);
    }
  }

  const tuyaVendor = data.vendors.find((v) => v.vendor === 'tuya');
  const ghVendor = data.vendors.find((v) => v.vendor === 'google_home');
  const isGhConnected = Boolean(ghVendor?.connected);

  return (
    <div className="space-y-6">
      {/* Synchronisation Multi-Vendors */}
      <div
        className={
          showGoogleHomeApi ? 'grid grid-cols-1 lg:grid-cols-2 gap-4' : 'grid grid-cols-1 gap-4'
        }
      >
        {/* Tuya Cloud */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_REGISTRY.tuya.badgeClass}`}
                >
                  {VENDOR_REGISTRY.tuya.label}
                </span>
                <span className="text-xs text-slate-400">
                  {tuyaVendor?.devicesCount ?? systemCounts.tuya} appareil(s)
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    data.env.tuyaConfigured || data.env.mode === 'demo'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {data.env.mode === 'demo'
                    ? 'Mode Démo'
                    : data.env.tuyaConfigured
                      ? `Connecté (${data.env.tuyaRegion.toUpperCase()})`
                      : 'Non configuré'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {VENDOR_REGISTRY.tuya.description}. Mesures prioritaires : W, kWh, tension, piles, IP/MAC.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-slate-500">
              {tuyaVendor?.lastSyncedAt
                ? `Synchro : ${new Date(tuyaVendor.lastSyncedAt).toLocaleString('fr-FR')}`
                : 'Aucune synchronisation manuelle récente'}
            </span>
            <button
              type="button"
              onClick={handleSyncTuya}
              disabled={syncingTuya}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingTuya ? 'animate-spin' : ''}`} />
              {syncingTuya ? 'Synchronisation...' : 'Synchroniser Tuya'}
            </button>
          </div>
        </div>

        {/* Google Home (masqué si GOOGLE_HOME_MODE=off ou non défini) */}
        {showGoogleHomeApi && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="w-full">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_REGISTRY.google_home.badgeClass}`}
                    >
                      {VENDOR_REGISTRY.google_home.label}
                    </span>
                    <span className="text-xs text-slate-400">
                      {ghVendor?.devicesCount ?? systemCounts.google_home} appareil(s)
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        isGhConnected
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {data.env.mode === 'demo'
                        ? 'Mode Démo'
                        : isGhConnected
                          ? `Connecté (${(ghVendor?.mode ?? selectedGoogleMode).toString().toUpperCase()})`
                          : data.env.googleHomeConfigured
                            ? 'Prêt (OAuth requis)'
                            : 'OAuth non configuré'}
                    </span>
                  </div>

                  {!isGhConnected && data.env.mode === 'live' && (
                    <select
                      value={selectedGoogleMode}
                      onChange={(e) => setSelectedGoogleMode(e.target.value as GoogleHomeMode)}
                      aria-label="Mode API Google Home"
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
                    >
                      <option value="mcp">Mode Home MCP (tous appareils)</option>
                      <option value="sdm">Mode Nest SDM (Nest)</option>
                    </select>
                  )}
                </div>

                <p className="text-xs text-slate-400 mt-2">
                  {VENDOR_REGISTRY.google_home.description}. Fusionnez les doublons Tuya sans duplication.
                </p>

                {ghVendor?.lastError && (
                  <p className="text-[11px] text-rose-300 mt-1.5">{ghVendor.lastError}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {ghVendor?.lastSyncedAt
                  ? `Synchro : ${new Date(ghVendor.lastSyncedAt).toLocaleString('fr-FR')}`
                  : data.env.mode === 'live' && !data.env.googleHomeConfigured
                    ? 'Ajoutez GOOGLE_CLIENT_ID / SECRET (voir Guide Setup)'
                    : 'Lecture seule · zéro commande envoyée'}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {onOpenGoogleGuide && (
                  <button
                    type="button"
                    onClick={onOpenGoogleGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                    title="Afficher le déroulé opératoire pas-à-pas Google Home"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-sky-400" />
                    Déroulé setup
                  </button>
                )}
                {data.env.mode === 'live' && !isGhConnected ? (
                  <a
                    href={`/api/vendors/google-home/oauth/start?mode=${selectedGoogleMode}`}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 px-3.5 py-2 text-xs font-medium text-white transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Connecter Google Home ({selectedGoogleMode.toUpperCase()})
                  </a>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleSyncGoogleHome}
                      disabled={syncingGoogle || disconnectingGoogle}
                      className="inline-flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${syncingGoogle ? 'animate-spin' : ''}`} />
                      {syncingGoogle ? 'Synchronisation...' : 'Synchroniser Google Home'}
                    </button>
                    {data.env.mode === 'live' && isGhConnected && (
                      <button
                        type="button"
                        onClick={handleDisconnectGoogleHome}
                        disabled={disconnectingGoogle || syncingGoogle}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 disabled:opacity-50 px-3 py-2 text-xs text-slate-300 transition"
                      >
                        Déconnecter
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {syncMessage && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs ${
            syncMessage.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          }`}
        >
          {syncMessage.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{syncMessage.text}</span>
        </div>
      )}

      {/* Bannière de déduplication Tuya <-> Google Home */}
      {visibleDuplicateCandidates.length > 0 && (
        <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-200">
              <GitMerge className="h-4 w-4 text-amber-400 shrink-0" />
              Doublons potentiels Tuya ↔ Google Home détectés ({visibleDuplicateCandidates.length})
            </div>
            <span className="text-[11px] text-amber-300/80">
              Fusionnez en 1 clic pour combiner les badges sur une seule ligne et conserver les mesures Tuya.
            </span>
          </div>

          <div className="space-y-2">
            {visibleDuplicateCandidates.map((cand) => (
              <div
                key={cand.sourceDeviceId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-slate-950/60 px-3.5 py-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${VENDOR_REGISTRY[cand.sourceVendor].badgeClass}`}
                  >
                    {VENDOR_REGISTRY[cand.sourceVendor].label}
                  </span>
                  <span className="font-medium text-white">{cand.sourceName}</span>
                  <span className="text-slate-500">→</span>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${VENDOR_REGISTRY[cand.targetVendor].badgeClass}`}
                  >
                    {VENDOR_REGISTRY[cand.targetVendor].label}
                  </span>
                  <span className="font-medium text-white">{cand.targetName}</span>
                  <span className="text-[11px] text-slate-400">
                    ({cand.reason}
                    {cand.roomName ? ` · ${cand.roomName}` : ''})
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={mergingId === cand.sourceDeviceId}
                    onClick={() => void handleMergeDevices(cand.targetDeviceId, cand.sourceDeviceId)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition"
                  >
                    <GitMerge className="h-3.5 w-3.5" />
                    {mergingId === cand.sourceDeviceId ? 'Fusion...' : 'Fusionner en 1 clic'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDismissedDuplicates((prev) => [...prev, cand.sourceDeviceId])
                    }
                    className="rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-2.5 py-1.5 text-[11px] text-slate-300 transition"
                  >
                    Ignorer
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Liste des appareils */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Appareils détectés ({filteredDevices.length}
                {roomFilter !== 'all' || systemFilter !== 'all' || searchQuery.trim() !== ''
                  ? ` / ${data.devices.length}`
                  : ''}
                )
              </h3>
              <p className="text-xs text-slate-400">
                Filtrez par texte, système ou pièce, déclarez les liaisons multi-systèmes sans doublons et calibrez vos calculs kWh
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher (nom, IP, MAC, pièce, système, DP...)"
                  aria-label="Rechercher un appareil"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-8 pr-8 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    title="Effacer la recherche"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={openCreateManualDeviceModal}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                Déclarer un appareil
              </button>
            </div>
          </div>

          {/* Barre de filtres par système (Vendor) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 mr-1">
              <Layers className="h-3.5 w-3.5 text-slate-500" />
              Système :
            </span>
            <button
              type="button"
              onClick={() => setSystemFilter('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                systemFilter === 'all'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              Tous ({systemCounts.all})
            </button>
            {VENDOR_IDS.map((vId) => {
              const meta = VENDOR_REGISTRY[vId];
              const active = systemFilter === vId;
              const count = systemCounts[vId];
              return (
                <button
                  key={vId}
                  type="button"
                  onClick={() => setSystemFilter(vId)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition border ${
                    active
                      ? meta.badgeClass
                      : 'border-transparent bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${meta.dotClass}`} />
                  {meta.label} ({count})
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setSystemFilter('multi')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition border ${
                systemFilter === 'multi'
                  ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200'
                  : 'border-transparent bg-slate-800/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Link2 className="h-3 w-3" />
              Multi-systèmes ({systemCounts.multi})
            </button>
          </div>

          {/* Barre de filtres par pièce */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 mr-1">
              <Home className="h-3.5 w-3.5 text-slate-500" />
              Pièce :
            </span>
            <button
              type="button"
              onClick={() => setRoomFilter('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                roomFilter === 'all'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              Toutes ({systemCounts.all === filteredDevices.length && roomFilter === 'all' ? systemCounts.all : unassignedCount + Array.from(roomDeviceCounts.values()).reduce((a, b) => a + b, 0)})
            </button>

            <button
              type="button"
              onClick={() => setRoomFilter('unassigned')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition border ${
                roomFilter === 'unassigned'
                  ? 'border-amber-500 bg-amber-500/20 text-amber-200'
                  : unassignedCount > 0
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                    : 'border-transparent bg-slate-800/80 text-slate-400 hover:bg-slate-800'
              }`}
            >
              Sans pièce ({unassignedCount})
            </button>

            {data.rooms.map((r) => {
              const key = String(r.id);
              const active = roomFilter === key;
              const count = roomDeviceCounts.get(r.id) ?? 0;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRoomFilter(key)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition border ${
                    active
                      ? 'border-indigo-500 bg-indigo-600/25 text-white'
                      : 'border-transparent bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: r.color }}
                  />
                  {r.name} ({count})
                </button>
              );
            })}

            {onOpenRoomsTab && (
              <button
                type="button"
                onClick={onOpenRoomsTab}
                className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition"
              >
                Gérer les pièces
                <ArrowRight className="h-3 w-3 text-indigo-400" />
              </button>
            )}
          </div>
        </div>

        {/* Vue Desktop sans scrollbar horizontale (table-fixed 100 %) */}
        <div className="hidden lg:block">
          <table className="w-full table-fixed text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider text-[10.5px]">
              <tr>
                <th className="w-[21%] px-2.5 py-2.5">Appareil / Nom affiché</th>
                <th className="w-[13%] px-2.5 py-2.5">Système</th>
                <th className="w-[12%] px-2.5 py-2.5">IP / MAC</th>
                <th className="w-[13%] px-2.5 py-2.5">Pièce</th>
                <th className="w-[12%] px-2.5 py-2.5">Calcul kWh</th>
                <th className="w-[11%] px-2.5 py-2.5">Valeurs</th>
                <th
                  className="w-[5%] px-2 py-2.5 text-center"
                  title="Décocher pour ignorer complètement cet appareil lors des collectes et dans le dashboard"
                >
                  Suivi
                </th>
                <th
                  className="w-[6%] px-2 py-2.5 text-center"
                  title="Exclure (Cascade / Climat) : cocher pour exclure l'appareil des totaux électriques (prises en cascade) et des mesures/compteurs de la page Climat (ex. pilotes de radiateurs)"
                >
                  Exclure
                </th>
                <th className="w-[7%] px-2.5 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredDevices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-xs text-slate-500">
                    <div>Aucun appareil ne correspond aux filtres actifs.</div>
                    {(roomFilter !== 'all' || systemFilter !== 'all' || searchQuery.trim() !== '') && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          setRoomFilter('all');
                          setSystemFilter('all');
                        }}
                        className="mt-2.5 inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-1 text-[11px] text-slate-200 transition"
                      >
                        Réinitialiser les filtres
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredDevices.map((dev) => {
                  const isManual = dev.id.startsWith('manual_');
                  return (
                    <tr key={dev.id} className="hover:bg-slate-800/30 align-top">
                      <td className="px-2.5 py-2.5 min-w-0">
                        <div className="flex items-start gap-1.5 min-w-0">
                          {dev.isOnline ? (
                            <Wifi className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          ) : (
                            <WifiOff className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-medium text-white truncate" title={dev.name}>
                                {dev.name}
                              </span>
                              {isManual && (
                                <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.2 text-[9.5px] font-medium text-emerald-300">
                                  Manuel
                                </span>
                              )}
                            </div>
                            <div
                              className="text-[10px] text-slate-500 font-mono truncate"
                              title={dev.productName || dev.tuyaCategory || dev.id}
                            >
                              {dev.productName || dev.tuyaCategory || dev.id}
                            </div>
                            <input
                              key={`name-${dev.id}-${dev.customName ?? ''}`}
                              type="text"
                              defaultValue={dev.customName ?? ''}
                              placeholder="Nom affiché (personnaliser…)"
                              aria-label={`Nom affiché pour ${dev.name}`}
                              onBlur={(e) => {
                                const val = e.target.value.trim();
                                if (val !== (dev.customName ?? '')) {
                                  void handleDeviceUpdate(dev.id, { customName: val || null });
                                }
                              }}
                              className="w-full min-w-0 rounded-md border border-slate-700/80 bg-slate-950 px-2 py-1 text-[11px] text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      </td>

                      <td className="px-2.5 py-2.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-1">
                          {dev.systems.map((sys) => {
                            const meta = VENDOR_REGISTRY[sys];
                            const isPrimary = sys === dev.primaryVendor;
                            return (
                              <span
                                key={sys}
                                title={
                                  isPrimary
                                    ? `${meta.label} — Source principale de mesure`
                                    : `${meta.label} — Lié sans doublon`
                                }
                                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${meta.dotClass}`} />
                                {meta.label}
                              </span>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => openManageSystems(dev)}
                            title="Gérer les systèmes liés (déclarer Google Home / fusionner un doublon)"
                            className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/80 hover:border-slate-500 hover:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 transition"
                          >
                            <Link2 className="h-2.5 w-2.5" />
                            Lier
                          </button>
                        </div>
                      </td>

                      <td className="px-2.5 py-2.5 font-mono text-[10.5px] leading-tight min-w-0">
                        <div className="text-slate-200 truncate" title={dev.ipAddress || '—'}>
                          {dev.ipAddress || '—'}
                        </div>
                        <div
                          className="text-[10px] text-slate-400 mt-0.5 truncate"
                          title={dev.macAddress || '—'}
                        >
                          {dev.macAddress || '—'}
                        </div>
                      </td>

                      <td className="px-2.5 py-2.5 min-w-0">
                        <select
                          value={dev.roomId ?? ''}
                          aria-label={`Pièce de ${dev.name}`}
                          onChange={(e) =>
                            void handleDeviceUpdate(dev.id, {
                              roomId: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                          className="w-full min-w-0 truncate rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="">Non assignée</option>
                          {data.rooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="px-2.5 py-2.5 min-w-0">
                        <select
                          value={dev.energyMode}
                          aria-label={`Calcul kWh de ${dev.name}`}
                          onChange={(e) =>
                            void handleDeviceUpdate(dev.id, {
                              energyMode: e.target.value as EnergyMode,
                            })
                          }
                          className="w-full min-w-0 truncate rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="hybrid">Hybride Auto</option>
                          <option value="add_ele">Compteur (add_ele)</option>
                          <option value="integration">Intégration (W×0.5h)</option>
                        </select>
                      </td>

                      <td className="px-2.5 py-2.5 font-mono text-[11px] text-slate-300 min-w-0">
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                          {dev.lastPowerW !== null && (
                            <span className="text-indigo-300">{dev.lastPowerW} W</span>
                          )}
                          {dev.lastTempC !== null && (
                            <span className="text-emerald-300">{dev.lastTempC} °C</span>
                          )}
                          {dev.lastHumidityPct !== null && (
                            <span className="text-sky-300">{dev.lastHumidityPct} %</span>
                          )}
                          {dev.lastContactOpen !== null && (
                            <span
                              className={
                                dev.lastContactOpen ? 'text-amber-300' : 'text-emerald-300'
                              }
                            >
                              {dev.lastContactOpen ? 'Ouvert' : 'Fermé'}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-2 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={dev.isMonitored}
                          aria-label={`Suivi de ${dev.name}`}
                          onChange={(e) =>
                            void handleDeviceUpdate(dev.id, { isMonitored: e.target.checked })
                          }
                          className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>

                      <td className="px-2 py-2.5 text-center">
                        <label
                          className="inline-flex flex-col items-center gap-0.5 cursor-pointer"
                          title="Si coché, cet appareil est exclu des totaux électriques (prises en cascade) et des mesures/compteurs de la page Climat"
                        >
                          <input
                            type="checkbox"
                            checked={dev.excludeFromTotals}
                            aria-label={`Exclure ${dev.name}`}
                            onChange={(e) =>
                              void handleDeviceUpdate(dev.id, {
                                excludeFromTotals: e.target.checked,
                              })
                            }
                            className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-amber-500 focus:ring-amber-500"
                          />
                          {dev.excludeFromTotals && (
                            <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1 py-0.2 text-[9.5px] leading-tight text-amber-300">
                              Exclu
                            </span>
                          )}
                        </label>
                      </td>

                      <td className="px-2.5 py-2.5 text-right">
                        {isManual ? (
                          <div className="inline-flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openEditManualDeviceModal(dev)}
                              title="Modifier cet appareil manuel"
                              className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 p-1.5 text-slate-200 transition"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteManualDevice(dev)}
                              title="Supprimer cet appareil manuel"
                              className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300 p-1.5 text-slate-300 transition"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openInspector(dev)}
                            title="Ouvrir l'Inspecteur Data Points"
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2 py-1 text-[11px] text-slate-200 transition"
                          >
                            <Sliders className="h-3 w-3" />
                            DP
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Vue Mobile / Tablette (< 1024px) empilée sans scrollbar */}
        <div className="lg:hidden divide-y divide-slate-800/80">
          {filteredDevices.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500">
              <div>Aucun appareil ne correspond aux filtres actifs.</div>
              {(roomFilter !== 'all' || systemFilter !== 'all' || searchQuery.trim() !== '') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setRoomFilter('all');
                    setSystemFilter('all');
                  }}
                  className="mt-2.5 inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-1 text-[11px] text-slate-200 transition"
                >
                  Réinitialiser les filtres
                </button>
              )}
            </div>
          ) : (
            filteredDevices.map((dev) => {
              const isManual = dev.id.startsWith('manual_');
              return (
                <div key={dev.id} className="p-4 space-y-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      {dev.isOnline ? (
                        <Wifi className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <WifiOff className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-medium text-white truncate">{dev.name}</span>
                          {isManual && (
                            <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.2 text-[9.5px] font-medium text-emerald-300">
                              Manuel
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono truncate">
                          {dev.productName || dev.tuyaCategory || dev.id}
                        </div>
                      </div>
                    </div>

                    {isManual ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditManualDeviceModal(dev)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] text-slate-200"
                        >
                          <Pencil className="h-3 w-3" />
                          Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteManualDevice(dev)}
                          title="Supprimer cet appareil manuel"
                          className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300 p-1.5 text-slate-300"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openInspector(dev)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] text-slate-200 shrink-0"
                      >
                        <Sliders className="h-3 w-3" />
                        Inspecteur DP
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {dev.systems.map((sys) => {
                      const meta = VENDOR_REGISTRY[sys];
                      return (
                        <span
                          key={sys}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                          {meta.label}
                        </span>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => openManageSystems(dev)}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300"
                    >
                      <Link2 className="h-2.5 w-2.5" />
                      Lier
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Nom affiché</label>
                      <input
                        key={`mob-name-${dev.id}-${dev.customName ?? ''}`}
                        type="text"
                        defaultValue={dev.customName ?? ''}
                        placeholder={dev.name}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          if (val !== (dev.customName ?? '')) {
                            void handleDeviceUpdate(dev.id, { customName: val || null });
                          }
                        }}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">IP / MAC</label>
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 font-mono text-[11px] text-slate-300 truncate">
                        {dev.ipAddress || '—'} · {dev.macAddress || '—'}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Pièce</label>
                      <select
                        value={dev.roomId ?? ''}
                        onChange={(e) =>
                          void handleDeviceUpdate(dev.id, {
                            roomId: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="">Non assignée</option>
                        {data.rooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Calcul kWh</label>
                      <select
                        value={dev.energyMode}
                        onChange={(e) =>
                          void handleDeviceUpdate(dev.id, {
                            energyMode: e.target.value as EnergyMode,
                          })
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="hybrid">Hybride Auto</option>
                        <option value="add_ele">Compteur (add_ele)</option>
                        <option value="integration">Intégration (W×0.5h)</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex flex-wrap gap-2 font-mono text-[11px] text-slate-300">
                      {dev.lastPowerW !== null && (
                        <span className="text-indigo-300">{dev.lastPowerW} W</span>
                      )}
                      {dev.lastTempC !== null && (
                        <span className="text-emerald-300">{dev.lastTempC} °C</span>
                      )}
                      {dev.lastHumidityPct !== null && (
                        <span className="text-sky-300">{dev.lastHumidityPct} %</span>
                      )}
                      {dev.lastContactOpen !== null && (
                        <span className={dev.lastContactOpen ? 'text-amber-300' : 'text-emerald-300'}>
                          {dev.lastContactOpen ? 'Ouvert' : 'Fermé'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-[11px] text-slate-300">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={dev.isMonitored}
                          onChange={(e) =>
                            void handleDeviceUpdate(dev.id, { isMonitored: e.target.checked })
                          }
                          className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-600"
                        />
                        Suivi
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={dev.excludeFromTotals}
                          onChange={(e) =>
                            void handleDeviceUpdate(dev.id, {
                              excludeFromTotals: e.target.checked,
                            })
                          }
                          className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-amber-500"
                        />
                        Exclure
                      </label>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Journal des collectes */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-slate-400" />
          Historique récent des collectes (toutes les 30 min)
        </h3>
        <div className="space-y-2 max-h-56 overflow-y-auto">
          {data.logs.map((log) => (
            <div
              key={log.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 px-3.5 py-2 text-xs"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`h-2 w-2 rounded-full ${
                    log.status === 'success' ? 'bg-emerald-400' : 'bg-rose-400'
                  }`}
                />
                <span className="font-mono text-slate-300">
                  {new Date(log.executedAt).toLocaleString('fr-FR')}
                </span>
                <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] uppercase text-slate-300">
                  {log.trigger}
                </span>
              </div>
              <div className="text-slate-400">
                {log.status === 'success' ? (
                  <span>
                    {log.readingsInserted} mesures enregistrées ({log.devicesCount} appareils) ·{' '}
                    {log.durationMs ?? 0} ms
                  </span>
                ) : (
                  <span className="text-rose-300">{log.errorMessage}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modale Inspecteur DP */}
      {inspectDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Inspecteur Data Points — {inspectDevice.customName || inspectDevice.name}
                </h3>
                <p className="text-xs text-slate-400 font-mono">{inspectDevice.id}</p>
              </div>
              <button
                onClick={() => setInspectDevice(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {(
                [
                  { key: 'power', label: 'Puissance (W)' },
                  { key: 'addEle', label: 'Compteur énergie (kWh)' },
                  { key: 'voltage', label: 'Tension (V)' },
                  { key: 'temp', label: 'Température (°C)' },
                  { key: 'humidity', label: 'Humidité (%)' },
                  { key: 'battery', label: 'Batterie (%)' },
                  { key: 'contact', label: 'Contact (Ouvert / Fermé)' },
                ] as const
              ).map(({ key, label }) => {
                const current = dpDraft[key] ?? { code: '', scale: 1 };
                const isContact = key === 'contact';
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2"
                  >
                    <div className="font-medium text-slate-200">{label}</div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder={isContact ? 'ex: doorcontact_state' : 'Code DP (ex: cur_power)'}
                        value={current.code}
                        onChange={(e) => {
                          const code = e.target.value.trim();
                          setDpDraft({
                            ...dpDraft,
                            [key]: code ? { code, scale: current.scale || 1 } : undefined,
                          });
                        }}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-mono text-white"
                      />
                      <select
                        value={current.scale}
                        onChange={(e) =>
                          setDpDraft({
                            ...dpDraft,
                            [key]: { code: current.code, scale: Number(e.target.value) },
                          })
                        }
                        className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                      >
                        {isContact ? (
                          <>
                            <option value={1}>Normal (true = Ouvert)</option>
                            <option value={-1}>Inversé (false = Ouvert)</option>
                          </>
                        ) : (
                          SCALE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <div className="text-xs font-medium text-slate-300 mb-1.5">
                Dernier statut brut reçu (`lastRawStatus`)
              </div>
              <pre className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-48">
                {JSON.stringify(inspectDevice.lastRawStatus ?? [], null, 2)}
              </pre>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setInspectDevice(null)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300 hover:bg-slate-800"
              >
                Fermer
              </button>
              <button
                onClick={saveInspector}
                disabled={savingDp}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-medium text-white"
              >
                {savingDp ? 'Enregistrement...' : 'Appliquer le mapping'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale Systèmes & Fusion (Multi-Vendors sans doublon) */}
      {manageSystemsDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-sky-400" />
                  Systèmes &amp; Fusion — {manageSystemsDevice.customName || manageSystemsDevice.name}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Source principale de mesure :{' '}
                  <strong className="text-slate-200">
                    {VENDOR_REGISTRY[manageSystemsDevice.primaryVendor].label}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManageSystemsDeviceId(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {linkFeedback && (
              <div
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                  linkFeedback.ok
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                }`}
              >
                {linkFeedback.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                )}
                <span>{linkFeedback.text}</span>
              </div>
            )}

            {/* Cases à cocher présence multi-systèmes */}
            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-slate-200">
                Présence déclarée dans les écosystèmes (sans créer de doublon)
              </div>
              <div className="space-y-2">
                {VENDOR_IDS.map((vId) => {
                  const meta = VENDOR_REGISTRY[vId];
                  const isPrimary = manageSystemsDevice.primaryVendor === vId;
                  const checked = manageSystemsDevice.systems.includes(vId);
                  return (
                    <label
                      key={vId}
                      className={`flex items-start justify-between gap-3 rounded-xl border p-3 text-xs transition ${
                        checked
                          ? 'border-slate-700 bg-slate-950/80'
                          : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                      } ${isPrimary ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isPrimary || savingLink}
                          onChange={(e) =>
                            void handleToggleSystemTag(
                              manageSystemsDevice.id,
                              vId,
                              e.target.checked
                            )
                          }
                          className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div>
                          <div className="flex items-center gap-2 font-medium text-white">
                            <span>{meta.label}</span>
                            {isPrimary && (
                              <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-300">
                                Système principal
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {isPrimary
                              ? 'Collecte active et source principale des métriques de cet appareil.'
                              : `Cochez si cet appareil est aussi remonté dans ${meta.label}. Il apparaîtra dans les deux filtres sans doublon.`}
                          </p>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Fusion d'un doublon existant */}
            <div className="space-y-2.5 pt-2 border-t border-slate-800">
              <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <GitMerge className="h-3.5 w-3.5 text-amber-400" />
                Fusionner un doublon existant dans cet appareil
              </div>
              <p className="text-[11px] text-slate-400">
                Sélectionnez une ligne doublon d&apos;un autre système pour transférer son ID
                externe vers cette fiche et supprimer la ligne en double.
              </p>

              {mergeableCandidatesForModal.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-[11px] text-slate-500">
                  Aucun appareil d&apos;un autre fournisseur disponible à fusionner pour le moment.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <select
                    value={mergeSourceId}
                    onChange={(e) => setMergeSourceId(e.target.value)}
                    className="flex-1 min-w-[200px] rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
                  >
                    <option value="">Choisir un appareil à absorber...</option>
                    {mergeableCandidatesForModal.map((cand) => {
                      const candRoom = data.rooms.find((r) => r.id === cand.roomId);
                      return (
                        <option key={cand.id} value={cand.id}>
                          [{VENDOR_REGISTRY[cand.primaryVendor].label}] {cand.customName || cand.name}
                          {candRoom ? ` (${candRoom.name})` : ''}
                        </option>
                      );
                    })}
                  </select>
                  <button
                    type="button"
                    disabled={!mergeSourceId || savingLink}
                    onClick={() =>
                      void handleMergeDevices(manageSystemsDevice.id, mergeSourceId)
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 px-3.5 py-2 text-xs font-semibold text-slate-950 transition"
                  >
                    <GitMerge className="h-3.5 w-3.5" />
                    Fusionner
                  </button>
                </div>
              )}
            </div>

            {/* Liens mémorisés */}
            {(manageSystemsDevice.vendorLinks?.length ?? 0) > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="text-xs font-semibold text-slate-200">
                  Identités externes mémorisées (anti-doublon)
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {manageSystemsDevice.vendorLinks?.map((link) => {
                    const meta = VENDOR_REGISTRY[link.vendor];
                    const canUnlink =
                      link.vendor !== manageSystemsDevice.primaryVendor &&
                      manageSystemsDevice.systems.length > 1;
                    return (
                      <div
                        key={link.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px]"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`rounded border px-1.5 py-0.2 text-[10px] ${meta.badgeClass}`}>
                              {meta.label}
                            </span>
                            <span className="text-slate-200 truncate">
                              {link.externalName || link.externalId}
                            </span>
                          </div>
                          <div className="font-mono text-[10px] text-slate-500 truncate mt-0.5">
                            {link.externalId}
                          </div>
                        </div>
                        {canUnlink && (
                          <button
                            type="button"
                            disabled={savingLink}
                            onClick={() =>
                              void handleUnlinkVendor(manageSystemsDevice.id, link.vendor)
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 hover:border-rose-500/40 hover:text-rose-300 px-2 py-1 text-[10px] text-slate-300 shrink-0"
                            title="Dissocier ce système"
                          >
                            <Unlink className="h-3 w-3" />
                            Délier
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setManageSystemsDeviceId(null)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300 hover:bg-slate-800"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale Déclaration / Édition appareil manuel */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveManualDevice}
            className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Plus className="h-4 w-4 text-emerald-400" />
                  {editingManualDeviceId
                    ? 'Modifier un appareil manuel'
                    : 'Déclarer un appareil manuel'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Référencez vos appareils Google Home ou autres équipements hors cloud Tuya sans
                  collecte cloud automatique.
                </p>
              </div>
              <button
                type="button"
                onClick={closeManualModal}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {manualFeedback && (
              <div
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                  manualFeedback.ok
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                }`}
              >
                {manualFeedback.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                )}
                <span>{manualFeedback.text}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">
                  Nom de l&apos;appareil <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="ex: Nest Mini Salon, Chromecast..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Nom affiché (optionnel)</label>
                <input
                  type="text"
                  value={manualCustomName}
                  onChange={(e) => setManualCustomName(e.target.value)}
                  placeholder="Laisser vide pour le nom d'origine"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Marque / Modèle (optionnel)</label>
                <input
                  type="text"
                  value={manualProductName}
                  onChange={(e) => setManualProductName(e.target.value)}
                  placeholder="ex: Google Nest Mini, Chromecast 4K..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Pièce</label>
                <select
                  value={manualRoomId}
                  onChange={(e) => setManualRoomId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">Non assignée</option>
                  {data.rooms.map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Catégorie</label>
                <select
                  value={manualCategory}
                  onChange={(e) => setManualCategory(e.target.value as DeviceCategory)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="other">Autre / Multimédia (other)</option>
                  <option value="power">Énergie / Prise (power)</option>
                  <option value="climate">Climat / Température (climate)</option>
                  <option value="contact">Ouverture / Contact (contact)</option>
                  <option value="hybrid">Hybride (hybrid)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Adresse IP (optionnel)</label>
                <input
                  type="text"
                  value={manualIpAddress}
                  onChange={(e) => setManualIpAddress(e.target.value)}
                  placeholder="ex: 192.168.1.45"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-slate-400 mb-1">Adresse MAC (optionnel)</label>
                <input
                  type="text"
                  value={manualMacAddress}
                  onChange={(e) => setManualMacAddress(e.target.value)}
                  placeholder="ex: AA:BB:CC:DD:EE:FF"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Systèmes associés */}
            <div className="space-y-2 text-xs">
              <div className="text-slate-300 font-medium">Systèmes associés</div>
              <div className="flex flex-wrap items-center gap-3">
                {VENDOR_IDS.map((vId) => {
                  const meta = VENDOR_REGISTRY[vId];
                  const checked = manualSystems.includes(vId);
                  return (
                    <label
                      key={vId}
                      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 cursor-pointer transition ${
                        checked
                          ? 'border-slate-600 bg-slate-950/90 text-white'
                          : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleToggleManualSystem(vId)}
                        className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-600"
                      />
                      <span className={`h-2 w-2 rounded-full ${meta.dotClass}`} />
                      <span>{meta.label}</span>
                    </label>
                  );
                })}
              </div>

              {manualSystems.length > 1 && (
                <div className="pt-1">
                  <label className="block text-slate-400 mb-1">Système principal</label>
                  <select
                    value={manualPrimaryVendor}
                    onChange={(e) => setManualPrimaryVendor(e.target.value as VendorId)}
                    className="w-full sm:w-64 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                  >
                    {manualSystems.map((vId) => (
                      <option key={vId} value={vId}>
                        {VENDOR_REGISTRY[vId].label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Options d'état et de suivi */}
            <div className="flex flex-wrap items-center gap-5 pt-1 text-xs text-slate-300">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={manualIsOnline}
                  onChange={(e) => setManualIsOnline(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-600"
                />
                En ligne
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={manualIsMonitored}
                  onChange={(e) => setManualIsMonitored(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-600"
                />
                Suivi dans le dashboard
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={manualExcludeFromTotals}
                  onChange={(e) => setManualExcludeFromTotals(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-amber-500"
                />
                Exclure (Cascade / Climat)
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={closeManualModal}
                disabled={savingManualDevice}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={savingManualDevice}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-xs font-medium text-white transition"
              >
                {savingManualDevice
                  ? 'Enregistrement...'
                  : editingManualDeviceId
                    ? 'Enregistrer'
                    : "Déclarer l'appareil"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
