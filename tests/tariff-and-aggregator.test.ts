import { describe, expect, it } from 'vitest';
import { buildDashboardPayload, detect24hBucketMinutes, resolveTimeWindow } from '@/lib/aggregator';
import {
  computeHybridEnergyKwh,
  computeReadingCost,
  contributionHtToTtc,
  contributionTtcToHt,
  DEFAULT_TEMPO_CONFIG,
  isTimeInHcSlot,
  kwhHtToTtc,
  kwhTtcToHt,
  normalizeTariffTimeline,
  sanitizeTariffContributions,
  simulateContracts,
  subscriptionHtToTtc,
  subscriptionTtcToHt,
  summarizeTariffContributions,
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
      oidcConfigured: false,
      oidcProviderName: null,
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
    expect(payload.kpis.projectedMonthEnergyKwh).toBeCloseTo(0.6 * 31, 1);
  });

  it('supports EDF Tempo pricing, contract simulation, and period-over-period delta', () => {
    const tempoTariffs: TariffPeriodRecord[] = [
      {
        id: 10,
        label: 'EDF Tempo',
        startDate: '2026-01-01',
        endDate: null,
        mode: 'TEMPO',
        baseRateEur: null,
        hpRateEur: null,
        hcRateEur: null,
        hcSlots: [{ start: '22:00', end: '06:00' }],
        tempoConfig: {
          ...DEFAULT_TEMPO_CONFIG,
          dayColors: {
            '2026-01-15': 'RED',
            '2026-01-16': 'WHITE',
          },
        },
        monthlySubscriptionEur: 15,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    // 2026-01-15 11:00 UTC = 12:00 Paris -> RED HP
    const redHp = computeReadingCost('2026-01-15T11:00:00.000Z', 2, tempoTariffs);
    expect(redHp.periodType).toBe('HP');
    expect(redHp.costEur).toBeCloseTo(2 * DEFAULT_TEMPO_CONFIG.redHpRateEur, 5);

    // 2026-01-16 01:00 UTC = 02:00 Paris -> WHITE HC
    const whiteHc = computeReadingCost('2026-01-16T01:00:00.000Z', 2, tempoTariffs);
    expect(whiteHc.periodType).toBe('HC');
    expect(whiteHc.costEur).toBeCloseTo(2 * DEFAULT_TEMPO_CONFIG.whiteHcRateEur, 5);

    // 2026-01-17 (default BLUE) 12:00 UTC -> BLUE HP
    const blueHp = computeReadingCost('2026-01-17T12:00:00.000Z', 2, tempoTariffs);
    expect(blueHp.periodType).toBe('HP');
    expect(blueHp.costEur).toBeCloseTo(2 * DEFAULT_TEMPO_CONFIG.blueHpRateEur, 5);

    const sim = simulateContracts({
      totalKwh: 100,
      hpKwh: 60,
      hcKwh: 40,
      baseRate: 0.21,
      hpRate: 0.22,
      hcRate: 0.17,
      tempoConfig: DEFAULT_TEMPO_CONFIG,
    });
    expect(sim.cheapest).toBe('TEMPO');
    expect(sim.bestSavingsVsBase).toBeGreaterThan(0);

    const now = new Date('2026-01-15T12:00:00.000Z');
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
        id: 'dev1',
        name: 'Plug 1',
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
        lastSeenAt: now.toISOString(),
        lastPowerW: 100,
        lastVoltageV: 230,
        lastAddEleKwh: 1,
        lastTempC: null,
        lastHumidityPct: null,
        lastBatteryPct: null,
        lastContactOpen: null,
      },
    ];
    const readings: MetricReadingRecord[] = [
      // Previous 24h window: 1.0 kWh
      {
        id: 1,
        deviceId: 'dev1',
        roomId: 1,
        recordedAt: '2026-01-14T10:00:00.000Z',
        powerW: 100,
        voltageV: 230,
        energyKwh: 1.0,
        energySource: 'add_ele',
        tempC: null,
        humidityPct: null,
        contactOpen: null,
      },
      // Current 24h window: 1.5 kWh (+50%)
      {
        id: 2,
        deviceId: 'dev1',
        roomId: 1,
        recordedAt: '2026-01-15T10:00:00.000Z',
        powerW: 150,
        voltageV: 230,
        energyKwh: 1.5,
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
      oidcConfigured: false,
      oidcProviderName: null,
      scheduleSecretConfigured: false,
      googleHomeApiEnabled: false,
      googleHomeConfigured: false,
      googleHomeMode: 'mcp',
      googleHomeConnected: false,
      googleSdmProjectConfigured: false,
    };

    const payload = buildDashboardPayload({
      env,
      range: '24h',
      selectedRoomId: 'all',
      selectedSystem: 'all',
      rooms,
      devices,
      readings,
      tariffs: tempoTariffs,
      logs: [],
      now,
    });

    expect(payload.kpis.prevPeriodEnergyKwh).toBeCloseTo(1.0, 5);
    expect(payload.kpis.energyDeltaPct).toBeCloseTo(50, 2);
    expect(payload.kpis.projectedMonthEnergyKwh).toBeCloseTo(1.5 * 31, 1);
    expect(payload.kpis.projectedMonthCostEur).toBeGreaterThan(15);
  });

  it('integrates Linky meter reference with J-1 smart toggle, unmeasured load, max VA peak, and room filter isolation', () => {
    const now = new Date('2026-01-15T14:00:00.000Z');
    const rooms: RoomRecord[] = [
      {
        id: 1,
        name: 'Salon',
        icon: 'Sofa',
        color: '#6366f1',
        targetTempMin: 19,
        targetTempMax: 22,
        targetHumidityMin: 40,
        targetHumidityMax: 60,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const devices: DeviceRecord[] = [
      {
        id: 'dev1',
        name: 'Plug 1',
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
        lastSeenAt: now.toISOString(),
        lastPowerW: 200,
        lastVoltageV: 230,
        lastAddEleKwh: 2,
        lastTempC: null,
        lastHumidityPct: null,
        lastBatteryPct: null,
        lastContactOpen: null,
      },
    ];
    const readings: MetricReadingRecord[] = [
      // Published day J-1 (2026-01-14): measured 3.0 kWh
      {
        id: 1,
        deviceId: 'dev1',
        roomId: 1,
        recordedAt: '2026-01-14T20:00:00.000Z',
        powerW: 600,
        voltageV: 230,
        energyKwh: 3.0,
        energySource: 'add_ele',
        tempC: null,
        humidityPct: null,
        contactOpen: null,
      },
      // Live day J (2026-01-15, not yet published by Enedis): measured 1.2 kWh
      {
        id: 2,
        deviceId: 'dev1',
        roomId: 1,
        recordedAt: '2026-01-15T10:00:00.000Z',
        powerW: 200,
        voltageV: 230,
        energyKwh: 1.2,
        energySource: 'add_ele',
        tempC: null,
        humidityPct: null,
        contactOpen: null,
      },
    ];
    const meterReadings = [
      {
        id: 1,
        pointId: '12345678901234',
        granularity: 'load_curve_30m' as const,
        recordedAt: '2026-01-14T20:00:00.000Z',
        dateKey: '2026-01-14',
        energyKwh: 5.0,
        powerW: 10000,
      },
      {
        id: 2,
        pointId: '12345678901234',
        granularity: 'max_power_daily' as const,
        recordedAt: '2026-01-14T19:00:00.000Z',
        dateKey: '2026-01-14',
        energyKwh: null,
        powerW: 6150,
      },
    ];
    const env: EnvStatus = {
      mode: 'live',
      databaseConfigured: true,
      tuyaConfigured: true,
      tuyaRegion: 'eu',
      tuyaUserUidConfigured: true,
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
      oidcConfigured: false,
      oidcProviderName: null,
      scheduleSecretConfigured: false,
      googleHomeApiEnabled: false,
      googleHomeConfigured: false,
      googleHomeMode: 'mcp',
      googleHomeConnected: false,
      googleSdmProjectConfigured: false,
      consoApiConfigured: true,
      consoApiConnected: true,
      consoApiPrmMasked: '••••••••••1234',
      consoApiSubscribedKva: 9,
    };

    const tariffs: TariffPeriodRecord[] = [
      {
        id: 1,
        label: 'Base 0.20',
        startDate: '2026-01-01',
        endDate: null,
        mode: 'BASE',
        baseRateEur: 0.2,
        hpRateEur: null,
        hcRateEur: null,
        hcSlots: [],
        monthlySubscriptionEur: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const globalPayload = buildDashboardPayload({
      env,
      range: '24h',
      selectedRoomId: 'all',
      selectedSystem: 'all',
      rooms,
      devices,
      readings,
      meterReadings,
      subscribedPowerKva: 9,
      tariffs,
      logs: [],
      now,
    });

    // Global total = J-1 Linky (5.0) + J live measured (1.2) = 6.2 kWh
    expect(globalPayload.kpis.periodEnergyKwh).toBeCloseTo(6.2, 3);
    expect(globalPayload.meter).toMatchObject({
      enabled: true,
      activeInCurrentView: true,
      lastPublishedDate: '2026-01-14',
      periodMeterEnergyKwh: 5.0,
      periodMeasuredEnergyKwh: 3.0,
      periodUnmeasuredEnergyKwh: 2.0,
      measuredCoveragePct: 60,
      todayLiveMeasuredKwh: 1.2,
      periodMaxPowerVa: 6150,
      subscribedPowerKva: 9,
    });
    expect(globalPayload.energyByRoom.some((r) => r.id === 'unmeasured' && r.isUnmeasured)).toBe(true);

    // Room-filtered view keeps only that room's measured energy (3.0 + 1.2 = 4.2 kWh)
    const roomPayload = buildDashboardPayload({
      env,
      range: '24h',
      selectedRoomId: '1',
      selectedSystem: 'all',
      rooms,
      devices,
      readings,
      meterReadings,
      subscribedPowerKva: 9,
      tariffs,
      logs: [],
      now,
    });
    expect(roomPayload.meter?.activeInCurrentView).toBe(false);
    expect(roomPayload.kpis.periodEnergyKwh).toBeCloseTo(4.2, 3);
    expect(roomPayload.energyByRoom.some((r) => r.id === 'unmeasured')).toBe(false);
  });

  it('auto-adapts 24h buckets to 15 min when intervals <= 20 min exist and falls back to 30 min otherwise', () => {
    expect(
      detect24hBucketMinutes([
        { deviceId: 'dev1', recordedAt: '2026-01-15T10:00:00.000Z' },
        { deviceId: 'dev1', recordedAt: '2026-01-15T10:30:00.000Z' },
        { deviceId: 'dev2', recordedAt: '2026-01-15T10:15:00.000Z' },
        // < 5 min burst on same device should not switch resolution
        { deviceId: 'dev2', recordedAt: '2026-01-15T10:17:00.000Z' },
      ])
    ).toBe(30);

    expect(
      detect24hBucketMinutes([
        { deviceId: 'dev1', recordedAt: '2026-01-15T10:00:00.000Z' },
        { deviceId: 'dev1', recordedAt: '2026-01-15T10:15:00.000Z' },
      ])
    ).toBe(15);

    const now = new Date('2026-01-15T12:00:00.000Z');
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
        id: 'dev1',
        name: 'Plug 1',
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
        lastSeenAt: now.toISOString(),
        lastPowerW: 200,
        lastVoltageV: 230,
        lastAddEleKwh: 1,
        lastTempC: null,
        lastHumidityPct: null,
        lastBatteryPct: null,
        lastContactOpen: null,
      },
    ];
    const env: EnvStatus = {
      mode: 'live',
      databaseConfigured: true,
      tuyaConfigured: true,
      tuyaRegion: 'eu',
      tuyaUserUidConfigured: true,
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
      oidcConfigured: false,
      oidcProviderName: null,
      scheduleSecretConfigured: false,
      googleHomeApiEnabled: false,
      googleHomeConfigured: false,
      googleHomeMode: 'mcp',
      googleHomeConnected: false,
      googleSdmProjectConfigured: false,
      consoApiConfigured: true,
      consoApiConnected: true,
      consoApiPrmMasked: '••••••••••1234',
      consoApiSubscribedKva: 9,
    };

    const makeReading = (id: number, iso: string, energyKwh: number): MetricReadingRecord => ({
      id,
      deviceId: 'dev1',
      roomId: 1,
      recordedAt: iso,
      powerW: 200,
      voltageV: 230,
      energyKwh,
      energySource: 'integration',
      tempC: null,
      humidityPct: null,
      contactOpen: null,
    });

    // 15-min readings + 30-min Linky load curve -> 4 distinct 15-min buckets and exact total energy
    const payload15m = buildDashboardPayload({
      env,
      range: '24h',
      selectedRoomId: 'all',
      selectedSystem: 'all',
      rooms,
      devices,
      readings: [
        makeReading(1, '2026-01-15T10:00:00.000Z', 0.1),
        makeReading(2, '2026-01-15T10:15:00.000Z', 0.2),
        makeReading(3, '2026-01-15T10:30:00.000Z', 0.15),
        makeReading(4, '2026-01-15T10:45:00.000Z', 0.15),
      ],
      meterReadings: [
        {
          id: 1,
          pointId: '12345678901234',
          granularity: 'load_curve_30m',
          recordedAt: '2026-01-15T10:00:00.000Z',
          dateKey: '2026-01-15',
          energyKwh: 0.5,
          powerW: 1000,
        },
        {
          id: 2,
          pointId: '12345678901234',
          granularity: 'load_curve_30m',
          recordedAt: '2026-01-15T10:30:00.000Z',
          dateKey: '2026-01-15',
          energyKwh: 0.5,
          powerW: 1000,
        },
      ],
      tariffs: [],
      logs: [],
      now,
    });

    expect(payload15m.timeSeries.map((pt) => pt.label)).toEqual([
      '11:00',
      '11:15',
      '11:30',
      '11:45',
    ]);
    expect(payload15m.kpis.periodEnergyKwh).toBeCloseTo(1.0, 5);
    expect(payload15m.meter?.periodUnmeasuredEnergyKwh).toBeCloseTo(0.4, 5);

    // 30-min readings -> stays on 2 buckets (:00 and :30)
    const payload30m = buildDashboardPayload({
      env,
      range: '24h',
      selectedRoomId: 'all',
      selectedSystem: 'all',
      rooms,
      devices,
      readings: [
        makeReading(10, '2026-01-15T10:00:00.000Z', 0.2),
        makeReading(11, '2026-01-15T10:30:00.000Z', 0.3),
      ],
      tariffs: [],
      logs: [],
      now,
    });
    expect(payload30m.timeSeries.map((pt) => pt.label)).toEqual(['11:00', '11:30']);
  });

  it('converts kWh and subscription rates cleanly between HT and TTC with VAT and excise', () => {
    // Pure 20% VAT: 0.1680 HT -> 0.2016 TTC
    expect(kwhHtToTtc(0.168, 20, 0)).toBeCloseTo(0.2016, 6);
    expect(kwhTtcToHt(0.2016, 20, 0)).toBeCloseTo(0.168, 6);

    // 20% VAT + 0.02998 €/kWh excise: (0.1380 + 0.02998) * 1.2 = 0.201576
    expect(kwhHtToTtc(0.138, 20, 0.02998)).toBeCloseTo(0.201576, 6);
    expect(kwhTtcToHt(0.201576, 20, 0.02998)).toBeCloseTo(0.138, 6);

    // Clamps HT to 0 if TTC < excise * (1 + VAT) and handles 0% VAT
    expect(kwhTtcToHt(0.01, 20, 0.05)).toBe(0);
    expect(kwhHtToTtc(0.15, 0, 0.02)).toBeCloseTo(0.17, 6);

    // Subscription: 20% vs 5.5% VAT without excise
    expect(subscriptionHtToTtc(11.816667, 20)).toBeCloseTo(14.18, 2);
    expect(subscriptionTtcToHt(14.18, 20)).toBeCloseTo(11.816667, 5);
    expect(subscriptionHtToTtc(13.004739, 5.5)).toBeCloseTo(13.72, 2);
    expect(subscriptionTtcToHt(13.72, 5.5)).toBeCloseTo(13.004739, 5);
  });

  it('computes contributions, full invoice breakdown, Linky reconciliation, and contract simulation', () => {
    expect(contributionHtToTtc(0.02998, 20)).toBeCloseTo(0.035976, 6);
    expect(contributionTtcToHt(0.035976, 20)).toBeCloseTo(0.02998, 6);

    const contributions = sanitizeTariffContributions([
      {
        id: 'accise',
        name: "Accise sur l'électricité",
        kind: 'per_kwh',
        amountHtEur: 0.03,
        vatRatePct: 20,
      },
      {
        id: 'cta',
        name: 'CTA',
        kind: 'monthly',
        amountHtEur: 3.0,
        vatRatePct: 20,
      },
      { name: '   ', kind: 'monthly', amountHtEur: 1, vatRatePct: 20 },
    ]);
    expect(contributions).toHaveLength(2);

    const contribSummary = summarizeTariffContributions(contributions);
    expect(contribSummary.perKwhHtEur).toBeCloseTo(0.03, 5);
    expect(contribSummary.perKwhTtcEur).toBeCloseTo(0.036, 5);
    expect(contribSummary.monthlyHtEur).toBeCloseTo(3.0, 5);
    expect(contribSummary.monthlyTtcEur).toBeCloseTo(3.6, 5);

    const tariffWithContribs: TariffPeriodRecord = {
      id: 1,
      label: 'EDF Base + Taxes',
      startDate: '2026-01-01',
      endDate: null,
      mode: 'BASE',
      baseRateEur: 0.18, // energy-only TTC (0.15 HT @ 20% TVA)
      hpRateEur: null,
      hcRateEur: null,
      hcSlots: [],
      monthlySubscriptionEur: 12, // 10 HT @ 20% TVA
      vatRatePct: 20,
      subscriptionVatRatePct: 20,
      contributions,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    // 10 kWh -> energy 1.80 TTC (1.50 HT) + variable contribs 0.36 TTC (0.30 HT) = 2.16 TTC
    const costRes = computeReadingCost('2026-01-15T11:00:00.000Z', 10, [tariffWithContribs]);
    expect(costRes.energyCostEur).toBeCloseTo(1.8, 5);
    expect(costRes.energyCostHtEur).toBeCloseTo(1.5, 5);
    expect(costRes.variableContributionsCostEur).toBeCloseTo(0.36, 5);
    expect(costRes.variableContributionsCostHtEur).toBeCloseTo(0.3, 5);
    expect(costRes.costEur).toBeCloseTo(2.16, 5);
    expect(costRes.rateEur).toBeCloseTo(0.216, 5);

    const sim = simulateContracts({
      totalKwh: 100,
      hpKwh: 65,
      hcKwh: 35,
      baseRate: 0.18,
      hpRate: 0.2,
      hcRate: 0.14,
      perKwhContributionsTtc: 0.036,
      fixedPeriodTtc: 15.6,
    });
    expect(sim.baseCost).toBeCloseTo(100 * 0.216 + 15.6, 4);
    expect(sim.hpHcCost).toBeCloseTo(65 * 0.236 + 35 * 0.176 + 15.6, 4);

    // Dashboard aggregator invoice consistency with Linky unmeasured slice
    const now = new Date('2026-01-15T12:00:00.000Z');
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
      oidcConfigured: false,
      oidcProviderName: null,
      scheduleSecretConfigured: false,
      googleHomeApiEnabled: true,
      googleHomeConfigured: false,
      googleHomeMode: 'mcp',
      googleHomeConnected: false,
      googleSdmProjectConfigured: false,
      consoApiConfigured: true,
      consoApiConnected: true,
      consoApiPrmMasked: '••••••••••1234',
      consoApiSubscribedKva: 9,
    };
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
        id: 'plug_1',
        name: 'Prise',
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
        lastPowerW: 500,
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
        deviceId: 'plug_1',
        roomId: 1,
        recordedAt: '2026-01-15T10:00:00.000Z',
        powerW: 500,
        voltageV: 230,
        energyKwh: 4,
        energySource: 'add_ele',
        tempC: null,
        humidityPct: null,
        contactOpen: null,
      },
    ];

    const payload = buildDashboardPayload({
      env,
      range: '24h',
      selectedRoomId: 'all',
      selectedSystem: 'all',
      rooms,
      devices,
      readings,
      meterReadings: [
        {
          id: 1,
          pointId: '12345678901234',
          granularity: 'load_curve_30m',
          recordedAt: '2026-01-15T10:00:00.000Z',
          dateKey: '2026-01-15',
          energyKwh: 10, // 4 measured + 6 unmeasured
          powerW: 2000,
        },
      ],
      tariffs: [tariffWithContribs],
      logs: [],
      now,
    });

    expect(payload.kpis.periodEnergyKwh).toBeCloseTo(10, 5);
    expect(payload.kpis.periodCostEur).toBeCloseTo(2.16, 2);
    expect(payload.kpis.energyCostEur).toBeCloseTo(1.8, 2);
    expect(payload.kpis.energyCostHtEur).toBeCloseTo(1.5, 2);
    expect(payload.kpis.variableContributionsCostEur).toBeCloseTo(0.36, 2);
    expect(payload.kpis.fixedContributionsCostEur).toBeCloseTo(3.6 / 30.4375, 2);
    expect(payload.kpis.contributionsBreakdown).toHaveLength(2);

    const energy = payload.kpis.energyCostEur ?? 0;
    const sub = payload.kpis.subscriptionCostEur;
    const contribs = payload.kpis.contributionsCostEur ?? 0;
    const totalTtc = payload.kpis.totalPeriodCostEur ?? 0;
    const totalHt = payload.kpis.totalPeriodCostHtEur ?? 0;
    const totalVat = payload.kpis.totalPeriodVatEur ?? 0;
    expect(totalTtc).toBeCloseTo(energy + sub + contribs, 2);
    expect(totalTtc).toBeCloseTo(totalHt + totalVat, 2);
    // Projected month cost = (2.16 / 1 day * 31 days) + 12 (sub) + 3.6 (monthly CTA) = 82.56
    expect(payload.kpis.projectedMonthCostEur).toBeCloseTo(2.16 * 31 + 12 + 3.6, 1);
  });
});
