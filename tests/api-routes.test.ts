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
import { signDaikinOAuthState } from '@/lib/vendors/crypto-store';
import { POST as loginPost } from '@/app/api/auth/login/route';
import { POST as backupImportPost } from '@/app/api/backup/import/route';
import { GET as dashboardGet } from '@/app/api/dashboard/route';
import {
  DELETE as devicesDelete,
  PATCH as devicesPatch,
  POST as devicesPost,
} from '@/app/api/devices/route';
import {
  DELETE as roomsDelete,
  POST as roomsPost,
} from '@/app/api/rooms/route';
import {
  DELETE as tariffsDelete,
  PATCH as tariffsPatch,
  POST as tariffsPost,
} from '@/app/api/tariffs/route';
import { GET as daikinCallbackGet } from '@/app/api/vendors/daikin/oauth/callback/route';
import { POST as daikinExchangePost } from '@/app/api/vendors/daikin/oauth/exchange/route';

describe('API route security & input validation', () => {
  beforeEach(() => {
    mockCookiesMap.clear();
    (globalThis as Record<string, unknown>).__tuyaDemoState = undefined;
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('APP_PASSWORD', 'correct-password');
    vi.stubEnv('SCHEDULE_SECRET', 'cron-secret');
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    mockCookiesMap.clear();
  });

  it('enforces password bounds, rate limiting, and signed session cookies on POST /api/auth/login', async () => {
    const tooLong = await loginPost(
      new Request('https://cockpit.local/api/auth/login', {
        method: 'POST',
        headers: { 'x-real-ip': '10.0.0.10' },
        body: JSON.stringify({ password: 'x'.repeat(257) }),
      })
    );
    expect(tooLong.status).toBe(400);
    expect(tooLong.headers.get('cache-control')).toBe('no-store');

    // 5 failed attempts trigger 429 lockout
    for (let i = 0; i < 4; i++) {
      const fail = await loginPost(
        new Request('https://cockpit.local/api/auth/login', {
          method: 'POST',
          headers: { 'x-real-ip': '10.0.0.99' },
          body: JSON.stringify({ password: 'wrong' }),
        })
      );
      expect(fail.status).toBe(401);
    }
    const fifthFail = await loginPost(
      new Request('https://cockpit.local/api/auth/login', {
        method: 'POST',
        headers: { 'x-real-ip': '10.0.0.99' },
        body: JSON.stringify({ password: 'wrong' }),
      })
    );
    expect(fifthFail.status).toBe(429);
    expect(fifthFail.headers.get('retry-after')).toBeTruthy();

    const success = await loginPost(
      new Request('https://cockpit.local/api/auth/login', {
        method: 'POST',
        headers: { 'x-real-ip': '10.0.0.20' },
        body: JSON.stringify({ password: 'correct-password' }),
      })
    );
    expect(success.status).toBe(200);
    const setCookie = success.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=v2.`);
  });

  it('rejects unauthenticated requests and sets private no-store cache headers on GET /api/dashboard', async () => {
    const unauthRes = await dashboardGet(new Request('https://cockpit.local/api/dashboard'));
    expect(unauthRes.status).toBe(401);

    mockCookiesMap.set(SESSION_COOKIE_NAME, createSessionToken());
    const okRes = await dashboardGet(new Request('https://cockpit.local/api/dashboard?range=24h'));
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get('cache-control')).toBe('private, no-store');
  });

  it('validates manual device CRUD bounds and ignores unknown PATCH properties', async () => {
    const unauth = await devicesPost(
      new Request('https://cockpit.local/api/devices', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Plug' }),
      })
    );
    expect(unauth.status).toBe(401);

    mockCookiesMap.set(SESSION_COOKIE_NAME, createSessionToken());

    const tooLong = await devicesPost(
      new Request('https://cockpit.local/api/devices', {
        method: 'POST',
        body: JSON.stringify({ name: 'A'.repeat(121) }),
      })
    );
    expect(tooLong.status).toBe(400);

    const createdRes = await devicesPost(
      new Request('https://cockpit.local/api/devices', {
        method: 'POST',
        body: JSON.stringify({ name: 'Meter Lab', category: 'power', primaryVendor: 'kasa' }),
      })
    );
    expect(createdRes.status).toBe(201);
    const { device } = (await createdRes.json()) as { device: { id: string; energyMode: string } };
    expect(device.id.startsWith('manual_')).toBe(true);

    const badEnergyMode = await devicesPatch(
      new Request('https://cockpit.local/api/devices', {
        method: 'PATCH',
        body: JSON.stringify({ id: device.id, energyMode: 'bogus_mode' }),
      })
    );
    expect(badEnergyMode.status).toBe(400);

    const patchedRes = await devicesPatch(
      new Request('https://cockpit.local/api/devices', {
        method: 'PATCH',
        body: JSON.stringify({
          id: device.id,
          name: 'Meter Lab Updated',
          energyMode: 'integration',
          injectedField: 'should-not-stick',
        }),
      })
    );
    expect(patchedRes.status).toBe(200);
    const patchedJson = (await patchedRes.json()) as { device: Record<string, unknown> };
    expect(patchedJson.device.name).toBe('Meter Lab Updated');
    expect(patchedJson.device.energyMode).toBe('integration');
    expect(patchedJson.device.injectedField).toBeUndefined();

    const deletedRes = await devicesDelete(
      new Request(`https://cockpit.local/api/devices?id=${encodeURIComponent(device.id)}`, {
        method: 'DELETE',
      })
    );
    expect(deletedRes.status).toBe(200);
  });

  it('supports single and bulk deletion of any device (cloud or manual) via DELETE /api/devices', async () => {
    mockCookiesMap.set(SESSION_COOKIE_NAME, createSessionToken());
    const state = getDemoState();
    const cloudDevices = state.devices.filter((d) => !d.id.startsWith('manual_'));
    expect(cloudDevices.length).toBeGreaterThanOrEqual(3);

    const [first, second, third] = cloudDevices;

    const singleDelete = await devicesDelete(
      new Request(`https://cockpit.local/api/devices?id=${encodeURIComponent(first.id)}`, {
        method: 'DELETE',
      })
    );
    expect(singleDelete.status).toBe(200);
    expect((await singleDelete.json()) as { deletedCount: number }).toMatchObject({
      ok: true,
      deletedCount: 1,
    });
    expect(getDemoState().devices.some((d) => d.id === first.id)).toBe(false);

    const deleteMissing = await devicesDelete(
      new Request(`https://cockpit.local/api/devices?id=${encodeURIComponent(first.id)}`, {
        method: 'DELETE',
      })
    );
    expect(deleteMissing.status).toBe(404);

    const bulkEmpty = await devicesDelete(
      new Request('https://cockpit.local/api/devices', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [] }),
      })
    );
    expect(bulkEmpty.status).toBe(400);

    const bulkDelete = await devicesDelete(
      new Request('https://cockpit.local/api/devices', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [second.id, third.id, 'nonexistent_device_id'] }),
      })
    );
    expect(bulkDelete.status).toBe(200);
    expect((await bulkDelete.json()) as { ok: boolean; deletedCount: number }).toMatchObject({
      ok: true,
      deletedCount: 2,
    });
    const remainingIds = new Set(getDemoState().devices.map((d) => d.id));
    expect(remainingIds.has(second.id)).toBe(false);
    expect(remainingIds.has(third.id)).toBe(false);

    const bulkNoneFound = await devicesDelete(
      new Request('https://cockpit.local/api/devices', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['nonexistent_device_id'] }),
      })
    );
    expect(bulkNoneFound.status).toBe(404);
  });

  it('validates tariff payloads and rejects invalid dates, modes, or negative rates', async () => {
    mockCookiesMap.set(SESSION_COOKIE_NAME, createSessionToken());

    const badDate = await tariffsPost(
      new Request('https://cockpit.local/api/tariffs', {
        method: 'POST',
        body: JSON.stringify({ label: 'EDF', startDate: '24/11/2026', mode: 'BASE' }),
      })
    );
    expect(badDate.status).toBe(400);

    const negRate = await tariffsPost(
      new Request('https://cockpit.local/api/tariffs', {
        method: 'POST',
        body: JSON.stringify({
          label: 'EDF',
          startDate: '2026-01-01',
          mode: 'BASE',
          baseRateEur: -0.5,
        }),
      })
    );
    expect(negRate.status).toBe(400);

    const created = await tariffsPost(
      new Request('https://cockpit.local/api/tariffs', {
        method: 'POST',
        body: JSON.stringify({
          label: 'EDF HP/HC',
          startDate: '2026-01-01',
          mode: 'HP_HC',
          hpRateEur: 0.25,
          hcRateEur: 0.18,
          hcSlots: [{ start: '22:00', end: '06:00' }],
          monthlySubscriptionEur: 15,
          vatRatePct: 20,
          subscriptionVatRatePct: 5.5,
          exciseRateEur: 0.02998,
        }),
      })
    );
    expect(created.status).toBe(201);
    const createdJson = (await created.json()) as {
      tariffs: Array<{
        label: string;
        vatRatePct?: number;
        subscriptionVatRatePct?: number;
        exciseRateEur?: number;
      }>;
    };
    const edfCreated = createdJson.tariffs.find((t) => t.label === 'EDF HP/HC');
    expect(edfCreated?.vatRatePct).toBe(20);
    expect(edfCreated?.subscriptionVatRatePct).toBe(5.5);
    expect(edfCreated?.exciseRateEur).toBeCloseTo(0.02998, 5);

    const badVat = await tariffsPost(
      new Request('https://cockpit.local/api/tariffs', {
        method: 'POST',
        body: JSON.stringify({
          label: 'Bad VAT',
          startDate: '2026-01-01',
          mode: 'BASE',
          baseRateEur: 0.2,
          vatRatePct: 120,
        }),
      })
    );
    expect(badVat.status).toBe(400);

    const badExcise = await tariffsPost(
      new Request('https://cockpit.local/api/tariffs', {
        method: 'POST',
        body: JSON.stringify({
          label: 'Bad Excise',
          startDate: '2026-01-01',
          mode: 'BASE',
          baseRateEur: 0.2,
          exciseRateEur: -0.01,
        }),
      })
    );
    expect(badExcise.status).toBe(400);

    const badDelete = await tariffsDelete(
      new Request('https://cockpit.local/api/tariffs?id=1.5', { method: 'DELETE' })
    );
    expect(badDelete.status).toBe(400);

    const badPatch = await tariffsPatch(
      new Request('https://cockpit.local/api/tariffs', {
        method: 'PATCH',
        body: JSON.stringify({ id: 1, mode: 'UNKNOWN' }),
      })
    );
    expect(badPatch.status).toBe(400);

    const badSubVatPatch = await tariffsPatch(
      new Request('https://cockpit.local/api/tariffs', {
        method: 'PATCH',
        body: JSON.stringify({ id: 1, subscriptionVatRatePct: -5 }),
      })
    );
    expect(badSubVatPatch.status).toBe(400);
  });

  it('validates room comfort bounds and rejects non-integer room IDs', async () => {
    mockCookiesMap.set(SESSION_COOKIE_NAME, createSessionToken());

    const badRange = await roomsPost(
      new Request('https://cockpit.local/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Room', targetTempMin: 25, targetTempMax: 18 }),
      })
    );
    expect(badRange.status).toBe(400);

    const badDelete = await roomsDelete(
      new Request('https://cockpit.local/api/rooms?id=0', { method: 'DELETE' })
    );
    expect(badDelete.status).toBe(400);
  });

  it('rejects Daikin OAuth callback missing nonce cookie and untrusted exchange redirectUri', async () => {
    const signedState = signDaikinOAuthState({
      nonce: '1234567890abcdef',
      returnTab: 'systems',
      redirectUri: 'https://cockpit.local/api/vendors/daikin/oauth/callback',
    });

    const cbRes = await daikinCallbackGet(
      new Request(
        `https://cockpit.local/api/vendors/daikin/oauth/callback?code=abc&state=${encodeURIComponent(signedState)}`
      )
    );
    expect(cbRes.status).toBe(307);
    const location = cbRes.headers.get('location') ?? '';
    expect(location).toContain('dk_error=');
    expect(location).toContain('CSRF');

    mockCookiesMap.set(SESSION_COOKIE_NAME, createSessionToken());
    const exchangeRes = await daikinExchangePost(
      new Request('https://cockpit.local/api/vendors/daikin/oauth/exchange', {
        method: 'POST',
        body: JSON.stringify({
          input: 'https://cockpit.local/cb?code=fake',
          redirectUri: 'https://evil-attacker.example/steal',
        }),
      })
    );
    expect(exchangeRes.status).toBe(400);
  });

  it('rejects empty or invalid backup archive uploads with 400', async () => {
    mockCookiesMap.set(SESSION_COOKIE_NAME, createSessionToken());

    const emptyForm = new FormData();
    const emptyRes = await backupImportPost(
      new Request('https://cockpit.local/api/backup/import', {
        method: 'POST',
        body: emptyForm,
      })
    );
    expect(emptyRes.status).toBe(400);

    const corruptForm = new FormData();
    corruptForm.set('file', new File([Buffer.from('not-valid-json-or-gzip')], 'bad.json.gz'));
    const corruptRes = await backupImportPost(
      new Request('https://cockpit.local/api/backup/import', {
        method: 'POST',
        body: corruptForm,
      })
    );
    expect(corruptRes.status).toBe(400);
  });
});
