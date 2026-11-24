import { NextResponse } from 'next/server';
import { importBackupArchive, previewBackupArchive } from '@/lib/backup-service';
import { requireApiAuth } from '@/lib/http-utils';
import type { BackupImportMode } from '@/types';

const MAX_UPLOAD_BYTES = 35 * 1024 * 1024; // 35 Mo compressés

export async function POST(request: Request) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const formData = await request.formData();
    const fileEntry = formData.get('file');
    if (!(fileEntry instanceof File) || fileEntry.size === 0) {
      return NextResponse.json(
        { error: 'Veuillez sélectionner un fichier de sauvegarde (.json.gz ou .json).' },
        { status: 400 }
      );
    }

    if (fileEntry.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: 'L’archive dépasse la taille maximale autorisée (35 Mo compressés).' },
        { status: 400 }
      );
    }

    const rawBuffer = Buffer.from(await fileEntry.arrayBuffer());
    const dryRun = String(formData.get('dryRun') ?? 'false') === 'true';

    if (dryRun) {
      const preview = await previewBackupArchive(rawBuffer);
      return NextResponse.json({ ok: true, preview });
    }

    const rawMode = String(formData.get('mode') ?? 'merge');
    const mode: BackupImportMode = rawMode === 'replace' ? 'replace' : 'merge';
    const importMetrics = String(formData.get('importMetrics') ?? 'true') === 'true';
    const importEncryptedSessions =
      String(formData.get('importEncryptedSessions') ?? 'false') === 'true';

    const result = await importBackupArchive(rawBuffer, {
      mode,
      importMetrics,
      importEncryptedSessions,
    });

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Échec lors de l’importation de la sauvegarde.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
