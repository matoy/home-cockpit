import { and, eq, isNull, notInArray } from 'drizzle-orm';
import { getDb, type AppDatabase } from '@/db';
import {
  automations,
  devices,
  deviceVendorLinks,
  metricReadings,
} from '@/db/schema';
import { extractCoverSummary } from '@/lib/covers-utils';
import { getDemoState } from '@/lib/demo-store';
import { inferDeviceCategory, sanitizeDeviceDpConfig } from '@/lib/device-utils';
import {
  cleanupDefaultSeededRoomsInDb,
  ensureMissingRoomsInDb,
  ensureMissingRoomsInDemo,
  ensureSchemaInitialized,
  seedDefaultDataIfEmpty,
} from '@/lib/services/shared';
import {
  backfillMissingReadingRoomId,
  upsertVendorConnectionState,
} from '@/lib/services/vendors/upsert-helper';
import type {
  VendorCollectionResult,
  VendorRoomSyncResult,
  VendorServerPlugin,
  VendorSyncResult,
} from '@/lib/services/vendors/types';
import { computeHybridEnergyKwh } from '@/lib/tariff-engine';
import {
  autoDetectDpConfig,
  extractMetricsFromStatus,
  fetchBatchFactoryInfos,
  fetchBatchStatuses,
  fetchDeviceSpecification,
  fetchTuyaAutomations,
  fetchTuyaDevices,
  fetchTuyaDeviceReportLogs,
  fetchTuyaRoomMapping,
  formatMacAddress,
  getTuyaConfig,
  type TuyaRawDevice,
} from '@/lib/tuya-client';
import { isValidVendorId, normalizeSystems } from '@/lib/vendors/registry';
import type {
  AutomationRuleType,
  DeviceCategory,
  DpConfig,
  EnergyMode,
  MetricReadingRecord,
  RawDpStatus,
  VendorId,
} from '@/types';

interface TuyaIntermediateReading {
  recordedAt: Date;
  contactOpen: boolean | null;
  coverState: NonNullable<MetricReadingRecord['coverState']> | null;
  coverOpenPct: number | null;
}

const TUYA_COVER_EVENT_CODES = [
  'percent_state',
  'percent_control',
  'situation_set',
  'control',
];

export async function collectTuyaIntermediateEvents(params: {
  deviceId: string;
  deviceName: string;
  tuyaCategory: string | null;
  category: DeviceCategory;
  lastBatteryPct: number | null;
  lastSeenAt: Date | string | null;
  effectiveDpConfig: DpConfig;
  hasContact: boolean;
  hasCover: boolean;
  now: Date;
}): Promise<TuyaIntermediateReading[]> {
  if (!params.hasContact && !params.hasCover) return [];

  const codes: string[] = [];
  if (params.hasContact && params.effectiveDpConfig.contact?.code) {
    codes.push(params.effectiveDpConfig.contact.code);
  }
  if (params.hasCover) {
    for (const code of TUYA_COVER_EVENT_CODES) {
      if (!codes.includes(code)) codes.push(code);
    }
  }
  if (codes.length === 0) return [];

  const nowMs = params.now.getTime();
  const rawLastMs = params.lastSeenAt ? new Date(params.lastSeenAt).getTime() : NaN;
  const startTimeMs = Number.isFinite(rawLastMs)
    ? Math.max(nowMs - 12 * 3_600_000, rawLastMs + 1000)
    : nowMs - 30 * 60_000;
  const endTimeMs = nowMs - 2000;
  if (endTimeMs <= startTimeMs) return [];

  const logs = await fetchTuyaDeviceReportLogs({
    deviceId: params.deviceId,
    codes,
    startTimeMs,
    endTimeMs,
    size: 50,
  });
  if (logs.length === 0) return [];

  const buckets = new Map<number, { tsMs: number; statuses: RawDpStatus[] }>();
  for (const entry of logs) {
    if (Math.abs(nowMs - entry.eventTimeMs) <= 2000) continue;
    const key = Math.floor(entry.eventTimeMs / 2000);
    const bucket = buckets.get(key) ?? { tsMs: entry.eventTimeMs, statuses: [] };
    bucket.tsMs = Math.max(bucket.tsMs, entry.eventTimeMs);
    bucket.statuses.push({ code: entry.code, value: entry.value });
    buckets.set(key, bucket);
  }

  const results: TuyaIntermediateReading[] = [];
  for (const bucket of Array.from(buckets.values()).sort((a, b) => a.tsMs - b.tsMs)) {
    const contactOpen =
      params.hasContact && params.effectiveDpConfig.contact
        ? extractMetricsFromStatus(bucket.statuses, { contact: params.effectiveDpConfig.contact })
            .contactOpen
        : null;
    const coverSummary = params.hasCover
      ? extractCoverSummary({
          name: params.deviceName,
          primaryVendor: 'tuya',
          tuyaCategory: params.tuyaCategory,
          category: params.category,
          lastRawStatus: bucket.statuses,
          lastBatteryPct: params.lastBatteryPct,
        })
      : null;

    if (contactOpen !== null || coverSummary !== null) {
      results.push({
        recordedAt: new Date(bucket.tsMs),
        contactOpen,
        coverState: coverSummary ? coverSummary.state : null,
        coverOpenPct: coverSummary ? coverSummary.openPct : null,
      });
    }
  }
  return results;
}

export async function syncTuyaDevices(): Promise<VendorSyncResult> {
  const db = getDb();
  const tuya = getTuyaConfig();

  if (!tuya.configured) {
    if (!db) {
      const state = getDemoState();
      state.vendorConnections.tuya.lastSyncedAt = new Date().toISOString();
      const tuyaCount = state.devices.filter((d) => d.systems.includes('tuya')).length;
      return {
        syncedCount: tuyaCount,
        newCount: 0,
        mode: 'demo',
        message: `Mode démo actif : ${tuyaCount} appareils Tuya simulés déjà synchronisés.`,
      };
    }
    throw new Error(
      'Identifiants Tuya manquants. Configurez TUYA_ACCESS_ID et TUYA_ACCESS_SECRET dans Vercel / .env.local.'
    );
  }

  const rawDevices = await fetchTuyaDevices();
  const deviceIds = rawDevices.map((d) => d.id);
  const [statusMap, roomMapping, factoryInfoMap] = await Promise.all([
    fetchBatchStatuses(deviceIds).catch(() => new Map<string, RawDpStatus[]>()),
    fetchTuyaRoomMapping(rawDevices),
    fetchBatchFactoryInfos(deviceIds),
  ]);
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    const { roomNameToId, processedCount: syncedRoomsCount } = ensureMissingRoomsInDemo(
      roomMapping.roomNames
    );

    let newCount = 0;
    for (const raw of rawDevices) {
      const rawStatus = statusMap.get(raw.id) ?? raw.status ?? [];
      const tuyaRoomName = roomMapping.deviceRoomMap.get(raw.id);
      const mappedRoomId = tuyaRoomName
        ? (roomNameToId.get(tuyaRoomName.trim().toLowerCase()) ?? null)
        : null;
      const existing = state.devices.find((d) => d.id === raw.id);
      const nextIp = raw.ip?.trim() || null;
      const nextMac =
        factoryInfoMap.get(raw.id)?.mac ?? formatMacAddress(raw.mac) ?? existing?.macAddress ?? null;
      if (existing) {
        existing.name = raw.name;
        existing.primaryVendor = existing.primaryVendor ?? 'tuya';
        existing.systems = normalizeSystems(existing.systems, existing.primaryVendor);
        if (mappedRoomId !== null) existing.roomId = mappedRoomId;
        existing.isOnline = raw.online ?? true;
        existing.tuyaCategory = raw.category;
        existing.productName = raw.product_name ?? null;
        existing.ipAddress = nextIp ?? existing.ipAddress;
        existing.macAddress = nextMac;
        existing.lastRawStatus = rawStatus;
        if (!existing.dpConfig?.contact || !existing.dpConfig?.battery) {
          const detected = autoDetectDpConfig(rawStatus, {}, raw.category);
          existing.dpConfig = {
            ...detected.dpConfig,
            ...existing.dpConfig,
          };
          if (existing.category === 'other' && detected.category !== 'other') {
            existing.category = detected.category;
          }
        }
        const sanitized = sanitizeDeviceDpConfig(existing.dpConfig ?? {}, raw.category);
        if (sanitized.changed) {
          existing.dpConfig = sanitized.dpConfig;
          existing.category = inferDeviceCategory(existing.dpConfig, raw.category);
        }
        const metrics = extractMetricsFromStatus(rawStatus, existing.dpConfig);
        existing.lastPowerW = metrics.powerW;
        existing.lastVoltageV = metrics.voltageV;
        existing.lastAddEleKwh = metrics.addEleKwh;
        existing.lastTempC = metrics.tempC;
        existing.lastHumidityPct = metrics.humidityPct;
        existing.lastBatteryPct = metrics.batteryPct;
        existing.lastContactOpen = metrics.contactOpen;
        existing.lastSeenAt = now.toISOString();
      } else {
        const spec = await fetchDeviceSpecification(raw.id);
        const { dpConfig, category } = autoDetectDpConfig(rawStatus, spec, raw.category);
        const metrics = extractMetricsFromStatus(rawStatus, dpConfig);
        state.devices.push({
          id: raw.id,
          name: raw.name,
          customName: null,
          primaryVendor: 'tuya',
          systems: ['tuya'],
          roomId: mappedRoomId,
          category,
          tuyaCategory: raw.category,
          productName: raw.product_name ?? null,
          ipAddress: nextIp,
          macAddress: nextMac,
          isOnline: raw.online ?? true,
          isMonitored: true,
          excludeFromTotals: false,
          energyMode: 'hybrid',
          dpConfig,
          lastRawStatus: rawStatus,
          lastSeenAt: now.toISOString(),
          lastPowerW: metrics.powerW,
          lastVoltageV: metrics.voltageV,
          lastAddEleKwh: metrics.addEleKwh,
          lastTempC: metrics.tempC,
          lastHumidityPct: metrics.humidityPct,
          lastBatteryPct: metrics.batteryPct,
          lastContactOpen: metrics.contactOpen,
        });
        state.vendorLinks.push({
          id: state.nextLinkId++,
          deviceId: raw.id,
          vendor: 'tuya',
          externalId: raw.id,
          externalName: raw.name,
          isPrimaryTelemetry: true,
          linkedAt: now.toISOString(),
        });
        newCount++;
      }
    }
    state.vendorConnections.tuya.connected = true;
    state.vendorConnections.tuya.lastSyncedAt = now.toISOString();
    state.vendorConnections.tuya.lastError = null;
    const baseMsg =
      syncedRoomsCount > 0
        ? `${rawDevices.length} appareils et ${syncedRoomsCount} pièces synchronisés depuis Tuya Cloud (${newCount} nouveaux).`
        : `${rawDevices.length} appareils récupérés depuis Tuya Cloud (${newCount} nouveaux).`;
    return {
      syncedCount: rawDevices.length,
      newCount,
      mode: 'demo',
      message: roomMapping.warning ? `${baseMsg} (${roomMapping.warning})` : baseMsg,
    };
  }

  await seedDefaultDataIfEmpty(db);

  const { existingRoomsRows, roomNameToId, processedCount: syncedRoomsCount } =
    await ensureMissingRoomsInDb(db, roomMapping.roomNames);

  const existingRows = await db.select().from(devices);
  const existingMap = new Map(existingRows.map((d) => [d.id, d]));

  let newCount = 0;

  for (const raw of rawDevices) {
    const rawStatus = statusMap.get(raw.id) ?? raw.status ?? [];
    const existing = existingMap.get(raw.id);
    const nextIp = raw.ip?.trim() || existing?.ipAddress || null;
    const nextMac =
      factoryInfoMap.get(raw.id)?.mac ?? formatMacAddress(raw.mac) ?? existing?.macAddress ?? null;
    const tuyaRoomName = roomMapping.deviceRoomMap.get(raw.id);
    const tuyaRoomId = tuyaRoomName
      ? (roomNameToId.get(tuyaRoomName.trim().toLowerCase()) ?? null)
      : null;

    if (existing) {
      const targetRoomId = tuyaRoomId ?? existing.roomId;
      let dpConfig = existing.dpConfig ?? {};
      let nextCategory = existing.category;

      if (Object.keys(dpConfig).length === 0) {
        const detected = autoDetectDpConfig(
          rawStatus,
          await fetchDeviceSpecification(raw.id),
          raw.category
        );
        dpConfig = detected.dpConfig;
        nextCategory = detected.category;
      } else if (!dpConfig.contact || !dpConfig.battery) {
        const detected = autoDetectDpConfig(rawStatus, {}, raw.category);
        dpConfig = { ...detected.dpConfig, ...dpConfig };
        if (nextCategory === 'other' && detected.category !== 'other') {
          nextCategory = detected.category;
        }
      }

      const sanitized = sanitizeDeviceDpConfig(dpConfig, raw.category);
      if (sanitized.changed) {
        dpConfig = sanitized.dpConfig;
        nextCategory = inferDeviceCategory(dpConfig, raw.category);
      }

      const metrics = extractMetricsFromStatus(rawStatus, dpConfig);
      const primaryVendor: VendorId = isValidVendorId(existing.primaryVendor)
        ? existing.primaryVendor
        : 'tuya';
      const nextSystems = normalizeSystems(existing.systems, primaryVendor);

      await db
        .update(devices)
        .set({
          name: raw.name,
          systems: nextSystems,
          roomId: targetRoomId,
          category: nextCategory,
          tuyaCategory: raw.category,
          productName: raw.product_name ?? null,
          ipAddress: nextIp,
          macAddress: nextMac,
          isOnline: raw.online ?? true,
          dpConfig,
          lastRawStatus: rawStatus,
          lastSeenAt: now,
          lastPowerW: metrics.powerW,
          lastVoltageV: metrics.voltageV,
          lastAddEleKwh: metrics.addEleKwh,
          lastTempC: metrics.tempC,
          lastHumidityPct: metrics.humidityPct,
          lastBatteryPct: metrics.batteryPct,
          lastContactOpen: metrics.contactOpen,
        })
        .where(eq(devices.id, raw.id));

      await db
        .insert(deviceVendorLinks)
        .values({
          deviceId: raw.id,
          vendor: 'tuya',
          externalId: raw.id,
          externalName: raw.name,
          isPrimaryTelemetry: primaryVendor === 'tuya',
          linkedAt: now,
        })
        .onConflictDoUpdate({
          target: [deviceVendorLinks.vendor, deviceVendorLinks.externalId],
          set: { externalName: raw.name },
        });

      await backfillMissingReadingRoomId(db, raw.id, targetRoomId, existing.roomId);
    } else {
      const spec = await fetchDeviceSpecification(raw.id);
      const { dpConfig, category } = autoDetectDpConfig(rawStatus, spec, raw.category);
      const metrics = extractMetricsFromStatus(rawStatus, dpConfig);

      await db.insert(devices).values({
        id: raw.id,
        name: raw.name,
        customName: null,
        primaryVendor: 'tuya',
        systems: ['tuya'],
        roomId: tuyaRoomId,
        category,
        tuyaCategory: raw.category,
        productName: raw.product_name ?? null,
        ipAddress: nextIp,
        macAddress: nextMac,
        isOnline: raw.online ?? true,
        isMonitored: true,
        excludeFromTotals: false,
        energyMode: 'hybrid',
        dpConfig,
        lastRawStatus: rawStatus,
        lastSeenAt: now,
        lastPowerW: metrics.powerW,
        lastVoltageV: metrics.voltageV,
        lastAddEleKwh: metrics.addEleKwh,
        lastTempC: metrics.tempC,
        lastHumidityPct: metrics.humidityPct,
        lastBatteryPct: metrics.batteryPct,
        lastContactOpen: metrics.contactOpen,
      });

      await db
        .insert(deviceVendorLinks)
        .values({
          deviceId: raw.id,
          vendor: 'tuya',
          externalId: raw.id,
          externalName: raw.name,
          isPrimaryTelemetry: true,
          linkedAt: now,
        })
        .onConflictDoNothing();

      newCount++;
    }
  }

  await upsertVendorConnectionState(db, {
    vendor: 'tuya',
    mode: 'cloud_key',
    status: 'connected',
    lastSyncedAt: now,
    lastError: null,
  });

  await cleanupDefaultSeededRoomsInDb(db, roomMapping.roomNames, existingRoomsRows);
  await syncTuyaAutomations(rawDevices).catch(() => null);

  const baseMsg =
    syncedRoomsCount > 0
      ? `${rawDevices.length} appareils et ${syncedRoomsCount} pièces synchronisés avec Tuya Cloud (${newCount} nouveaux).`
      : `${rawDevices.length} appareils synchronisés avec Tuya Cloud (${newCount} nouveaux).`;

  return {
    syncedCount: rawDevices.length,
    newCount,
    mode: 'live',
    message: roomMapping.warning ? `${baseMsg} (${roomMapping.warning})` : baseMsg,
  };
}

export async function syncTuyaAutomations(rawDevicesArg?: TuyaRawDevice[]): Promise<{
  syncedCount: number;
  mode: 'live' | 'demo';
  message: string;
}> {
  const db = getDb();
  const tuya = getTuyaConfig();

  if (!tuya.configured) {
    if (!db) {
      const state = getDemoState();
      return {
        syncedCount: state.automations.length,
        mode: 'demo',
        message: `Mode démo actif : ${state.automations.length} scénarios simulés disponibles.`,
      };
    }
    throw new Error(
      'Identifiants Tuya manquants. Configurez TUYA_ACCESS_ID et TUYA_ACCESS_SECRET.'
    );
  }

  const res = await fetchTuyaAutomations(rawDevicesArg);
  const now = new Date();

  if (!db) {
    const state = getDemoState();
    if (res.automations.length > 0) {
      state.automations = res.automations;
    }
    const baseMsg = `${res.automations.length} scénario(x) et automatisation(s) récupérés depuis Tuya Cloud.`;
    return {
      syncedCount: res.automations.length,
      mode: 'demo',
      message: res.warning ? `${baseMsg} (${res.warning})` : baseMsg,
    };
  }

  await ensureSchemaInitialized(db);

  for (const item of res.automations) {
    await db
      .insert(automations)
      .values({
        id: item.id,
        homeId: item.homeId,
        name: item.name,
        ruleType: item.ruleType as AutomationRuleType,
        enabled: item.enabled,
        matchType: item.matchType,
        effectiveTime: item.effectiveTime,
        conditions: item.conditions,
        actions: item.actions,
        rawPayload: item.rawPayload,
        syncedAt: now,
      })
      .onConflictDoUpdate({
        target: automations.id,
        set: {
          homeId: item.homeId,
          name: item.name,
          ruleType: item.ruleType as AutomationRuleType,
          enabled: item.enabled,
          matchType: item.matchType,
          effectiveTime: item.effectiveTime,
          conditions: item.conditions,
          actions: item.actions,
          rawPayload: item.rawPayload,
          syncedAt: now,
        },
      });
  }

  if (res.automations.length > 0) {
    const syncedIds = res.automations.map((a) => a.id);
    await db.delete(automations).where(notInArray(automations.id, syncedIds));
  }

  const baseMsg = `${res.automations.length} scénario(x) et automatisation(s) synchronisés avec Tuya Cloud.`;
  return {
    syncedCount: res.automations.length,
    mode: 'live',
    message: res.warning ? `${baseMsg} (${res.warning})` : baseMsg,
  };
}

export async function collectTuyaReadingsInDb(
  db: AppDatabase,
  tuyaMonitored: Array<typeof devices.$inferSelect>,
  now: Date
): Promise<VendorCollectionResult> {
  if (tuyaMonitored.length === 0 || !getTuyaConfig().configured) {
    return { devicesCount: 0, readingsInserted: 0, updatedCount: 0 };
  }

  const statusMap = await fetchBatchStatuses(tuyaMonitored.map((d) => d.id));
  const readingsToInsert: Array<typeof metricReadings.$inferInsert> = [];
  let updatedCount = 0;

  for (const dev of tuyaMonitored) {
    const rawStatus: RawDpStatus[] = statusMap.get(dev.id) ?? [];
    if (rawStatus.length === 0) continue;

    const effectiveDpConfig = sanitizeDeviceDpConfig(dev.dpConfig ?? {}, dev.tuyaCategory).dpConfig;
    const metrics = extractMetricsFromStatus(rawStatus, effectiveDpConfig);
    const hasPower = metrics.powerW !== null || metrics.addEleKwh !== null;
    const hasClimate = metrics.tempC !== null || metrics.humidityPct !== null;
    const hasContact = metrics.contactOpen !== null;
    const coverSummary = extractCoverSummary({
      name: dev.name,
      primaryVendor: 'tuya',
      tuyaCategory: dev.tuyaCategory,
      category: (dev.category as DeviceCategory) || 'other',
      lastRawStatus: rawStatus,
      lastBatteryPct: metrics.batteryPct,
    });
    const hasCover = coverSummary !== null;

    if (hasContact || Boolean(effectiveDpConfig.contact?.code) || dev.category === 'contact' || hasCover) {
      const intermediateEvents = await collectTuyaIntermediateEvents({
        deviceId: dev.id,
        deviceName: dev.name,
        tuyaCategory: dev.tuyaCategory,
        category: (dev.category as DeviceCategory) || 'other',
        lastBatteryPct: metrics.batteryPct,
        lastSeenAt: dev.lastSeenAt,
        effectiveDpConfig,
        hasContact: hasContact || Boolean(effectiveDpConfig.contact?.code) || dev.category === 'contact',
        hasCover,
        now,
      });
      for (const ev of intermediateEvents) {
        readingsToInsert.push({
          deviceId: dev.id,
          roomId: dev.roomId,
          recordedAt: ev.recordedAt,
          powerW: null,
          voltageV: null,
          energyKwh: null,
          energySource: null,
          tempC: null,
          humidityPct: null,
          contactOpen: ev.contactOpen,
          coverState: ev.coverState,
          coverOpenPct: ev.coverOpenPct,
        });
      }
    }

    if (!hasPower && !hasClimate && !hasContact && !hasCover) {
      await db
        .update(devices)
        .set({ lastRawStatus: rawStatus, lastSeenAt: now })
        .where(eq(devices.id, dev.id));
      updatedCount++;
      continue;
    }

    const energyRes = hasPower
      ? computeHybridEnergyKwh({
          energyMode: (dev.energyMode as EnergyMode) || 'hybrid',
          powerW: metrics.powerW,
          currentAddEleKwh: metrics.addEleKwh,
          previousAddEleKwh: dev.lastAddEleKwh,
          previousSeenAt: dev.lastSeenAt,
          now,
        })
      : null;

    readingsToInsert.push({
      deviceId: dev.id,
      roomId: dev.roomId,
      recordedAt: now,
      powerW: metrics.powerW,
      voltageV: metrics.voltageV,
      energyKwh: energyRes ? energyRes.energyKwh : null,
      energySource: energyRes ? energyRes.source : null,
      tempC: metrics.tempC,
      humidityPct: metrics.humidityPct,
      contactOpen: metrics.contactOpen,
      coverState: coverSummary ? coverSummary.state : null,
      coverOpenPct: coverSummary ? coverSummary.openPct : null,
    });

    await db
      .update(devices)
      .set({
        lastRawStatus: rawStatus,
        lastSeenAt: now,
        lastPowerW: metrics.powerW,
        lastVoltageV: metrics.voltageV,
        lastAddEleKwh: metrics.addEleKwh,
        lastTempC: metrics.tempC,
        lastHumidityPct: metrics.humidityPct,
        lastBatteryPct: metrics.batteryPct,
        lastContactOpen: metrics.contactOpen,
      })
      .where(eq(devices.id, dev.id));
    updatedCount++;
  }

  if (readingsToInsert.length > 0) {
    await db.insert(metricReadings).values(readingsToInsert);
  }

  return {
    devicesCount: tuyaMonitored.length,
    readingsInserted: readingsToInsert.length,
    updatedCount,
  };
}

export async function syncRoomsFromTuya(): Promise<VendorRoomSyncResult> {
  const db = getDb();
  const tuya = getTuyaConfig();
  const now = new Date();

  if (!tuya.configured) {
    if (!db) {
      const state = getDemoState();
      state.vendorConnections.tuya.lastSyncedAt = now.toISOString();
      return {
        vendor: 'tuya',
        roomsFound: state.rooms.length,
        createdCount: 0,
        assignedDevicesCount: 0,
        mode: 'demo',
        message: `Mode démo actif : ${state.rooms.length} pièce(s) Tuya simulée(s) déjà disponible(s).`,
      };
    }
    throw new Error(
      'Identifiants Tuya manquants. Configurez TUYA_ACCESS_ID et TUYA_ACCESS_SECRET dans Vercel / .env.local.'
    );
  }

  const rawDevices = await fetchTuyaDevices();
  const roomMapping = await fetchTuyaRoomMapping(rawDevices);

  if (!db) {
    const state = getDemoState();
    const { roomNameToId, createdCount } = ensureMissingRoomsInDemo(roomMapping.roomNames);
    let assignedDevicesCount = 0;

    for (const [deviceId, tuyaRoomName] of roomMapping.deviceRoomMap.entries()) {
      const existing = state.devices.find((d) => d.id === deviceId);
      const mappedRoomId = roomNameToId.get(tuyaRoomName.trim().toLowerCase()) ?? null;
      if (existing && mappedRoomId !== null && existing.roomId !== mappedRoomId) {
        existing.roomId = mappedRoomId;
        assignedDevicesCount++;
      }
    }

    state.vendorConnections.tuya.connected = true;
    state.vendorConnections.tuya.lastSyncedAt = now.toISOString();
    state.vendorConnections.tuya.lastError = null;

    const baseMsg = `Tuya : ${roomMapping.roomNames.length} pièce(s) détectée(s) (${createdCount} créée(s), ${assignedDevicesCount} appareil(s) rattaché(s)).`;
    return {
      vendor: 'tuya',
      roomsFound: roomMapping.roomNames.length,
      createdCount,
      assignedDevicesCount,
      mode: 'demo',
      message: roomMapping.warning ? `${baseMsg} (${roomMapping.warning})` : baseMsg,
    };
  }

  await seedDefaultDataIfEmpty(db);

  const { existingRoomsRows, roomNameToId, createdCount } = await ensureMissingRoomsInDb(
    db,
    roomMapping.roomNames
  );

  const existingDeviceRows = await db
    .select({ id: devices.id, roomId: devices.roomId })
    .from(devices);
  const deviceById = new Map(existingDeviceRows.map((d) => [d.id, d]));

  let assignedDevicesCount = 0;
  for (const [deviceId, tuyaRoomName] of roomMapping.deviceRoomMap.entries()) {
    const existing = deviceById.get(deviceId);
    const tuyaRoomId = roomNameToId.get(tuyaRoomName.trim().toLowerCase()) ?? null;
    if (existing && tuyaRoomId !== null && existing.roomId !== tuyaRoomId) {
      await db.update(devices).set({ roomId: tuyaRoomId }).where(eq(devices.id, deviceId));
      await db
        .update(metricReadings)
        .set({ roomId: tuyaRoomId })
        .where(and(eq(metricReadings.deviceId, deviceId), isNull(metricReadings.roomId)));
      assignedDevicesCount++;
    }
  }

  await cleanupDefaultSeededRoomsInDb(db, roomMapping.roomNames, existingRoomsRows);

  await upsertVendorConnectionState(db, {
    vendor: 'tuya',
    mode: 'cloud_key',
    status: 'connected',
    lastSyncedAt: now,
    lastError: null,
  });

  const baseMsg = `Tuya : ${roomMapping.roomNames.length} pièce(s) détectée(s) (${createdCount} créée(s), ${assignedDevicesCount} appareil(s) rattaché(s)).`;
  return {
    vendor: 'tuya',
    roomsFound: roomMapping.roomNames.length,
    createdCount,
    assignedDevicesCount,
    mode: 'live',
    message: roomMapping.warning ? `${baseMsg} (${roomMapping.warning})` : baseMsg,
  };
}

export const tuyaPlugin: VendorServerPlugin = {
  id: 'tuya',
  isConfigured: () => getTuyaConfig().configured,
  getConnectionMode: () => 'cloud_key',
  isConnectedLive: ({ devices: mappedDevices }) =>
    getTuyaConfig().configured || mappedDevices.some((d) => d.systems.includes('tuya')),
  syncDevices: syncTuyaDevices,
  collectReadings: ({ db, monitoredDevices, now }) =>
    collectTuyaReadingsInDb(db, monitoredDevices, now),
  syncRooms: syncRoomsFromTuya,
  isReadyForRoomSync: async (db) => (!db ? true : getTuyaConfig().configured),
};
