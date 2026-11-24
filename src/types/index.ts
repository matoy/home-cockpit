export type DeviceCategory = 'power' | 'climate' | 'contact' | 'hybrid' | 'other';

export type VendorId =
  | 'tuya'
  | 'kasa'
  | 'home_connect'
  | 'somfy'
  | 'daikin'
  | 'xsense'
  | 'xiaomi'
  | 'google_home';

export type SystemFilter = 'all' | VendorId;

export type GoogleHomeMode = 'mcp' | 'sdm';

export type HomeConnectEnv = 'prod' | 'simulator' | 'cn';

export type EnergyMode = 'hybrid' | 'add_ele' | 'integration';

export type EnergySource = 'add_ele' | 'integration';

export type TariffMode = 'BASE' | 'HP_HC';

export type TimeRange = '24h' | '7d' | '30d' | '365d' | 'custom';

export type TabId =
  | 'overview'
  | 'energy'
  | 'climate'
  | 'contacts'
  | 'covers'
  | 'hvac'
  | 'security'
  | 'automations'
  | 'devices'
  | 'rooms'
  | 'systems'
  | 'tariffs'
  | 'guide';

export interface DeviceVendorLinkRecord {
  id: number;
  deviceId: string;
  vendor: VendorId;
  externalId: string;
  externalName: string | null;
  isPrimaryTelemetry: boolean;
  linkedAt: string;
}

export interface VendorConnectionSummary {
  vendor: VendorId;
  label: string;
  mode: 'cloud_key' | 'cloud_account' | 'oauth_prod' | 'oauth_simulator' | 'oauth_cn' | GoogleHomeMode;
  configured: boolean;
  connected: boolean;
  devicesCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface DuplicateCandidate {
  sourceDeviceId: string;
  sourceName: string;
  sourceVendor: VendorId;
  targetDeviceId: string;
  targetName: string;
  targetVendor: VendorId;
  roomName: string | null;
  confidence: 'high' | 'medium';
  reason: string;
}

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
  contact?: DpMappingField;
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
  primaryVendor: VendorId;
  systems: VendorId[];
  vendorLinks?: DeviceVendorLinkRecord[];
  roomId: number | null;
  category: DeviceCategory;
  tuyaCategory: string | null;
  productName: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  isOnline: boolean;
  isMonitored: boolean;
  excludeFromTotals: boolean;
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
  lastContactOpen: boolean | null;
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
  contactOpen: boolean | null;
  coverState?: 'open' | 'partial' | 'closed' | 'unknown' | null;
  coverOpenPct?: number | null;
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
  excludeFromTotals?: boolean;
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
  kasaConfigured: boolean;
  kasaRegion: string;
  homeConnectConfigured: boolean;
  homeConnectConnected: boolean;
  homeConnectEnv: HomeConnectEnv;
  somfyConfigured: boolean;
  somfyRegion: string;
  daikinConfigured: boolean;
  daikinConnected: boolean;
  xsenseConfigured: boolean;
  xiaomiConfigured: boolean;
  xiaomiConnected: boolean;
  xiaomiRegion: string;
  appPasswordConfigured: boolean;
  oidcConfigured: boolean;
  oidcProviderName: string | null;
  scheduleSecretConfigured: boolean;
  googleHomeApiEnabled: boolean;
  googleHomeConfigured: boolean;
  googleHomeMode: GoogleHomeMode;
  googleHomeConnected: boolean;
  googleSdmProjectConfigured: boolean;
}

export interface ContactSensorStat {
  deviceId: string;
  name: string;
  roomId: number | null;
  roomName: string;
  roomColor: string;
  isOnline: boolean;
  isOpen: boolean | null;
  batteryPct: number | null;
  lastSeenAt: string | null;
  lastOpenedAt: string | null;
  openEventsCount: number;
  openMinutes: number;
}

export interface ContactEventItem {
  id: string;
  deviceId: string;
  deviceName: string;
  roomId: number | null;
  roomName: string;
  roomColor: string;
  recordedAt: string;
  isOpen: boolean;
  prevIsOpen?: boolean | null;
  isTransition: boolean;
}

export interface ContactActivityPoint {
  bucket: string;
  label: string;
  openCount: number;
  transitionsCount: number;
}

export interface ContactsPayload {
  summary: {
    totalSensors: number;
    openCountNow: number;
    closedCountNow: number;
    onlineCount: number;
    lowBatteryCount: number;
    totalOpenEventsPeriod: number;
    totalOpenMinutesPeriod: number;
  };
  sensors: ContactSensorStat[];
  events: ContactEventItem[];
  activitySeries: ContactActivityPoint[];
}

export type CoverHistoryState = 'open' | 'partial' | 'closed' | 'unknown';

export interface CoverDeviceHistoryStat {
  deviceId: string;
  movementsCount: number;
  lastMovedAt: string | null;
}

export interface CoverEventItem {
  id: string;
  deviceId: string;
  deviceName: string;
  roomId: number | null;
  roomName: string;
  roomColor: string;
  recordedAt: string;
  state: CoverHistoryState;
  stateLabel: string;
  openPct: number | null;
  prevState: CoverHistoryState | null;
  prevOpenPct: number | null;
  deltaPct: number | null;
  isTransition: boolean;
}

export interface CoverActivityPoint {
  bucket: string;
  label: string;
  openCount: number;
  transitionsCount: number;
}

export interface CoversPayload {
  byDevice: Record<string, CoverDeviceHistoryStat>;
  events: CoverEventItem[];
  activitySeries: CoverActivityPoint[];
}

export type AutomationRuleType = 'automation' | 'scene';
export type AutomationMatchType = 'any' | 'all' | 'manual';
export type AutomationConditionCategory = 'device' | 'timer' | 'weather' | 'geofence' | 'other';
export type AutomationActionCategory = 'device' | 'delay' | 'notification' | 'rule' | 'other';

export interface AutomationEffectiveTime {
  allDay: boolean;
  startTime: string;
  endTime: string;
  loops: string;
}

export interface AutomationCondition {
  category: AutomationConditionCategory;
  entityId: string | null;
  entityName: string | null;
  code: string | null;
  operator: string | null;
  value: string | number | boolean | null;
  summary: string;
}

export interface AutomationAction {
  category: AutomationActionCategory;
  entityId: string | null;
  entityName: string | null;
  executor: string | null;
  properties: Record<string, unknown>;
  summary: string;
}

export interface AutomationRecord {
  id: string;
  homeId: string | null;
  vendor?: VendorId;
  name: string;
  ruleType: AutomationRuleType;
  enabled: boolean;
  matchType: AutomationMatchType;
  effectiveTime: AutomationEffectiveTime | null;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  rawPayload: unknown;
  syncedAt: string;
}

export interface AutomationDeviceRef {
  deviceId: string;
  name: string;
  roomId: number | null;
  roomName: string;
  roomColor: string;
  isOnline: boolean;
  batteryPct: number | null;
  foundInInventory: boolean;
}

export interface AutomationDiagnostic {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: 'warning' | 'info' | 'error';
  kind:
  | 'offline_dependency'
  | 'low_battery_dependency'
  | 'missing_device'
  | 'potential_conflict'
  | 'empty_rule';
  message: string;
}

export interface EnrichedAutomation extends AutomationRecord {
  primaryTriggerCategory: AutomationConditionCategory | 'manual';
  rooms: Array<{ id: number; name: string; color: string }>;
  triggerDevices: AutomationDeviceRef[];
  targetDevices: AutomationDeviceRef[];
  diagnostics: AutomationDiagnostic[];
  health: 'healthy' | 'warning' | 'disabled';
}

export interface AutomationsPayload {
  summary: {
    totalCount: number;
    automationsCount: number;
    scenesCount: number;
    enabledCount: number;
    disabledCount: number;
    healthyCount: number;
    warningCount: number;
    conflictsCount: number;
    coveredDevicesCount: number;
    totalDevicesCount: number;
    coveredRoomsCount: number;
    lastSyncedAt: string | null;
  };
  triggerBreakdown: Array<{
    category: string;
    label: string;
    count: number;
  }>;
  topDevices: Array<{
    deviceId: string;
    name: string;
    roomName: string;
    roomColor: string;
    asTriggerCount: number;
    asActionCount: number;
    totalRules: number;
    isOnline: boolean;
  }>;
  roomCoverage: Array<{
    roomId: number;
    roomName: string;
    roomColor: string;
    rulesCount: number;
    activeRulesCount: number;
  }>;
  insights: AutomationDiagnostic[];
  rules: EnrichedAutomation[];
}

export interface DashboardPayload {
  env: EnvStatus;
  range: TimeRange;
  customFrom: string | null;
  customTo: string | null;
  selectedRoomId: string;
  selectedSystem: SystemFilter;
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
  vendors: VendorConnectionSummary[];
  duplicateCandidates: DuplicateCandidate[];
  tariffs: TariffPeriodRecord[];
  energyByRoom: EnergyBreakdownItem[];
  energyByDevice: EnergyBreakdownItem[];
  timeSeries: TimeSeriesPoint[];
  contacts: ContactsPayload;
  covers: CoversPayload;
  automations: AutomationsPayload;
  logs: CollectionLogRecord[];
}

export type BackupMetricsRange = 'none' | '30d' | '90d' | '365d' | 'all';

export type BackupImportMode = 'merge' | 'replace';

export interface BackupStats {
  rooms: number;
  devices: number;
  deviceVendorLinks: number;
  tariffPeriods: number;
  automations: number;
  vendorConnections: number;
  encryptedSessionsCount: number;
  metricReadings: number;
  collectionLogs: number;
  metricsDateMin: string | null;
  metricsDateMax: string | null;
}

export interface BackupPreviewResponse {
  format: 'home-cockpit-backup';
  version: number;
  exportedAt: string;
  sourceMode: 'live' | 'demo';
  compressed: boolean;
  compressedBytes: number;
  uncompressedBytes: number;
  options: {
    includeMetrics: boolean;
    metricsRange: BackupMetricsRange;
    includeEncryptedSessions: boolean;
  };
  stats: BackupStats;
  currentStats: {
    rooms: number;
    devices: number;
    deviceVendorLinks: number;
    tariffPeriods: number;
    automations: number;
    metricReadings: number;
  };
  warnings: string[];
}

export interface BackupImportResult {
  mode: BackupImportMode;
  targetMode: 'live' | 'demo';
  imported: {
    rooms: number;
    devices: number;
    deviceVendorLinks: number;
    tariffPeriods: number;
    automations: number;
    vendorConnections: number;
    metricReadings: number;
    collectionLogs: number;
  };
  skippedMetricsDuplicates: number;
  warnings: string[];
  message: string;
}
