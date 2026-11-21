import { computeDewPointC, computeReadingCost, getParisDateAndTime } from './tariff-engine';
import { hasValidHumidityMeasurement, hasValidTempMeasurement } from './device-utils';
import type {
  AutomationDeviceRef,
  AutomationDiagnostic,
  AutomationRecord,
  AutomationsPayload,
  CollectionLogRecord,
  ComfortStatus,
  ContactActivityPoint,
  ContactEventItem,
  ContactSensorStat,
  ContactsPayload,
  DashboardPayload,
  DeviceRecord,
  EnergyBreakdownItem,
  EnrichedAutomation,
  EnvStatus,
  MetricReadingRecord,
  RoomRecord,
  RoomSummary,
  TariffPeriodRecord,
  TimeRange,
  TimeSeriesPoint,
} from '@/types';

const RANGE_HOURS: Record<Exclude<TimeRange, 'custom'>, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
  '365d': 24 * 365,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function resolveTimeWindow(
  range: TimeRange,
  customFrom?: string | null,
  customTo?: string | null,
  now: Date = new Date()
): { startMs: number; endMs: number; effectiveHours: number } {
  if (range === 'custom' && customFrom && customTo) {
    const t1 = new Date(customFrom).getTime();
    const t2 = new Date(customTo).getTime();
    if (!Number.isNaN(t1) && !Number.isNaN(t2)) {
      const startMs = Math.min(t1, t2);
      const endMs = Math.max(t1, t2);
      const effectiveHours = Math.max(1, (endMs - startMs) / 3_600_000);
      return { startMs, endMs, effectiveHours };
    }
  }

  const fallbackKey: Exclude<TimeRange, 'custom'> = range === 'custom' ? '24h' : range;
  const hours = RANGE_HOURS[fallbackKey] ?? 24;
  return {
    startMs: now.getTime() - hours * 3_600_000,
    endMs: now.getTime() + 60_000,
    effectiveHours: hours,
  };
}

function getBucketInfo(
  date: Date,
  range: TimeRange,
  effectiveHours: number
): { key: string; label: string } {
  const { dateStr, timeStr } = getParisDateAndTime(date);
  const [year, month, day] = dateStr.split('-');
  const [hourStr, minStr] = timeStr.split(':');
  const hour = Number(hourStr);
  const minute = Number(minStr);

  const mode =
    range !== 'custom'
      ? range
      : effectiveHours <= 48
        ? '24h'
        : effectiveHours <= 24 * 10
          ? '7d'
          : effectiveHours <= 24 * 90
            ? '30d'
            : '365d';

  if (mode === '24h') {
    const slotMin = minute >= 30 ? '30' : '00';
    return {
      key: `${dateStr}T${hourStr}:${slotMin}`,
      label: effectiveHours > 24 ? `${day}/${month} ${hourStr}:${slotMin}` : `${hourStr}:${slotMin}`,
    };
  }

  if (mode === '7d') {
    const blockHour = Math.floor(hour / 2) * 2;
    const bh = String(blockHour).padStart(2, '0');
    return {
      key: `${dateStr}T${bh}:00`,
      label: `${day}/${month} ${bh}h`,
    };
  }

  if (mode === '30d') {
    return {
      key: dateStr,
      label: `${day}/${month}`,
    };
  }

  return {
    key: `${year}-${month}`,
    label: `${month}/${year}`,
  };
}

function evaluateComfort(
  room: RoomRecord,
  tempC: number | null,
  humidityPct: number | null
): ComfortStatus {
  if (tempC === null && humidityPct === null) {
    return { label: 'Aucun capteur', tone: 'slate' };
  }
  if (tempC !== null && tempC < room.targetTempMin) {
    return { label: 'Frais', tone: 'sky' };
  }
  if (tempC !== null && tempC > room.targetTempMax) {
    return { label: 'Chaud', tone: 'rose' };
  }
  if (humidityPct !== null && humidityPct < room.targetHumidityMin) {
    return { label: 'Air sec', tone: 'amber' };
  }
  if (humidityPct !== null && humidityPct > room.targetHumidityMax) {
    return { label: 'Humide', tone: 'sky' };
  }
  if (tempC === null || humidityPct === null) {
    return { label: 'Optimal', tone: 'emerald' };
  }
  return { label: 'Optimal', tone: 'emerald' };
}

export function buildAutomationsPayload(
  automations: AutomationRecord[],
  devices: DeviceRecord[],
  rooms: RoomRecord[],
  selectedRoomNumeric: number | null
): AutomationsPayload {
  const deviceMap = new Map(devices.map((d) => [d.id, d]));
  const roomMap = new Map(rooms.map((r) => [r.id, r]));

  const resolveDeviceRef = (entityId: string | null, entityName: string | null): AutomationDeviceRef | null => {
    if (!entityId) return null;
    const dev = deviceMap.get(entityId);
    if (!dev) {
      return {
        deviceId: entityId,
        name: entityName || entityId,
        roomId: null,
        roomName: 'Non répertorié',
        roomColor: '#64748b',
        isOnline: false,
        batteryPct: null,
        foundInInventory: false,
      };
    }
    const room = dev.roomId !== null ? roomMap.get(dev.roomId) : undefined;
    return {
      deviceId: dev.id,
      name: dev.customName || dev.name,
      roomId: dev.roomId,
      roomName: room?.name ?? 'Non assignée',
      roomColor: room?.color ?? '#64748b',
      isOnline: dev.isOnline,
      batteryPct: dev.lastBatteryPct,
      foundInInventory: true,
    };
  };

  // Enrichissement initial de chaque règle
  const allEnriched: EnrichedAutomation[] = automations.map((rule) => {
    const triggerMap = new Map<string, AutomationDeviceRef>();
    for (const c of rule.conditions) {
      if (c.category === 'device' && c.entityId) {
        const ref = resolveDeviceRef(c.entityId, c.entityName);
        if (ref) triggerMap.set(ref.deviceId, ref);
      }
    }

    const targetMap = new Map<string, AutomationDeviceRef>();
    for (const a of rule.actions) {
      if (a.category === 'device' && a.entityId) {
        const ref = resolveDeviceRef(a.entityId, a.entityName);
        if (ref) targetMap.set(ref.deviceId, ref);
      }
    }

    const triggerDevices = Array.from(triggerMap.values());
    const targetDevices = Array.from(targetMap.values());

    const ruleRoomsMap = new Map<number, { id: number; name: string; color: string }>();
    for (const dRef of [...triggerDevices, ...targetDevices]) {
      if (dRef.roomId !== null) {
        const rm = roomMap.get(dRef.roomId);
        if (rm) ruleRoomsMap.set(rm.id, { id: rm.id, name: rm.name, color: rm.color });
      }
    }

    const primaryTriggerCategory =
      rule.ruleType === 'scene'
        ? 'manual'
        : rule.conditions[0]?.category ?? 'other';

    const diagnostics: AutomationDiagnostic[] = [];
    const seenDevices = new Map<string, AutomationDeviceRef>();
    for (const dRef of [...triggerDevices, ...targetDevices]) {
      seenDevices.set(dRef.deviceId, dRef);
    }

    for (const dRef of seenDevices.values()) {
      if (!dRef.foundInInventory) {
        diagnostics.push({
          id: `${rule.id}-missing-${dRef.deviceId}`,
          ruleId: rule.id,
          ruleName: rule.name,
          severity: 'info',
          kind: 'missing_device',
          message: `Appareil « ${dRef.name} » (${dRef.deviceId}) absent de l'inventaire synchronisé.`,
        });
      } else if (rule.enabled && !dRef.isOnline) {
        diagnostics.push({
          id: `${rule.id}-offline-${dRef.deviceId}`,
          ruleId: rule.id,
          ruleName: rule.name,
          severity: 'warning',
          kind: 'offline_dependency',
          message: `Dépendance hors-ligne : « ${dRef.name} » est actuellement déconnecté.`,
        });
      }
    }

    for (const trig of triggerDevices) {
      if (rule.enabled && trig.foundInInventory && trig.batteryPct !== null && trig.batteryPct <= 20) {
        diagnostics.push({
          id: `${rule.id}-battery-${trig.deviceId}`,
          ruleId: rule.id,
          ruleName: rule.name,
          severity: 'warning',
          kind: 'low_battery_dependency',
          message: `Pile faible (${trig.batteryPct}%) sur le déclencheur « ${trig.name} ».`,
        });
      }
    }

    if (rule.ruleType === 'automation' && (rule.conditions.length === 0 || rule.actions.length === 0)) {
      diagnostics.push({
        id: `${rule.id}-empty`,
        ruleId: rule.id,
        ruleName: rule.name,
        severity: 'info',
        kind: 'empty_rule',
        message: 'Détails de conditions ou d’actions incomplets dans la réponse Tuya.',
      });
    }

    return {
      ...rule,
      primaryTriggerCategory,
      rooms: Array.from(ruleRoomsMap.values()),
      triggerDevices,
      targetDevices,
      diagnostics,
      health: !rule.enabled ? 'disabled' : diagnostics.some((d) => d.severity === 'warning') ? 'warning' : 'healthy',
    };
  });

  // Filtre par pièce si sélectionnée en haut du dashboard
  const scopedRules =
    selectedRoomNumeric !== null
      ? allEnriched.filter((r) => r.rooms.some((rm) => rm.id === selectedRoomNumeric))
      : allEnriched;

  // Détection des conflits / chevauchements entre automatisations actives ciblant le même appareil
  const targetRulesByDevice = new Map<string, EnrichedAutomation[]>();
  for (const r of scopedRules) {
    if (!r.enabled || r.ruleType !== 'automation') continue;
    for (const target of r.targetDevices) {
      if (!target.foundInInventory) continue;
      const list = targetRulesByDevice.get(target.deviceId) ?? [];
      list.push(r);
      targetRulesByDevice.set(target.deviceId, list);
    }
  }

  let conflictsCount = 0;
  for (const [devId, rulesTargeting] of targetRulesByDevice.entries()) {
    if (rulesTargeting.length < 2) continue;
    conflictsCount += 1;
    const dev = deviceMap.get(devId);
    const devName = dev?.customName || dev?.name || devId;
    const namesList = rulesTargeting.map((x) => `« ${x.name} »`).join(', ');
    for (const r of rulesTargeting) {
      r.diagnostics.push({
        id: `${r.id}-conflict-${devId}`,
        ruleId: r.id,
        ruleName: r.name,
        severity: 'warning',
        kind: 'potential_conflict',
        message: `Cible partagée : « ${devName} » est aussi piloté par ${namesList}.`,
      });
      if (r.enabled) r.health = 'warning';
    }
  }

  // Trier : actives avec alerte -> actives saines -> désactivées
  scopedRules.sort((a, b) => {
    const score = (x: EnrichedAutomation) =>
      x.health === 'warning' ? 0 : x.health === 'healthy' ? 1 : 2;
    const diff = score(a) - score(b);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });

  // Insights globaux (dédupliqués par id)
  const insights: AutomationDiagnostic[] = [];
  for (const r of scopedRules) {
    for (const d of r.diagnostics) {
      insights.push(d);
    }
  }

  // Trigger breakdown
  const TRIGGER_LABELS: Record<string, string> = {
    device: 'Capteur / Appareil',
    timer: 'Horaire',
    weather: 'Météo',
    geofence: 'Géolocalisation',
    manual: 'Manuel (Tap-to-Run)',
    other: 'Autre',
  };
  const triggerCounts = new Map<string, number>();
  for (const r of scopedRules) {
    triggerCounts.set(
      r.primaryTriggerCategory,
      (triggerCounts.get(r.primaryTriggerCategory) ?? 0) + 1
    );
  }
  const triggerBreakdown = Array.from(triggerCounts.entries())
    .map(([category, count]) => ({
      category,
      label: TRIGGER_LABELS[category] ?? category,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // Top appareils pivots
  const deviceStatsMap = new Map<
    string,
    {
      deviceId: string;
      name: string;
      roomName: string;
      roomColor: string;
      triggerRules: Set<string>;
      actionRules: Set<string>;
      allRules: Set<string>;
      isOnline: boolean;
    }
  >();

  for (const r of scopedRules) {
    for (const td of r.triggerDevices) {
      if (!td.foundInInventory) continue;
      const entry = deviceStatsMap.get(td.deviceId) ?? {
        deviceId: td.deviceId,
        name: td.name,
        roomName: td.roomName,
        roomColor: td.roomColor,
        triggerRules: new Set<string>(),
        actionRules: new Set<string>(),
        allRules: new Set<string>(),
        isOnline: td.isOnline,
      };
      entry.triggerRules.add(r.id);
      entry.allRules.add(r.id);
      deviceStatsMap.set(td.deviceId, entry);
    }
    for (const ad of r.targetDevices) {
      if (!ad.foundInInventory) continue;
      const entry = deviceStatsMap.get(ad.deviceId) ?? {
        deviceId: ad.deviceId,
        name: ad.name,
        roomName: ad.roomName,
        roomColor: ad.roomColor,
        triggerRules: new Set<string>(),
        actionRules: new Set<string>(),
        allRules: new Set<string>(),
        isOnline: ad.isOnline,
      };
      entry.actionRules.add(r.id);
      entry.allRules.add(r.id);
      deviceStatsMap.set(ad.deviceId, entry);
    }
  }

  const topDevices = Array.from(deviceStatsMap.values())
    .map((e) => ({
      deviceId: e.deviceId,
      name: e.name,
      roomName: e.roomName,
      roomColor: e.roomColor,
      asTriggerCount: e.triggerRules.size,
      asActionCount: e.actionRules.size,
      totalRules: e.allRules.size,
      isOnline: e.isOnline,
    }))
    .sort((a, b) => b.totalRules - a.totalRules)
    .slice(0, 8);

  // Couverture par pièce
  const roomCovMap = new Map<
    number,
    { roomId: number; roomName: string; roomColor: string; rules: Set<string>; activeRules: Set<string> }
  >();
  for (const rm of rooms) {
    roomCovMap.set(rm.id, {
      roomId: rm.id,
      roomName: rm.name,
      roomColor: rm.color,
      rules: new Set(),
      activeRules: new Set(),
    });
  }
  for (const r of allEnriched) {
    for (const rm of r.rooms) {
      const cov = roomCovMap.get(rm.id);
      if (cov) {
        cov.rules.add(r.id);
        if (r.enabled) cov.activeRules.add(r.id);
      }
    }
  }
  const roomCoverage = Array.from(roomCovMap.values())
    .map((c) => ({
      roomId: c.roomId,
      roomName: c.roomName,
      roomColor: c.roomColor,
      rulesCount: c.rules.size,
      activeRulesCount: c.activeRules.size,
    }))
    .sort((a, b) => b.rulesCount - a.rulesCount);

  const coveredDevicesCount = deviceStatsMap.size;
  const totalDevicesCount =
    selectedRoomNumeric !== null
      ? devices.filter((d) => d.roomId === selectedRoomNumeric).length
      : devices.length;
  const coveredRoomsCount = roomCoverage.filter((rc) => rc.rulesCount > 0).length;

  const lastSyncedAt =
    scopedRules.length > 0
      ? scopedRules.reduce(
          (latest, r) => (r.syncedAt > latest ? r.syncedAt : latest),
          scopedRules[0].syncedAt
        )
      : null;

  return {
    summary: {
      totalCount: scopedRules.length,
      automationsCount: scopedRules.filter((r) => r.ruleType === 'automation').length,
      scenesCount: scopedRules.filter((r) => r.ruleType === 'scene').length,
      enabledCount: scopedRules.filter((r) => r.enabled).length,
      disabledCount: scopedRules.filter((r) => !r.enabled).length,
      healthyCount: scopedRules.filter((r) => r.health === 'healthy').length,
      warningCount: scopedRules.filter((r) => r.health === 'warning').length,
      conflictsCount,
      coveredDevicesCount,
      totalDevicesCount,
      coveredRoomsCount,
      lastSyncedAt,
    },
    triggerBreakdown,
    topDevices,
    roomCoverage,
    insights,
    rules: scopedRules,
  };
}

export function buildDashboardPayload(params: {
  env: EnvStatus;
  range: TimeRange;
  customFrom?: string | null;
  customTo?: string | null;
  selectedRoomId: string;
  rooms: RoomRecord[];
  devices: DeviceRecord[];
  readings: MetricReadingRecord[];
  tariffs: TariffPeriodRecord[];
  automations?: AutomationRecord[];
  logs: CollectionLogRecord[];
  now?: Date;
}): DashboardPayload {
  const {
    env,
    range,
    customFrom = null,
    customTo = null,
    selectedRoomId,
    rooms,
    devices,
    readings,
    tariffs,
    automations = [],
    logs,
    now = new Date(),
  } = params;

  const { startMs, endMs, effectiveHours } = resolveTimeWindow(range, customFrom, customTo, now);

  const roomMap = new Map<number, RoomRecord>();
  for (const r of rooms) {
    roomMap.set(r.id, r);
  }

  const deviceMap = new Map<string, DeviceRecord>();
  for (const d of devices) {
    deviceMap.set(d.id, d);
  }

  const periodReadings = readings.filter((r) => {
    const ts = new Date(r.recordedAt).getTime();
    return ts >= startMs && ts <= endMs;
  });

  // Calcul des coûts par lecture + agrégation par pièce pour roomSummaries (toujours sur toutes les pièces)
  const roomEnergyTotals = new Map<number, number>();
  const roomCostTotals = new Map<number, number>();
  const roomTempStats = new Map<number, number[]>();
  const roomHumStats = new Map<number, number[]>();

  for (const r of periodReadings) {
    const dev = deviceMap.get(r.deviceId);
    if (!dev || !dev.isMonitored) continue;
    const effectiveRoomId = r.roomId ?? dev.roomId ?? null;
    if (effectiveRoomId === null) continue;

    if (r.energyKwh !== null && r.energyKwh > 0 && !dev.excludeFromTotals) {
      const costInfo = computeReadingCost(r.recordedAt, r.energyKwh, tariffs);
      roomEnergyTotals.set(effectiveRoomId, (roomEnergyTotals.get(effectiveRoomId) ?? 0) + r.energyKwh);
      roomCostTotals.set(effectiveRoomId, (roomCostTotals.get(effectiveRoomId) ?? 0) + costInfo.costEur);
    }

    if (r.tempC !== null && hasValidTempMeasurement(dev)) {
      const arr = roomTempStats.get(effectiveRoomId) ?? [];
      arr.push(r.tempC);
      roomTempStats.set(effectiveRoomId, arr);
    }

    if (r.humidityPct !== null && hasValidHumidityMeasurement(dev)) {
      const arr = roomHumStats.get(effectiveRoomId) ?? [];
      arr.push(r.humidityPct);
      roomHumStats.set(effectiveRoomId, arr);
    }
  }

  const roomSummaries: RoomSummary[] = rooms.map((room) => {
    const roomDevices = devices.filter((d) => d.roomId === room.id);
    const monitoredDevices = roomDevices.filter((d) => d.isMonitored);

    const currentPowerW = round2(
      monitoredDevices
        .filter((d) => !d.excludeFromTotals)
        .reduce((sum, d) => sum + (d.lastPowerW ?? 0), 0)
    );

    const tempValues = monitoredDevices
      .filter((d) => hasValidTempMeasurement(d))
      .map((d) => d.lastTempC)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const currentTempC =
      tempValues.length > 0
        ? round2(tempValues.reduce((a, b) => a + b, 0) / tempValues.length)
        : null;

    const humValues = monitoredDevices
      .filter((d) => hasValidHumidityMeasurement(d))
      .map((d) => d.lastHumidityPct)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const currentHumidityPct =
      humValues.length > 0
        ? round2(humValues.reduce((a, b) => a + b, 0) / humValues.length)
        : null;

    const periodTemps = roomTempStats.get(room.id) ?? [];
    const periodHums = roomHumStats.get(room.id) ?? [];

    return {
      room,
      currentPowerW,
      periodEnergyKwh: round3(roomEnergyTotals.get(room.id) ?? 0),
      periodCostEur: round2(roomCostTotals.get(room.id) ?? 0),
      currentTempC,
      currentHumidityPct,
      dewPointC: computeDewPointC(currentTempC, currentHumidityPct),
      avgTempC:
        periodTemps.length > 0
          ? round2(periodTemps.reduce((a, b) => a + b, 0) / periodTemps.length)
          : currentTempC,
      minTempC: periodTemps.length > 0 ? round2(Math.min(...periodTemps)) : currentTempC,
      maxTempC: periodTemps.length > 0 ? round2(Math.max(...periodTemps)) : currentTempC,
      avgHumidityPct:
        periodHums.length > 0
          ? round2(periodHums.reduce((a, b) => a + b, 0) / periodHums.length)
          : currentHumidityPct,
      minHumidityPct: periodHums.length > 0 ? round2(Math.min(...periodHums)) : currentHumidityPct,
      maxHumidityPct: periodHums.length > 0 ? round2(Math.max(...periodHums)) : currentHumidityPct,
      comfort: evaluateComfort(room, currentTempC, currentHumidityPct),
      devices: roomDevices,
    };
  });

  // Filtrage pour les KPIs et graphiques si une pièce précise est sélectionnée
  const selectedRoomNumeric =
    selectedRoomId !== 'all' && !Number.isNaN(Number(selectedRoomId))
      ? Number(selectedRoomId)
      : null;

  const filteredDevices = devices.filter((d) => {
    if (!d.isMonitored) return false;
    if (selectedRoomNumeric !== null) {
      return d.roomId === selectedRoomNumeric;
    }
    return true;
  });

  const filteredDeviceIds = new Set(filteredDevices.map((d) => d.id));
  const filteredReadings = periodReadings.filter((r) => {
    if (!filteredDeviceIds.has(r.deviceId)) return false;
    if (selectedRoomNumeric !== null) {
      const dev = deviceMap.get(r.deviceId);
      const effectiveRoomId = r.roomId ?? dev?.roomId ?? null;
      return effectiveRoomId === selectedRoomNumeric;
    }
    return true;
  });

  // KPIs globaux & répartition tarifaire
  let periodEnergyKwh = 0;
  let periodCostEur = 0;
  let hpEnergyKwh = 0;
  let hcEnergyKwh = 0;
  let baseEnergyKwh = 0;
  let hpCostEur = 0;
  let hcCostEur = 0;
  let baseCostEur = 0;

  // Regroupement par pièce et par appareil
  const energyByRoomAcc = new Map<
    string,
    { id: string; name: string; color: string; energyKwh: number; costEur: number; powerSamples: number[]; maxPowerW: number }
  >();
  const energyByDeviceAcc = new Map<
    string,
    { id: string; name: string; color: string; roomName: string; excludeFromTotals: boolean; energyKwh: number; costEur: number; powerSamples: number[]; maxPowerW: number }
  >();

  // Pour le talon nocturne (02h00 - 05h00 Paris)
  const nightPowerBySlot = new Map<string, number>();

  // Pour la série temporelle
  interface BucketState {
    bucket: string;
    label: string;
    byRoomEnergy: Record<string, number>;
    byRoomCost: Record<string, number>;
    byRoomDevicePower: Record<string, Record<string, { sum: number; count: number }>>;
    byDeviceEnergy: Record<string, number>;
    byDeviceCost: Record<string, number>;
    byDevicePower: Record<string, { sum: number; count: number }>;
    byRoomTemp: Record<string, { sum: number; count: number }>;
    byRoomHumidity: Record<string, { sum: number; count: number }>;
  }

  const buckets = new Map<string, BucketState>();

  for (const r of filteredReadings) {
    const dev = deviceMap.get(r.deviceId);
    if (!dev) continue;

    const effectiveRoomId = r.roomId ?? dev.roomId;
    const room = effectiveRoomId !== null ? roomMap.get(effectiveRoomId) : undefined;
    const roomKey = room ? String(room.id) : 'unassigned';
    const roomName = room ? room.name : 'Non assignée';
    const roomColor = room ? room.color : '#64748b';
    const devName = dev.customName || dev.name;

    const dt = new Date(r.recordedAt);
    const { key: bucketKey, label: bucketLabel } = getBucketInfo(dt, range, effectiveHours);

    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        bucket: bucketKey,
        label: bucketLabel,
        byRoomEnergy: {},
        byRoomCost: {},
        byRoomDevicePower: {},
        byDeviceEnergy: {},
        byDeviceCost: {},
        byDevicePower: {},
        byRoomTemp: {},
        byRoomHumidity: {},
      };
      buckets.set(bucketKey, bucket);
    }

    const energy = r.energyKwh ?? 0;
    const costInfo = computeReadingCost(dt, energy, tariffs);

    if (energy > 0 || (r.powerW !== null && r.powerW >= 0)) {
      const countsInTotals = !dev.excludeFromTotals;

      if (countsInTotals) {
        periodEnergyKwh += energy;
        periodCostEur += costInfo.costEur;

        if (costInfo.periodType === 'HP') {
          hpEnergyKwh += energy;
          hpCostEur += costInfo.costEur;
        } else if (costInfo.periodType === 'HC') {
          hcEnergyKwh += energy;
          hcCostEur += costInfo.costEur;
        } else {
          baseEnergyKwh += energy;
          baseCostEur += costInfo.costEur;
        }

        // Room breakdown
        const roomAcc = energyByRoomAcc.get(roomKey) ?? {
          id: roomKey,
          name: roomName,
          color: roomColor,
          energyKwh: 0,
          costEur: 0,
          powerSamples: [],
          maxPowerW: 0,
        };
        roomAcc.energyKwh += energy;
        roomAcc.costEur += costInfo.costEur;
        if (r.powerW !== null) {
          roomAcc.powerSamples.push(r.powerW);
          if (r.powerW > roomAcc.maxPowerW) roomAcc.maxPowerW = r.powerW;
        }
        energyByRoomAcc.set(roomKey, roomAcc);

        bucket.byRoomEnergy[roomKey] = (bucket.byRoomEnergy[roomKey] ?? 0) + energy;
        bucket.byRoomCost[roomKey] = (bucket.byRoomCost[roomKey] ?? 0) + costInfo.costEur;
      }

      // Device breakdown (toujours conservé pour le détail par appareil)
      const devAcc = energyByDeviceAcc.get(dev.id) ?? {
        id: dev.id,
        name: devName,
        color: roomColor,
        roomName,
        excludeFromTotals: dev.excludeFromTotals,
        energyKwh: 0,
        costEur: 0,
        powerSamples: [],
        maxPowerW: 0,
      };
      devAcc.energyKwh += energy;
      devAcc.costEur += costInfo.costEur;
      if (r.powerW !== null) {
        devAcc.powerSamples.push(r.powerW);
        if (r.powerW > devAcc.maxPowerW) devAcc.maxPowerW = r.powerW;
      }
      energyByDeviceAcc.set(dev.id, devAcc);

      // Bucket energy & cost par appareil
      bucket.byDeviceEnergy[dev.id] = (bucket.byDeviceEnergy[dev.id] ?? 0) + energy;
      bucket.byDeviceCost[dev.id] = (bucket.byDeviceCost[dev.id] ?? 0) + costInfo.costEur;

      if (r.powerW !== null) {
        const dp = bucket.byDevicePower[dev.id] ?? { sum: 0, count: 0 };
        dp.sum += r.powerW;
        dp.count += 1;
        bucket.byDevicePower[dev.id] = dp;

        if (countsInTotals) {
          const rdpMap = bucket.byRoomDevicePower[roomKey] ?? {};
          const rdp = rdpMap[dev.id] ?? { sum: 0, count: 0 };
          rdp.sum += r.powerW;
          rdp.count += 1;
          rdpMap[dev.id] = rdp;
          bucket.byRoomDevicePower[roomKey] = rdpMap;

          // Talon nocturne (02h00 - 05h00 heure de Paris)
          const { dateStr, timeStr } = getParisDateAndTime(dt);
          if (timeStr >= '02:00' && timeStr < '05:00') {
            const halfSlot = `${dateStr} ${timeStr.slice(0, 3)}${Number(timeStr.slice(3, 5)) >= 30 ? '30' : '00'}`;
            nightPowerBySlot.set(halfSlot, (nightPowerBySlot.get(halfSlot) ?? 0) + r.powerW);
          }
        }
      }
    }

    if (r.tempC !== null && hasValidTempMeasurement(dev)) {
      const rt = bucket.byRoomTemp[roomKey] ?? { sum: 0, count: 0 };
      rt.sum += r.tempC;
      rt.count += 1;
      bucket.byRoomTemp[roomKey] = rt;
    }

    if (r.humidityPct !== null && hasValidHumidityMeasurement(dev)) {
      const rh = bucket.byRoomHumidity[roomKey] ?? { sum: 0, count: 0 };
      rh.sum += r.humidityPct;
      rh.count += 1;
      bucket.byRoomHumidity[roomKey] = rh;
    }
  }

  const timeSeries: TimeSeriesPoint[] = Array.from(buckets.values())
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
    .map((b) => {
      const byRoomPower: Record<string, number> = {};
      let totalPowerW = 0;

      for (const [rKey, devMap] of Object.entries(b.byRoomDevicePower)) {
        let roomPowSum = 0;
        for (const stat of Object.values(devMap)) {
          roomPowSum += stat.count > 0 ? stat.sum / stat.count : 0;
        }
        byRoomPower[rKey] = round2(roomPowSum);
        totalPowerW += roomPowSum;
      }

      const byDevicePower: Record<string, number> = {};
      for (const [dKey, stat] of Object.entries(b.byDevicePower)) {
        byDevicePower[dKey] = stat.count > 0 ? round2(stat.sum / stat.count) : 0;
      }

      const byRoomEnergyRounded: Record<string, number> = {};
      let totalEnergyKwh = 0;
      for (const [k, v] of Object.entries(b.byRoomEnergy)) {
        byRoomEnergyRounded[k] = round3(v);
        totalEnergyKwh += v;
      }

      const byRoomCostRounded: Record<string, number> = {};
      let totalCostEur = 0;
      for (const [k, v] of Object.entries(b.byRoomCost)) {
        byRoomCostRounded[k] = round2(v);
        totalCostEur += v;
      }

      const byDeviceEnergyRounded: Record<string, number> = {};
      for (const [k, v] of Object.entries(b.byDeviceEnergy)) {
        byDeviceEnergyRounded[k] = round3(v);
      }

      const byDeviceCostRounded: Record<string, number> = {};
      for (const [k, v] of Object.entries(b.byDeviceCost)) {
        byDeviceCostRounded[k] = round2(v);
      }

      const byRoomTemp: Record<string, number | null> = {};
      for (const [k, stat] of Object.entries(b.byRoomTemp)) {
        byRoomTemp[k] = stat.count > 0 ? round2(stat.sum / stat.count) : null;
      }

      const byRoomHumidity: Record<string, number | null> = {};
      for (const [k, stat] of Object.entries(b.byRoomHumidity)) {
        byRoomHumidity[k] = stat.count > 0 ? round2(stat.sum / stat.count) : null;
      }

      return {
        bucket: b.bucket,
        label: b.label,
        totalPowerW: round2(totalPowerW),
        totalEnergyKwh: round3(totalEnergyKwh),
        totalCostEur: round2(totalCostEur),
        byRoomEnergy: byRoomEnergyRounded,
        byRoomPower,
        byRoomCost: byRoomCostRounded,
        byDeviceEnergy: byDeviceEnergyRounded,
        byDevicePower,
        byDeviceCost: byDeviceCostRounded,
        byRoomTemp,
        byRoomHumidity,
      };
    });

  const energyByRoom: EnergyBreakdownItem[] = Array.from(energyByRoomAcc.values())
    .map((item) => ({
      id: item.id,
      name: item.name,
      color: item.color,
      energyKwh: round3(item.energyKwh),
      costEur: round2(item.costEur),
      avgPowerW:
        item.powerSamples.length > 0
          ? round2(item.powerSamples.reduce((a, b) => a + b, 0) / item.powerSamples.length)
          : 0,
      maxPowerW: round2(item.maxPowerW),
      sharePct: periodEnergyKwh > 0 ? round2((item.energyKwh / periodEnergyKwh) * 100) : 0,
    }))
    .sort((a, b) => b.energyKwh - a.energyKwh);

  const energyByDevice: EnergyBreakdownItem[] = Array.from(energyByDeviceAcc.values())
    .map((item) => ({
      id: item.id,
      name: item.name,
      color: item.color,
      roomName: item.roomName,
      excludeFromTotals: item.excludeFromTotals,
      energyKwh: round3(item.energyKwh),
      costEur: round2(item.costEur),
      avgPowerW:
        item.powerSamples.length > 0
          ? round2(item.powerSamples.reduce((a, b) => a + b, 0) / item.powerSamples.length)
          : 0,
      maxPowerW: round2(item.maxPowerW),
      sharePct: periodEnergyKwh > 0 ? round2((item.energyKwh / periodEnergyKwh) * 100) : 0,
    }))
    .sort((a, b) => b.energyKwh - a.energyKwh);

  const powerDevices = filteredDevices.filter(
    (d) =>
      !d.excludeFromTotals &&
      (d.category === 'power' || d.category === 'hybrid' || d.lastPowerW !== null)
  );
  const currentPowerW = round2(
    powerDevices.reduce((sum, d) => sum + (d.lastPowerW ?? 0), 0)
  );
  const activePowerDevices = powerDevices.filter((d) => (d.lastPowerW ?? 0) > 2).length;

  // Calcul du talon nocturne (15e percentile des sommes nocturnes 02h-05h)
  const nightValues = Array.from(nightPowerBySlot.values()).filter((v) => v > 0).sort((a, b) => a - b);
  let standbyPowerW = 0;
  if (nightValues.length > 0) {
    const idx = Math.floor(nightValues.length * 0.15);
    standbyPowerW = round2(nightValues[idx]);
  }

  const effectiveRateEurPerKwh =
    periodEnergyKwh > 0
      ? round3(periodCostEur / periodEnergyKwh)
      : tariffs.length > 0
        ? tariffs[tariffs.length - 1].baseRateEur ?? tariffs[tariffs.length - 1].hpRateEur ?? 0.2016
        : 0.2016;

  const standbyAnnualCostEur = round2(
    (standbyPowerW / 1000) * 24 * 365 * effectiveRateEurPerKwh
  );

  // Abonnement proratisé sur la période
  const latestTariff = tariffs.length > 0 ? tariffs[tariffs.length - 1] : null;
  const subscriptionCostEur = latestTariff
    ? round2((effectiveHours / 24 / 30.4375) * (latestTariff.monthlySubscriptionEur ?? 0))
    : 0;

  // Climat moyen
  const roomsWithTemp = roomSummaries.filter((rs) => rs.currentTempC !== null);
  const roomsWithHum = roomSummaries.filter((rs) => rs.currentHumidityPct !== null);
  const avgTempC =
    roomsWithTemp.length > 0
      ? round2(
          roomsWithTemp.reduce((s, rs) => s + (rs.currentTempC ?? 0), 0) / roomsWithTemp.length
        )
      : null;
  const avgHumidityPct =
    roomsWithHum.length > 0
      ? round2(
          roomsWithHum.reduce((s, rs) => s + (rs.currentHumidityPct ?? 0), 0) / roomsWithHum.length
        )
      : null;
  const climateAlertsCount = roomSummaries.filter(
    (rs) => rs.comfort.label !== 'Optimal' && rs.comfort.label !== 'Aucun capteur'
  ).length;

  // Agrégation des Contact Sensors (capteurs d'ouverture)
  const contactDevices = filteredDevices.filter(
    (d) => d.category === 'contact' || Boolean(d.dpConfig?.contact) || d.lastContactOpen !== null
  );

  const contactActivityBuckets = new Map<string, ContactActivityPoint>();
  const contactEvents: ContactEventItem[] = [];
  const contactSensors: ContactSensorStat[] = [];

  for (const dev of contactDevices) {
    const devName = dev.customName || dev.name;
    const room = dev.roomId !== null ? roomMap.get(dev.roomId) : undefined;
    const roomName = room?.name ?? 'Non assignée';
    const roomColor = room?.color ?? '#64748b';

    const devReadings = filteredReadings
      .filter((r) => r.deviceId === dev.id && r.contactOpen !== null)
      .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

    let openEventsCount = 0;
    let openMinutes = 0;
    let lastOpenedAt: string | null = null;
    let prevState: boolean | null = null;

    for (let i = 0; i < devReadings.length; i++) {
      const r = devReadings[i];
      const isOpen = r.contactOpen === true;
      const isTransition = prevState === null ? isOpen : prevState !== isOpen;

      if (isOpen && (prevState === null || prevState === false)) {
        openEventsCount += 1;
      }
      if (isOpen) {
        lastOpenedAt = r.recordedAt;
        const curMs = new Date(r.recordedAt).getTime();
        const nextMs =
          i + 1 < devReadings.length
            ? new Date(devReadings[i + 1].recordedAt).getTime()
            : now.getTime();
        const deltaMin = Math.min(60, Math.max(1, Math.round((nextMs - curMs) / 60_000)));
        openMinutes += deltaMin;
      }

      const dt = new Date(r.recordedAt);
      const { key: bucketKey, label: bucketLabel } = getBucketInfo(dt, range, effectiveHours);
      const act = contactActivityBuckets.get(bucketKey) ?? {
        bucket: bucketKey,
        label: bucketLabel,
        openCount: 0,
        transitionsCount: 0,
      };
      if (isOpen) act.openCount += 1;
      if (isTransition) act.transitionsCount += 1;
      contactActivityBuckets.set(bucketKey, act);

      contactEvents.push({
        id: `${dev.id}-${r.id}-${r.recordedAt}`,
        deviceId: dev.id,
        deviceName: devName,
        roomId: dev.roomId,
        roomName,
        roomColor,
        recordedAt: r.recordedAt,
        isOpen,
        isTransition,
      });

      prevState = isOpen;
    }

    if (!lastOpenedAt && dev.lastContactOpen === true && dev.lastSeenAt) {
      lastOpenedAt = dev.lastSeenAt;
    }

    contactSensors.push({
      deviceId: dev.id,
      name: devName,
      roomId: dev.roomId,
      roomName,
      roomColor,
      isOnline: dev.isOnline,
      isOpen: dev.lastContactOpen,
      batteryPct: dev.lastBatteryPct,
      lastSeenAt: dev.lastSeenAt,
      lastOpenedAt,
      openEventsCount,
      openMinutes,
    });
  }

  contactSensors.sort((a, b) => {
    const aOpen = a.isOpen === true ? 0 : 1;
    const bOpen = b.isOpen === true ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return a.name.localeCompare(b.name);
  });

  contactEvents.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

  const contacts: ContactsPayload = {
    summary: {
      totalSensors: contactSensors.length,
      openCountNow: contactSensors.filter((s) => s.isOpen === true).length,
      closedCountNow: contactSensors.filter((s) => s.isOpen === false).length,
      onlineCount: contactSensors.filter((s) => s.isOnline).length,
      lowBatteryCount: contactSensors.filter((s) => s.batteryPct !== null && s.batteryPct <= 20)
        .length,
      totalOpenEventsPeriod: contactSensors.reduce((sum, s) => sum + s.openEventsCount, 0),
      totalOpenMinutesPeriod: contactSensors.reduce((sum, s) => sum + s.openMinutes, 0),
    },
    sensors: contactSensors,
    events: contactEvents.slice(0, 400),
    activitySeries: Array.from(contactActivityBuckets.values()).sort((a, b) =>
      a.bucket.localeCompare(b.bucket)
    ),
  };

  const automationsPayload = buildAutomationsPayload(
    automations,
    devices,
    rooms,
    selectedRoomNumeric
  );

  return {
    env,
    range,
    customFrom: range === 'custom' ? customFrom : null,
    customTo: range === 'custom' ? customTo : null,
    selectedRoomId,
    generatedAt: now.toISOString(),
    kpis: {
      currentPowerW,
      activePowerDevices,
      totalPowerDevices: powerDevices.length,
      periodEnergyKwh: round3(periodEnergyKwh),
      periodCostEur: round2(periodCostEur),
      subscriptionCostEur,
      effectiveRateEurPerKwh,
      hpEnergyKwh: round3(hpEnergyKwh),
      hcEnergyKwh: round3(hcEnergyKwh),
      baseEnergyKwh: round3(baseEnergyKwh),
      hpCostEur: round2(hpCostEur),
      hcCostEur: round2(hcCostEur),
      baseCostEur: round2(baseCostEur),
      standbyPowerW,
      standbyAnnualCostEur,
      avgTempC,
      avgHumidityPct,
      climateAlertsCount,
    },
    rooms,
    roomSummaries,
    devices,
    tariffs,
    energyByRoom,
    energyByDevice,
    timeSeries,
    contacts,
    automations: automationsPayload,
    logs: logs.slice(0, 20),
  };
}
