import { describe, expect, it } from 'vitest';
import { buildDashboardPayload, resolveTimeWindow } from '@/lib/aggregator';
import {
  computeHybridEnergyKwh,
  computeReadingCost,
  isTimeInHcSlot,
  normalizeTariffTimeline,
} from '@/lib/tariff-engine';
import type { DeviceRecord, EnvStatus, MetricReadingRecord, RoomRecord, TariffPeriodRecord } from '@/types';

describe('tariff-engine & dashboard aggregator', () => {
  it('computes hybrid energy using add_ele delta, reset fallback, or integration', () => {
    const now = new Date('2026-01-15T12:00:00Z');
    const thirtyMinAgo = new Date('2026-01-15T11:30:00Z');

    const deltaRes = computeHybridEnergyKwh({
      energyMode: 'hybrid',
      powerW: 200,
      currentAddEleKwh: 12.6,
      previousAddEleKwh: 12.1,
      previousSeenAt: thirtyMinAgo,
      now,
    });
    expect(deltaRes.source).toBe('add_ele');
    expect(deltaRes.energyKwh).toBeCloseTo(0.5, 5);

    const integForced = computeHybridEnergyKwh({
      energyMode: 'integration',
      powerW: 1000,
      currentAddEleKwh: 5.0,
      previousAddEleKwh: 4.0,
      previousSeenAt: thirtyMinAgo,
      now,
    });
    expect(integForced.source).toBe('integration');
    expect(integForced.energyKwh).toBeCloseTo(0.5, 5);

    const implausibleJump = computeHybridEnergyKwh({
      energyMode: 'hybrid',
      powerW: 400,
      currentAddEleKwh: 500,
      previousAddEleKwh: 10,
      previousSeenAt: thirtyMinAgo,
      now,
    });
    expect(implausibleJump.source).toBe('integration');
    expect(implausibleJump.energyKwh).toBeCloseTo(0.2, 5);
  });

  it('evaluates HP/HC midnight-crossing slots and normalizes overlapping tariff periods', () => {
    const slot = { start: '22:00', end: '06:00' };
    expect(isTimeInHcSlot('23:15', slot)).toBe(true);
    expect(isTimeInHcSlot('04:30', slot)).toBe(true);
    expect(isTimeInHcSlot('14:00', slot)).toBe(false);

    const timeline = normalizeTariffTimeline([
      { id: 1, startDate: '2025-01-01', endDate: null },
      { id: 2, startDate: '2026-02-01', endDate: null },
    ]);
    expect(timeline[0].endDate).toBe('2026-01-31');
    expect(timeline[1].endDate).toBeNull();

    const tariffs: TariffPeriodRecord[] = [
      {
        id: 1,
        label: 'HP/HC 2026',
        startDate: '2026-01-01',
        endDate: null,
        mode: 'HP_HC',
        baseRateEur: null,
        hpRateEur: 0.25,
        hcRateEur: 0.15,
        hcSlots: [{ start: '22:00', end: '06:00' }],
        monthlySubscriptionEur: 14,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    // 23:30 UTC in winter = 00:30 Europe/Paris -> HC
    const hcCost = computeReadingCost('2026-01-15T23:30:00.000Z', 2, tariffs);
    expect(hcCost.periodType).toBe('HC');
    expect(hcCost.costEur).toBeCloseTo(0.3, 5);

    // 11:00 UTC = 12:00 Europe/Paris -> HP
    const hpCost = computeReadingCost('2026-01-15T11:00:00.000Z', 2, tariffs);
    expect(hpCost.periodType).toBe('HP');
    expect(hpCost.costEur).toBeCloseTo(0.5, 5);
  });

  it('filters devices/readings by room & system and excludes excludeFromTotals devices from totals', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    const win = resolveTimeWindow('24h', null, null, now);
    expect(win.effectiveHours).toBe(24);

    const rooms: RoomRecord[] = [
      {
        id: 1,
        name: 'Salon',
        icon: 'Sofa',
        color: '#3b82f6',
        targetTempMin: 19,
        targetTempMax: 22,
        targetHumidityMin: 40,
        targetHumidityMax: 60,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const devices: DeviceRecord[] = [
      {
        id: 'dev_main',
        name: 'TV Plug',
        customName: null,
        primaryVendor: 'tuya',
        systems: ['tuya'],
        roomId: 1,
        category: 'power',
        tuyaCategory: 'cz',
        productName: null,
        ipAddress: null,
        macAddress: null,
        isOnline: true,
        isMonitored: true,
        excludeFromTotals: false,
        energyMode: 'hybrid',
        dpConfig: {},
        lastRawStatus: null,
        lastSeenAt: '2026-01-15T11:30:00.000Z',
        lastPowerW: 120,
        lastVoltageV: 230,
        lastAddEleKwh: 1,
        lastTempC: null,
        lastHumidityPct: null,
        lastBatteryPct: null,
        lastContactOpen: null,
      },
      {
        id: 'dev_excluded',
        name: 'Whole House Clamp',
        customName: null,
        primaryVendor: 'kasa',
        systems: ['kasa'],
        roomId: 1,
        category: 'power',
        tuyaCategory: 'cz',
        productName: null,
        ipAddress: null,
        macAddress: null,
        isOnline: true,
        isMonitored: true,
        excludeFromTotals: true,
        energyMode: 'hybrid',
        dpConfig: {},
        lastRawStatus: null,
        lastSeenAt: '2026-01-15T11:30:00.000Z',
        lastPowerW: 900,
        lastVoltageV: 230,
        lastAddEleKwh: 5,
        lastTempC: null,
        lastHumidityPct: null,
        lastBatteryPct: null,
        lastContactOpen: null,
      },
    ];

    const readings: MetricReadingRecord[] = [
      {
        id: 1,
        deviceId: 'dev_main',
        roomId: 1,
        recordedAt: '2026-01-15T11:30:00.000Z',
        powerW: 120,
        voltageV: 230,
        energyKwh: 0.6,
        energySource: 'add_ele',
        tempC: null,
        humidityPct: null,
        contactOpen: null,
      },
      {
        id: 2,
        deviceId: 'dev_excluded',
        roomId: 1,
        recordedAt: '2026-01-15T11:30:00.000Z',
        powerW: 900,
        voltageV: 230,
        energyKwh: 3.0,
        energySource: 'add_ele',
        tempC: null,
        humidityPct: null,
        contactOpen: null,
      },
    ];

    const env: EnvStatus = {
      mode: 'demo',
      databaseConfigured: false,
      tuyaConfigured: false,
      tuyaRegion: 'eu',
      tuyaUserUidConfigured: false,
      kasaConfigured: false,
      kasaRegion: 'eu',
      homeConnectConfigured: false,
      homeConnectConnected: false,
      homeConnectEnv: 'prod',
      somfyConfigured: false,
      somfyRegion: 'eu',
      daikinConfigured: false,
      daikinConnected: false,
      xsenseConfigured: false,
      xiaomiConfigured: false,
      xiaomiConnected: false,
      xiaomiRegion: 'de',
      appPasswordConfigured: false,
      scheduleSecretConfigured: false,
      googleHomeApiEnabled: true,
      googleHomeConfigured: false,
      googleHomeMode: 'mcp',
      googleHomeConnected: false,
      googleSdmProjectConfigured: false,
    };

    const payload = buildDashboardPayload({
      env,
      range: '24h',
      selectedRoomId: '1',
      selectedSystem: 'all',
      rooms,
      devices,
      readings,
      tariffs: [],
      logs: [],
      now,
    });

    expect(payload.kpis.periodEnergyKwh).toBeCloseTo(0.6, 5);
    expect(payload.kpis.currentPowerW).toBeCloseTo(120, 5);
    expect(payload.devices.length).toBe(2);
  });
});
