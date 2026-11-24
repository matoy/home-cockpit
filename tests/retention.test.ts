import { describe, expect, it } from 'vitest';
import {
  buildRetentionCutoffs,
  getRetentionConfigFromEnv,
} from '@/lib/services/retention-service';

describe('metrics retention helpers', () => {
  it('parses retention env defaults and bounds', () => {
    expect(getRetentionConfigFromEnv({})).toEqual({
      rawRetentionDays: 90,
      maxRetentionDays: 730,
    });

    expect(
      getRetentionConfigFromEnv({
        METRICS_RAW_RETENTION_DAYS: '3',
        METRICS_DAILY_RETENTION_DAYS: '0',
      })
    ).toEqual({
      rawRetentionDays: 90,
      maxRetentionDays: 0,
    });

    expect(
      getRetentionConfigFromEnv({
        METRICS_RAW_RETENTION_DAYS: '60',
        METRICS_DAILY_RETENTION_DAYS: '365',
      })
    ).toEqual({
      rawRetentionDays: 60,
      maxRetentionDays: 365,
    });
  });

  it('computes exact rollup and prune cutoffs', () => {
    const now = new Date('2026-11-24T12:00:00.000Z');
    const cutoffs = buildRetentionCutoffs(now, 30, 365);
    expect(cutoffs.rollupBefore.toISOString()).toBe('2026-10-25T12:00:00.000Z');
    expect(cutoffs.pruneBefore?.toISOString()).toBe('2025-11-24T12:00:00.000Z');

    const noPrune = buildRetentionCutoffs(now, 90, 0);
    expect(noPrune.pruneBefore).toBeNull();
  });
});
