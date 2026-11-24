import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { rooms } from '@/db/schema';
import { getDemoState } from '@/lib/demo-store';
import { ensureSchemaInitialized, mapDbRoom } from '@/lib/services/shared';
import { VENDOR_SERVER_PLUGINS } from '@/lib/services/vendors';
import { VENDOR_IDS, VENDOR_REGISTRY } from '@/lib/vendors/registry';
import type { RoomRecord, VendorId } from '@/types';

export interface RoomVendorSyncResult {
  vendor: VendorId | 'all';
  roomsFound: number;
  createdCount: number;
  assignedDevicesCount: number;
  mode: 'live' | 'demo';
  message: string;
}

export async function createRoom(input: {
  name: string;
  icon?: string;
  color?: string;
  targetTempMin?: number;
  targetTempMax?: number;
  targetHumidityMin?: number;
  targetHumidityMax?: number;
}): Promise<RoomRecord> {
  const db = getDb();
  if (!db) {
    const state = getDemoState();
    const room: RoomRecord = {
      id: state.nextRoomId++,
      name: input.name.trim(),
      icon: input.icon ?? 'Home',
      color: input.color ?? '#3b82f6',
      targetTempMin: input.targetTempMin ?? 19,
      targetTempMax: input.targetTempMax ?? 22,
      targetHumidityMin: input.targetHumidityMin ?? 40,
      targetHumidityMax: input.targetHumidityMax ?? 60,
      createdAt: new Date().toISOString(),
    };
    state.rooms.push(room);
    return room;
  }

  await ensureSchemaInitialized(db);
  const [created] = await db
    .insert(rooms)
    .values({
      name: input.name.trim(),
      icon: input.icon ?? 'Home',
      color: input.color ?? '#3b82f6',
      targetTempMin: input.targetTempMin ?? 19,
      targetTempMax: input.targetTempMax ?? 22,
      targetHumidityMin: input.targetHumidityMin ?? 40,
      targetHumidityMax: input.targetHumidityMax ?? 60,
    })
    .returning();
  return mapDbRoom(created);
}

export async function updateRoom(
  id: number,
  input: Partial<{
    name: string;
    icon: string;
    color: string;
    targetTempMin: number;
    targetTempMax: number;
    targetHumidityMin: number;
    targetHumidityMax: number;
  }>
): Promise<RoomRecord | null> {
  const normalized: typeof input = {
    ...input,
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
  };

  const db = getDb();
  if (!db) {
    const state = getDemoState();
    const room = state.rooms.find((r) => r.id === id);
    if (!room) return null;
    Object.assign(room, normalized);
    return room;
  }

  await ensureSchemaInitialized(db);
  const [updated] = await db
    .update(rooms)
    .set(normalized)
    .where(eq(rooms.id, id))
    .returning();
  return updated ? mapDbRoom(updated) : null;
}

export async function deleteRoom(id: number): Promise<void> {
  const db = getDb();
  if (!db) {
    const state = getDemoState();
    state.rooms = state.rooms.filter((r) => r.id !== id);
    for (const d of state.devices) {
      if (d.roomId === id) d.roomId = null;
    }
    return;
  }

  await ensureSchemaInitialized(db);
  await db.delete(rooms).where(eq(rooms.id, id));
}

export async function syncRoomsFromVendor(
  vendor: VendorId | 'all' = 'all'
): Promise<RoomVendorSyncResult> {
  if (vendor !== 'all') {
    const plugin = VENDOR_SERVER_PLUGINS[vendor];
    if (!plugin?.syncRooms) {
      throw new Error(`La synchronisation des pièces n'est pas supportée pour ${vendor}.`);
    }
    return plugin.syncRooms();
  }

  const db = getDb();
  const tasks: Array<{ label: string; run: () => Promise<RoomVendorSyncResult> }> = [];

  for (const id of VENDOR_IDS) {
    const plugin = VENDOR_SERVER_PLUGINS[id];
    if (!plugin.syncRooms) continue;
    if (plugin.isVisible && !plugin.isVisible()) continue;

    const ready = plugin.isReadyForRoomSync
      ? await plugin.isReadyForRoomSync(db)
      : !db || plugin.isConfigured();
    if (ready) {
      tasks.push({ label: VENDOR_REGISTRY[id].label, run: plugin.syncRooms });
    }
  }

  if (db && tasks.length === 0) {
    throw new Error(
      'Aucun système configuré ou connecté pour synchroniser les pièces (configurez Tuya, Kasa, Somfy ou connectez Xiaomi Home / Google Home).'
    );
  }

  const results: RoomVendorSyncResult[] = [];
  const errors: string[] = [];

  for (const task of tasks) {
    try {
      results.push(await task.run());
    } catch (err) {
      errors.push(`${task.label} : ${err instanceof Error ? err.message : 'Erreur inconnue'}`);
    }
  }

  if (results.length === 0) {
    throw new Error(errors.join(' | ') || 'Échec de synchronisation des pièces.');
  }

  const roomsFound = results.reduce((sum, r) => sum + r.roomsFound, 0);
  const createdCount = results.reduce((sum, r) => sum + r.createdCount, 0);
  const assignedDevicesCount = results.reduce((sum, r) => sum + r.assignedDevicesCount, 0);
  const mode = results.some((r) => r.mode === 'live') ? 'live' : 'demo';

  const summaryMsg = results.map((r) => r.message).join(' · ');
  const fullMessage =
    errors.length > 0 ? `${summaryMsg} · Avertissement : ${errors.join(' | ')}` : summaryMsg;

  return {
    vendor: 'all',
    roomsFound,
    createdCount,
    assignedDevicesCount,
    mode,
    message: fullMessage,
  };
}
