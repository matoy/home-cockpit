import { computeHybridEnergyKwh, normalizeTariffTimeline } from './tariff-engine';
import type {
  AutomationRecord,
  CollectionLogRecord,
  DeviceRecord,
  DeviceVendorLinkRecord,
  GoogleHomeMode,
  MetricReadingRecord,
  RoomRecord,
  TariffPeriodRecord,
  VendorId,
} from '@/types';

export interface DemoVendorConnectionState {
  mode: 'cloud_key' | GoogleHomeMode;
  connected: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface DemoState {
  rooms: RoomRecord[];
  devices: DeviceRecord[];
  vendorLinks: DeviceVendorLinkRecord[];
  vendorConnections: Record<VendorId, DemoVendorConnectionState>;
  readings: MetricReadingRecord[];
  tariffs: TariffPeriodRecord[];
  automations: AutomationRecord[];
  logs: CollectionLogRecord[];
  nextRoomId: number;
  nextReadingId: number;
  nextTariffId: number;
  nextLogId: number;
  nextLinkId: number;
}

declare global {
  var __tuyaDemoState: DemoState | undefined;
}

function pseudoNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function createInitialDemoState(): DemoState {
  const now = new Date();
  // Aligne sur la demi-heure précédente pour des courbes propres
  const alignedNow = new Date(now);
  alignedNow.setMinutes(now.getMinutes() >= 30 ? 30 : 0, 0, 0);

  const rooms: RoomRecord[] = [
    {
      id: 1,
      name: 'Salon',
      icon: 'Sofa',
      color: '#3b82f6',
      targetTempMin: 19.5,
      targetTempMax: 22.5,
      targetHumidityMin: 40,
      targetHumidityMax: 60,
      createdAt: new Date(alignedNow.getTime() - 35 * 86_400_000).toISOString(),
    },
    {
      id: 2,
      name: 'Bureau',
      icon: 'Monitor',
      color: '#8b5cf6',
      targetTempMin: 19,
      targetTempMax: 22,
      targetHumidityMin: 40,
      targetHumidityMax: 60,
      createdAt: new Date(alignedNow.getTime() - 35 * 86_400_000).toISOString(),
    },
    {
      id: 3,
      name: 'Cuisine',
      icon: 'Utensils',
      color: '#f59e0b',
      targetTempMin: 18.5,
      targetTempMax: 23,
      targetHumidityMin: 40,
      targetHumidityMax: 65,
      createdAt: new Date(alignedNow.getTime() - 35 * 86_400_000).toISOString(),
    },
    {
      id: 4,
      name: 'Chambre Parentale',
      icon: 'Bed',
      color: '#10b981',
      targetTempMin: 17,
      targetTempMax: 20,
      targetHumidityMin: 40,
      targetHumidityMax: 60,
      createdAt: new Date(alignedNow.getTime() - 35 * 86_400_000).toISOString(),
    },
    {
      id: 5,
      name: 'Salle de Bain',
      icon: 'Bath',
      color: '#ec4899',
      targetTempMin: 20,
      targetTempMax: 24,
      targetHumidityMin: 45,
      targetHumidityMax: 65,
      createdAt: new Date(alignedNow.getTime() - 35 * 86_400_000).toISOString(),
    },
  ];

  const tuyaSeedDevices: Array<Omit<DeviceRecord, 'primaryVendor' | 'systems'>> = [
    {
      id: 'bf81a2c9salonplug01',
      name: 'Prise TV & Box Salon',
      customName: 'Multimédia & Box Fibre',
      roomId: 1,
      category: 'power',
      tuyaCategory: 'cz',
      productName: 'Smart WiFi Plug 16A',
      ipAddress: '192.168.1.42',
      macAddress: 'A4:C1:38:10:42:11',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {
        power: { code: 'cur_power', scale: 0.1 },
        voltage: { code: 'cur_voltage', scale: 0.1 },
        current: { code: 'cur_current', scale: 1 },
        addEle: { code: 'add_ele', scale: 0.001 },
      },
      lastRawStatus: [
        { code: 'switch_1', value: true },
        { code: 'cur_power', value: 1180 },
        { code: 'cur_voltage', value: 2314 },
        { code: 'cur_current', value: 510 },
        { code: 'add_ele', value: 42150 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: 118,
      lastVoltageV: 231.4,
      lastAddEleKwh: 42.15,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: null,
      lastContactOpen: null,
    },
    {
      id: 'bf81a2c9salonclim01',
      name: 'Capteur Salon Zigbee',
      customName: 'Thermomètre Salon',
      roomId: 1,
      category: 'climate',
      tuyaCategory: 'wsdcg',
      productName: 'Tuya Temperature & Humidity Sensor',
      ipAddress: null,
      macAddress: '50:8A:06:22:19:01',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {
        temp: { code: 'va_temperature', scale: 0.1 },
        humidity: { code: 'va_humidity', scale: 1 },
        battery: { code: 'battery_percentage', scale: 1 },
      },
      lastRawStatus: [
        { code: 'va_temperature', value: 211 },
        { code: 'va_humidity', value: 48 },
        { code: 'battery_percentage', value: 86 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: 21.1,
      lastHumidityPct: 48,
      lastBatteryPct: 86,
      lastContactOpen: null,
    },
    {
      id: 'bf81a2c9bureaudesk1',
      name: 'Prise Station Bureau',
      customName: 'PC Fixe & Écrans',
      roomId: 2,
      category: 'power',
      tuyaCategory: 'cz',
      productName: 'Smart Power Meter Plug',
      ipAddress: '192.168.1.45',
      macAddress: 'A4:C1:38:10:45:22',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {
        power: { code: 'cur_power', scale: 0.1 },
        voltage: { code: 'cur_voltage', scale: 0.1 },
        addEle: { code: 'add_ele', scale: 0.001 },
      },
      lastRawStatus: [
        { code: 'switch_1', value: true },
        { code: 'cur_power', value: 2450 },
        { code: 'cur_voltage', value: 2308 },
        { code: 'add_ele', value: 68420 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: 245,
      lastVoltageV: 230.8,
      lastAddEleKwh: 68.42,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: null,
      lastContactOpen: null,
    },
    {
      id: 'bf81a2c9bureauclim1',
      name: 'Capteur Bureau',
      customName: 'Sonde Climat Bureau',
      roomId: 2,
      category: 'climate',
      tuyaCategory: 'wsdcg',
      productName: 'Tuya Temperature & Humidity Sensor',
      ipAddress: null,
      macAddress: '50:8A:06:22:19:01',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {
        temp: { code: 'temp_current', scale: 0.1 },
        humidity: { code: 'humidity_value', scale: 1 },
        battery: { code: 'battery_percentage', scale: 1 },
      },
      lastRawStatus: [
        { code: 'temp_current', value: 218 },
        { code: 'humidity_value', value: 44 },
        { code: 'battery_percentage', value: 92 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: 21.8,
      lastHumidityPct: 44,
      lastBatteryPct: 92,
      lastContactOpen: null,
    },
    {
      id: 'bf81a2c9cuisinefrigo',
      name: 'Prise Réfrigérateur',
      customName: 'Réfrigérateur & Congélateur',
      roomId: 3,
      category: 'power',
      tuyaCategory: 'cz',
      productName: 'Smart WiFi Plug 16A',
      ipAddress: '192.168.1.42',
      macAddress: 'A4:C1:38:10:42:11',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {
        power: { code: 'cur_power', scale: 0.1 },
        voltage: { code: 'cur_voltage', scale: 0.1 },
        addEle: { code: 'add_ele', scale: 0.001 },
      },
      lastRawStatus: [
        { code: 'switch_1', value: true },
        { code: 'cur_power', value: 840 },
        { code: 'cur_voltage', value: 2319 },
        { code: 'add_ele', value: 53110 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: 84,
      lastVoltageV: 231.9,
      lastAddEleKwh: 53.11,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: null,
      lastContactOpen: null,
    },
    {
      id: 'bf81a2c9chambreelec',
      name: 'Prise Radiateur Chambre',
      customName: 'Convecteur Chambre',
      roomId: 4,
      category: 'power',
      tuyaCategory: 'cz',
      productName: 'Smart Energy Plug 16A',
      ipAddress: '192.168.1.48',
      macAddress: 'A4:C1:38:10:48:33',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'integration',
      dpConfig: {
        power: { code: 'cur_power', scale: 0.1 },
        voltage: { code: 'cur_voltage', scale: 0.1 },
      },
      lastRawStatus: [
        { code: 'switch_1', value: true },
        { code: 'cur_power', value: 3200 },
        { code: 'cur_voltage', value: 2295 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: 320,
      lastVoltageV: 229.5,
      lastAddEleKwh: null,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: null,
      lastContactOpen: null,
    },
    {
      id: 'bf81a2c9chambreclim',
      name: 'Capteur Chambre',
      customName: 'Thermomètre Chambre',
      roomId: 4,
      category: 'climate',
      tuyaCategory: 'wsdcg',
      productName: 'Tuya Temperature & Humidity Sensor',
      ipAddress: null,
      macAddress: '50:8A:06:22:19:01',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {
        temp: { code: 'va_temperature', scale: 0.1 },
        humidity: { code: 'va_humidity', scale: 1 },
        battery: { code: 'battery_percentage', scale: 1 },
      },
      lastRawStatus: [
        { code: 'va_temperature', value: 186 },
        { code: 'va_humidity', value: 53 },
        { code: 'battery_percentage', value: 78 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: 18.6,
      lastHumidityPct: 53,
      lastBatteryPct: 78,
      lastContactOpen: null,
    },
    {
      id: 'bf81a2c9sdbclim001',
      name: 'Capteur Salle de Bain',
      customName: 'Hygromètre Salle de Bain',
      roomId: 5,
      category: 'climate',
      tuyaCategory: 'wsdcg',
      productName: 'Tuya Waterproof Temp & Humidity',
      ipAddress: null,
      macAddress: '50:8A:06:22:19:04',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {
        temp: { code: 'va_temperature', scale: 0.1 },
        humidity: { code: 'va_humidity', scale: 1 },
        battery: { code: 'battery_percentage', scale: 1 },
      },
      lastRawStatus: [
        { code: 'va_temperature', value: 214 },
        { code: 'va_humidity', value: 67 },
        { code: 'battery_percentage', value: 90 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: 21.4,
      lastHumidityPct: 67,
      lastBatteryPct: 90,
      lastContactOpen: null,
    },
    {
      id: 'bf81a2c9entree001',
      name: 'Capteur Porte Entrée',
      customName: "Porte d'Entrée",
      roomId: 1,
      category: 'contact',
      tuyaCategory: 'mcs',
      productName: 'Zigbee Door & Window Sensor',
      ipAddress: null,
      macAddress: '70:B3:D5:88:11:A1',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {
        contact: { code: 'doorcontact_state', scale: 1 },
        battery: { code: 'battery_percentage', scale: 1 },
      },
      lastRawStatus: [
        { code: 'doorcontact_state', value: false },
        { code: 'battery_percentage', value: 94 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: 94,
      lastContactOpen: false,
    },
    {
      id: 'bf81a2c9salonbaie',
      name: 'Capteur Baie Vitrée',
      customName: 'Baie Vitrée Salon',
      roomId: 1,
      category: 'contact',
      tuyaCategory: 'mcs',
      productName: 'Zigbee Door & Window Sensor',
      ipAddress: null,
      macAddress: '70:B3:D5:88:11:A1',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {
        contact: { code: 'doorcontact_state', scale: 1 },
        battery: { code: 'battery_percentage', scale: 1 },
      },
      lastRawStatus: [
        { code: 'doorcontact_state', value: true },
        { code: 'battery_percentage', value: 82 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: 82,
      lastContactOpen: true,
    },
    {
      id: 'bf81a2c9chambrefen',
      name: 'Capteur Fenêtre Chambre',
      customName: 'Fenêtre Chambre',
      roomId: 4,
      category: 'contact',
      tuyaCategory: 'mcs',
      productName: 'Zigbee Door & Window Sensor',
      ipAddress: null,
      macAddress: '70:B3:D5:88:11:A1',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {
        contact: { code: 'doorcontact_state', scale: 1 },
        battery: { code: 'battery_percentage', scale: 1 },
      },
      lastRawStatus: [
        { code: 'doorcontact_state', value: false },
        { code: 'battery_percentage', value: 65 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: 65,
      lastContactOpen: false,
    },
  ];

  const LINKED_TO_GOOGLE_HOME_IDS = new Set(['bf81a2c9salonplug01', 'bf81a2c9bureaudesk1']);

  const devices: DeviceRecord[] = [
    ...tuyaSeedDevices.map((d) => ({
      ...d,
      primaryVendor: 'tuya' as const,
      systems: LINKED_TO_GOOGLE_HOME_IDS.has(d.id)
        ? (['tuya', 'google_home'] as VendorId[])
        : (['tuya'] as VendorId[]),
    })),
    {
      id: 'gh_nest_thermostat_salon',
      name: 'Nest Thermostat Salon',
      customName: 'Nest Thermostat Salon',
      primaryVendor: 'google_home',
      systems: ['google_home'],
      roomId: 1,
      category: 'climate',
      tuyaCategory: 'gh_thermostat',
      productName: 'Google Nest Thermostat',
      ipAddress: null,
      macAddress: null,
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {
        temp: { code: 'ambientTemperatureCelsius', scale: 1 },
        humidity: { code: 'ambientHumidityPercent', scale: 1 },
      },
      lastRawStatus: [
        { code: 'ambientTemperatureCelsius', value: 20.8 },
        { code: 'ambientHumidityPercent', value: 48 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: 20.8,
      lastHumidityPct: 48,
      lastBatteryPct: null,
      lastContactOpen: null,
    },
    {
      id: 'gh_nest_hub_cuisine',
      name: 'Google Nest Hub Cuisine',
      customName: null,
      primaryVendor: 'google_home',
      systems: ['google_home'],
      roomId: 3,
      category: 'other',
      tuyaCategory: 'gh_display',
      productName: 'Google Nest Hub (2nd Gen)',
      ipAddress: null,
      macAddress: null,
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [{ code: 'Connectivity', value: 'ONLINE' }],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: null,
      lastContactOpen: null,
    },
    {
      id: 'gh_dup_radiateur_chambre',
      name: 'Radiateur Chambre',
      customName: null,
      primaryVendor: 'google_home',
      systems: ['google_home'],
      roomId: 4,
      category: 'other',
      tuyaCategory: 'gh_plug',
      productName: 'Smart Life via Google Home',
      ipAddress: null,
      macAddress: null,
      isOnline: true,
      isMonitored: false,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [{ code: 'OnOff', value: true }],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: null,
      lastContactOpen: null,
    },
  ];

  // Deux périodes tarifaires (2025 -> 2026) pour illustrer la gestion multi-périodes
  const currentYear = alignedNow.getUTCFullYear();
  const prevYear = currentYear - 1;
  const tariffs: TariffPeriodRecord[] = normalizeTariffTimeline([
    {
      id: 1,
      label: `Tarif Bleu Base ${prevYear}`,
      startDate: `${prevYear}-02-01`,
      endDate: `${currentYear}-01-31`,
      mode: 'BASE',
      baseRateEur: 0.2516,
      hpRateEur: 0.27,
      hcRateEur: 0.2068,
      hcSlots: [{ start: '22:00', end: '06:00' }],
      monthlySubscriptionEur: 13.72,
      createdAt: new Date(alignedNow.getTime() - 300 * 86_400_000).toISOString(),
    },
    {
      id: 2,
      label: `Tarif Bleu Base ${currentYear}`,
      startDate: `${currentYear}-02-01`,
      endDate: null,
      mode: 'BASE',
      baseRateEur: 0.2016,
      hpRateEur: 0.2146,
      hcRateEur: 0.1696,
      hcSlots: [{ start: '22:00', end: '06:00' }],
      monthlySubscriptionEur: 14.18,
      createdAt: new Date(alignedNow.getTime() - 60 * 86_400_000).toISOString(),
    },
  ]);

  // Génération de 30 jours au pas de 30 minutes (1 440 points par appareil)
  const readings: MetricReadingRecord[] = [];
  let nextReadingId = 1;
  const totalSteps = 30 * 48; // 30 jours * 48 tranches de 30 min

  const cumulativeAddEle = new Map<string, number>([
    ['bf81a2c9salonplug01', 12.0],
    ['bf81a2c9bureaudesk1', 20.0],
    ['bf81a2c9cuisinefrigo', 28.0],
  ]);

  for (let step = totalSteps; step >= 0; step--) {
    const ts = new Date(alignedNow.getTime() - step * 30 * 60_000);
    const hour = ts.getHours() + ts.getMinutes() / 60;
    const dayPhase = Math.sin(((hour - 6) / 24) * 2 * Math.PI);

    // 1. Salon Plug (TV soirée + box H24 ~28W)
    {
      const noise = pseudoNoise(step * 1.1);
      const isEvening = hour >= 18.5 && hour <= 23.5;
      const isDay = hour >= 9 && hour < 18.5;
      const base = isEvening ? 135 : isDay ? 52 : 28;
      const powerW = Math.round((base + noise * 32) * 10) / 10;
      const prevAdd = cumulativeAddEle.get('bf81a2c9salonplug01') ?? 12;
      const kwh = Math.round((powerW / 1000) * 0.5 * 10000) / 10000;
      cumulativeAddEle.set('bf81a2c9salonplug01', prevAdd + kwh);
      readings.push({
        id: nextReadingId++,
        deviceId: 'bf81a2c9salonplug01',
        roomId: 1,
        recordedAt: ts.toISOString(),
        powerW,
        voltageV: 230 + Math.round(noise * 40) / 10,
        energyKwh: kwh,
        energySource: 'add_ele',
        tempC: null,
        humidityPct: null,
        contactOpen: null,
      });
    }

    // 2. Salon Climate
    {
      const noise = pseudoNoise(step * 1.3);
      const tempC = Math.round((20.8 + dayPhase * 1.1 + (noise - 0.5) * 0.4) * 10) / 10;
      const humidityPct = Math.round(49 - dayPhase * 3 + (noise - 0.5) * 4);
      readings.push({
        id: nextReadingId++,
        deviceId: 'bf81a2c9salonclim01',
        roomId: 1,
        recordedAt: ts.toISOString(),
        powerW: null,
        voltageV: null,
        energyKwh: null,
        energySource: null,
        tempC,
        humidityPct,
        contactOpen: null,
      });
    }

    // 3. Bureau Plug (PC journée 09h-18h + veille 18W)
    {
      const noise = pseudoNoise(step * 1.7);
      const dayOfWeek = ts.getDay();
      const isWorkday = dayOfWeek >= 1 && dayOfWeek <= 5;
      const isWorking = isWorkday && hour >= 9 && hour <= 18.5;
      const isEveningGaming = hour >= 20.5 && hour <= 22.5 && noise > 0.35;
      const base = isWorking ? 210 : isEveningGaming ? 280 : 18;
      const powerW = Math.round((base + noise * (isWorking ? 75 : 8)) * 10) / 10;
      const prevAdd = cumulativeAddEle.get('bf81a2c9bureaudesk1') ?? 20;
      const kwh = Math.round((powerW / 1000) * 0.5 * 10000) / 10000;
      cumulativeAddEle.set('bf81a2c9bureaudesk1', prevAdd + kwh);
      readings.push({
        id: nextReadingId++,
        deviceId: 'bf81a2c9bureaudesk1',
        roomId: 2,
        recordedAt: ts.toISOString(),
        powerW,
        voltageV: 230.5 + Math.round(noise * 30) / 10,
        energyKwh: kwh,
        energySource: 'add_ele',
        tempC: null,
        humidityPct: null,
        contactOpen: null,
      });
    }

    // 4. Bureau Climate (légèrement plus chaud quand le PC tourne)
    {
      const noise = pseudoNoise(step * 2.1);
      const isWorkHours = hour >= 9 && hour <= 19;
      const pcHeat = isWorkHours ? 0.9 : 0;
      const tempC = Math.round((20.4 + pcHeat + dayPhase * 0.9 + (noise - 0.5) * 0.4) * 10) / 10;
      const humidityPct = Math.round(45 - dayPhase * 2 + (noise - 0.5) * 3);
      readings.push({
        id: nextReadingId++,
        deviceId: 'bf81a2c9bureauclim1',
        roomId: 2,
        recordedAt: ts.toISOString(),
        powerW: null,
        voltageV: null,
        energyKwh: null,
        energySource: null,
        tempC,
        humidityPct,
        contactOpen: null,
      });
    }

    // 5. Cuisine Frigo (cycles compresseur ~95W / ~4W)
    {
      const noise = pseudoNoise(step * 2.7);
      const compressorOn = (step % 3 !== 0) || noise > 0.6;
      const powerW = Math.round((compressorOn ? 88 + noise * 18 : 4 + noise * 2) * 10) / 10;
      const prevAdd = cumulativeAddEle.get('bf81a2c9cuisinefrigo') ?? 28;
      const kwh = Math.round((powerW / 1000) * 0.5 * 10000) / 10000;
      cumulativeAddEle.set('bf81a2c9cuisinefrigo', prevAdd + kwh);
      readings.push({
        id: nextReadingId++,
        deviceId: 'bf81a2c9cuisinefrigo',
        roomId: 3,
        recordedAt: ts.toISOString(),
        powerW,
        voltageV: 231.2,
        energyKwh: kwh,
        energySource: 'add_ele',
        tempC: null,
        humidityPct: null,
        contactOpen: null,
      });
    }

    // 6. Chambre Convecteur (chauffe principalement fin de journée & nuit)
    {
      const noise = pseudoNoise(step * 3.1);
      const isColdWindow = hour >= 20 || hour <= 7.5;
      const powerW = isColdWindow
        ? Math.round((280 + noise * 450) * 10) / 10
        : Math.round((2 + noise * 3) * 10) / 10;
      const kwh = Math.round((powerW / 1000) * 0.5 * 10000) / 10000;
      readings.push({
        id: nextReadingId++,
        deviceId: 'bf81a2c9chambreelec',
        roomId: 4,
        recordedAt: ts.toISOString(),
        powerW,
        voltageV: 229.6,
        energyKwh: kwh,
        energySource: 'integration',
        tempC: null,
        humidityPct: null,
        contactOpen: null,
      });
    }

    // 7. Chambre Climate
    {
      const noise = pseudoNoise(step * 3.5);
      const tempC = Math.round((18.8 + dayPhase * 0.8 + (noise - 0.5) * 0.3) * 10) / 10;
      const humidityPct = Math.round(53 + (noise - 0.5) * 4);
      readings.push({
        id: nextReadingId++,
        deviceId: 'bf81a2c9chambreclim',
        roomId: 4,
        recordedAt: ts.toISOString(),
        powerW: null,
        voltageV: null,
        energyKwh: null,
        energySource: null,
        tempC,
        humidityPct,
        contactOpen: null,
      });
    }

    // 8. Salle de Bain Climate (pics d'humidité matin et soir douche)
    {
      const noise = pseudoNoise(step * 3.9);
      const showerMorning = hour >= 7 && hour <= 8.5;
      const showerEvening = hour >= 20 && hour <= 21.5;
      const humSpike = showerMorning ? 20 : showerEvening ? 16 : 0;
      const tempC = Math.round((21.2 + (showerMorning || showerEvening ? 1.4 : 0) + (noise - 0.5) * 0.5) * 10) / 10;
      const humidityPct = Math.min(88, Math.round(54 + humSpike + (noise - 0.5) * 4));
      readings.push({
        id: nextReadingId++,
        deviceId: 'bf81a2c9sdbclim001',
        roomId: 5,
        recordedAt: ts.toISOString(),
        powerW: null,
        voltageV: null,
        energyKwh: null,
        energySource: null,
        tempC,
        humidityPct,
        contactOpen: null,
      });
    }

    // 9. Capteur Porte Entrée (ouvert ponctuellement en journée)
    {
      const noise = pseudoNoise(step * 4.3);
      const isDay = hour >= 8 && hour <= 21;
      const open = step > 0 && isDay && noise > 0.91;
      readings.push({
        id: nextReadingId++,
        deviceId: 'bf81a2c9entree001',
        roomId: 1,
        recordedAt: ts.toISOString(),
        powerW: null,
        voltageV: null,
        energyKwh: null,
        energySource: null,
        tempC: null,
        humidityPct: null,
        contactOpen: open,
      });
    }

    // 10. Capteur Baie Vitrée Salon (aération après-midi, ouvert en ce moment)
    {
      const noise = pseudoNoise(step * 4.7);
      const open = step === 0 || (hour >= 13 && hour <= 17.5 && noise > 0.65);
      readings.push({
        id: nextReadingId++,
        deviceId: 'bf81a2c9salonbaie',
        roomId: 1,
        recordedAt: ts.toISOString(),
        powerW: null,
        voltageV: null,
        energyKwh: null,
        energySource: null,
        tempC: null,
        humidityPct: null,
        contactOpen: open,
      });
    }

    // 11. Capteur Fenêtre Chambre (aération le matin 08h-09h30)
    {
      const noise = pseudoNoise(step * 5.1);
      const open = step > 0 && hour >= 8 && hour <= 9.5 && noise > 0.35;
      readings.push({
        id: nextReadingId++,
        deviceId: 'bf81a2c9chambrefen',
        roomId: 4,
        recordedAt: ts.toISOString(),
        powerW: null,
        voltageV: null,
        energyKwh: null,
        energySource: null,
        tempC: null,
        humidityPct: null,
        contactOpen: open,
      });
    }
  }

  // Synchroniser les dernières valeurs des appareils avec la fin de la série générée
  const lastByDevice = new Map<string, MetricReadingRecord>();
  for (const r of readings) {
    lastByDevice.set(r.deviceId, r);
  }
  for (const dev of devices) {
    const last = lastByDevice.get(dev.id);
    if (last) {
      dev.lastSeenAt = last.recordedAt;
      if (last.powerW !== null) dev.lastPowerW = last.powerW;
      if (last.voltageV !== null) dev.lastVoltageV = last.voltageV;
      if (last.tempC !== null) dev.lastTempC = last.tempC;
      if (last.humidityPct !== null) dev.lastHumidityPct = last.humidityPct;
      if (last.contactOpen !== null) dev.lastContactOpen = last.contactOpen;
    }
    const finalAdd = cumulativeAddEle.get(dev.id);
    if (finalAdd !== undefined) {
      dev.lastAddEleKwh = Math.round(finalAdd * 1000) / 1000;
    }
  }

  const logs: CollectionLogRecord[] = [
    {
      id: 1,
      executedAt: alignedNow.toISOString(),
      trigger: 'schedule',
      devicesCount: devices.length,
      readingsInserted: devices.length,
      status: 'success',
      errorMessage: null,
      durationMs: 312,
    },
    {
      id: 2,
      executedAt: new Date(alignedNow.getTime() - 30 * 60_000).toISOString(),
      trigger: 'schedule',
      devicesCount: devices.length,
      readingsInserted: devices.length,
      status: 'success',
      errorMessage: null,
      durationMs: 289,
    },
    {
      id: 3,
      executedAt: new Date(alignedNow.getTime() - 60 * 60_000).toISOString(),
      trigger: 'schedule',
      devicesCount: devices.length,
      readingsInserted: devices.length,
      status: 'success',
      errorMessage: null,
      durationMs: 304,
    },
  ];

  const syncedIso = alignedNow.toISOString();
  const demoAutomationSeeds: Array<Omit<AutomationRecord, 'vendor'>> = [
    {
      id: 'rule_window_cut_heat',
      homeId: 'demo-home-1',
      name: 'Coupure chauffage si fenêtre chambre ouverte',
      ruleType: 'automation',
      enabled: true,
      matchType: 'all',
      effectiveTime: { allDay: true, startTime: '00:00', endTime: '23:59', loops: '1111111' },
      conditions: [
        {
          category: 'device',
          entityId: 'bf81a2c9chambrefen',
          entityName: 'Capteur Fenêtre Chambre',
          code: 'doorcontact_state',
          operator: '==',
          value: true,
          summary: 'doorcontact_state == true',
        },
      ],
      actions: [
        {
          category: 'device',
          entityId: 'bf81a2c9chambreelec',
          entityName: 'Prise Radiateur Chambre',
          executor: 'dpIssue',
          properties: { switch_1: false },
          summary: 'switch_1: OFF',
        },
      ],
      rawPayload: { rule_id: 'rule_window_cut_heat', source: 'demo' },
      syncedAt: syncedIso,
    },
    {
      id: 'rule_evening_heat_chambre',
      homeId: 'demo-home-1',
      name: 'Relance chauffage chambre en soirée',
      ruleType: 'automation',
      enabled: true,
      matchType: 'all',
      effectiveTime: { allDay: false, startTime: '19:30', endTime: '23:30', loops: '1111111' },
      conditions: [
        {
          category: 'timer',
          entityId: null,
          entityName: null,
          code: 'timer',
          operator: '==',
          value: '20:00',
          summary: 'Horaire : 20:00',
        },
        {
          category: 'device',
          entityId: 'bf81a2c9chambreclim',
          entityName: 'Capteur Chambre',
          code: 'va_temperature',
          operator: '<',
          value: 185,
          summary: 'va_temperature < 185',
        },
      ],
      actions: [
        {
          category: 'device',
          entityId: 'bf81a2c9chambreelec',
          entityName: 'Prise Radiateur Chambre',
          executor: 'dpIssue',
          properties: { switch_1: true },
          summary: 'switch_1: ON',
        },
      ],
      rawPayload: { rule_id: 'rule_evening_heat_chambre', source: 'demo' },
      syncedAt: syncedIso,
    },
    {
      id: 'rule_night_door_alert',
      homeId: 'demo-home-1',
      name: "Alerte porte d'entrée ouverte la nuit",
      ruleType: 'automation',
      enabled: true,
      matchType: 'all',
      effectiveTime: { allDay: false, startTime: '23:00', endTime: '06:30', loops: '1111111' },
      conditions: [
        {
          category: 'device',
          entityId: 'bf81a2c9entree001',
          entityName: 'Capteur Porte Entrée',
          code: 'doorcontact_state',
          operator: '==',
          value: true,
          summary: 'doorcontact_state == true',
        },
      ],
      actions: [
        {
          category: 'notification',
          entityId: null,
          entityName: null,
          executor: 'appPush',
          properties: {},
          summary: 'Notification Push Smart Life',
        },
      ],
      rawPayload: { rule_id: 'rule_night_door_alert', source: 'demo' },
      syncedAt: syncedIso,
    },
    {
      id: 'rule_desk_auto_off',
      homeId: 'demo-home-1',
      name: 'Extinction station bureau la nuit',
      ruleType: 'automation',
      enabled: true,
      matchType: 'all',
      effectiveTime: { allDay: true, startTime: '00:00', endTime: '23:59', loops: '0111110' },
      conditions: [
        {
          category: 'timer',
          entityId: null,
          entityName: null,
          code: 'timer',
          operator: '==',
          value: '23:30',
          summary: 'Horaire : 23:30',
        },
      ],
      actions: [
        {
          category: 'device',
          entityId: 'bf81a2c9bureaudesk1',
          entityName: 'Prise Station Bureau',
          executor: 'dpIssue',
          properties: { switch_1: false },
          summary: 'switch_1: OFF',
        },
      ],
      rawPayload: { rule_id: 'rule_desk_auto_off', source: 'demo' },
      syncedAt: syncedIso,
    },
    {
      id: 'rule_sdb_humidity_alert',
      homeId: 'demo-home-1',
      name: 'Alerte humidité élevée salle de bain',
      ruleType: 'automation',
      enabled: false,
      matchType: 'any',
      effectiveTime: { allDay: true, startTime: '00:00', endTime: '23:59', loops: '1111111' },
      conditions: [
        {
          category: 'device',
          entityId: 'bf81a2c9sdbclim001',
          entityName: 'Capteur Salle de Bain',
          code: 'va_humidity',
          operator: '>',
          value: 75,
          summary: 'va_humidity > 75',
        },
      ],
      actions: [
        {
          category: 'notification',
          entityId: null,
          entityName: null,
          executor: 'appPush',
          properties: {},
          summary: 'Notification Push Smart Life',
        },
      ],
      rawPayload: { rule_id: 'rule_sdb_humidity_alert', source: 'demo' },
      syncedAt: syncedIso,
    },
    {
      id: 'scene_leave_home',
      homeId: 'demo-home-1',
      name: 'Départ Maison (Tout couper)',
      ruleType: 'scene',
      enabled: true,
      matchType: 'manual',
      effectiveTime: null,
      conditions: [],
      actions: [
        {
          category: 'device',
          entityId: 'bf81a2c9salonplug01',
          entityName: 'Prise TV & Box Salon',
          executor: 'dpIssue',
          properties: { switch_1: false },
          summary: 'switch_1: OFF',
        },
        {
          category: 'device',
          entityId: 'bf81a2c9bureaudesk1',
          entityName: 'Prise Station Bureau',
          executor: 'dpIssue',
          properties: { switch_1: false },
          summary: 'switch_1: OFF',
        },
        {
          category: 'device',
          entityId: 'bf81a2c9chambreelec',
          entityName: 'Prise Radiateur Chambre',
          executor: 'dpIssue',
          properties: { switch_1: false },
          summary: 'switch_1: OFF',
        },
      ],
      rawPayload: { rule_id: 'scene_leave_home', type: 'scene', source: 'demo' },
      syncedAt: syncedIso,
    },
  ];

  const demoAutomations: AutomationRecord[] = demoAutomationSeeds.map((rule) => ({
    ...rule,
    vendor: 'tuya',
  }));

  let nextLinkId = 1;
  const vendorLinks: DeviceVendorLinkRecord[] = [];
  for (const d of devices) {
    vendorLinks.push({
      id: nextLinkId++,
      deviceId: d.id,
      vendor: d.primaryVendor,
      externalId: d.primaryVendor === 'google_home' ? `enterprises/demo/devices/${d.id}` : d.id,
      externalName: d.name,
      isPrimaryTelemetry: true,
      linkedAt: syncedIso,
    });
    if (d.primaryVendor === 'tuya' && d.systems.includes('google_home')) {
      vendorLinks.push({
        id: nextLinkId++,
        deviceId: d.id,
        vendor: 'google_home',
        externalId: `enterprises/demo/devices/gh_${d.id}`,
        externalName: d.customName || d.name,
        isPrimaryTelemetry: false,
        linkedAt: syncedIso,
      });
    }
    d.vendorLinks = vendorLinks.filter((l) => l.deviceId === d.id);
  }

  const vendorConnections: Record<VendorId, DemoVendorConnectionState> = {
    tuya: {
      mode: 'cloud_key',
      connected: true,
      lastSyncedAt: syncedIso,
      lastError: null,
    },
    google_home: {
      mode: 'mcp',
      connected: true,
      lastSyncedAt: syncedIso,
      lastError: null,
    },
  };

  return {
    rooms,
    devices,
    vendorLinks,
    vendorConnections,
    readings,
    tariffs,
    automations: demoAutomations,
    logs,
    nextRoomId: rooms.length + 1,
    nextReadingId,
    nextTariffId: tariffs.length + 1,
    nextLogId: logs.length + 1,
    nextLinkId,
  };
}

export function getDemoState(): DemoState {
  if (!globalThis.__tuyaDemoState) {
    globalThis.__tuyaDemoState = createInitialDemoState();
  }
  return globalThis.__tuyaDemoState;
}

export function simulateDemoCollection(trigger: 'schedule' | 'manual'): CollectionLogRecord {
  const state = getDemoState();
  const startedAt = Date.now();
  const now = new Date();
  let inserted = 0;

  for (const dev of state.devices) {
    if (!dev.isMonitored) continue;

    const jitter = pseudoNoise(now.getTime() / 1000 + inserted);
    let powerW: number | null = dev.lastPowerW;
    let tempC: number | null = dev.lastTempC;
    let humidityPct: number | null = dev.lastHumidityPct;
    let addEleKwh: number | null = dev.lastAddEleKwh;
    let contactOpen: boolean | null = dev.lastContactOpen;

    if (powerW !== null) {
      powerW = Math.max(2, Math.round((powerW + (jitter - 0.5) * 18) * 10) / 10);
      if (addEleKwh !== null) {
        addEleKwh = Math.round((addEleKwh + (powerW / 1000) * 0.5) * 1000) / 1000;
      }
    }
    if (tempC !== null) {
      tempC = Math.round((tempC + (jitter - 0.5) * 0.3) * 10) / 10;
    }
    if (humidityPct !== null) {
      humidityPct = Math.min(95, Math.max(20, Math.round(humidityPct + (jitter - 0.5) * 2)));
    }
    if (contactOpen !== null && jitter > 0.72) {
      contactOpen = !contactOpen;
    }

    const energyRes =
      powerW !== null
        ? computeHybridEnergyKwh({
            energyMode: dev.energyMode,
            powerW,
            currentAddEleKwh: addEleKwh,
            previousAddEleKwh: dev.lastAddEleKwh,
            previousSeenAt: dev.lastSeenAt,
            now,
          })
        : null;

    state.readings.push({
      id: state.nextReadingId++,
      deviceId: dev.id,
      roomId: dev.roomId,
      recordedAt: now.toISOString(),
      powerW,
      voltageV: dev.lastVoltageV,
      energyKwh: energyRes ? energyRes.energyKwh : null,
      energySource: energyRes ? energyRes.source : null,
      tempC,
      humidityPct,
      contactOpen,
    });

    dev.lastPowerW = powerW;
    dev.lastAddEleKwh = addEleKwh;
    dev.lastTempC = tempC;
    dev.lastHumidityPct = humidityPct;
    dev.lastContactOpen = contactOpen;
    dev.lastSeenAt = now.toISOString();
    inserted += 1;
  }

  const log: CollectionLogRecord = {
    id: state.nextLogId++,
    executedAt: now.toISOString(),
    trigger,
    devicesCount: state.devices.length,
    readingsInserted: inserted,
    status: 'success',
    errorMessage: null,
    durationMs: Math.max(45, Date.now() - startedAt + 140),
  };

  state.logs.unshift(log);
  return log;
}
