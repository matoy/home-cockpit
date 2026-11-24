import { and, eq, isNull } from 'drizzle-orm';
import type { AppDatabase } from '@/db';
import { devices, deviceVendorLinks, metricReadings, vendorConnections } from '@/db/schema';
import { getDemoState } from '@/lib/demo-store';
import { ensureSchemaInitialized } from '@/lib/services/shared';
import type { VendorConnectionSummary, VendorId } from '@/types';

/**
 * Charge l'index des appareils et des liens d'un vendor donné en base Postgres.
 */
export async function loadVendorDeviceIndex(db: AppDatabase, vendor: VendorId): Promise<{
  deviceById: Map<string, typeof devices.$inferSelect>;
  linkByExternalId: Map<string, typeof deviceVendorLinks.$inferSelect>;
}> {
  const [existingDeviceRows, linkRows] = await Promise.all([
    db.select().from(devices),
    db.select().from(deviceVendorLinks).where(eq(deviceVendorLinks.vendor, vendor)),
  ]);
  return {
    deviceById: new Map(existingDeviceRows.map((d) => [d.id, d])),
    linkByExternalId: new Map(linkRows.map((l) => [l.externalId, l])),
  };
}

/**
 * Construit un map `externalId -> deviceId` pour accélérer les collectes périodiques.
 */
export async function loadVendorExternalDeviceMap(
  db: AppDatabase,
  vendor: VendorId
): Promise<Map<string, string>> {
  const links = await db
    .select()
    .from(deviceVendorLinks)
    .where(eq(deviceVendorLinks.vendor, vendor));
  return new Map(links.map((l) => [l.externalId, l.deviceId]));
}

/**
 * Génère un identifiant unique dans `devices` si une collision de préfixe survient.
 */
export function ensureUniqueDeviceId(
  baseId: string,
  hasId: (id: string) => boolean,
  now: Date
): string {
  if (!hasId(baseId)) return baseId;
  return `${baseId}_${now.getTime().toString(36).slice(-4)}`;
}

/**
 * Renseigne rétroactivement `roomId` sur les mesures orphelines d'un appareil nouvellement assigné.
 */
export async function backfillMissingReadingRoomId(
  db: AppDatabase,
  deviceId: string,
  roomId: number | null,
  previousRoomId: number | null
): Promise<void> {
  if (roomId === null || roomId === previousRoomId) return;
  await db
    .update(metricReadings)
    .set({ roomId })
    .where(and(eq(metricReadings.deviceId, deviceId), isNull(metricReadings.roomId)));
}

/**
 * Réinitialise la session/connexion stockée d'un fournisseur (OAuth / QR Code / token).
 */
export async function disconnectVendorConnection(vendor: VendorId): Promise<void> {
  const db = (await import('@/db')).getDb();
  if (!db) {
    const state = getDemoState();
    state.vendorConnections[vendor].connected = false;
    state.vendorConnections[vendor].lastError = null;
    return;
  }

  await ensureSchemaInitialized(db);
  await db
    .update(vendorConnections)
    .set({
      status: 'disconnected',
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(vendorConnections.vendor, vendor));
}

/**
 * Met à jour rapidement `status`, `lastSyncedAt` et `lastError` d'un connecteur existant.
 */
export async function upsertVendorConnectionState(
  db: AppDatabase,
  params: {
    vendor: VendorId;
    mode: VendorConnectionSummary['mode'];
    status: 'connected' | 'error' | 'disconnected';
    lastSyncedAt?: Date;
    lastError: string | null;
  }
): Promise<void> {
  const now = new Date();
  await db
    .insert(vendorConnections)
    .values({
      vendor: params.vendor,
      mode: params.mode,
      status: params.status,
      ...(params.lastSyncedAt ? { lastSyncedAt: params.lastSyncedAt } : {}),
      lastError: params.lastError,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: vendorConnections.vendor,
      set: {
        status: params.status,
        ...(params.lastSyncedAt ? { lastSyncedAt: params.lastSyncedAt } : {}),
        lastError: params.lastError,
        updatedAt: now,
      },
    });
}
