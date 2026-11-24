import { describe, expect, it } from 'vitest';
import { computeHomeHealth } from '@/lib/home-health';
import type { DashboardPayload, DeviceRecord } from '@/types';

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

function makePayload(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    env: {
      mode: 'live',
      databaseConfigured: true,
      tuyaConfigured: true,
      tuyaRegion: 'eu',
      tuyaUserUidConfigured: true,
      googleHomeApiEnabled: false,
      googleHomeConfigured: false,
      googleHomeMode: 'mcp',
      googleHomeConnected: false,
      googleSdmProjectConfigured: false,
      kasaConfigured: false,
      kasaRegion: 'eu',
      homeConnectConfigured: false,
      homeConnectEnv: 'prod',
      homeConnectConnected: false,
      somfyConfigured: false,
      somfyRegion: 'eu',
      daikinConfigured: false,
      daikinConnected: false,
      xsenseConfigured: false,
      xiaomiConfigured: false,
      xiaomiRegion: 'de',
      xiaomiConnected: false,
      appPasswordConfigured: false,
      oidcConfigured: false,
      oidcProviderName: null,
      scheduleSecretConfigured: false,
    },
    range: '24h',
    customFrom: null,
    customTo: null,
    selectedRoomId: 'all',
    selectedSystem: 'all',
    generatedAt: '2026-11-24T12:00:00.000Z',
    kpis: {
      currentPowerW: 0,
      activePowerDevices: 0,
      totalPowerDevices: 0,
      periodEnergyKwh: 0,
      periodCostEur: 0,
      subscriptionCostEur: 0,
      effectiveRateEurPerKwh: 0.2,
      hpEnergyKwh: 0,
      hcEnergyKwh: 0,
      baseEnergyKwh: 0,
      hpCostEur: 0,
      hcCostEur: 0,
      baseCostEur: 0,
      standbyPowerW: 0,
      standbyAnnualCostEur: 0,
      avgTempC: 20,
      avgHumidityPct: 50,
      climateAlertsCount: 0,
    },
    rooms: [
      {
        id: 1,
        name: 'Salon',
        icon: 'Home',
        color: '#6366f1',
        targetTempMin: 19,
        targetTempMax: 22,
        targetHumidityMin: 40,
        targetHumidityMax: 60,
        createdAt: '2026-11-01T00:00:00.000Z',
      },
      {
        id: 2,
        name: 'Chambre',
        icon: 'Bed',
        color: '#10b981',
        targetTempMin: 18,
        targetTempMax: 21,
        targetHumidityMin: 40,
        targetHumidityMax: 60,
        createdAt: '2026-11-01T00:00:00.000Z',
      },
    ],
    roomSummaries: [],
    devices: [],
    vendors: [],
    duplicateCandidates: [],
    tariffs: [],
    energyByRoom: [],
    energyByDevice: [],
    timeSeries: [],
    contacts: {
      summary: {
        totalSensors: 0,
        openCountNow: 0,
        closedCountNow: 0,
        onlineCount: 0,
        lowBatteryCount: 0,
        totalOpenEventsPeriod: 0,
        totalOpenMinutesPeriod: 0,
      },
      sensors: [],
      events: [],
      activitySeries: [],
    },
    covers: {
      byDevice: {},
      events: [],
      activitySeries: [],
    },
    automations: {
      summary: {
        totalCount: 0,
        automationsCount: 0,
        scenesCount: 0,
        enabledCount: 0,
        disabledCount: 0,
        healthyCount: 0,
        warningCount: 0,
        conflictsCount: 0,
        coveredDevicesCount: 0,
        totalDevicesCount: 0,
        coveredRoomsCount: 0,
        lastSyncedAt: null,
      },
      triggerBreakdown: [],
      topDevices: [],
      roomCoverage: [],
      insights: [],
      rules: [],
    },
    logs: [],
    ...overrides,
  };
}

describe('computeHomeHealth', () => {
  it('returns healthy status when no issues are present', () => {
    const payload = makePayload({
      devices: [
        makeDevice({ id: 'd1', name: 'Sonde Salon', lastBatteryPct: 21, isOnline: true }),
      ],
    });
    const report = computeHomeHealth(payload, 'fr');
    expect(report.status).toBe('healthy');
    expect(report.totalIssues).toBe(0);
    expect(report.lowBatteryDevices).toHaveLength(0);
  });

  it('detects low batteries at <= 20%, offline devices, and cross-room open window + active HVAC', () => {
    const payload = makePayload({
      devices: [
        makeDevice({ id: 'batt20', name: 'Capteur 20', lastBatteryPct: 20, roomId: 1 }),
        makeDevice({ id: 'batt10', name: 'Capteur 10', lastBatteryPct: 10, roomId: 2 }),
        makeDevice({ id: 'batt21', name: 'Capteur 21', lastBatteryPct: 21, roomId: 1 }),
        makeDevice({
          id: 'off1',
          name: 'Prise HS',
          isOnline: false,
          lastSeenAt: '2026-11-23T10:00:00.000Z',
        }),
        makeDevice({
          id: 'daikin1',
          name: 'Split Salon',
          primaryVendor: 'daikin',
          systems: ['daikin'],
          roomId: 1,
          lastRawStatus: [
            { code: 'daikin:unitType', value: 'climateControl' },
            { code: 'daikin:onOff', value: 'on' },
            { code: 'daikin:operationMode', value: 'heating' },
          ],
        }),
        makeDevice({
          id: 'daikin2',
          name: 'Split Chambre',
          primaryVendor: 'daikin',
          systems: ['daikin'],
          roomId: 2,
          lastRawStatus: [
            { code: 'daikin:unitType', value: 'climateControl' },
            { code: 'daikin:onOff', value: 'off' },
          ],
        }),
      ],
      contacts: {
        summary: {
          totalSensors: 2,
          openCountNow: 2,
          closedCountNow: 0,
          onlineCount: 2,
          lowBatteryCount: 1,
          totalOpenEventsPeriod: 2,
          totalOpenMinutesPeriod: 20,
        },
        sensors: [
          {
            deviceId: 'c1',
            name: 'Baie Salon',
            roomId: 1,
            roomName: 'Salon',
            roomColor: '#6366f1',
            isOnline: true,
            isOpen: true,
            batteryPct: 80,
            lastSeenAt: null,
            lastOpenedAt: null,
            openEventsCount: 1,
            openMinutes: 10,
          },
          {
            deviceId: 'c2',
            name: 'Fenêtre Chambre',
            roomId: 2,
            roomName: 'Chambre',
            roomColor: '#10b981',
            isOnline: true,
            isOpen: true,
            batteryPct: 80,
            lastSeenAt: null,
            lastOpenedAt: null,
            openEventsCount: 1,
            openMinutes: 10,
          },
        ],
        events: [],
        activitySeries: [],
      },
    });

    const report = computeHomeHealth(payload, 'fr');
    expect(report.status).toBe('warning');
    expect(report.lowBatteryDevices.map((d) => d.id)).toEqual(['batt10', 'batt20']);
    expect(report.offlineDevices.map((d) => d.id)).toEqual(['off1']);
    expect(report.openWithHvacRooms).toHaveLength(1);
    expect(report.openWithHvacRooms[0]?.roomId).toBe(1);
    expect(report.openWithHvacRooms[0]?.openSensors).toEqual(['Baie Salon']);
    expect(report.openWithHvacRooms[0]?.activeHvacUnits).toEqual(['Split Salon']);
    expect(report.totalIssues).toBe(4);
  });

  it('marks status critical on safety alerts or vendor errors', () => {
    const payload = makePayload({
      devices: [
        makeDevice({
          id: 'xs1',
          name: 'Détecteur Fumée',
          primaryVendor: 'xsense',
          systems: ['xsense'],
          lastRawStatus: [
            { code: 'xsense:unitType', value: 'smokeCoDetector' },
            { code: 'xsense:alarmStatus', value: 'smoke' },
          ],
        }),
      ],
      vendors: [
        {
          vendor: 'daikin',
          label: 'Daikin Onecta',
          mode: 'oauth_prod',
          configured: true,
          connected: false,
          devicesCount: 1,
          lastSyncedAt: null,
          lastError: 'OAuth expired',
        },
      ],
    });

    const report = computeHomeHealth(payload, 'en');
    expect(report.status).toBe('critical');
    expect(report.safetyAlerts).toHaveLength(1);
    expect(report.vendorIssues).toHaveLength(1);
    expect(report.totalIssues).toBe(2);
  });

  it('excludes offline-exempted devices, legacy Kasa room notices, and disabled Google Home from issues', () => {
    const payload = makePayload({
      env: {
        mode: 'live',
        databaseConfigured: true,
        tuyaConfigured: true,
        tuyaRegion: 'eu',
        tuyaUserUidConfigured: true,
        googleHomeApiEnabled: false,
        googleHomeConfigured: false,
        googleHomeMode: 'mcp',
        googleHomeConnected: false,
        googleSdmProjectConfigured: false,
        kasaConfigured: true,
        kasaRegion: 'eu',
        homeConnectConfigured: false,
        homeConnectEnv: 'prod',
        homeConnectConnected: false,
        somfyConfigured: false,
        somfyRegion: 'eu',
        daikinConfigured: false,
        daikinConnected: false,
        xsenseConfigured: false,
        xiaomiConfigured: false,
        xiaomiRegion: 'de',
        xiaomiConnected: false,
        appPasswordConfigured: false,
        oidcConfigured: false,
        oidcProviderName: null,
        scheduleSecretConfigured: false,
      },
      devices: [
        makeDevice({
          id: 'offExempt',
          name: 'Seasonal Plug',
          primaryVendor: 'kasa',
          systems: ['kasa', 'google_home'],
          category: 'power',
          productName: 'TP-Link HS110',
          tuyaCategory: 'kasa_plug',
          isOnline: false,
          ignoreOfflineAlert: true,
        }),
        makeDevice({
          id: 'offAlert',
          name: 'Main Router Plug',
          primaryVendor: 'tuya',
          systems: ['tuya'],
          category: 'power',
          productName: 'Nous A1T',
          tuyaCategory: 'cz',
          isOnline: false,
          ignoreOfflineAlert: false,
        }),
      ],
      vendors: [
        {
          vendor: 'kasa',
          label: 'Kasa',
          mode: 'cloud_account',
          configured: true,
          connected: true,
          devicesCount: 2,
          lastSyncedAt: '2026-11-24T12:00:00.000Z',
          lastError:
            "Aucune pièce/groupe Kasa remonté par le cloud TP-Link — assignez vos pièces dans l'onglet Appareils ou Pièces.",
        },
        {
          vendor: 'google_home',
          label: 'Google Home',
          mode: 'mcp',
          configured: true,
          connected: false,
          devicesCount: 0,
          lastSyncedAt: null,
          lastError: null,
        },
      ],
    });

    const report = computeHomeHealth(payload, 'en');
    expect(report.offlineDevices.map((d) => d.id)).toEqual(['offAlert']);
    expect(report.offlineDevices[0]).toMatchObject({
      systems: ['tuya'],
      category: 'power',
      productName: 'Nous A1T',
      tuyaCategory: 'cz',
    });
    expect(report.exemptedOfflineDevices.map((d) => d.id)).toEqual(['offExempt']);
    expect(report.exemptedDevices[0]).toMatchObject({
      id: 'offExempt',
      systems: ['kasa', 'google_home'],
      category: 'power',
      productName: 'TP-Link HS110',
      tuyaCategory: 'kasa_plug',
    });
    expect(report.vendorIssues).toHaveLength(0);
    expect(report.totalIssues).toBe(1);
    expect(report.status).toBe('warning');
  });
});
