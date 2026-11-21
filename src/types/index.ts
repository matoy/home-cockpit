export type DeviceCategory = 'power' | 'climate' | 'hybrid' | 'other';

export type EnergyMode = 'hybrid' | 'add_ele' | 'integration';

export type EnergySource = 'add_ele' | 'integration';

export type TariffMode = 'BASE' | 'HP_HC';

export type TimeRange = '24h' | '7d' | '30d' | '365d';

export interface DpMappingField {
  code: string;
  scale: number;
}

export interface DpConfig {
  power?: DpMappingField;
  voltage?: DpMappingField;
  current?: DpMappingField;
  addEle?: DpMappingField;
  temp?: DpMappingField;
  humidity?: DpMappingField;
  battery?: DpMappingField;
}

export interface RawDpStatus {
  code: string;
  value: unknown;
}

export interface HcSlot {
  start: string; // "HH:mm"
  end: string;   // "HH:mm"
}

export interface RoomRecord {
  id: number;
  name: string;
  icon: string;
  color: string;
  targetTempMin: number;
  targetTempMax: number;
  targetHumidityMin: number;
  targetHumidityMax: number;
  createdAt: string;
}

export interface DeviceRecord {
  id: string;
  name: string;
  customName: string | null;
  roomId: number | null;
  category: DeviceCategory;
  tuyaCategory: string | null;
  productName: string | null;
  isOnline: boolean;
  isMonitored: boolean;
  energyMode: EnergyMode;
  dpConfig: DpConfig;
  lastRawStatus: RawDpStatus[] | null;
  lastSeenAt: string | null;
  lastPowerW: number | null;
  lastVoltageV: number | null;
  lastAddEleKwh: number | null;
  lastTempC: number | null;
  lastHumidityPct: number | null;
  lastBatteryPct: number | null;
}

export interface MetricReadingRecord {
  id: number;
  deviceId: string;
  roomId: number | null;
  recordedAt: string;
  powerW: number | null;
  voltageV: number | null;
  energyKwh: number | null;
  energySource: EnergySource | null;
  tempC: number | null;
  humidityPct: number | null;
}

export interface TariffPeriodRecord {
  id: number;
  label: string;
  startDate: string; // YYYY-MM-DD
  endDate: string | null;
  mode: TariffMode;
  baseRateEur: number | null;
  hpRateEur: number | null;
  hcRateEur: number | null;
  hcSlots: HcSlot[];
  monthlySubscriptionEur: number;
  createdAt: string;
}

export interface CollectionLogRecord {
  id: number;
  executedAt: string;
  trigger: 'schedule' | 'manual';
  devicesCount: number;
  readingsInserted: number;
  status: 'success' | 'error';
  errorMessage: string | null;
  durationMs: number | null;
}

export interface ComfortStatus {
  label: 'Optimal' | 'Air sec' | 'Humide' | 'Frais' | 'Chaud' | 'Données partielles' | 'Aucun capteur';
  tone: 'emerald' | 'amber' | 'sky' | 'rose' | 'slate';
}

export interface RoomSummary {
  room: RoomRecord;
  currentPowerW: number;
  periodEnergyKwh: number;
  periodCostEur: number;
  currentTempC: number | null;
  currentHumidityPct: number | null;
  dewPointC: number | null;
  avgTempC: number | null;
  minTempC: number | null;
  maxTempC: number | null;
  avgHumidityPct: number | null;
  minHumidityPct: number | null;
  maxHumidityPct: number | null;
  comfort: ComfortStatus;
  devices: DeviceRecord[];
}

export interface EnergyBreakdownItem {
  id: string;
  name: string;
  color: string;
  roomName?: string;
  energyKwh: number;
  costEur: number;
  avgPowerW: number;
  maxPowerW: number;
  sharePct: number;
}

export interface TimeSeriesPoint {
  bucket: string;
  label: string;
  totalPowerW: number;
  totalEnergyKwh: number;
  totalCostEur: number;
  byRoomEnergy: Record<string, number>;
  byRoomPower: Record<string, number>;
  byRoomCost: Record<string, number>;
  byDeviceEnergy: Record<string, number>;
  byDevicePower: Record<string, number>;
  byDeviceCost: Record<string, number>;
  byRoomTemp: Record<string, number | null>;
  byRoomHumidity: Record<string, number | null>;
}

export interface EnvStatus {
  mode: 'live' | 'demo';
  databaseConfigured: boolean;
  tuyaConfigured: boolean;
  tuyaRegion: string;
  tuyaUserUidConfigured: boolean;
  appPasswordConfigured: boolean;
  scheduleSecretConfigured: boolean;
}

export interface DashboardPayload {
  env: EnvStatus;
  range: TimeRange;
  selectedRoomId: string;
  generatedAt: string;
  kpis: {
    currentPowerW: number;
    activePowerDevices: number;
    totalPowerDevices: number;
    periodEnergyKwh: number;
    periodCostEur: number;
    subscriptionCostEur: number;
    effectiveRateEurPerKwh: number;
    hpEnergyKwh: number;
    hcEnergyKwh: number;
    baseEnergyKwh: number;
    hpCostEur: number;
    hcCostEur: number;
    baseCostEur: number;
    standbyPowerW: number;
    standbyAnnualCostEur: number;
    avgTempC: number | null;
    avgHumidityPct: number | null;
    climateAlertsCount: number;
  };
  rooms: RoomRecord[];
  roomSummaries: RoomSummary[];
  devices: DeviceRecord[];
  tariffs: TariffPeriodRecord[];
  energyByRoom: EnergyBreakdownItem[];
  energyByDevice: EnergyBreakdownItem[];
  timeSeries: TimeSeriesPoint[];
  logs: CollectionLogRecord[];
}
