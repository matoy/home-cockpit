import { NextResponse } from 'next/server';
import { exportBackupArchive } from '@/lib/backup-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';
import type { BackupMetricsRange } from '@/types';

const VALID_RANGES: ReadonlySet<BackupMetricsRange> = new Set([
  'none',
  '30d',
  '90d',
  '365d',
  'all',
]);

export async function GET(request: Request) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const rawRange = (searchParams.get('metrics') ?? 'none').trim() as BackupMetricsRange;
    const metricsRange: BackupMetricsRange = VALID_RANGES.has(rawRange) ? rawRange : 'none';
    const includeEncryptedSessions = searchParams.get('includeEncryptedSessions') === 'true';

    const result = await exportBackupArchive({
      metricsRange,
      includeEncryptedSessions,
    });

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Content-Length': String(result.compressedBytes),
        'X-Backup-Stats': JSON.stringify(result.stats),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return apiErrorResponse(
      'api/backup/export',
      err,
      'Échec lors de la génération de la sauvegarde.'
    );
  }
}
