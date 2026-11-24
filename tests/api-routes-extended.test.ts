import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCookiesMap = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mockCookiesMap.get(name);
      return value !== undefined ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      mockCookiesMap.set(name, value);
    },
    delete: (name: string) => {
      mockCookiesMap.delete(name);
    },
  }),
}));

import { SESSION_COOKIE_NAME, createSessionToken } from '@/lib/auth';
import { getDemoState } from '@/lib/demo-store';
import { POST as logoutPost } from '@/app/api/auth/logout/route';
import { GET as backupExportGet } from '@/app/api/backup/export/route';
import {
  DELETE as linksDelete,
  POST as linksPost,
} from '@/app/api/devices/links/route';
import { POST as roomsSyncPost } from '@/app/api/rooms/sync/route';
import {
  GET as scheduleCollectGet,
  POST as scheduleCollectPost,
} from '@/app/api/schedule/collect/route';
import { POST as vendorDisconnectPost } from '@/app/api/vendors/[vendor]/disconnect/route';
import { POST as vendorSyncPost } from '@/app/api/vendors/[vendor]/sync/route';

describe('extended API routes: logout, backup export, cron collect, rooms sync, vendor plugins & links', () => {
  beforeEach(() => {
    mockCookiesMap.clear();
    (globalThis as Record<string, unknown>).__tuyaDemoState = undefined;
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('APP_PASSWORD', 'correct-password');
    vi.stubEnv('SCHEDULE_SECRET', 'cron-secret-value');
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    mockCookiesMap.clear();
  });

  it('clears the session cookie on POST /api/auth/logout', async () => {
    const res = await logoutPost();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
  });

  it('protects GET /api/backup/export and streams valid Gzip archives when authenticated', async () => {
    const unauth = await backupExportGet(new Request('https://cockpit.local/api/backup/export'));
    expect(unauth.status).toBe(401);

    mockCookiesMap.set(SESSION_COOKIE_NAME, createSessionToken());
    const res = await backupExportGet(
      new Request('https://cockpit.local/api/backup/export?metrics=30d')
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/gzip');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toContain('.json.gz');

    const stats = JSON.parse(res.headers.get('x-backup-stats') ?? '{}') as {
      devices: number;
      vendorConnections: number;
    };
    expect(stats.devices).toBeGreaterThan(0);
    expect(stats.vendorConnections).toBeGreaterThan(0);

    const archiveBuf = Buffer.from(await res.arrayBuffer());
    const parsed = JSON.parse(gunzipSync(archiveBuf).toString('utf8')) as {
      format: string;
      integrity?: { algorithm: string; dataSha256: string };
    };
    expect(parsed.format).toBe('home-cockpit-backup');
    expect(parsed.integrity?.algorithm).toBe('sha256');
    expect(parsed.integrity?.dataSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('enforces Bearer SCHEDULE_SECRET or session auth on /api/schedule/collect', async () => {
    const unauthGet = await scheduleCollectGet(
      new Request('https://cockpit.local/api/schedule/collect')
    );
    expect(unauthGet.status).toBe(401);

    const badSecret = await scheduleCollectGet(
      new Request('https://cockpit.local/api/schedule/collect', {
        headers: { authorization: 'Bearer wrong-secret' },
      })
    );
    expect(badSecret.status).toBe(401);

    const cronOk = await scheduleCollectGet(
      new Request('https://cockpit.local/api/schedule/collect', {
        headers: { authorization: 'Bearer cron-secret-value' },
      })
    );
    expect(cronOk.status).toBe(200);
    expect(cronOk.headers.get('cache-control')).toBe('no-store');
    const cronBody = (await cronOk.json()) as { ok: boolean; log: { trigger: string } };
    expect(cronBody.ok).toBe(true);
    expect(cronBody.log.trigger).toBe('schedule');

    mockCookiesMap.set(SESSION_COOKIE_NAME, createSessionToken());
    const manualPost = await scheduleCollectPost(
      new Request('https://cockpit.local/api/schedule/collect?trigger=manual', { method: 'POST' })
    );
    expect(manualPost.status).toBe(200);
    const manualBody = (await manualPost.json()) as { ok: boolean; log: { trigger: string } };
    expect(manualBody.ok).toBe(true);
    expect(manualBody.log.trigger).toBe('manual');
  });

  it('handles generic /api/vendors/[vendor]/sync and /disconnect routes properly', async () => {
    const unauthSync = await vendorSyncPost(
      new Request('https://cockpit.local/api/vendors/kasa/sync', { method: 'POST' }),
      { params: Promise.resolve({ vendor: 'kasa' }) }
    );
    expect(unauthSync.status).toBe(401);

    mockCookiesMap.set(SESSION_COOKIE_NAME, createSessionToken());

    const unknownSync = await vendorSyncPost(
      new Request('https://cockpit.local/api/vendors/unknown/sync', { method: 'POST' }),
      { params: Promise.resolve({ vendor: 'unknown' }) }
    );
    expect(unknownSync.status).toBe(404);

    const kasaSync = await vendorSyncPost(
      new Request('https://cockpit.local/api/vendors/kasa/sync', { method: 'POST' }),
      { params: Promise.resolve({ vendor: 'kasa' }) }
    );
    expect(kasaSync.status).toBe(200);
    const kasaJson = (await kasaSync.json()) as { ok: boolean; vendor: string };
    expect(kasaJson.ok).toBe(true);
    expect(kasaJson.vendor).toBe('kasa');

    const unsupportedDisconnect = await vendorDisconnectPost(
      new Request('https://cockpit.local/api/vendors/tuya/disconnect', { method: 'POST' }),
      { params: Promise.resolve({ vendor: 'tuya' }) }
    );
    expect(unsupportedDisconnect.status).toBe(400);

    const daikinDisconnect = await vendorDisconnectPost(
      new Request('https://cockpit.local/api/vendors/daikin/disconnect', { method: 'POST' }),
      { params: Promise.resolve({ vendor: 'daikin' }) }
    );
    expect(daikinDisconnect.status).toBe(200);
    const disconnectJson = (await daikinDisconnect.json()) as { ok: boolean; vendor: string };
    expect(disconnectJson.ok).toBe(true);
    expect(disconnectJson.vendor).toBe('daikin');
  });

  it('validates vendor capability and syncs rooms on POST /api/rooms/sync', async () => {
    const unauth = await roomsSyncPost(
      new Request('https://cockpit.local/api/rooms/sync', { method: 'POST' })
    );
    expect(unauth.status).toBe(401);

    mockCookiesMap.set(SESSION_COOKIE_NAME, createSessionToken());

    const unsupported = await roomsSyncPost(
      new Request('https://cockpit.local/api/rooms/sync', {
        method: 'POST',
        body: JSON.stringify({ vendor: 'home_connect' }),
      })
    );
    expect(unsupported.status).toBe(400);

    const invalid = await roomsSyncPost(
      new Request('https://cockpit.local/api/rooms/sync', {
        method: 'POST',
        body: JSON.stringify({ vendor: 'nonexistent' }),
      })
    );
    expect(invalid.status).toBe(400);

    const okAll = await roomsSyncPost(
      new Request('https://cockpit.local/api/rooms/sync', {
        method: 'POST',
        body: JSON.stringify({ vendor: 'all' }),
      })
    );
    expect(okAll.status).toBe(200);
    const json = (await okAll.json()) as { ok: boolean; vendor: string };
    expect(json.ok).toBe(true);
    expect(json.vendor).toBe('all');
  });

  it('manages multi-vendor tags, unlinking, and merging on /api/devices/links', async () => {
    const unauth = await linksPost(
      new Request('https://cockpit.local/api/devices/links', {
        method: 'POST',
        body: JSON.stringify({ action: 'unknown' }),
      })
    );
    expect(unauth.status).toBe(401);

    mockCookiesMap.set(SESSION_COOKIE_NAME, createSessionToken());

    const badAction = await linksPost(
      new Request('https://cockpit.local/api/devices/links', {
        method: 'POST',
        body: JSON.stringify({ action: 'not_valid' }),
      })
    );
    expect(badAction.status).toBe(400);

    const state = getDemoState();
    const target = state.devices[0];
    const secondaryVendor = target.primaryVendor === 'kasa' ? 'google_home' : 'kasa';

    const toggleOn = await linksPost(
      new Request('https://cockpit.local/api/devices/links', {
        method: 'POST',
        body: JSON.stringify({
          action: 'toggle_system',
          deviceId: target.id,
          vendor: secondaryVendor,
          enabled: true,
        }),
      })
    );
    expect(toggleOn.status).toBe(200);
    const toggledJson = (await toggleOn.json()) as { device: { systems: string[] } };
    expect(toggledJson.device.systems).toContain(secondaryVendor);

    // Cannot unlink primaryVendor
    const unlinkPrimary = await linksDelete(
      new Request(
        `https://cockpit.local/api/devices/links?deviceId=${encodeURIComponent(target.id)}&vendor=${target.primaryVendor}`,
        { method: 'DELETE' }
      )
    );
    expect(unlinkPrimary.status).toBe(400);

    // Can unlink secondaryVendor
    const unlinkSecondary = await linksDelete(
      new Request(
        `https://cockpit.local/api/devices/links?deviceId=${encodeURIComponent(target.id)}&vendor=${secondaryVendor}`,
        { method: 'DELETE' }
      )
    );
    expect(unlinkSecondary.status).toBe(200);

    // Merge another device into target
    const source = state.devices.find((d) => d.id !== target.id);
    expect(source).toBeDefined();
    const mergeRes = await linksPost(
      new Request('https://cockpit.local/api/devices/links', {
        method: 'POST',
        body: JSON.stringify({
          action: 'merge',
          targetDeviceId: target.id,
          sourceDeviceId: source!.id,
        }),
      })
    );
    expect(mergeRes.status).toBe(200);

    const missingDevice = await linksDelete(
      new Request('https://cockpit.local/api/devices/links?deviceId=missing_dev&vendor=kasa', {
        method: 'DELETE',
      })
    );
    expect(missingDevice.status).toBe(404);
  });
});
