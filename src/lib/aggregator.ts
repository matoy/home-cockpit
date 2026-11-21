import { computeDewPointC, computeReadingCost, getParisDateAndTime } from './tariff-engine';
import type {
  CollectionLogRecord,
  ComfortStatus,
  ContactActivityPoint,
  ContactEventItem,
  ContactSensorStat,
  ContactsPayload,
  DashboardPayload,
  DeviceRecord,
  EnergyBreakdownItem,
  EnvStatus,
  MetricReadingRecord,
  RoomRecord,
  RoomSummary,
  TariffPeriodRecord,
  TimeRange,
  TimeSeriesPoint,
} from '@/types';

const RANGE_HOURS: Record<TimeRange, number> = {
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

function getBucketInfo(date: Date, range: TimeRange): { key: string; label: string } {
  const { dateStr, timeStr } = getParisDateAndTime(date);
  const [year, month, day] = dateStr.split('-');
  const [hourStr, minStr] = timeStr.split(':');
  const hour = Number(hourStr);
  const minute = Number(minStr);

  if (range === '24h') {
    const slotMin = minute >= 30 ? '30' : '00';
    return {
      key: `${dateStr}T${hourStr}:${slotMin}`,
      label: `${hourStr}:${slotMin}`,
    };
  }

  if (range === '7d') {
    const blockHour = Math.floor(hour / 2) * 2;
    const bh = String(blockHour).padStart(2, '0');
    return {
      key: `${dateStr}T${bh}:00`,
      label: `${day}/${month} ${bh}h`,
    };
  }

  if (range === '30d') {
    return {
      key: dateStr,
      label: `${day}/${month}`,
    };
  }

  // 365d -> par mois si > 45 jours sinon par jour
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

export function buildDashboardPayload(params: {
  env: EnvStatus;
  range: TimeRange;
  selectedRoomId: string;
  rooms: RoomRecord[];
  devices: DeviceRecord[];
  readings: MetricReadingRecord[];
  tariffs: TariffPeriodRecord[];
  logs: CollectionLogRecord[];
  now?: Date;
}): DashboardPayload {
  const {
    env,
    range,
    selectedRoomId,
    rooms,
    devices,
    readings,
    tariffs,
    logs,
    now = new Date(),
  } = params;

  const hours = RANGE_HOURS[range] ?? 24;
  const cutoffMs = now.getTime() - hours * 3_600_000;

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
    return ts >= cutoffMs && ts <= now.getTime() + 60_000;
  });

  // Calcul des coûts par lecture + agrégation par pièce pour roomSummaries (toujours sur toutes les pièces)
  const roomEnergyTotals = new Map<number, number>();
  const roomCostTotals = new Map<number, number>();
  const roomTempStats = new Map<number, number[]>();
  const roomHumStats = new Map<number, number[]>();

  for (const r of periodReadings) {
    const dev = deviceMap.get(r.deviceId);
    const effectiveRoomId = r.roomId ?? dev?.roomId ?? null;
    if (effectiveRoomId === null) continue;

    if (r.energyKwh !== null && r.energyKwh > 0) {
      const costInfo = computeReadingCost(r.recordedAt, r.energyKwh, tariffs);
      roomEnergyTotals.set(effectiveRoomId, (roomEnergyTotals.get(effectiveRoomId) ?? 0) + r.energyKwh);
      roomCostTotals.set(effectiveRoomId, (roomCostTotals.get(effectiveRoomId) ?? 0) + costInfo.costEur);
    }

    if (r.tempC !== null) {
      const arr = roomTempStats.get(effectiveRoomId) ?? [];
      arr.push(r.tempC);
      roomTempStats.set(effectiveRoomId, arr);
    }

    if (r.humidityPct !== null) {
      const arr = roomHumStats.get(effectiveRoomId) ?? [];
      arr.push(r.humidityPct);
      roomHumStats.set(effectiveRoomId, arr);
    }
  }

  const roomSummaries: RoomSummary[] = rooms.map((room) => {
    const roomDevices = devices.filter((d) => d.roomId === room.id);
    const monitoredDevices = roomDevices.filter((d) => d.isMonitored);

    const currentPowerW = round2(
      monitoredDevices.reduce((sum, d) => sum + (d.lastPowerW ?? 0), 0)
    );

    const tempValues = monitoredDevices
      .map((d) => d.lastTempC)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const currentTempC =
      tempValues.length > 0
        ? round2(tempValues.reduce((a, b) => a + b, 0) / tempValues.length)
        : null;

    const humValues = monitoredDevices
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
    { id: string; name: string; color: string; roomName: string; energyKwh: number; costEur: number; powerSamples: number[]; maxPowerW: number }
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
    const { key: bucketKey, label: bucketLabel } = getBucketInfo(dt, range);

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

      // Device breakdown
      const devAcc = energyByDeviceAcc.get(dev.id) ?? {
        id: dev.id,
        name: devName,
        color: roomColor,
        roomName,
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

      // Bucket energy & cost
      bucket.byRoomEnergy[roomKey] = (bucket.byRoomEnergy[roomKey] ?? 0) + energy;
      bucket.byRoomCost[roomKey] = (bucket.byRoomCost[roomKey] ?? 0) + costInfo.costEur;
      bucket.byDeviceEnergy[dev.id] = (bucket.byDeviceEnergy[dev.id] ?? 0) + energy;
      bucket.byDeviceCost[dev.id] = (bucket.byDeviceCost[dev.id] ?? 0) + costInfo.costEur;

      if (r.powerW !== null) {
        const dp = bucket.byDevicePower[dev.id] ?? { sum: 0, count: 0 };
        dp.sum += r.powerW;
        dp.count += 1;
        bucket.byDevicePower[dev.id] = dp;

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

    if (r.tempC !== null) {
      const rt = bucket.byRoomTemp[roomKey] ?? { sum: 0, count: 0 };
      rt.sum += r.tempC;
      rt.count += 1;
      bucket.byRoomTemp[roomKey] = rt;
    }

    if (r.humidityPct !== null) {
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
    (d) => d.category === 'power' || d.category === 'hybrid' || d.lastPowerW !== null
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
    ? round2((hours / 24 / 30.4375) * (latestTariff.monthlySubscriptionEur ?? 0))
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
      const { key: bucketKey, label: bucketLabel } = getBucketInfo(dt, range);
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

  return {
    env,
    range,
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
    logs: logs.slice(0, 20),
  };
}
