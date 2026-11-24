import { eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '@/db';
import { alertEvents } from '@/db/schema';

const RETENTION_STATE_KEY = '__system:metrics_retention__';
const RETENTION_INTERVAL_MS = 24 * 3_600_000;

export interface RetentionConfig {
  rawRetentionDays: number;
  maxRetentionDays: number;
}

export function getRetentionConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): RetentionConfig {
  const rawDays = Number(env.METRICS_RAW_RETENTION_DAYS ?? 90);
  const rawRetentionDays =
    Number.isFinite(rawDays) && rawDays >= 7 ? Math.round(rawDays) : 90;

  const maxDays = Number(env.METRICS_DAILY_RETENTION_DAYS ?? 730);
  const maxRetentionDays =
    Number.isFinite(maxDays) && maxDays >= 0 ? Math.round(maxDays) : 730;

  return { rawRetentionDays, maxRetentionDays };
}

export function buildRetentionCutoffs(
  now: Date,
  rawRetentionDays: number,
  maxRetentionDays: number
): { rollupBefore: Date; pruneBefore: Date | null } {
  const rollupBefore = new Date(now.getTime() - rawRetentionDays * 86_400_000);
  const pruneBefore =
    maxRetentionDays > 0
      ? new Date(now.getTime() - maxRetentionDays * 86_400_000)
      : null;
  return { rollupBefore, pruneBefore };
}

/**
 * Compacte les relevés sub-horaires anciens en moyennes/sommes horaires et purge
 * les relevés dépassant la fenêtre de rétention maximale (au plus 1 fois / 24h).
 */
export async function runMetricsRetention(
  db: AppDatabase,
  now: Date = new Date()
): Promise<{
  skipped: boolean;
  rolledUpBuckets: number;
  prunedReadings: number;
  prunedLogs: number;
}> {
  const [stateRow] = await db
    .select({ lastSentAt: alertEvents.lastSentAt })
    .from(alertEvents)
    .where(eq(alertEvents.dedupKey, RETENTION_STATE_KEY));

  if (stateRow && now.getTime() - stateRow.lastSentAt.getTime() < RETENTION_INTERVAL_MS) {
    return { skipped: true, rolledUpBuckets: 0, prunedReadings: 0, prunedLogs: 0 };
  }

  const { rawRetentionDays, maxRetentionDays } = getRetentionConfigFromEnv();
  const { rollupBefore, pruneBefore } = buildRetentionCutoffs(
    now,
    rawRetentionDays,
    maxRetentionDays
  );

  // Agrège en 1 ligne horaire les buckets anciens qui ont encore plusieurs relevés (> 1)
  const rollupRes = await db.execute(sql`
    WITH target_buckets AS (
      SELECT
        device_id,
        date_trunc('hour', recorded_at) AS bucket_ts
      FROM metric_readings
      WHERE recorded_at < ${rollupBefore}
      GROUP BY device_id, date_trunc('hour', recorded_at)
      HAVING COUNT(*) > 1
      LIMIT 500
    ),
    deleted_rows AS (
      DELETE FROM metric_readings mr
      USING target_buckets tb
      WHERE mr.device_id = tb.device_id
        AND date_trunc('hour', mr.recorded_at) = tb.bucket_ts
      RETURNING
        mr.device_id,
        mr.room_id,
        tb.bucket_ts,
        mr.power_w,
        mr.voltage_v,
        mr.energy_kwh,
        mr.energy_source,
        mr.temp_c,
        mr.humidity_pct,
        mr.contact_open,
        mr.cover_state,
        mr.cover_open_pct
    ),
    inserted_rows AS (
      INSERT INTO metric_readings (
        device_id,
        room_id,
        recorded_at,
        power_w,
        voltage_v,
        energy_kwh,
        energy_source,
        temp_c,
        humidity_pct,
        contact_open,
        cover_state,
        cover_open_pct
      )
      SELECT
        device_id,
        MAX(room_id),
        bucket_ts,
        AVG(power_w)::real,
        AVG(voltage_v)::real,
        SUM(energy_kwh)::real,
        MAX(energy_source),
        AVG(temp_c)::real,
        AVG(humidity_pct)::real,
        BOOL_OR(contact_open),
        MAX(cover_state),
        AVG(cover_open_pct)::real
      FROM deleted_rows
      GROUP BY device_id, bucket_ts
      RETURNING 1
    )
    SELECT COUNT(*)::int AS cnt FROM inserted_rows
  `);

  const rollupRows = Array.isArray(rollupRes)
    ? rollupRes
    : ((rollupRes as { rows?: Array<Record<string, unknown>> }).rows ?? []);
  const rolledUpBuckets = Number(
    (rollupRows[0] as Record<string, unknown> | undefined)?.cnt ?? 0
  );

  let prunedReadings = 0;
  if (pruneBefore) {
    const pruneRes = await db.execute(sql`
      WITH del AS (
        DELETE FROM metric_readings
        WHERE recorded_at < ${pruneBefore}
        RETURNING 1
      )
      SELECT COUNT(*)::int AS cnt FROM del
    `);
    const pruneRows = Array.isArray(pruneRes)
      ? pruneRes
      : ((pruneRes as { rows?: Array<Record<string, unknown>> }).rows ?? []);
    prunedReadings = Number(
      (pruneRows[0] as Record<string, unknown> | undefined)?.cnt ?? 0
    );
  }

  const logPruneRes = await db.execute(sql`
    WITH del AS (
      DELETE FROM collection_logs
      WHERE id NOT IN (
        SELECT id FROM collection_logs ORDER BY executed_at DESC LIMIT 500
      )
      RETURNING 1
    )
    SELECT COUNT(*)::int AS cnt FROM del
  `);
  const logPruneRows = Array.isArray(logPruneRes)
    ? logPruneRes
    : ((logPruneRes as { rows?: Array<Record<string, unknown>> }).rows ?? []);
  const prunedLogs = Number(
    (logPruneRows[0] as Record<string, unknown> | undefined)?.cnt ?? 0
  );

  await db
    .insert(alertEvents)
    .values({
      dedupKey: RETENTION_STATE_KEY,
      severity: 'info',
      message: `Rollup=${rolledUpBuckets}, prunedReadings=${prunedReadings}, prunedLogs=${prunedLogs}`,
      lastSentAt: now,
    })
    .onConflictDoUpdate({
      target: alertEvents.dedupKey,
      set: {
        message: `Rollup=${rolledUpBuckets}, prunedReadings=${prunedReadings}, prunedLogs=${prunedLogs}`,
        lastSentAt: now,
      },
    });

  return { skipped: false, rolledUpBuckets, prunedReadings, prunedLogs };
}
