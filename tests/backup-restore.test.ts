import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exportBackupArchive,
  importBackupArchive,
  parseAndValidateBackupBuffer,
  previewBackupArchive,
} from '@/lib/backup-service';
import { getDemoState } from '@/lib/demo-store';

describe('backup-service Gzip export, preview, and restore', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__tuyaDemoState = undefined;
    vi.stubEnv('DATABASE_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exports Gzip archives with SHA-256 integrity checksum and previews valid archives', async () => {
    const noMetrics = await exportBackupArchive({ metricsRange: 'none' });
    expect(noMetrics.stats.metricReadings).toBe(0);
    expect(noMetrics.stats.devices).toBeGreaterThan(0);
    expect(noMetrics.filename.endsWith('.json.gz')).toBe(true);
    expect(noMetrics.archive.integrity?.algorithm).toBe('sha256');
    expect(noMetrics.archive.integrity?.dataSha256).toMatch(/^[0-9a-f]{64}$/);

    const preview = await previewBackupArchive(noMetrics.buffer);
    expect(preview.format).toBe('home-cockpit-backup');
    expect(preview.stats.devices).toBe(noMetrics.stats.devices);

    const withAllMetrics = await exportBackupArchive({
      metricsRange: 'all',
      includeEncryptedSessions: true,
    });
    expect(withAllMetrics.stats.metricReadings).toBeGreaterThan(0);
    expect(withAllMetrics.compressedBytes).toBeLessThanOrEqual(withAllMetrics.uncompressedBytes);
  });

  it('rejects tampered SHA-256 archives, warns on legacy v1 & unknown vendors, and preserves demo config', async () => {
    const exported = await exportBackupArchive({ metricsRange: 'none' });
    const parsedObj = JSON.parse(zlib.gunzipSync(exported.buffer).toString('utf8')) as Record<
      string,
      unknown
    >;

    // 1. Tamper data without updating integrity checksum -> explicit integrity error
    const tamperedClone = structuredClone(parsedObj) as {
      data: { rooms: Array<{ name: string }> };
      integrity?: { algorithm: string; dataSha256: string };
    };
    tamperedClone.data.rooms[0].name = 'Tampered Room Name';
    expect(() =>
      parseAndValidateBackupBuffer(Buffer.from(JSON.stringify(tamperedClone), 'utf8'))
    ).toThrow(/SHA-256/i);

    // 2. Legacy v1 archive without integrity succeeds with informational warning
    const legacyClone = structuredClone(parsedObj) as Record<string, unknown>;
    delete legacyClone.integrity;
    const legacyParsed = parseAndValidateBackupBuffer(
      Buffer.from(JSON.stringify(legacyClone), 'utf8')
    );
    expect(legacyParsed.warnings.some((w) => w.includes('SHA-256'))).toBe(true);

    // 3. Unknown vendor in archive triggers explicit warning
    const unknownVendorClone = structuredClone(legacyClone) as {
      data: {
        vendorConnections: Array<Record<string, unknown>>;
      };
    };
    unknownVendorClone.data.vendorConnections.push({
      vendor: 'future_vendor_xyz',
      mode: 'cloud_account',
      status: 'connected',
      config: { region: 'eu' },
    });
    const unknownParsed = parseAndValidateBackupBuffer(
      Buffer.from(JSON.stringify(unknownVendorClone), 'utf8')
    );
    expect(
      unknownParsed.warnings.some((w) => w.includes('future_vendor_xyz'))
    ).toBe(true);

    // 4. Demo Mode preserves vendorConnections.config across import + export
    const configTestObj = structuredClone(legacyClone) as {
      data: {
        vendorConnections: Array<{ vendor: string; config?: Record<string, unknown> }>;
      };
    };
    const tuyaConn = configTestObj.data.vendorConnections.find((v) => v.vendor === 'tuya');
    if (tuyaConn) {
      tuyaConn.config = { customSetting: 'eu-west' };
    }
    await importBackupArchive(Buffer.from(JSON.stringify(configTestObj), 'utf8'), {
      mode: 'replace',
      importMetrics: false,
    });
    expect(getDemoState().vendorConnections.tuya.config).toEqual({ customSetting: 'eu-west' });
  });

  it('imports in merge and replace modes while deduplicating metrics and rejecting invalid buffers', async () => {
    const archiveOut = await exportBackupArchive({ metricsRange: '30d' });
    const mergeRes = await importBackupArchive(archiveOut.buffer, {
      mode: 'merge',
      importMetrics: true,
      importEncryptedSessions: false,
    });
    expect(mergeRes.mode).toBe('merge');
    expect(mergeRes.targetMode).toBe('demo');
    expect(mergeRes.skippedMetricsDuplicates).toBeGreaterThan(0);

    const stateBeforeReplace = getDemoState();
    const initialDeviceCount = stateBeforeReplace.devices.length;
    expect(initialDeviceCount).toBeGreaterThan(0);

    // Replace with importMetrics=false keeps existing readings for preserved devices and imports 0 new readings
    const replacePreserveRes = await importBackupArchive(archiveOut.buffer, {
      mode: 'replace',
      importMetrics: false,
    });
    expect(replacePreserveRes.mode).toBe('replace');
    expect(replacePreserveRes.imported.metricReadings).toBe(0);
    expect(getDemoState().readings.length).toBeGreaterThan(0);

    // Replace with importMetrics=true replaces readings with the 30d archive slice
    const replaceMetricsRes = await importBackupArchive(archiveOut.buffer, {
      mode: 'replace',
      importMetrics: true,
    });
    expect(replaceMetricsRes.imported.metricReadings).toBe(archiveOut.stats.metricReadings);
    expect(getDemoState().readings.length).toBe(archiveOut.stats.metricReadings);
    expect(archiveOut.archive.data.meterReadings?.length ?? 0).toBeGreaterThan(0);
    expect(getDemoState().meterReadings.length).toBe(
      archiveOut.archive.data.meterReadings?.length ?? 0
    );

    // Preserves tariff fiscal metadata (VAT, subscription VAT, excise) across export + import
    const exportedTariff = archiveOut.archive.data.tariffPeriods[0];
    expect(exportedTariff.vatRatePct).toBe(20);
    expect(exportedTariff.subscriptionVatRatePct).toBe(5.5);
    expect(exportedTariff.exciseRateEur).toBe(0);
    const restoredTariff = getDemoState().tariffs.find((t) => t.id === exportedTariff.id);
    expect(restoredTariff?.subscriptionVatRatePct).toBe(5.5);

    // Rejects invalid gzip or invalid JSON schema
    await expect(previewBackupArchive(Buffer.from('corrupt-bytes'))).rejects.toThrow();
    const badJsonGz = zlib.gzipSync(Buffer.from(JSON.stringify({ format: 'wrong' }), 'utf8'));
    await expect(previewBackupArchive(badJsonGz)).rejects.toThrow();
  });
});
