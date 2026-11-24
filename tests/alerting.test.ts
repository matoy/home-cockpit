import { describe, expect, it, vi } from 'vitest';
import {
  dispatchAlerts,
  evaluateAlertCandidates,
  getAlertingConfigFromEnv,
  hasConfiguredAlertChannel,
} from '@/lib/alerting';
import type { DeviceRecord } from '@/types';

function makeDevice(overrides: Partial<DeviceRecord> & { id: string; name: string }): DeviceRecord {
  return {
    customName: null,
    primaryVendor: 'tuya',
    systems: ['tuya'],
    roomId: 1,
    category: 'other',
    tuyaCategory: null,
    productName: null,
    ipAddress: null,
    macAddress: null,
    isOnline: true,
    isMonitored: true,
    excludeFromTotals: false,
    energyMode: 'hybrid',
    dpConfig: {},
    lastRawStatus: null,
    lastSeenAt: '2026-11-24T12:00:00.000Z',
    lastPowerW: null,
    lastVoltageV: null,
    lastAddEleKwh: null,
    lastTempC: null,
    lastHumidityPct: null,
    lastBatteryPct: null,
    lastContactOpen: null,
    ...overrides,
  };
}

describe('outbound alerting engine', () => {
  it('parses and validates alerting env config safely', () => {
    const empty = getAlertingConfigFromEnv({});
    expect(hasConfiguredAlertChannel(empty)).toBe(false);
    expect(empty.cooldownMinutes).toBe(180);
    expect(empty.lowBatteryPct).toBe(15);

    const cfg = getAlertingConfigFromEnv({
      ALERT_WEBHOOK_URL: 'https://hooks.example.com/alert',
      ALERT_WEBHOOK_SECRET: 'sec123',
      ALERT_TELEGRAM_BOT_TOKEN: 'bot1',
      ALERT_TELEGRAM_CHAT_ID: 'chat1',
      ALERT_DISCORD_WEBHOOK_URL: 'ftp://invalid.example.com',
      ALERT_NTFY_URL: 'https://ntfy.sh/home',
      ALERT_COOLDOWN_MINUTES: '2', // clamped/fallback to 180 because < 5
      ALERT_LOW_BATTERY_PCT: '12',
      ALERT_POWER_PEAK_W: '3500',
    });
    expect(hasConfiguredAlertChannel(cfg)).toBe(true);
    expect(cfg.webhookUrl).toBe('https://hooks.example.com/alert');
    expect(cfg.discordWebhookUrl).toBeNull();
    expect(cfg.cooldownMinutes).toBe(180);
    expect(cfg.lowBatteryPct).toBe(12);
    expect(cfg.powerPeakW).toBe(3500);
  });

  it('evaluates safety, low battery, offline > 24h, power peak, and vendor errors', () => {
    const now = new Date('2026-11-24T12:00:00.000Z');
    const candidates = evaluateAlertCandidates({
      now,
      lowBatteryPct: 15,
      powerPeakW: 2000,
      devices: [
        makeDevice({
          id: 'xs1',
          name: 'Smoke Alarm',
          primaryVendor: 'xsense',
          lastRawStatus: [
            { code: 'xsense:unitType', value: 'smokeCoDetector' },
            { code: 'xsense:alarmStatus', value: 'smoke' },
          ],
        }),
        makeDevice({ id: 'bat1', name: 'Contact Door', lastBatteryPct: 14 }),
        makeDevice({
          id: 'offOld',
          name: 'Old Plug',
          isOnline: false,
          lastSeenAt: '2026-11-23T08:00:00.000Z',
        }),
        makeDevice({
          id: 'offRecent',
          name: 'Recent Plug',
          isOnline: false,
          lastSeenAt: '2026-11-24T06:00:00.000Z',
        }),
        makeDevice({ id: 'pwr1', name: 'Heater', lastPowerW: 2500 }),
        makeDevice({ id: 'pwrExcl', name: 'Main Clamp', lastPowerW: 5000, excludeFromTotals: true }),
      ],
      vendors: [
        { vendor: 'daikin', label: 'Daikin Onecta', lastError: 'Token expired' },
        { vendor: 'tuya', label: 'Tuya Cloud', lastError: null },
      ],
    });

    const keys = candidates.map((c) => c.dedupKey);
    expect(keys).toContain('safety:xs1');
    expect(keys).toContain('battery:bat1');
    expect(keys).toContain('offline:offOld');
    expect(keys).not.toContain('offline:offRecent');
    expect(keys).toContain('power_peak');
    expect(keys).toContain('vendor_error:daikin');
    expect(keys).not.toContain('vendor_error:tuya');
    expect(candidates.find((c) => c.dedupKey === 'safety:xs1')?.severity).toBe('critical');
  });

  it('dispatches formatted payloads to all configured channels and enforces cooldown deduplication', async () => {
    const sentMap = new Map<string, Date>();
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    const config = getAlertingConfigFromEnv({
      ALERT_WEBHOOK_URL: 'https://hooks.example.com/hook',
      ALERT_WEBHOOK_SECRET: 'top-secret',
      ALERT_TELEGRAM_BOT_TOKEN: 'tg-token',
      ALERT_TELEGRAM_CHAT_ID: '12345',
      ALERT_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc',
      ALERT_NTFY_URL: 'https://ntfy.sh/test-topic',
      ALERT_NTFY_TOKEN: 'tk_123',
      ALERT_COOLDOWN_MINUTES: '60',
    });

    const candidates = [
      {
        dedupKey: 'safety:xs1',
        severity: 'critical' as const,
        title: 'Alerte sécurité',
        message: 'Fumée détectée',
      },
    ];

    const t0 = new Date('2026-11-24T12:00:00.000Z');
    const first = await dispatchAlerts({
      candidates,
      config,
      now: t0,
      cooldownLookup: async (key) => sentMap.get(key) ?? null,
      markSent: async (c, dt) => {
        sentMap.set(c.dedupKey, dt);
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(first).toEqual({ sent: 1, skippedCooldown: 0, failedChannels: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Within 60 min cooldown -> skipped
    const t1 = new Date('2026-11-24T12:30:00.000Z');
    const second = await dispatchAlerts({
      candidates,
      config,
      now: t1,
      cooldownLookup: async (key) => sentMap.get(key) ?? null,
      markSent: async (c, dt) => {
        sentMap.set(c.dedupKey, dt);
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(second).toEqual({ sent: 0, skippedCooldown: 1, failedChannels: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
