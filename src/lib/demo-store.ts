import { extractCoverSummary } from './covers-utils';
import { computeHybridEnergyKwh, normalizeTariffTimeline } from './tariff-engine';
import type {
  AutomationRecord,
  CollectionLogRecord,
  DeviceRecord,
  DeviceVendorLinkRecord,
  GoogleHomeMode,
  MeterReadingRecord,
  MetricReadingRecord,
  RoomRecord,
  TariffPeriodRecord,
  VendorId,
} from '@/types';

export interface DemoVendorConnectionState {
  mode:
  | 'cloud_key'
  | 'cloud_account'
  | 'oauth_prod'
  | 'oauth_simulator'
  | 'oauth_cn'
  | 'bearer_token'
  | GoogleHomeMode;
  connected: boolean;
  config?: Record<string, unknown>;
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface DemoState {
  rooms: RoomRecord[];
  devices: DeviceRecord[];
  vendorLinks: DeviceVendorLinkRecord[];
  vendorConnections: Record<VendorId, DemoVendorConnectionState>;
  readings: MetricReadingRecord[];
  meterReadings: MeterReadingRecord[];
  consoApiConfig: { prm: string; token: string; subscribedKva: number | null } | null;
  tariffs: TariffPeriodRecord[];
  automations: AutomationRecord[];
  logs: CollectionLogRecord[];
  nextRoomId: number;
  nextReadingId: number;
  nextMeterReadingId: number;
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
    {
      id: 'kasa_demo_hs110_lavelinge',
      name: 'Prise Kasa Lave-Linge',
      customName: 'Lave-Linge (Kasa HS110)',
      primaryVendor: 'kasa',
      systems: ['kasa', 'google_home'],
      roomId: 5,
      category: 'power',
      tuyaCategory: 'IOT.SMARTPLUGSWITCH',
      productName: 'TP-Link · HS110(EU)',
      ipAddress: null,
      macAddress: '50:C7:BF:24:8A:10',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {
        power: { code: 'power_w', scale: 1 },
        voltage: { code: 'voltage_v', scale: 1 },
        addEle: { code: 'total_kwh', scale: 1 },
      },
      lastRawStatus: [
        { code: 'relay_state', value: true },
        { code: 'power_w', value: 48 },
        { code: 'voltage_v', value: 230.5 },
        { code: 'total_kwh', value: 19.4 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: 48,
      lastVoltageV: 230.5,
      lastAddEleKwh: 19.4,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: null,
      lastContactOpen: null,
    },
    {
      id: 'kasa_demo_kl130_salon',
      name: 'Ampoule Kasa Salon',
      customName: 'Lampe Ambiance Salon',
      primaryVendor: 'kasa',
      systems: ['kasa'],
      roomId: 1,
      category: 'other',
      tuyaCategory: 'IOT.SMARTBULB',
      productName: 'TP-Link · KL130(EU)',
      ipAddress: null,
      macAddress: '50:C7:BF:24:9C:22',
      isOnline: true,
      isMonitored: false,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'relay_state', value: true },
        { code: 'brightness', value: 75 },
      ],
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
      id: 'hc_siemens_dishwasher_cuisine',
      name: 'Lave-vaisselle Siemens iQ500',
      customName: 'Lave-vaisselle iQ500',
      primaryVendor: 'home_connect',
      systems: ['home_connect'],
      roomId: 3,
      category: 'other',
      tuyaCategory: 'Dishwasher',
      productName: 'SIEMENS · SN65ZX49CE/01',
      ipAddress: '192.168.1.54',
      macAddress: '68:A4:0E:51:24:90',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'ha_id', value: 'SIEMENS-SN65ZX49CE-68A40E512490' },
        { code: 'appliance_type', value: 'Dishwasher' },
        { code: 'brand', value: 'SIEMENS' },
        { code: 'operation_state', value: 'Run' },
        { code: 'power_state', value: 'On' },
        { code: 'door_state', value: 'Closed' },
        { code: 'active_program', value: 'Eco 50°' },
        { code: 'program_progress', value: 68 },
        { code: 'remaining_seconds', value: 2280 },
      ],
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
      id: 'hc_siemens_fridge_cuisine',
      name: 'Réfrigérateur Siemens iQ700',
      customName: 'Frigo & Congél. Siemens',
      primaryVendor: 'home_connect',
      systems: ['home_connect'],
      roomId: 3,
      category: 'other',
      tuyaCategory: 'FridgeFreezer',
      productName: 'SIEMENS · KG39NAI45/02',
      ipAddress: null,
      macAddress: '68:A4:0E:51:24:91',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'ha_id', value: 'SIEMENS-KG39NAI45-68A40E512491' },
        { code: 'appliance_type', value: 'FridgeFreezer' },
        { code: 'brand', value: 'SIEMENS' },
        { code: 'power_state', value: 'On' },
        { code: 'door_fridge', value: 'Closed' },
        { code: 'door_freezer', value: 'Closed' },
        { code: 'fridge_temp_c', value: 4 },
        { code: 'freezer_temp_c', value: -18 },
      ],
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
      id: 'somfy_demo_volet_salon',
      name: 'Volet Roulant Baie Salon',
      customName: 'Volet Baie Vitree Salon',
      primaryVendor: 'somfy',
      systems: ['somfy'],
      roomId: 1,
      category: 'other',
      tuyaCategory: 'RollerShutter',
      productName: 'Somfy · io-homecontrol (Kit de connectivité)',
      ipAddress: '192.168.1.42',
      macAddress: 'F4:CF:E2:1A:2B:3C',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'somfy:uiClass', value: 'RollerShutter' },
        { code: 'somfy:protocol', value: 'io' },
        { code: 'somfy:controllableName', value: 'io:RollerShutterGenericIOComponent' },
        { code: 'somfy:deviceURL', value: 'io://1234-5678-9012/400001' },
        { code: 'somfy:gatewayId', value: '1234-5678-9012' },
        { code: 'somfy:networkSource', value: 'gateway' },
        { code: 'core:ClosureState', value: 25 },
        { code: 'core:OpenClosedState', value: 'open' },
        { code: 'core:MovingState', value: false },
        { code: 'core:RSSILevelState', value: 84 },
        { code: 'core:DiscreteRSSILevelState', value: 'good' },
      ],
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
      id: 'somfy_demo_store_terrasse',
      name: 'Store Banne Terrasse RTS',
      customName: 'Store Banne Terrasse',
      primaryVendor: 'somfy',
      systems: ['somfy'],
      roomId: 1,
      category: 'other',
      tuyaCategory: 'Awning',
      productName: 'Somfy · RTS (Kit de connectivité)',
      ipAddress: '192.168.1.42',
      macAddress: 'F4:CF:E2:1A:2B:3C',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'somfy:uiClass', value: 'Awning' },
        { code: 'somfy:protocol', value: 'RTS' },
        { code: 'somfy:controllableName', value: 'rts:AwningHorizontalRTSComponent' },
        { code: 'somfy:deviceURL', value: 'rts://1234-5678-9012/400002' },
        { code: 'somfy:gatewayId', value: '1234-5678-9012' },
        { code: 'somfy:networkSource', value: 'gateway' },
        { code: 'core:OpenClosedUnknownState', value: 'unknown' },
      ],
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
      id: 'bf81a2c9tubularbureau',
      name: 'Volet Bureau Tubular Motor',
      customName: 'Volet Bureau (Tubular Motor)',
      primaryVendor: 'tuya',
      systems: ['tuya'],
      roomId: 2,
      category: 'other',
      tuyaCategory: 'cl',
      productName: 'Tuya · Tubular Motors',
      ipAddress: null,
      macAddress: null,
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'control', value: 'open' },
        { code: 'percent_state', value: 0 },
        { code: 'percent_control', value: 0 },
        { code: 'situation_set', value: 'fully_open' },
        { code: 'work_state', value: 'standby' },
      ],
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
      id: 'daikin_demo_stylish_salon',
      name: 'Clim Daikin Stylish Salon',
      customName: 'Split Daikin Salon',
      primaryVendor: 'daikin',
      systems: ['daikin', 'google_home'],
      roomId: 1,
      category: 'hybrid',
      tuyaCategory: 'climateControl',
      productName: 'Daikin · FTXA35AW (Stylish)',
      ipAddress: '192.168.1.64',
      macAddress: 'D0:C5:D3:44:12:8A',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'add_ele',
      dpConfig: {},
      lastRawStatus: [
        { code: 'daikin:unitType', value: 'climateControl' },
        { code: 'daikin:model', value: 'FTXA35AW' },
        { code: 'daikin:onOff', value: 'on' },
        { code: 'daikin:operationMode', value: 'heating' },
        { code: 'daikin:roomTempC', value: 21.3 },
        { code: 'daikin:roomHumidityPct', value: 47 },
        { code: 'daikin:targetTempC', value: 21.5 },
        { code: 'daikin:outdoorTempC', value: 9.2 },
        { code: 'daikin:fanSpeed', value: 'auto' },
        { code: 'daikin:swingVertical', value: 'swing' },
        { code: 'daikin:econo', value: true },
        { code: 'daikin:powerful', value: false },
        { code: 'daikin:streamer', value: true },
        { code: 'daikin:todayKwh', value: 2.8 },
        { code: 'daikin:todayHeatingKwh', value: 2.8 },
        { code: 'daikin:todayCoolingKwh', value: 0 },
        { code: 'daikin:weekKwh', value: 18.4 },
        { code: 'daikin:yearKwh', value: 312.4 },
        { code: 'daikin:wifiSsid', value: 'MaisonWiFi' },
        { code: 'daikin:wifiRssiDbm', value: -54 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: 312.4,
      lastTempC: 21.3,
      lastHumidityPct: 47,
      lastBatteryPct: null,
      lastContactOpen: null,
    },
    {
      id: 'daikin_demo_perfera_chambre',
      name: 'Clim Daikin Perfera Chambre',
      customName: 'Split Daikin Chambre',
      primaryVendor: 'daikin',
      systems: ['daikin'],
      roomId: 4,
      category: 'hybrid',
      tuyaCategory: 'climateControl',
      productName: 'Daikin · FTXM25R (Perfera)',
      ipAddress: '192.168.1.65',
      macAddress: 'D0:C5:D3:44:12:9B',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'add_ele',
      dpConfig: {},
      lastRawStatus: [
        { code: 'daikin:unitType', value: 'climateControl' },
        { code: 'daikin:model', value: 'FTXM25R' },
        { code: 'daikin:onOff', value: 'off' },
        { code: 'daikin:operationMode', value: 'heating' },
        { code: 'daikin:roomTempC', value: 18.9 },
        { code: 'daikin:roomHumidityPct', value: 51 },
        { code: 'daikin:targetTempC', value: 19 },
        { code: 'daikin:outdoorTempC', value: 9.2 },
        { code: 'daikin:fanSpeed', value: 'quiet' },
        { code: 'daikin:econo', value: false },
        { code: 'daikin:powerful', value: false },
        { code: 'daikin:streamer', value: true },
        { code: 'daikin:todayKwh', value: 1.1 },
        { code: 'daikin:todayHeatingKwh', value: 1.1 },
        { code: 'daikin:todayCoolingKwh', value: 0 },
        { code: 'daikin:weekKwh', value: 8.6 },
        { code: 'daikin:yearKwh', value: 184.2 },
        { code: 'daikin:wifiSsid', value: 'MaisonWiFi' },
        { code: 'daikin:wifiRssiDbm', value: -61 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: 184.2,
      lastTempC: 18.9,
      lastHumidityPct: 51,
      lastBatteryPct: null,
      lastContactOpen: null,
    },
    {
      id: 'xsense_demo_sbs50_entree',
      name: 'Station SBS50 Entrée',
      customName: null,
      primaryVendor: 'xsense',
      systems: ['xsense'],
      roomId: 3,
      category: 'other',
      tuyaCategory: 'baseStation',
      productName: 'X-Sense · SBS50',
      ipAddress: '192.168.1.54',
      macAddress: '48:E7:29:14:A0:01',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'xsense:unitType', value: 'baseStation' },
        { code: 'xsense:model', value: 'SBS50' },
        { code: 'xsense:alarmStatus', value: 'normal' },
        { code: 'xsense:smokeDetected', value: false },
        { code: 'xsense:coDetected', value: false },
        { code: 'xsense:waterLeakDetected', value: false },
        { code: 'xsense:isMuted', value: false },
        { code: 'xsense:wifiRssi', value: -49 },
        { code: 'xsense:wifiSsid', value: 'MaisonWiFi' },
        { code: 'xsense:houseName', value: 'Maison Principale' },
        { code: 'xsense:firmware', value: 'v2.4.18' },
      ],
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
      id: 'xsense_demo_sc07_salon',
      name: 'Détecteur Fumée & CO Salon',
      customName: null,
      primaryVendor: 'xsense',
      systems: ['xsense'],
      roomId: 1,
      category: 'other',
      tuyaCategory: 'smokeCoDetector',
      productName: 'X-Sense · SC07-WX',
      ipAddress: '192.168.1.55',
      macAddress: '48:E7:29:14:A0:02',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'xsense:unitType', value: 'smokeCoDetector' },
        { code: 'xsense:model', value: 'SC07-WX' },
        { code: 'xsense:alarmStatus', value: 'normal' },
        { code: 'xsense:smokeDetected', value: false },
        { code: 'xsense:coDetected', value: false },
        { code: 'xsense:coPpm', value: 0 },
        { code: 'xsense:waterLeakDetected', value: false },
        { code: 'xsense:isMuted', value: false },
        { code: 'xsense:wifiRssi', value: -55 },
        { code: 'xsense:houseName', value: 'Maison Principale' },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: 96,
      lastContactOpen: null,
    },
    {
      id: 'xsense_demo_xs01_chambre',
      name: 'Détecteur Fumée Chambre',
      customName: null,
      primaryVendor: 'xsense',
      systems: ['xsense'],
      roomId: 4,
      category: 'other',
      tuyaCategory: 'smokeCoDetector',
      productName: 'X-Sense · XS01-M',
      ipAddress: null,
      macAddress: null,
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'xsense:unitType', value: 'smokeCoDetector' },
        { code: 'xsense:model', value: 'XS01-M' },
        { code: 'xsense:alarmStatus', value: 'normal' },
        { code: 'xsense:smokeDetected', value: false },
        { code: 'xsense:coDetected', value: false },
        { code: 'xsense:waterLeakDetected', value: false },
        { code: 'xsense:isMuted', value: false },
        { code: 'xsense:rfLevel', value: 3 },
        { code: 'xsense:stationName', value: 'Station SBS50 Entrée' },
        { code: 'xsense:houseName', value: 'Maison Principale' },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: 88,
      lastContactOpen: null,
    },
    {
      id: 'xsense_demo_sws51_cuisine',
      name: 'Capteur Fuite d’eau Cuisine',
      customName: null,
      primaryVendor: 'xsense',
      systems: ['xsense'],
      roomId: 2,
      category: 'other',
      tuyaCategory: 'waterLeakSensor',
      productName: 'X-Sense · SWS51',
      ipAddress: null,
      macAddress: null,
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'xsense:unitType', value: 'waterLeakSensor' },
        { code: 'xsense:model', value: 'SWS51' },
        { code: 'xsense:alarmStatus', value: 'normal' },
        { code: 'xsense:smokeDetected', value: false },
        { code: 'xsense:coDetected', value: false },
        { code: 'xsense:waterLeakDetected', value: false },
        { code: 'xsense:isMuted', value: false },
        { code: 'xsense:rfLevel', value: 2 },
        { code: 'xsense:stationName', value: 'Station SBS50 Entrée' },
        { code: 'xsense:houseName', value: 'Maison Principale' },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: 92,
      lastContactOpen: null,
    },
    {
      id: 'xsense_demo_sth51_bureau',
      name: 'Thermo-hygromètre X-Sense Bureau',
      customName: null,
      primaryVendor: 'xsense',
      systems: ['xsense'],
      roomId: 5,
      category: 'climate',
      tuyaCategory: 'thermoHygrometer',
      productName: 'X-Sense · STH51',
      ipAddress: null,
      macAddress: null,
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'xsense:unitType', value: 'thermoHygrometer' },
        { code: 'xsense:model', value: 'STH51' },
        { code: 'xsense:alarmStatus', value: 'normal' },
        { code: 'xsense:rfLevel', value: 3 },
        { code: 'xsense:stationName', value: 'Station SBS50 Entrée' },
        { code: 'xsense:tempC', value: 20.6 },
        { code: 'xsense:humidityPct', value: 48 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: 20.6,
      lastHumidityPct: 48,
      lastBatteryPct: 91,
      lastContactOpen: null,
    },
    {
      id: 'xiaomi_demo_thermo_chambre',
      name: 'Mi Temp & Humidity Monitor 2',
      customName: 'Capteur Mi Chambre',
      primaryVendor: 'xiaomi',
      systems: ['xiaomi'],
      roomId: 4,
      category: 'climate',
      tuyaCategory: 'climateSensor',
      productName: 'Xiaomi · LYWSD03MMC',
      ipAddress: null,
      macAddress: 'A4:C1:38:52:90:14',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'xiaomi:unitType', value: 'climateSensor' },
        { code: 'xiaomi:model', value: 'miaomiaoce.sensor_ht.t2' },
        { code: 'xiaomi:firmware', value: '2.1.1_0159' },
        { code: 'xiaomi:rssi', value: -58 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: 19.1,
      lastHumidityPct: 50,
      lastBatteryPct: 84,
      lastContactOpen: null,
    },
    {
      id: 'xiaomi_demo_plug_bureau',
      name: 'Mi Smart Plug Wi-Fi Bureau',
      customName: 'Prise Xiaomi Écran',
      primaryVendor: 'xiaomi',
      systems: ['xiaomi'],
      roomId: 5,
      category: 'power',
      tuyaCategory: 'smartPlug',
      productName: 'Xiaomi · chuangmi.plug.v3',
      ipAddress: '192.168.1.62',
      macAddress: '7C:49:EB:81:2C:10',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'xiaomi:unitType', value: 'smartPlug' },
        { code: 'xiaomi:model', value: 'chuangmi.plug.v3' },
        { code: 'xiaomi:firmware', value: '1.3.0_0028' },
        { code: 'xiaomi:rssi', value: -52 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: 42,
      lastVoltageV: 231,
      lastAddEleKwh: 38.4,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: null,
      lastContactOpen: null,
    },
    {
      id: 'xiaomi_demo_door_entree',
      name: 'Capteur Porte Xiaomi Entrée',
      customName: null,
      primaryVendor: 'xiaomi',
      systems: ['xiaomi'],
      roomId: 3,
      category: 'contact',
      tuyaCategory: 'contactSensor',
      productName: 'Xiaomi · MCCGQ02HL',
      ipAddress: null,
      macAddress: '54:48:E6:71:11:09',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'xiaomi:unitType', value: 'contactSensor' },
        { code: 'xiaomi:model', value: 'isa.magnet.dw2hl' },
        { code: 'xiaomi:rssi', value: -61 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: 79,
      lastContactOpen: false,
    },
    {
      id: 'xiaomi_demo_purifier_salon',
      name: 'Xiaomi Smart Air Purifier 4',
      customName: 'Purificateur d’Air Salon',
      primaryVendor: 'xiaomi',
      systems: ['xiaomi'],
      roomId: 1,
      category: 'climate',
      tuyaCategory: 'airPurifier',
      productName: 'Xiaomi · zhimi.airp.mb5',
      ipAddress: '192.168.1.64',
      macAddress: '64:90:C1:44:8E:20',
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'xiaomi:unitType', value: 'airPurifier' },
        { code: 'xiaomi:model', value: 'zhimi.airp.mb5' },
        { code: 'xiaomi:pm25', value: 8 },
        { code: 'xiaomi:mode', value: 'auto' },
        { code: 'xiaomi:filterLifePct', value: 78 },
        { code: 'xiaomi:firmware', value: '2.1.4_0015' },
        { code: 'xiaomi:rssi', value: -47 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: 21.5,
      lastHumidityPct: 46,
      lastBatteryPct: null,
      lastContactOpen: null,
    },
    {
      id: 'xiaomi_demo_wleak_sdb',
      name: 'Capteur Fuite d’eau Xiaomi SDB',
      customName: null,
      primaryVendor: 'xiaomi',
      systems: ['xiaomi'],
      roomId: 2,
      category: 'other',
      tuyaCategory: 'waterLeakSensor',
      productName: 'Xiaomi · lumi.sensor_wleak.aq1',
      ipAddress: null,
      macAddress: null,
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'hybrid',
      dpConfig: {},
      lastRawStatus: [
        { code: 'xiaomi:unitType', value: 'waterLeakSensor' },
        { code: 'xiaomi:model', value: 'lumi.sensor_wleak.aq1' },
        { code: 'xiaomi:waterLeak', value: false },
        { code: 'xiaomi:rssi', value: -64 },
      ],
      lastSeenAt: alignedNow.toISOString(),
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: null,
      lastHumidityPct: null,
      lastBatteryPct: 94,
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
    ['kasa_demo_hs110_lavelinge', 14.0],
    ['xiaomi_demo_plug_bureau', 16.0],
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

    // 12. Kasa Lave-Linge HS110 (cycles ponctuels + veille ~2.5W)
    {
      const noise = pseudoNoise(step * 5.7);
      const isWashWindow = step % 48 >= 18 && step % 48 <= 21 && (step % 3 === 0 || noise > 0.45);
      const powerW = Math.round((isWashWindow ? 420 + noise * 950 : 2.2 + noise * 1.4) * 10) / 10;
      const prevAdd = cumulativeAddEle.get('kasa_demo_hs110_lavelinge') ?? 14;
      const kwh = Math.round((powerW / 1000) * 0.5 * 10000) / 10000;
      cumulativeAddEle.set('kasa_demo_hs110_lavelinge', prevAdd + kwh);
      readings.push({
        id: nextReadingId++,
        deviceId: 'kasa_demo_hs110_lavelinge',
        roomId: 5,
        recordedAt: ts.toISOString(),
        powerW,
        voltageV: 230.2 + Math.round(noise * 20) / 10,
        energyKwh: kwh,
        energySource: 'add_ele',
        tempC: null,
        humidityPct: null,
        contactOpen: null,
      });
    }

    // 13. Volet Roulant Salon (Somfy io) — ouvert 08h-20h30 (55%-100%), fermé la nuit (0%)
    {
      const noise = pseudoNoise(step * 6.1);
      const isDay = hour >= 8 && hour <= 20.5;
      const coverOpenPct =
        step === 0
          ? 75
          : isDay
            ? hour >= 13 && hour <= 16.5 && noise > 0.4
              ? 55
              : 100
            : 0;
      const coverState: MetricReadingRecord['coverState'] =
        coverOpenPct === 0 ? 'closed' : coverOpenPct === 100 ? 'open' : 'partial';
      readings.push({
        id: nextReadingId++,
        deviceId: 'somfy_demo_volet_salon',
        roomId: 1,
        recordedAt: ts.toISOString(),
        powerW: null,
        voltageV: null,
        energyKwh: null,
        energySource: null,
        tempC: null,
        humidityPct: null,
        contactOpen: null,
        coverState,
        coverOpenPct,
      });
    }

    // 14. Volet Bureau Tubular Motor (Tuya cl) — ouvert 08h30-19h30 (80%-100%), fermé la nuit (0%)
    {
      const noise = pseudoNoise(step * 6.5);
      const isDay = hour >= 8.5 && hour <= 19.5;
      const coverOpenPct =
        step === 0 ? 100 : isDay ? (noise > 0.7 ? 80 : 100) : 0;
      const coverState: MetricReadingRecord['coverState'] =
        coverOpenPct === 0 ? 'closed' : coverOpenPct === 100 ? 'open' : 'partial';
      readings.push({
        id: nextReadingId++,
        deviceId: 'bf81a2c9tubularbureau',
        roomId: 2,
        recordedAt: ts.toISOString(),
        powerW: null,
        voltageV: null,
        energyKwh: null,
        energySource: null,
        tempC: null,
        humidityPct: null,
        contactOpen: null,
        coverState,
        coverOpenPct,
      });
    }

    // 15. Daikin Stylish Salon (Température, Humidité & consommation kWh)
    {
      const noise = pseudoNoise(step * 6.9);
      const isHeatingWindow = (hour >= 6.5 && hour <= 9.5) || (hour >= 17.5 && hour <= 23);
      const kwh = isHeatingWindow
        ? Math.round((0.14 + noise * 0.22) * 1000) / 1000
        : Math.round((0.02 + noise * 0.03) * 1000) / 1000;
      const tempC =
        step === 0
          ? 21.3
          : Math.round((20.8 + dayPhase * 0.8 + (isHeatingWindow ? 0.5 : 0) + (noise - 0.5) * 0.3) * 10) / 10;
      const humidityPct = step === 0 ? 47 : Math.round(47 + (noise - 0.5) * 4);
      const prevAdd = cumulativeAddEle.get('daikin_demo_stylish_salon') ?? 240;
      cumulativeAddEle.set('daikin_demo_stylish_salon', prevAdd + kwh);
      readings.push({
        id: nextReadingId++,
        deviceId: 'daikin_demo_stylish_salon',
        roomId: 1,
        recordedAt: ts.toISOString(),
        powerW: null,
        voltageV: null,
        energyKwh: kwh,
        energySource: 'add_ele',
        tempC,
        humidityPct,
        contactOpen: null,
      });
    }

    // 16. Daikin Perfera Chambre (Chauffage ponctuel soir/matin + veille)
    {
      const noise = pseudoNoise(step * 7.3);
      const isEvening = hour >= 19.5 && hour <= 22.5;
      const kwh = isEvening
        ? Math.round((0.09 + noise * 0.14) * 1000) / 1000
        : Math.round((0.01 + noise * 0.015) * 1000) / 1000;
      const tempC =
        step === 0
          ? 18.9
          : Math.round((18.5 + dayPhase * 0.6 + (noise - 0.5) * 0.3) * 10) / 10;
      const humidityPct = step === 0 ? 51 : Math.round(51 + (noise - 0.5) * 4);
      const prevAdd = cumulativeAddEle.get('daikin_demo_perfera_chambre') ?? 140;
      cumulativeAddEle.set('daikin_demo_perfera_chambre', prevAdd + kwh);
      readings.push({
        id: nextReadingId++,
        deviceId: 'daikin_demo_perfera_chambre',
        roomId: 4,
        recordedAt: ts.toISOString(),
        powerW: null,
        voltageV: null,
        energyKwh: kwh,
        energySource: 'add_ele',
        tempC,
        humidityPct,
        contactOpen: null,
      });
    }

    // 17. X-Sense STH51 Bureau (Thermo-hygromètre)
    {
      const noise = pseudoNoise(step * 7.7);
      const tempC =
        step === 0
          ? 20.6
          : Math.round((20.2 + dayPhase * 0.7 + (noise - 0.5) * 0.3) * 10) / 10;
      const humidityPct = step === 0 ? 48 : Math.round(48 + (noise - 0.5) * 4);
      readings.push({
        id: nextReadingId++,
        deviceId: 'xsense_demo_sth51_bureau',
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

    // 18. Xiaomi Mi Temp & Humidity Monitor 2 Chambre
    {
      const noise = pseudoNoise(step * 8.1);
      const tempC =
        step === 0
          ? 19.1
          : Math.round((18.8 + dayPhase * 0.5 + (noise - 0.5) * 0.3) * 10) / 10;
      const humidityPct = step === 0 ? 50 : Math.round(50 + (noise - 0.5) * 4);
      readings.push({
        id: nextReadingId++,
        deviceId: 'xiaomi_demo_thermo_chambre',
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

    // 19. Xiaomi Smart Plug Wi-Fi Bureau (Consommation)
    {
      const noise = pseudoNoise(step * 8.5);
      const isWorkHours = hour >= 8.5 && hour <= 19;
      const powerW = isWorkHours
        ? Math.round((38 + noise * 22) * 10) / 10
        : Math.round((4 + noise * 3) * 10) / 10;
      const kwh = Math.round((powerW / 1000) * 0.5 * 10000) / 10000;
      const prevAdd = cumulativeAddEle.get('xiaomi_demo_plug_bureau') ?? 16;
      cumulativeAddEle.set('xiaomi_demo_plug_bureau', prevAdd + kwh);
      readings.push({
        id: nextReadingId++,
        deviceId: 'xiaomi_demo_plug_bureau',
        roomId: 5,
        recordedAt: ts.toISOString(),
        powerW,
        voltageV: 231,
        energyKwh: kwh,
        energySource: 'add_ele',
        tempC: null,
        humidityPct: null,
        contactOpen: null,
      });
    }

    // 20. Xiaomi Capteur Porte Entrée (Ouvertures)
    {
      const daySlot = step % 48;
      const isOpen = step > 0 && (daySlot === 16 || daySlot === 35);
      readings.push({
        id: nextReadingId++,
        deviceId: 'xiaomi_demo_door_entree',
        roomId: 3,
        recordedAt: ts.toISOString(),
        powerW: null,
        voltageV: null,
        energyKwh: null,
        energySource: null,
        tempC: null,
        humidityPct: null,
        contactOpen: isOpen,
      });
    }

    // 21. Xiaomi Smart Air Purifier 4 Salon (Température & Humidité)
    {
      const noise = pseudoNoise(step * 8.9);
      const tempC =
        step === 0
          ? 21.5
          : Math.round((21.1 + dayPhase * 0.7 + (noise - 0.5) * 0.3) * 10) / 10;
      const humidityPct = step === 0 ? 46 : Math.round(46 + (noise - 0.5) * 3);
      readings.push({
        id: nextReadingId++,
        deviceId: 'xiaomi_demo_purifier_salon',
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
  }

  // Synchroniser les dernières valeurs des appareils avec la fin de la série générée
  const lastByDevice = new Map<string, MetricReadingRecord>();
  for (const r of readings) {
    lastByDevice.set(r.deviceId, r);
  }

  // Générer des relevés compteur Linky (Conso API) cohérents jusqu'à J-1 (décalage Enedis)
  const demoPrm = '00000000001234';
  const meterReadings: MeterReadingRecord[] = [];
  let nextMeterReadingId = 1;
  const parisDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayParisKey = parisDateFormatter.format(now);
  const isoToDateKey = new Map<string, string>();
  const getParisDateKey = (iso: string): string => {
    let key = isoToDateKey.get(iso);
    if (!key) {
      key = parisDateFormatter.format(new Date(iso));
      isoToDateKey.set(iso, key);
    }
    return key;
  };

  const daySlotEnergyMap = new Map<string, Map<string, number>>();
  const dayTotalEnergyMap = new Map<string, number>();
  const dayPeakMeasuredPowerMap = new Map<string, number>();
  const slotTotalPowerMap = new Map<string, number>();

  for (const r of readings) {
    const dKey = getParisDateKey(r.recordedAt);
    if (dKey >= todayParisKey) continue;
    if (r.energyKwh !== null && r.energyKwh > 0) {
      dayTotalEnergyMap.set(dKey, (dayTotalEnergyMap.get(dKey) ?? 0) + r.energyKwh);
      const slotMap = daySlotEnergyMap.get(dKey) ?? new Map<string, number>();
      slotMap.set(r.recordedAt, (slotMap.get(r.recordedAt) ?? 0) + r.energyKwh);
      daySlotEnergyMap.set(dKey, slotMap);
    }
    if (r.powerW !== null && r.powerW > 0) {
      slotTotalPowerMap.set(r.recordedAt, (slotTotalPowerMap.get(r.recordedAt) ?? 0) + r.powerW);
    }
  }
  for (const [iso, slotPower] of slotTotalPowerMap.entries()) {
    const dKey = getParisDateKey(iso);
    const prevPeak = dayPeakMeasuredPowerMap.get(dKey) ?? 0;
    if (slotPower > prevPeak) {
      dayPeakMeasuredPowerMap.set(dKey, slotPower);
    }
  }

  const publishedDates = Array.from(dayTotalEnergyMap.keys()).sort();
  const recentCurveDates = new Set(publishedDates.slice(-7));

  for (let dIdx = 0; dIdx < publishedDates.length; dIdx++) {
    const dateKey = publishedDates[dIdx];
    const measuredKwh = dayTotalEnergyMap.get(dateKey) ?? 0;
    let meterDailyKwh = 0;

    if (recentCurveDates.has(dateKey)) {
      const slotMap = daySlotEnergyMap.get(dateKey) ?? new Map<string, number>();
      const slots = Array.from(slotMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      for (let sIdx = 0; sIdx < slots.length; sIdx++) {
        const [slotIso, slotMeasuredKwh] = slots[sIdx];
        const noise = pseudoNoise(dIdx * 100 + sIdx + 3);
        // Poste non mesuré réaliste (box, VMC, éclairage, frigo/four): ~0.10-0.24 kWh par tranche 30 min
        const baseUnmeasured = 0.08 + noise * 0.12;
        const slotMeterKwh = Math.round((slotMeasuredKwh * 1.15 + baseUnmeasured) * 10000) / 10000;
        meterDailyKwh += slotMeterKwh;
        meterReadings.push({
          id: nextMeterReadingId++,
          pointId: demoPrm,
          granularity: 'load_curve_30m',
          recordedAt: slotIso,
          dateKey,
          energyKwh: slotMeterKwh,
          powerW: Math.round(slotMeterKwh * 2000 * 10) / 10,
        });
      }
    } else {
      const noise = pseudoNoise(dIdx * 17 + 9);
      meterDailyKwh = measuredKwh * 1.28 + 3.2 + noise * 1.4;
    }

    const [yy, mm, dd] = dateKey.split('-').map(Number);
    const noonIso = new Date(Date.UTC(yy, mm - 1, dd, 11, 0, 0)).toISOString();
    meterReadings.push({
      id: nextMeterReadingId++,
      pointId: demoPrm,
      granularity: 'daily_kwh',
      recordedAt: noonIso,
      dateKey,
      energyKwh: Math.round(meterDailyKwh * 1000) / 1000,
      powerW: null,
    });

    const peakMeasuredW = dayPeakMeasuredPowerMap.get(dateKey) ?? 1800;
    const peakNoise = pseudoNoise(dIdx * 31 + 5);
    const maxPowerVa = Math.round(Math.max(3600, peakMeasuredW * 1.35 + 1100 + peakNoise * 1300));
    const peakIso = new Date(Date.UTC(yy, mm - 1, dd, 18, 30, 0)).toISOString();
    meterReadings.push({
      id: nextMeterReadingId++,
      pointId: demoPrm,
      granularity: 'max_power_daily',
      recordedAt: peakIso,
      dateKey,
      energyKwh: null,
      powerW: maxPowerVa,
    });
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
      externalId:
        d.primaryVendor === 'google_home'
          ? `enterprises/demo/devices/${d.id}`
          : d.primaryVendor === 'kasa'
            ? d.id.replace(/^kasa_/, '')
            : d.primaryVendor === 'home_connect'
              ? d.id.replace(/^hc_/, '')
              : d.primaryVendor === 'somfy'
                ? d.id.replace(/^somfy_/, '')
                : d.primaryVendor === 'daikin'
                  ? d.id.replace(/^daikin_/, '')
                  : d.primaryVendor === 'xsense'
                    ? d.id.replace(/^xsense_/, '')
                    : d.primaryVendor === 'xiaomi'
                      ? d.id.replace(/^xiaomi_/, '')
                      : d.id,
      externalName: d.name,
      isPrimaryTelemetry: true,
      linkedAt: syncedIso,
    });
    if (
      (d.primaryVendor === 'tuya' ||
        d.primaryVendor === 'kasa' ||
        d.primaryVendor === 'home_connect' ||
        d.primaryVendor === 'somfy' ||
        d.primaryVendor === 'daikin' ||
        d.primaryVendor === 'xsense' ||
        d.primaryVendor === 'xiaomi') &&
      d.systems.includes('google_home')
    ) {
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
    kasa: {
      mode: 'cloud_account',
      connected: true,
      lastSyncedAt: syncedIso,
      lastError: null,
    },
    home_connect: {
      mode: 'oauth_prod',
      connected: true,
      lastSyncedAt: syncedIso,
      lastError: null,
    },
    somfy: {
      mode: 'cloud_account',
      connected: true,
      lastSyncedAt: syncedIso,
      lastError: null,
    },
    daikin: {
      mode: 'oauth_prod',
      connected: true,
      lastSyncedAt: syncedIso,
      lastError: null,
    },
    xsense: {
      mode: 'cloud_account',
      connected: true,
      lastSyncedAt: syncedIso,
      lastError: null,
    },
    xiaomi: {
      mode: 'cloud_account',
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
    conso_api: {
      mode: 'bearer_token',
      connected: true,
      config: { prm: demoPrm, subscribedKva: 9, source: 'db' },
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
    meterReadings,
    consoApiConfig: { prm: demoPrm, token: 'demo-conso-api-token', subscribedKva: 9 },
    tariffs,
    automations: demoAutomations,
    logs,
    nextRoomId: rooms.length + 1,
    nextReadingId,
    nextMeterReadingId,
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

    const coverSummary = extractCoverSummary(dev);
    let coverState: MetricReadingRecord['coverState'] = coverSummary ? coverSummary.state : null;
    let coverOpenPct: number | null = coverSummary ? coverSummary.openPct : null;
    if (coverSummary && jitter > 0.55 && !coverSummary.unidirectional) {
      coverOpenPct =
        coverOpenPct === 0 ? 50 : coverOpenPct !== null && coverOpenPct < 100 ? 100 : 0;
      coverState =
        coverOpenPct === 0 ? 'closed' : coverOpenPct === 100 ? 'open' : 'partial';
      const baseTraits = (dev.lastRawStatus ?? []).filter(
        (item) =>
          item.code !== 'core:ClosureState' &&
          item.code !== 'core:OpenClosedState' &&
          item.code !== 'percent_state' &&
          item.code !== 'situation_set'
      );
      if (dev.primaryVendor === 'somfy') {
        dev.lastRawStatus = [
          ...baseTraits,
          { code: 'core:ClosureState', value: 100 - coverOpenPct },
          { code: 'core:OpenClosedState', value: coverState === 'closed' ? 'closed' : 'open' },
        ];
      } else {
        dev.lastRawStatus = [
          ...baseTraits,
          { code: 'percent_state', value: 100 - coverOpenPct },
          {
            code: 'situation_set',
            value: coverState === 'closed' ? 'fully_close' : coverState === 'open' ? 'fully_open' : 'half',
          },
        ];
      }
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

    const hasNumericOrContact =
      powerW !== null ||
      tempC !== null ||
      humidityPct !== null ||
      contactOpen !== null ||
      coverSummary !== null;

    if (hasNumericOrContact) {
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
        coverState,
        coverOpenPct,
      });
      inserted += 1;
    }

    dev.lastPowerW = powerW;
    dev.lastAddEleKwh = addEleKwh;
    dev.lastTempC = tempC;
    dev.lastHumidityPct = humidityPct;
    dev.lastContactOpen = contactOpen;
    dev.lastSeenAt = now.toISOString();
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
