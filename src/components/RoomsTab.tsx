'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  RefreshCw,
  Plus,
  Trash2,
  Home,
  Pencil,
  Save,
  X,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  BookOpen,
  Search,
  ArrowRight,
  Zap,
  Thermometer,
  Droplets,
} from 'lucide-react';
import { VENDOR_REGISTRY } from '@/lib/vendors/registry';
import type {
  ComfortStatus,
  DashboardPayload,
  GoogleHomeMode,
  RoomRecord,
  VendorId,
} from '@/types';

interface RoomsTabProps {
  data: DashboardPayload;
  onRefresh: () => Promise<void>;
  onOpenRoomDevices: (roomId: string) => void;
  onOpenGoogleGuide?: () => void;
}

const ROOM_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#f43f5e'];

const COMFORT_BADGE_CLASSES: Record<ComfortStatus['tone'], string> = {
  emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  sky: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  rose: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  slate: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
};

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function RoomsTab({
  data,
  onRefresh,
  onOpenRoomDevices,
  onOpenGoogleGuide,
}: RoomsTabProps) {
  // Synchronisation par système
  const [syncingTarget, setSyncingTarget] = useState<'tuya' | 'google_home' | 'all' | null>(null);
  const [selectedGoogleMode, setSelectedGoogleMode] = useState<GoogleHomeMode>(
    data.env.googleHomeMode ?? 'mcp'
  );
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Recherche rapide dans les pièces
  const [searchQuery, setSearchQuery] = useState('');

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

  const tuyaVendor = data.vendors.find((v) => v.vendor === 'tuya');
  const ghVendor = data.vendors.find((v) => v.vendor === 'google_home');
  const isGhConnected = Boolean(ghVendor?.connected);

  const { roomStatsById, summaryByRoomId, filteredRooms } = useMemo(() => {
    const stats = new Map<number, { count: number; systems: VendorId[] }>();

    for (const dev of data.devices) {
      if (dev.roomId === null) continue;
      const entry = stats.get(dev.roomId) ?? { count: 0, systems: [] };
      entry.count += 1;
      for (const sys of dev.systems) {
        if (!entry.systems.includes(sys)) {
          entry.systems.push(sys);
        }
      }
      stats.set(dev.roomId, entry);
    }

    const summaryMap = new Map(data.roomSummaries.map((rs) => [rs.room.id, rs]));

    const tokens = normalizeSearchText(searchQuery).trim().split(/\s+/).filter(Boolean);
    const filtered = data.rooms.filter((room) => {
      if (tokens.length === 0) return true;
      const st = stats.get(room.id);
      const haystack = normalizeSearchText(
        [
          room.name,
          ...(st?.systems.flatMap((s) => [s, VENDOR_REGISTRY[s].label]) ?? []),
        ].join(' ')
      );
      return tokens.every((tok) => haystack.includes(tok));
    });

    return {
      roomStatsById: stats,
      summaryByRoomId: summaryMap,
      filteredRooms: filtered,
    };
  }, [data.devices, data.rooms, data.roomSummaries, searchQuery]);

  async function handleSyncRooms(target: 'tuya' | 'google_home' | 'all') {
    setSyncingTarget(target);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/rooms/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor: target }),
      });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(json.error || 'Échec de synchronisation des pièces.');
      }
      setSyncMessage({
        ok: true,
        text: json.message || 'Pièces synchronisées avec succès.',
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur lors de la synchronisation.',
      });
    } finally {
      setSyncingTarget(null);
    }
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

  return (
    <div className="space-y-6">
      {/* Section 1 : Synchronisation des pièces depuis les systèmes */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Synchronisation des pièces depuis vos systèmes
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              100 % lecture seule · importe les pièces manquantes et met à jour l&apos;affectation
              des appareils sans écraser vos couleurs ni vos cibles °C / %.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleSyncRooms('all')}
            disabled={syncingTarget !== null}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncingTarget === 'all' ? 'animate-spin' : ''}`} />
            {syncingTarget === 'all' ? 'Synchronisation...' : 'Tout synchroniser'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Tuya Cloud */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 flex flex-col justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_REGISTRY.tuya.badgeClass}`}
                >
                  {VENDOR_REGISTRY.tuya.label}
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
                Importe vos espaces / pièces Smart Life &amp; Tuya et rattache les appareils Tuya
                correspondants (prioritaire sur Google Home).
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {tuyaVendor?.lastSyncedAt
                  ? `Synchro : ${new Date(tuyaVendor.lastSyncedAt).toLocaleString('fr-FR')}`
                  : 'Aucune synchronisation récente'}
              </span>
              <button
                type="button"
                onClick={() => void handleSyncRooms('tuya')}
                disabled={syncingTarget !== null}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white transition"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${syncingTarget === 'tuya' ? 'animate-spin' : ''}`}
                />
                {syncingTarget === 'tuya' ? 'Synchronisation...' : 'Synchroniser pièces Tuya'}
              </button>
            </div>
          </div>

          {/* Google Home */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 flex flex-col justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_REGISTRY.google_home.badgeClass}`}
                  >
                    {VENDOR_REGISTRY.google_home.label}
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
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="mcp">Mode Home MCP (tous appareils)</option>
                    <option value="sdm">Mode Nest SDM (Nest)</option>
                  </select>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Importe les pièces Google Home / Nest ({selectedGoogleMode.toUpperCase()}) et
                complète les appareils non encore assignés.
              </p>
              {ghVendor?.lastError && (
                <p className="text-[11px] text-rose-300 mt-1">{ghVendor.lastError}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {ghVendor?.lastSyncedAt
                  ? `Synchro : ${new Date(ghVendor.lastSyncedAt).toLocaleString('fr-FR')}`
                  : 'Lecture seule · zéro commande envoyée'}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {onOpenGoogleGuide && (
                  <button
                    type="button"
                    onClick={onOpenGoogleGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white transition"
                    title="Afficher le déroulé opératoire pas-à-pas Google Home"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-sky-400" />
                    Déroulé setup
                  </button>
                )}

                {data.env.mode === 'live' && !isGhConnected ? (
                  <a
                    href={`/api/vendors/google-home/oauth/start?mode=${selectedGoogleMode}&returnTab=rooms`}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 px-3 py-1.5 text-xs font-medium text-white transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Connecter Google Home ({selectedGoogleMode.toUpperCase()})
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSyncRooms('google_home')}
                    disabled={syncingTarget !== null}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white transition"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${syncingTarget === 'google_home' ? 'animate-spin' : ''}`}
                    />
                    {syncingTarget === 'google_home'
                      ? 'Synchronisation...'
                      : 'Synchroniser pièces Google Home'}
                  </button>
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
      </div>

      {/* Section 2 : Formulaire pièce + Pièces configurées */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form
          onSubmit={handleSubmitRoom}
          className={`rounded-2xl border p-5 space-y-4 transition self-start ${
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

        {/* Liste des pièces configurées */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Pièces configurées ({filteredRooms.length}
                {searchQuery.trim() ? ` / ${data.rooms.length}` : ''})
              </h3>
              <p className="text-[11px] text-slate-400">
                Cliquez sur une pièce pour modifier sa couleur et ses cibles de confort
              </p>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrer les pièces..."
                aria-label="Filtrer les pièces"
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
          </div>

          {filteredRooms.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 px-4 py-10 text-center text-xs text-slate-400 space-y-2">
              <div>
                {data.rooms.length === 0
                  ? 'Aucune pièce configurée pour le moment.'
                  : 'Aucune pièce ne correspond à votre recherche.'}
              </div>
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                >
                  Réinitialiser le filtre
                </button>
              ) : null}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredRooms.map((r) => {
                const isEditing = editingRoomId === r.id;
                const stats = roomStatsById.get(r.id);
                const summary = summaryByRoomId.get(r.id);
                const count = stats?.count ?? 0;
                const systems = stats?.systems ?? [];

                return (
                  <div
                    key={r.id}
                    onClick={() => {
                      if (isEditing) {
                        resetRoomForm();
                      } else {
                        selectRoomForEdit(r);
                      }
                    }}
                    className={`cursor-pointer rounded-xl border p-3.5 transition flex flex-col justify-between gap-3 ${
                      isEditing
                        ? 'border-indigo-500 bg-indigo-950/35 ring-1 ring-indigo-500/50'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span
                          className="h-3.5 w-3.5 rounded-full shrink-0 mt-0.5"
                          style={{ backgroundColor: r.color }}
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white flex flex-wrap items-center gap-1.5">
                            <span className="truncate">{r.name}</span>
                            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-normal text-slate-300">
                              {count} app.
                            </span>
                            {isEditing && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                                <Pencil className="h-2.5 w-2.5" />
                                En édition
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Cibles : {r.targetTempMin}–{r.targetTempMax}°C · {r.targetHumidityMin}–
                            {r.targetHumidityMax}%
                          </div>
                        </div>
                      </div>

                      {summary && (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium shrink-0 ${
                            COMFORT_BADGE_CLASSES[summary.comfort.tone]
                          }`}
                        >
                          {summary.comfort.label}
                        </span>
                      )}
                    </div>

                    {/* Systèmes + aperçu métriques */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="flex flex-wrap items-center gap-1">
                        {systems.length === 0 ? (
                          <span className="text-[10px] text-slate-500">Aucun appareil rattaché</span>
                        ) : (
                          systems.map((sys) => {
                            const meta = VENDOR_REGISTRY[sys];
                            return (
                              <span
                                key={sys}
                                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.2 text-[10px] font-medium ${meta.badgeClass}`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                                {meta.label}
                              </span>
                            );
                          })
                        )}
                      </div>

                      {summary && (
                        <div className="flex items-center gap-2 font-mono text-[10.5px] text-slate-400">
                          <span className="inline-flex items-center gap-0.5 text-indigo-300">
                            <Zap className="h-2.5 w-2.5" />
                            {summary.currentPowerW.toFixed(0)}W
                          </span>
                          {summary.currentTempC !== null && (
                            <span className="inline-flex items-center gap-0.5 text-emerald-300">
                              <Thermometer className="h-2.5 w-2.5" />
                              {summary.currentTempC.toFixed(1)}°C
                            </span>
                          )}
                          {summary.currentHumidityPct !== null && (
                            <span className="inline-flex items-center gap-0.5 text-sky-300">
                              <Droplets className="h-2.5 w-2.5" />
                              {summary.currentHumidityPct.toFixed(0)}%
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions carte */}
                    <div className="flex items-center justify-between gap-2 border-t border-slate-800/80 pt-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenRoomDevices(String(r.id));
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition"
                      >
                        Voir appareils
                        <ArrowRight className="h-3 w-3 text-indigo-400" />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteRoom(r.id);
                        }}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/15 hover:text-rose-400 transition"
                        title="Supprimer la pièce"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
