'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  RefreshCw,
  Plus,
  Trash2,
  Sliders,
  CheckCircle2,
  AlertCircle,
  X,
  Home,
  Pencil,
  Save,
  Wifi,
  WifiOff,
  Clock,
  Layers,
  Link2,
  GitMerge,
  Unlink,
  ExternalLink,
} from 'lucide-react';
import { VENDOR_IDS, VENDOR_REGISTRY } from '@/lib/vendors/registry';
import type {
  DashboardPayload,
  DeviceRecord,
  DpConfig,
  EnergyMode,
  GoogleHomeMode,
  RoomRecord,
  SystemFilter,
  VendorId,
} from '@/types';

interface DevicesRoomsTabProps {
  data: DashboardPayload;
  onRefresh: () => Promise<void>;
}

const ROOM_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#f43f5e'];

const SCALE_OPTIONS = [
  { label: '× 1 (brut)', value: 1 },
  { label: '÷ 10 (× 0.1)', value: 0.1 },
  { label: '÷ 100 (× 0.01)', value: 0.01 },
  { label: '÷ 1000 (× 0.001)', value: 0.001 },
];

export function DevicesRoomsTab({ data, onRefresh }: DevicesRoomsTabProps) {
  const [syncingTuya, setSyncingTuya] = useState(false);
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);
  const [selectedGoogleMode, setSelectedGoogleMode] = useState<GoogleHomeMode>(
    data.env.googleHomeMode ?? 'mcp'
  );
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dismissedDuplicates, setDismissedDuplicates] = useState<string[]>([]);
  const [mergingId, setMergingId] = useState<string | null>(null);

  // Création / édition de pièce
  const [editingRoomId, setEditingRoomId] = useState<number | null>(null);
  const [roomName, setRoomName] = useState('');
  const [roomColor, setRoomColor] = useState(ROOM_COLORS[0]);
  const [tempMin, setTempMin] = useState('19');
  const [tempMax, setTempMax] = useState('22');
  const [humMin, setHumMin] = useState('40');
  const [humMax, setHumMax] = useState('60');
  const [savingRoom, setSavingRoom] = useState(false);
  const [roomFeedback, setRoomFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Inspecteur DP
  const [inspectDevice, setInspectDevice] = useState<DeviceRecord | null>(null);
  const [dpDraft, setDpDraft] = useState<DpConfig>({});
  const [savingDp, setSavingDp] = useState(false);

  // Modale Systèmes & Fusion
  const [manageSystemsDeviceId, setManageSystemsDeviceId] = useState<string | null>(null);
  const [mergeSourceId, setMergeSourceId] = useState<string>('');
  const [savingLink, setSavingLink] = useState(false);
  const [linkFeedback, setLinkFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Filtre des appareils par système & pièce
  const [systemFilter, setSystemFilter] = useState<SystemFilter | 'multi'>(
    data.selectedSystem ?? 'all'
  );
  const [roomFilter, setRoomFilter] = useState<string>('all');

  useEffect(() => {
    setSystemFilter(data.selectedSystem ?? 'all');
  }, [data.selectedSystem]);

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

    const matchesSystem = (dev: DeviceRecord): boolean => {
      if (systemFilter === 'all') return true;
      if (systemFilter === 'multi') return dev.systems.length > 1;
      return dev.systems.includes(systemFilter);
    };

    const counts = new Map<number, number>();
    let unassigned = 0;

    for (const dev of data.devices) {
      if (dev.systems.includes('tuya')) sysCounts.tuya += 1;
      if (dev.systems.includes('google_home')) sysCounts.google_home += 1;
      if (dev.systems.length > 1) sysCounts.multi += 1;

      if (!matchesSystem(dev)) continue;

      if (dev.roomId === null) {
        unassigned += 1;
      } else {
        counts.set(dev.roomId, (counts.get(dev.roomId) ?? 0) + 1);
      }
    }

    const filtered = data.devices.filter((dev) => {
      if (!matchesSystem(dev)) return false;
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
  }, [data.devices, roomFilter, systemFilter]);

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

  function resetRoomForm() {
    setEditingRoomId(null);
    setRoomName('');
    setRoomColor(ROOM_COLORS[0]);
    setTempMin('19');
    setTempMax('22');
    setHumMin('40');
    setHumMax('60');
    setRoomFeedback(null);
  }

  function selectRoomForEdit(room: RoomRecord) {
    setEditingRoomId(room.id);
    setRoomName(room.name);
    setRoomColor(room.color || ROOM_COLORS[0]);
    setTempMin(String(room.targetTempMin));
    setTempMax(String(room.targetTempMax));
    setHumMin(String(room.targetHumidityMin));
    setHumMax(String(room.targetHumidityMax));
    setRoomFeedback(null);
  }

  async function handleSubmitRoom(e: FormEvent) {
    e.preventDefault();
    const trimmedName = roomName.trim();
    if (!trimmedName) {
      setRoomFeedback({ ok: false, text: 'Le nom de la pièce est requis.' });
      return;
    }

    const parsedTempMin = tempMin.trim() === '' ? 19 : Number(tempMin);
    const parsedTempMax = tempMax.trim() === '' ? 22 : Number(tempMax);
    const parsedHumMin = humMin.trim() === '' ? 40 : Number(humMin);
    const parsedHumMax = humMax.trim() === '' ? 60 : Number(humMax);

    if (
      !Number.isFinite(parsedTempMin) ||
      !Number.isFinite(parsedTempMax) ||
      !Number.isFinite(parsedHumMin) ||
      !Number.isFinite(parsedHumMax)
    ) {
      setRoomFeedback({ ok: false, text: 'Veuillez saisir des valeurs numériques valides.' });
      return;
    }

    if (parsedTempMin > parsedTempMax) {
      setRoomFeedback({
        ok: false,
        text: 'La température min doit être inférieure ou égale à la température max.',
      });
      return;
    }

    if (parsedHumMin < 0 || parsedHumMax > 100 || parsedHumMin > parsedHumMax) {
      setRoomFeedback({
        ok: false,
        text: "L'humidité cible doit être comprise entre 0 et 100 % (min ≤ max).",
      });
      return;
    }

    setSavingRoom(true);
    setRoomFeedback(null);
    try {
      const isEditing = editingRoomId !== null;
      const res = await fetch('/api/rooms', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isEditing ? { id: editingRoomId } : {}),
          name: trimmedName,
          color: roomColor,
          targetTempMin: parsedTempMin,
          targetTempMax: parsedTempMax,
          targetHumidityMin: parsedHumMin,
          targetHumidityMax: parsedHumMax,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error || "Échec de l'enregistrement de la pièce.");
      }

      await onRefresh();
      if (isEditing) {
        setRoomFeedback({ ok: true, text: `Pièce « ${trimmedName} » mise à jour.` });
      } else {
        resetRoomForm();
        setRoomFeedback({ ok: true, text: `Pièce « ${trimmedName} » créée.` });
      }
    } catch (err) {
      setRoomFeedback({
        ok: false,
        text: err instanceof Error ? err.message : "Erreur lors de l'enregistrement.",
      });
    } finally {
      setSavingRoom(false);
    }
  }

  async function handleDeleteRoom(id: number) {
    const res = await fetch(`/api/rooms?id=${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setRoomFeedback({
        ok: false,
        text: json.error || 'Échec de la suppression de la pièce.',
      });
      return;
    }
    if (editingRoomId === id) {
      resetRoomForm();
    }
    await onRefresh();
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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

        {/* Google Home */}
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

      {/* Gestion des pièces */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form
          onSubmit={handleSubmitRoom}
          className={`rounded-2xl border p-5 space-y-4 transition ${
            editingRoomId !== null
              ? 'border-indigo-500/50 bg-slate-900/90 ring-1 ring-indigo-500/20'
              : 'border-slate-800 bg-slate-900/70'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              {editingRoomId !== null ? (
                <>
                  <Pencil className="h-4 w-4 text-indigo-400" />
                  Modifier la pièce
                </>
              ) : (
                <>
                  <Home className="h-4 w-4 text-indigo-400" />
                  Ajouter une pièce
                </>
              )}
            </h3>
            {editingRoomId !== null && (
              <button
                type="button"
                onClick={resetRoomForm}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2 py-1 text-[11px] text-slate-300 transition"
                title="Revenir au mode ajout"
              >
                <X className="h-3.5 w-3.5" />
                Annuler
              </button>
            )}
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Nom de la pièce</label>
            <input
              type="text"
              required
              placeholder="ex: Buanderie, Garage..."
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Couleur sur les graphiques</label>
            <div className="flex flex-wrap items-center gap-2">
              {(ROOM_COLORS.includes(roomColor) ? ROOM_COLORS : [...ROOM_COLORS, roomColor]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setRoomColor(c)}
                  className={`h-6 w-6 rounded-full border-2 transition ${
                    roomColor === c ? 'border-white scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <label
                title="Couleur personnalisée"
                className="relative inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-dashed border-slate-500 bg-slate-950 text-[11px] font-semibold text-slate-300 hover:border-white transition overflow-hidden"
              >
                <span>+</span>
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(roomColor) ? roomColor : '#3b82f6'}
                  onChange={(e) => setRoomColor(e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  aria-label="Couleur personnalisée"
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Temp. cible min (°C)</label>
              <input
                type="number"
                step="0.5"
                value={tempMin}
                onChange={(e) => setTempMin(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Temp. cible max (°C)</label>
              <input
                type="number"
                step="0.5"
                value={tempMax}
                onChange={(e) => setTempMax(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Humidité min (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={humMin}
                onChange={(e) => setHumMin(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Humidité max (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={humMax}
                onChange={(e) => setHumMax(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
              />
            </div>
          </div>

          {roomFeedback && (
            <div
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                roomFeedback.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              }`}
            >
              {roomFeedback.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              )}
              <span>{roomFeedback.text}</span>
            </div>
          )}

          {editingRoomId !== null ? (
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={savingRoom}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 text-xs font-medium text-white transition"
              >
                <Save className="h-4 w-4" />
                {savingRoom ? 'Enregistrement...' : 'Enregistrer'}
              </button>
              <button
                type="button"
                onClick={resetRoomForm}
                disabled={savingRoom}
                className="rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-slate-300 transition"
              >
                Annuler
              </button>
            </div>
          ) : (
            <button
              type="submit"
              disabled={savingRoom}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-xs font-medium text-white transition"
            >
              <Plus className="h-4 w-4" />
              {savingRoom ? 'Création...' : 'Créer la pièce'}
            </button>
          )}
        </form>

        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Pièces configurées ({data.rooms.length})</h3>
            <span className="text-[11px] text-slate-400">
              Cliquez sur une pièce pour la modifier et filtrer ses appareils
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.rooms.map((r) => {
              const isEditing = editingRoomId === r.id;
              const isFiltered = roomFilter === String(r.id);
              const count = roomDeviceCounts.get(r.id) ?? 0;
              return (
                <div
                  key={r.id}
                  onClick={() => {
                    if (isEditing) {
                      resetRoomForm();
                      if (isFiltered) setRoomFilter('all');
                    } else {
                      selectRoomForEdit(r);
                      setRoomFilter(String(r.id));
                    }
                  }}
                  className={`cursor-pointer flex items-center justify-between rounded-xl border px-3.5 py-2.5 transition ${
                    isEditing
                      ? 'border-indigo-500 bg-indigo-950/35 ring-1 ring-indigo-500/50'
                      : isFiltered
                        ? 'border-indigo-500/40 bg-indigo-950/15'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="h-3.5 w-3.5 rounded-full shrink-0"
                      style={{ backgroundColor: r.color }}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white flex flex-wrap items-center gap-2">
                        <span className="truncate">{r.name}</span>
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-normal text-slate-300">
                          {count}
                        </span>
                        {isEditing && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                            <Pencil className="h-2.5 w-2.5" />
                            En édition
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Cibles : {r.targetTempMin}–{r.targetTempMax}°C · {r.targetHumidityMin}–
                        {r.targetHumidityMax}%
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isEditing) resetRoomForm();
                      if (isFiltered) setRoomFilter('all');
                      void handleDeleteRoom(r.id);
                    }}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/15 hover:text-rose-400 shrink-0"
                    title="Supprimer la pièce"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Liste des appareils */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Appareils détectés ({filteredDevices.length}
                {roomFilter !== 'all' || systemFilter !== 'all' ? ` / ${data.devices.length}` : ''})
              </h3>
              <p className="text-xs text-slate-400">
                Filtrez par système ou pièce, déclarez les liaisons multi-systèmes sans doublons et calibrez vos calculs kWh
              </p>
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
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Appareil</th>
                <th className="px-4 py-3">Système</th>
                <th className="px-4 py-3">Nom affiché</th>
                <th className="px-4 py-3">IP / MAC Address</th>
                <th className="px-4 py-3">Pièce</th>
                <th className="px-4 py-3">Calcul kWh</th>
                <th className="px-4 py-3">Dernières valeurs</th>
                <th
                  className="px-4 py-3"
                  title="Décocher pour ignorer complètement cet appareil lors des collectes et dans le dashboard"
                >
                  Suivi
                </th>
                <th
                  className="px-4 py-3"
                  title="Cocher pour exclure l'appareil des totaux électriques (prises en cascade) et des mesures/compteurs de la page Climat (ex. pilotes de radiateurs)"
                >
                  Exclure (Cascade / Climat)
                </th>
                <th className="px-4 py-3 text-right">Data Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredDevices.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-xs text-slate-500">
                    Aucun appareil dans ce filtre.
                  </td>
                </tr>
              ) : (
                filteredDevices.map((dev) => (
                <tr key={dev.id} className="hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {dev.isOnline ? (
                        <Wifi className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <WifiOff className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                      )}
                      <div>
                        <div className="font-medium text-white">{dev.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {dev.productName || dev.tuyaCategory || dev.id}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3">
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
                        title="Gérer les systèmes liés (déclarer Google Home / fusionner un doublon)"
                        className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/80 hover:border-slate-500 hover:bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 transition"
                      >
                        <Link2 className="h-2.5 w-2.5" />
                        Lier
                      </button>
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <input
                      type="text"
                      defaultValue={dev.customName ?? ''}
                      placeholder={dev.name}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val !== (dev.customName ?? '')) {
                          void handleDeviceUpdate(dev.id, { customName: val || null });
                        }
                      }}
                      className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-white focus:border-indigo-500 focus:outline-none"
                    />
                  </td>

                  <td className="px-4 py-3 font-mono text-[11px] leading-tight whitespace-nowrap">
                    <div className="text-slate-200">{dev.ipAddress || '—'}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {dev.macAddress || '—'}
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <select
                      value={dev.roomId ?? ''}
                      onChange={(e) =>
                        void handleDeviceUpdate(dev.id, {
                          roomId: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="">Non assignée</option>
                      {data.rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="px-4 py-3">
                    <select
                      value={dev.energyMode}
                      onChange={(e) =>
                        void handleDeviceUpdate(dev.id, {
                          energyMode: e.target.value as EnergyMode,
                        })
                      }
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="hybrid">Hybride Auto (add_ele + W×Δt)</option>
                      <option value="add_ele">Compteur Tuya (add_ele)</option>
                      <option value="integration">Intégration (W × 0.5h)</option>
                    </select>
                  </td>

                  <td className="px-4 py-3 font-mono text-[11px] text-slate-300">
                    <div className="flex flex-wrap gap-2">
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

                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={dev.isMonitored}
                      onChange={(e) =>
                        void handleDeviceUpdate(dev.id, { isMonitored: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                    />
                  </td>

                  <td className="px-4 py-3">
                    <label
                      className="inline-flex items-center gap-1.5 cursor-pointer"
                      title="Si coché, cet appareil est exclu des totaux électriques (prises en cascade) et des mesures/compteurs de la page Climat"
                    >
                      <input
                        type="checkbox"
                        checked={dev.excludeFromTotals}
                        onChange={(e) =>
                          void handleDeviceUpdate(dev.id, {
                            excludeFromTotals: e.target.checked,
                          })
                        }
                        className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-amber-500 focus:ring-amber-500"
                      />
                      {dev.excludeFromTotals && (
                        <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-300">
                          Exclu
                        </span>
                      )}
                    </label>
                  </td>

                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openInspector(dev)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] text-slate-200"
                    >
                      <Sliders className="h-3 w-3" />
                      Inspecteur DP
                    </button>
                  </td>
                </tr>
                ))
              )}
            </tbody>
          </table>
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
    </div>
  );
}
