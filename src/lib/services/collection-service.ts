import { getDb, type AppDatabase } from '@/db';
import { collectionLogs, devices } from '@/db/schema';
import { runPostCollectionAlerting } from '@/lib/alerting';
import { extractCoverSummary } from '@/lib/covers-utils';
import { getDemoState, simulateDemoCollection } from '@/lib/demo-store';
import { sanitizeDeviceDpConfig } from '@/lib/device-utils';
import { runMetricsRetention } from '@/lib/services/retention-service';
import { mapDbLog, seedDefaultDataIfEmpty } from '@/lib/services/shared';
import { VENDOR_SERVER_PLUGINS } from '@/lib/services/vendors';
import {
  collectTuyaIntermediateEvents,
  syncTuyaDevices,
} from '@/lib/services/vendors/tuya-sync';
import type { VendorCollectionResult } from '@/lib/services/vendors/types';
import { computeHybridEnergyKwh } from '@/lib/tariff-engine';
import {
  autoDetectDpConfig,
  extractMetricsFromStatus,
  fetchBatchFactoryInfos,
  fetchBatchStatuses,
  fetchDeviceSpecification,
  fetchTuyaDevices,
  formatMacAddress,
} from '@/lib/tuya-client';
import { VENDOR_IDS } from '@/lib/vendors/registry';
import type { CollectionLogRecord, VendorId } from '@/types';

const SECONDARY_VENDORS: readonly VendorId[] = VENDOR_IDS.filter((id) => id !== 'tuya');

async function collectTuyaLiveInDemoStore(
  trigger: 'schedule' | 'manual',
  startedMs: number
): Promise<CollectionLogRecord> {
  const state = getDemoState();
  const rawDevices = await fetchTuyaDevices();
  const deviceIds = rawDevices.map((d) => d.id);
  const [statusMap, factoryInfoMap] = await Promise.all([
    fetchBatchStatuses(deviceIds),
    fetchBatchFactoryInfos(deviceIds),
  ]);
  const now = new Date();
  let inserted = 0;

  for (const raw of rawDevices) {
    const rawStatus = statusMap.get(raw.id) ?? raw.status ?? [];
    let dev = state.devices.find((d) => d.id === raw.id);
    const nextIp = raw.ip?.trim() || dev?.ipAddress || null;
    const nextMac =
      factoryInfoMap.get(raw.id)?.mac ?? formatMacAddress(raw.mac) ?? dev?.macAddress ?? null;
    if (!dev) {
      const spec = await fetchDeviceSpecification(raw.id);
      const detected = autoDetectDpConfig(rawStatus, spec, raw.category);
      dev = {
        id: raw.id,
        name: raw.name,
        customName: null,
        primaryVendor: 'tuya',
        systems: ['tuya'],
        roomId: null,
        category: detected.category,
        tuyaCategory: raw.category,
        productName: raw.product_name ?? null,
        ipAddress: nextIp,
        macAddress: nextMac,
        isOnline: raw.online ?? true,
        isMonitored: true,
        excludeFromTotals: false,
        energyMode: 'hybrid',
        dpConfig: detected.dpConfig,
        lastRawStatus: rawStatus,
        lastSeenAt: null,
        lastPowerW: null,
        lastVoltageV: null,
        lastAddEleKwh: null,
        lastTempC: null,
        lastHumidityPct: null,
        lastBatteryPct: null,
        lastContactOpen: null,
      };
      state.devices.push(dev);
      state.vendorLinks.push({
        id: state.nextLinkId++,
        deviceId: raw.id,
        vendor: 'tuya',
        externalId: raw.id,
        externalName: raw.name,
        isPrimaryTelemetry: true,
        linkedAt: now.toISOString(),
      });
    }

    if (!dev.isMonitored) continue;
    const effectiveDpConfig = sanitizeDeviceDpConfig(dev.dpConfig ?? {}, dev.tuyaCategory).dpConfig;
    const metrics = extractMetricsFromStatus(rawStatus, effectiveDpConfig);
    const coverSummary = extractCoverSummary({
      name: dev.name,
      primaryVendor: 'tuya',
      tuyaCategory: dev.tuyaCategory,
      category: dev.category,
      lastRawStatus: rawStatus,
      lastBatteryPct: metrics.batteryPct,
    });
    const hasCover = coverSummary !== null;

    const intermediateEvents = await collectTuyaIntermediateEvents({
      deviceId: dev.id,
      deviceName: dev.name,
      tuyaCategory: dev.tuyaCategory,
      category: dev.category,
      lastBatteryPct: metrics.batteryPct,
      lastSeenAt: dev.lastSeenAt,
      effectiveDpConfig,
      hasContact: Boolean(effectiveDpConfig.contact?.code) || dev.category === 'contact',
      hasCover,
      now,
    });
    for (const ev of intermediateEvents) {
      state.readings.push({
        id: state.nextReadingId++,
        deviceId: dev.id,
        roomId: dev.roomId,
        recordedAt: ev.recordedAt.toISOString(),
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
      inserted++;
    }

    const energyRes =
      metrics.powerW !== null || metrics.addEleKwh !== null
        ? computeHybridEnergyKwh({
            energyMode: dev.energyMode,
            powerW: metrics.powerW,
            currentAddEleKwh: metrics.addEleKwh,
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

    dev.lastRawStatus = rawStatus;
    dev.ipAddress = nextIp;
    dev.macAddress = nextMac;
    dev.lastSeenAt = now.toISOString();
    dev.lastPowerW = metrics.powerW;
    dev.lastVoltageV = metrics.voltageV;
    dev.lastAddEleKwh = metrics.addEleKwh;
    dev.lastTempC = metrics.tempC;
    dev.lastHumidityPct = metrics.humidityPct;
    dev.lastBatteryPct = metrics.batteryPct;
    dev.lastContactOpen = metrics.contactOpen;
    inserted++;
  }

  const log: CollectionLogRecord = {
    id: state.nextLogId++,
    executedAt: now.toISOString(),
    trigger,
    devicesCount: rawDevices.length,
    readingsInserted: inserted,
    status: 'success',
    errorMessage: null,
    durationMs: Date.now() - startedMs,
  };
  state.logs.unshift(log);
  return log;
}

function groupMonitoredDevicesByVendor(
  allDevices: Array<typeof devices.$inferSelect>
): Map<VendorId, Array<typeof devices.$inferSelect>> {
  const grouped = new Map<VendorId, Array<typeof devices.$inferSelect>>();
  for (const id of VENDOR_IDS) grouped.set(id, []);

  for (const dev of allDevices) {
    if (!dev.isMonitored || dev.id.startsWith('manual_')) continue;
    const vendorId: VendorId =
      dev.primaryVendor && grouped.has(dev.primaryVendor as VendorId)
        ? (dev.primaryVendor as VendorId)
        : 'tuya';
    grouped.get(vendorId)!.push(dev);
  }
  return grouped;
}

async function runSecondaryVendorsCollection(params: {
  db: AppDatabase;
  grouped: Map<VendorId, Array<typeof devices.$inferSelect>>;
  now: Date;
  throwIfAllEmptyError: boolean;
}): Promise<{
  results: Array<{ vendor: VendorId; result: VendorCollectionResult }>;
  anyActiveVendor: boolean;
}> {
  let anyActiveVendor = false;

  const activeEntries = SECONDARY_VENDORS.map((vendorId) => {
    const plugin = VENDOR_SERVER_PLUGINS[vendorId];
    const list = params.grouped.get(vendorId) ?? [];
    const visible = plugin.isVisible ? plugin.isVisible() : true;
    const active =
      visible &&
      Boolean(plugin.collectReadings) &&
      (plugin.isConfigured() || (vendorId === 'xiaomi' && list.length > 0));
    return { vendorId, plugin, list, active };
  }).filter((entry) => entry.active);

  anyActiveVendor = activeEntries.some(
    (e) => e.plugin.isConfigured() || e.list.length > 0
  );

  const settled = await Promise.all(
    activeEntries.map(async (entry) => {
      try {
        const result = await entry.plugin.collectReadings!({
          db: params.db,
          monitoredDevices: entry.list,
          now: params.now,
        });
        return { vendor: entry.vendorId, result };
      } catch (err) {
        if (params.throwIfAllEmptyError && activeEntries.length === 1) {
          throw err;
        }
        return {
          vendor: entry.vendorId,
          result: { devicesCount: 0, readingsInserted: 0, updatedCount: 0 },
        };
      }
    })
  );

  return { results: settled, anyActiveVendor };
}

export async function runCollection(trigger: 'schedule' | 'manual'): Promise<CollectionLogRecord> {
  const db = getDb();
  const tuyaPlugin = VENDOR_SERVER_PLUGINS.tuya;
  const startedMs = Date.now();

  if (!tuyaPlugin.isConfigured()) {
    if (!db) {
      const log = simulateDemoCollection(trigger);
      if (log.status === 'success') {
        await runPostCollectionAlerting(null, new Date()).catch(() => undefined);
      }
      return log;
    }

    await seedDefaultDataIfEmpty(db);
    const now = new Date();
    try {
      let allDevices = await db.select().from(devices);
      if (allDevices.length === 0) {
        for (const id of ['kasa', 'somfy', 'xsense'] as const) {
          const plugin = VENDOR_SERVER_PLUGINS[id];
          if (plugin.isConfigured()) await plugin.syncDevices();
        }
        allDevices = await db.select().from(devices);
      }

      const grouped = groupMonitoredDevicesByVendor(allDevices);
      const { results, anyActiveVendor } = await runSecondaryVendorsCollection({
        db,
        grouped,
        now,
        throwIfAllEmptyError: true,
      });

      const hasCollectedAnything =
        anyActiveVendor ||
        results.some((r) => r.result.updatedCount > 0 || r.result.readingsInserted > 0) ||
        SECONDARY_VENDORS.some((v) => (grouped.get(v)?.length ?? 0) > 0);

      if (hasCollectedAnything) {
        let totalDevices = 0;
        let totalReadings = 0;
        for (const v of SECONDARY_VENDORS) {
          const plugin = VENDOR_SERVER_PLUGINS[v];
          if (plugin.isVisible && !plugin.isVisible()) continue;
          totalDevices += grouped.get(v)?.length ?? 0;
        }
        for (const r of results) {
          totalReadings += r.result.readingsInserted;
        }

        const [logRow] = await db
          .insert(collectionLogs)
          .values({
            trigger,
            devicesCount: totalDevices,
            readingsInserted: totalReadings,
            status: 'success',
            errorMessage: null,
            durationMs: Date.now() - startedMs,
          })
          .returning();
        await runPostCollectionAlerting(db, now).catch(() => undefined);
        if (trigger === 'schedule') {
          await runMetricsRetention(db, now).catch(() => undefined);
        }
        return mapDbLog(logRow);
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Erreur collecte multi-écosystèmes';
      const [logRow] = await db
        .insert(collectionLogs)
        .values({
          trigger,
          devicesCount: 0,
          readingsInserted: 0,
          status: 'error',
          errorMessage: msg,
          durationMs: Date.now() - startedMs,
        })
        .returning();
      return mapDbLog(logRow);
    }

    const errMsg =
      'Aucun fournisseur configuré (TUYA_ACCESS_ID / KASA_EMAIL / SIEMENS_HOME_CONNECT / Google Home non connectés).';
    const [inserted] = await db
      .insert(collectionLogs)
      .values({
        trigger,
        devicesCount: 0,
        readingsInserted: 0,
        status: 'error',
        errorMessage: errMsg,
        durationMs: Date.now() - startedMs,
      })
      .returning();
    return mapDbLog(inserted);
  }

  if (!db) {
    const log = await collectTuyaLiveInDemoStore(trigger, startedMs);
    if (log.status === 'success') {
      await runPostCollectionAlerting(null, new Date()).catch(() => undefined);
    }
    return log;
  }

  // Mode complet : Neon Postgres + Tuya + plugins secondaires enregistrés
  try {
    await seedDefaultDataIfEmpty(db);
    let allDevices = await db.select().from(devices);
    if (allDevices.length === 0) {
      await syncTuyaDevices();
      allDevices = await db.select().from(devices);
    }

    const grouped = groupMonitoredDevicesByVendor(allDevices);
    const now = new Date();

    const tuyaRes = tuyaPlugin.collectReadings
      ? await tuyaPlugin.collectReadings({
          db,
          monitoredDevices: grouped.get('tuya') ?? [],
          now,
        })
      : { devicesCount: 0, readingsInserted: 0, updatedCount: 0 };

    const { results: secondaryResults } = await runSecondaryVendorsCollection({
      db,
      grouped,
      now,
      throwIfAllEmptyError: false,
    });

    let totalDevices = grouped.get('tuya')?.length ?? 0;
    for (const v of SECONDARY_VENDORS) {
      const plugin = VENDOR_SERVER_PLUGINS[v];
      if (plugin.isVisible && !plugin.isVisible()) continue;
      totalDevices += grouped.get(v)?.length ?? 0;
    }

    const totalReadings =
      tuyaRes.readingsInserted +
      secondaryResults.reduce((sum, r) => sum + r.result.readingsInserted, 0);

    const [logRow] = await db
      .insert(collectionLogs)
      .values({
        trigger,
        devicesCount: totalDevices,
        readingsInserted: totalReadings,
        status: 'success',
        errorMessage: null,
        durationMs: Date.now() - startedMs,
      })
      .returning();

    await runPostCollectionAlerting(db, now).catch(() => undefined);
    if (trigger === 'schedule') {
      await runMetricsRetention(db, now).catch(() => undefined);
    }
    return mapDbLog(logRow);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue lors de la collecte';
    const [logRow] = await db
      .insert(collectionLogs)
      .values({
        trigger,
        devicesCount: 0,
        readingsInserted: 0,
        status: 'error',
        errorMessage,
        durationMs: Date.now() - startedMs,
      })
      .returning();
    return mapDbLog(logRow);
  }
}
