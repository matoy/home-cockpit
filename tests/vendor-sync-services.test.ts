import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDatabase } from '@/db';
import { getDemoState } from '@/lib/demo-store';
import { exportBackupArchive } from '@/lib/backup-service';
import { runCollection, syncRoomsFromVendor } from '@/lib/data-service';
import {
  VENDOR_SERVER_PLUGINS,
  buildVendorConnectionSummariesFromState,
} from '@/lib/services/vendors';
import {
  backfillMissingReadingRoomId,
  disconnectVendorConnection,
  ensureUniqueDeviceId,
  loadVendorDeviceIndex,
  loadVendorExternalDeviceMap,
  upsertVendorConnectionState,
} from '@/lib/services/vendors/upsert-helper';
import { VENDOR_IDS } from '@/lib/vendors/registry';

describe('vendor sync services & upsert helpers', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__tuyaDemoState = undefined;
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('APP_PASSWORD', 'test-password');
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('generates collision-free IDs via ensureUniqueDeviceId', () => {
    const now = new Date('2026-11-24T12:00:00.000Z');
    const existing = new Set(['kasa_abc123']);

    expect(ensureUniqueDeviceId('kasa_xyz', (id) => existing.has(id), now)).toBe('kasa_xyz');

    const deduped = ensureUniqueDeviceId('kasa_abc123', (id) => existing.has(id), now);
    expect(deduped).not.toBe('kasa_abc123');
    expect(deduped.startsWith('kasa_abc123_')).toBe(true);
  });

  it('queries device indexes, backfills missing room IDs, and upserts connection state on mocked DB', async () => {
    const mockDevices = [
      { id: 'kasa_1', name: 'Plug 1' },
      { id: 'kasa_2', name: 'Plug 2' },
    ];
    const mockLinks = [
      { id: 1, deviceId: 'kasa_1', vendor: 'kasa', externalId: 'ext-1' },
    ];

    const updateWhereMock = vi.fn().mockResolvedValue(undefined);
    const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
    const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi.fn(() => ({ onConflictDoUpdate: onConflictDoUpdateMock }));

    let selectCall = 0;
    const mockDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => {
          selectCall++;
          if (selectCall === 1) {
            return Promise.resolve(mockDevices);
          }
          return {
            where: vi.fn().mockResolvedValue(mockLinks),
          };
        }),
      })),
      update: vi.fn(() => ({ set: updateSetMock })),
      insert: vi.fn(() => ({ values: valuesMock })),
    } as unknown as AppDatabase;

    const index = await loadVendorDeviceIndex(mockDb, 'kasa');
    expect(index.deviceById.size).toBe(2);
    expect(index.linkByExternalId.get('ext-1')?.deviceId).toBe('kasa_1');

    const extMap = await loadVendorExternalDeviceMap(mockDb, 'kasa');
    expect(extMap.get('ext-1')).toBe('kasa_1');

    // No-op when roomId is null or unchanged
    await backfillMissingReadingRoomId(mockDb, 'kasa_1', null, null);
    await backfillMissingReadingRoomId(mockDb, 'kasa_1', 3, 3);
    expect(updateSetMock).not.toHaveBeenCalled();

    // Updates orphan readings when roomId changes
    await backfillMissingReadingRoomId(mockDb, 'kasa_1', 4, null);
    expect(updateSetMock).toHaveBeenCalledWith({ roomId: 4 });
    expect(updateWhereMock).toHaveBeenCalledTimes(1);

    const syncedAt = new Date('2026-11-24T12:00:00.000Z');
    await upsertVendorConnectionState(mockDb, {
      vendor: 'kasa',
      mode: 'cloud_account',
      status: 'connected',
      lastSyncedAt: syncedAt,
      lastError: null,
    });
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor: 'kasa',
        mode: 'cloud_account',
        status: 'connected',
        lastSyncedAt: syncedAt,
        lastError: null,
      })
    );
    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('builds connection summaries accurately for both demo and live DB states', () => {
    const state = getDemoState();
    const demoSummaries = buildVendorConnectionSummariesFromState({
      devices: state.devices,
      demoConnections: state.vendorConnections,
    });

    expect(demoSummaries).toHaveLength(VENDOR_IDS.length);
    for (const summary of demoSummaries) {
      expect(VENDOR_IDS).toContain(summary.vendor);
      expect(typeof summary.label).toBe('string');
      expect(summary.devicesCount).toBeGreaterThanOrEqual(0);
    }

    vi.stubEnv('DAIKIN_CLIENT_ID', 'test-dk-id');
    vi.stubEnv('DAIKIN_CLIENT_SECRET', 'test-dk-secret');

    const syncedAt = new Date('2026-11-24T10:00:00.000Z');
    const connMap = new Map();
    connMap.set('daikin', {
      vendor: 'daikin',
      mode: 'oauth_prod',
      status: 'connected',
      accessToken: 'enc:abc',
      refreshToken: null,
      tokenExpiresAt: null,
      config: null,
      lastSyncedAt: syncedAt,
      lastError: null,
      updatedAt: syncedAt,
    });

    const liveSummaries = buildVendorConnectionSummariesFromState({
      devices: state.devices,
      connByVendor: connMap,
    });
    const daikinSummary = liveSummaries.find((s) => s.vendor === 'daikin');
    expect(daikinSummary?.connected).toBe(true);
    expect(daikinSummary?.lastSyncedAt).toBe(syncedAt.toISOString());
  });

  it('syncs devices, syncs rooms, and disconnects cleanly for every plugin in demo mode', async () => {
    for (const vendorId of VENDOR_IDS) {
      const plugin = VENDOR_SERVER_PLUGINS[vendorId];
      const syncResult = await plugin.syncDevices();
      expect(syncResult.syncedCount).toBeGreaterThanOrEqual(0);
      expect(syncResult.newCount).toBeGreaterThanOrEqual(0);
      expect(syncResult.mode).toBe('demo');
      expect(syncResult.message.length).toBeGreaterThan(0);

      if (plugin.syncRooms) {
        const roomSyncResult = await plugin.syncRooms();
        expect(roomSyncResult.vendor).toBe(vendorId);
        expect(roomSyncResult.mode).toBe('demo');
      }

      if (plugin.disconnect) {
        await plugin.disconnect();
        const afterState = getDemoState();
        expect(afterState.vendorConnections[vendorId].connected).toBe(false);
        expect(afterState.vendorConnections[vendorId].lastError).toBeNull();
      }
    }

    await disconnectVendorConnection('somfy');
    expect(getDemoState().vendorConnections.somfy.connected).toBe(false);
  });

  it('runs demo telemetry collection, room sync, and full Gzip backup export', async () => {
    const initialLogsCount = getDemoState().logs.length;
    const log = await runCollection('manual');
    expect(log.status).toBe('success');
    expect(log.trigger).toBe('manual');
    expect(log.readingsInserted).toBeGreaterThan(0);
    expect(getDemoState().logs.length).toBe(initialLogsCount + 1);

    const roomsSync = await syncRoomsFromVendor('all');
    expect(roomsSync.vendor).toBe('all');
    expect(roomsSync.roomsFound).toBeGreaterThan(0);

    const exported = await exportBackupArchive({ metricsRange: '30d' });
    const json = JSON.parse(gunzipSync(exported.buffer).toString('utf8')) as {
      integrity?: { algorithm: string; dataSha256: string };
      data: { vendorConnections: unknown[]; deviceVendorLinks: unknown[] };
    };
    expect(json.integrity?.algorithm).toBe('sha256');
    expect(json.integrity?.dataSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(json.data.vendorConnections.length).toBeGreaterThan(0);
    expect(json.data.deviceVendorLinks.length).toBeGreaterThan(0);
  });
});
