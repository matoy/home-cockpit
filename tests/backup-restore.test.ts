import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exportBackupArchive,
  importBackupArchive,
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

  it('exports Gzip archives with selectable metric ranges and previews valid archives', async () => {
    const noMetrics = await exportBackupArchive({ metricsRange: 'none' });
    expect(noMetrics.stats.metricReadings).toBe(0);
    expect(noMetrics.stats.devices).toBeGreaterThan(0);
    expect(noMetrics.filename.endsWith('.json.gz')).toBe(true);

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

    // Rejects invalid gzip or invalid JSON schema
    await expect(previewBackupArchive(Buffer.from('corrupt-bytes'))).rejects.toThrow();
    const badJsonGz = zlib.gzipSync(Buffer.from(JSON.stringify({ format: 'wrong' }), 'utf8'));
    await expect(previewBackupArchive(badJsonGz)).rejects.toThrow();
  });
});
