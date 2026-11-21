'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  RefreshCw,
  Plus,
  Trash2,
  Sliders,
  CheckCircle2,
  AlertCircle,
  X,
  Home,
  Wifi,
  WifiOff,
  Clock,
} from 'lucide-react';
import type { DashboardPayload, DeviceRecord, DpConfig, EnergyMode } from '@/types';

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
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Création de pièce
  const [roomName, setRoomName] = useState('');
  const [roomColor, setRoomColor] = useState(ROOM_COLORS[0]);
  const [tempMin, setTempMin] = useState('19');
  const [tempMax, setTempMax] = useState('22');
  const [humMin, setHumMin] = useState('40');
  const [humMax, setHumMax] = useState('60');

  // Inspecteur DP
  const [inspectDevice, setInspectDevice] = useState<DeviceRecord | null>(null);
  const [dpDraft, setDpDraft] = useState<DpConfig>({});
  const [savingDp, setSavingDp] = useState(false);

  // Filtre des appareils par pièce ('all' | 'unassigned' | '<roomId>')
  const [roomFilter, setRoomFilter] = useState<string>('all');

  const { unassignedCount, roomDeviceCounts, filteredDevices } = useMemo(() => {
    const counts = new Map<number, number>();
    let unassigned = 0;

    for (const dev of data.devices) {
      if (dev.roomId === null) {
        unassigned += 1;
      } else {
        counts.set(dev.roomId, (counts.get(dev.roomId) ?? 0) + 1);
      }
    }

    const filtered = data.devices.filter((dev) => {
      if (roomFilter === 'all') return true;
      if (roomFilter === 'unassigned') return dev.roomId === null;
      return String(dev.roomId) === roomFilter;
    });

    return {
      unassignedCount: unassigned,
      roomDeviceCounts: counts,
      filteredDevices: filtered,
    };
  }, [data.devices, roomFilter]);

  async function handleSyncTuya() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/tuya/sync', { method: 'POST' });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(json.error || 'Échec de synchronisation');
      setSyncMessage({ ok: true, text: json.message || 'Synchronisation terminée.' });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur Tuya',
      });
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreateRoom(e: FormEvent) {
    e.preventDefault();
    if (!roomName.trim()) return;
    await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: roomName.trim(),
        color: roomColor,
        targetTempMin: Number(tempMin) || 19,
        targetTempMax: Number(tempMax) || 22,
        targetHumidityMin: Number(humMin) || 40,
        targetHumidityMax: Number(humMax) || 60,
      }),
    });
    setRoomName('');
    await onRefresh();
  }

  async function handleDeleteRoom(id: number) {
    await fetch(`/api/rooms?id=${id}`, { method: 'DELETE' });
    await onRefresh();
  }

  async function handleDeviceUpdate(
    deviceId: string,
    updates: Partial<{
      customName: string | null;
      roomId: number | null;
      isMonitored: boolean;
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

  return (
    <div className="space-y-6">
      {/* Synchronisation Tuya */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Appareils Tuya &amp; Pièces</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Importez automatiquement vos appareils, vos pièces et leurs affectations depuis
            Smart Life / Tuya Cloud, ou calibrez les Data Points si nécessaire.
          </p>
        </div>

        <button
          onClick={handleSyncTuya}
          disabled={syncing}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 text-xs font-medium text-white transition"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Synchronisation...' : 'Synchroniser depuis Tuya Cloud'}
        </button>
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

      {/* Gestion des pièces */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form
          onSubmit={handleCreateRoom}
          className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Home className="h-4 w-4 text-indigo-400" />
            Ajouter une pièce
          </h3>

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
            <div className="flex gap-2">
              {ROOM_COLORS.map((c) => (
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
                value={humMin}
                onChange={(e) => setHumMin(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Humidité max (%)</label>
              <input
                type="number"
                value={humMax}
                onChange={(e) => setHumMax(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-medium text-white transition"
          >
            <Plus className="h-4 w-4" />
            Créer la pièce
          </button>
        </form>

        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Pièces configurées ({data.rooms.length})</h3>
            <span className="text-[11px] text-slate-400">Cliquez sur une pièce pour filtrer les appareils</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.rooms.map((r) => {
              const isSelected = roomFilter === String(r.id);
              const count = roomDeviceCounts.get(r.id) ?? 0;
              return (
                <div
                  key={r.id}
                  onClick={() => setRoomFilter(isSelected ? 'all' : String(r.id))}
                  className={`cursor-pointer flex items-center justify-between rounded-xl border px-3.5 py-2.5 transition ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-950/30 ring-1 ring-indigo-500/40'
                      : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-3.5 w-3.5 rounded-full shrink-0"
                      style={{ backgroundColor: r.color }}
                    />
                    <div>
                      <div className="text-xs font-semibold text-white flex items-center gap-2">
                        {r.name}
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-normal text-slate-300">
                          {count}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Cibles : {r.targetTempMin}–{r.targetTempMax}°C · {r.targetHumidityMin}–
                        {r.targetHumidityMax}%
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isSelected) setRoomFilter('all');
                      void handleDeleteRoom(r.id);
                    }}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/15 hover:text-rose-400"
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
                Appareils Tuya détectés ({filteredDevices.length}
                {roomFilter !== 'all' ? ` / ${data.devices.length}` : ''})
              </h3>
              <p className="text-xs text-slate-400">
                Associez chaque appareil à une pièce et choisissez la méthode de calcul des kWh
              </p>
            </div>
          </div>

          {/* Barre de filtres par pièce */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setRoomFilter('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                roomFilter === 'all'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              Tous ({data.devices.length})
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
                <th className="px-4 py-3">Nom affiché</th>
                <th className="px-4 py-3">IP / MAC Address</th>
                <th className="px-4 py-3">Pièce</th>
                <th className="px-4 py-3">Calcul kWh</th>
                <th className="px-4 py-3">Dernières valeurs</th>
                <th className="px-4 py-3">Suivi</th>
                <th className="px-4 py-3 text-right">Data Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredDevices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
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
                Dernier statut brut reçu de Tuya (`lastRawStatus`)
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
    </div>
  );
}
