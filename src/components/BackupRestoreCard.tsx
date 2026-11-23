'use client';

import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  FileArchive,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import { useI18n } from './I18nProvider';
import type {
  BackupImportMode,
  BackupImportResult,
  BackupMetricsRange,
  BackupPreviewResponse,
  BackupStats,
  DashboardPayload,
} from '@/types';

interface BackupRestoreCardProps {
  data: DashboardPayload;
  onRefresh?: () => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateLocal(iso: string | null | undefined, intlLocale: string): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(intlLocale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function parseFilenameFromHeader(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = /filename="([^"]+)"/i.exec(headerValue);
  return match?.[1] ?? null;
}

export function BackupRestoreCard({ data, onRefresh }: BackupRestoreCardProps) {
  const { t, intlLocale } = useI18n();
  const metricsRangeOptions: Array<{
    value: BackupMetricsRange;
    label: string;
    hint: string;
  }> = [
    {
      value: 'none',
      label: t('backup.rangeNoneLabel'),
      hint: t('backup.rangeNoneHint'),
    },
    {
      value: '30d',
      label: t('backup.range30dLabel'),
      hint: t('backup.range30dHint'),
    },
    {
      value: '90d',
      label: t('backup.range90dLabel'),
      hint: t('backup.range90dHint'),
    },
    {
      value: '365d',
      label: t('backup.range365dLabel'),
      hint: t('backup.range365dHint'),
    },
    {
      value: 'all',
      label: t('backup.rangeAllLabel'),
      hint: t('backup.rangeAllHint'),
    },
  ];
  // --- Export state ---
  const [exportRange, setExportRange] = useState<BackupMetricsRange>('none');
  const [exportEncryptedSessions, setExportEncryptedSessions] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<{
    filename: string;
    bytes: number;
    stats: BackupStats | null;
  } | null>(null);

  // --- Import state ---
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<BackupPreviewResponse | null>(null);
  const [importMode, setImportMode] = useState<BackupImportMode>('merge');
  const [importMetrics, setImportMetrics] = useState(true);
  const [importEncryptedSessions, setImportEncryptedSessions] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<BackupImportResult | null>(null);

  async function handleExport() {
    setExportLoading(true);
    setExportError(null);
    setExportSuccess(null);

    try {
      const params = new URLSearchParams({
        metrics: exportRange,
        includeEncryptedSessions: exportEncryptedSessions ? 'true' : 'false',
      });
      const response = await fetch(`/api/backup/export?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? t('backup.exportHttpError', { status: response.status }));
      }

      const blob = await response.blob();
      const filename =
        parseFilenameFromHeader(response.headers.get('Content-Disposition')) ??
        `home-cockpit-backup-${new Date().toISOString().slice(0, 10)}.json.gz`;

      let stats: BackupStats | null = null;
      const statsHeader = response.headers.get('X-Backup-Stats');
      if (statsHeader) {
        try {
          stats = JSON.parse(statsHeader) as BackupStats;
        } catch {
          stats = null;
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);

      setExportSuccess({
        filename,
        bytes: blob.size,
        stats,
      });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : t('backup.exportGenericError'));
    } finally {
      setExportLoading(false);
    }
  }

  function resetImportSelection() {
    setSelectedFile(null);
    setPreview(null);
    setImportError(null);
    setImportResult(null);
    setConfirmReplace(false);
    setImportMode('merge');
    setImportMetrics(true);
    setImportEncryptedSessions(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleFileSelected(file: File | null) {
    setImportError(null);
    setImportResult(null);
    setPreview(null);
    setConfirmReplace(false);
    setSelectedFile(file);

    if (!file) return;

    setPreviewLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('dryRun', 'true');

      const response = await fetch('/api/backup/import', {
        method: 'POST',
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        preview?: BackupPreviewResponse;
        error?: string;
      } | null;

      if (!response.ok || !payload?.ok || !payload.preview) {
        throw new Error(
          payload?.error ?? t('backup.invalidArchiveError', { status: response.status })
        );
      }

      setPreview(payload.preview);
      const hasMetricsOrLogs =
        payload.preview.stats.metricReadings > 0 || payload.preview.stats.collectionLogs > 0;
      setImportMetrics(hasMetricsOrLogs);
      setImportEncryptedSessions(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t('backup.previewGenericError'));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleRunImport() {
    if (!selectedFile || !preview) return;
    if (importMode === 'replace' && !confirmReplace) {
      setImportError(t('backup.confirmReplaceError'));
      return;
    }

    setImportLoading(true);
    setImportError(null);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('dryRun', 'false');
      formData.append('mode', importMode);
      formData.append('importMetrics', importMetrics ? 'true' : 'false');
      formData.append('importEncryptedSessions', importEncryptedSessions ? 'true' : 'false');

      const response = await fetch('/api/backup/import', {
        method: 'POST',
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        result?: BackupImportResult;
        error?: string;
      } | null;

      if (!response.ok || !payload?.ok || !payload.result) {
        throw new Error(payload?.error ?? t('backup.importHttpError', { status: response.status }));
      }

      setImportResult(payload.result);
      setConfirmReplace(false);
      if (onRefresh) {
        await onRefresh();
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t('backup.importGenericError'));
    } finally {
      setImportLoading(false);
    }
  }

  const hasMetricsInArchive =
    (preview?.stats.metricReadings ?? 0) > 0 || (preview?.stats.collectionLogs ?? 0) > 0;

  return (
    <section
      id="setup-backup-restore"
      className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-5 scroll-mt-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-500/15 p-2.5 text-indigo-400 shrink-0">
            <Archive className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {t('backup.title')}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {t('backup.subtitle')}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1">
            {t('backup.badgeRooms', { count: data.rooms.length })}
          </span>
          <span className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1">
            {t('backup.badgeDevices', { count: data.devices.length })}
          </span>
          <span className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1">
            {t('backup.badgeTariffs', { count: data.tariffs.length })}
          </span>
          <span className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1">
            {t('backup.badgeAutomations', { count: data.automations.rules.length })}
          </span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Colonne Export */}
        <div className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-emerald-400" />
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-200">
              {t('backup.exportSectionTitle')}
            </h4>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="backup-metrics-range"
              className="block text-xs font-medium text-slate-300"
            >
              {t('backup.archiveContentLabel')}
            </label>
            <select
              id="backup-metrics-range"
              value={exportRange}
              onChange={(e) => setExportRange(e.target.value as BackupMetricsRange)}
              className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              {metricsRangeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400">
              {metricsRangeOptions.find((opt) => opt.value === exportRange)?.hint}
            </p>
          </div>

          <label className="flex items-start gap-2.5 rounded-xl border border-slate-800/80 bg-slate-900/50 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={exportEncryptedSessions}
              onChange={(e) => setExportEncryptedSessions(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500"
            />
            <span className="text-xs text-slate-300 leading-relaxed">
              <span className="font-medium text-slate-200">
                {t('backup.includeSessionsTitle')}
              </span>
              <span className="block text-[11px] text-slate-400 mt-0.5">
                {t('backup.includeSessionsHint')}
              </span>
            </span>
          </label>

          <button
            type="button"
            onClick={handleExport}
            disabled={exportLoading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 px-4 py-2.5 text-xs font-semibold text-white transition"
          >
            {exportLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('backup.exportingBtn')}
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                {t('backup.exportBtn')}
              </>
            )}
          </button>

          {exportError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              {exportError}
            </div>
          )}

          {exportSuccess && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                {t('backup.exportSuccess', {
                  filename: exportSuccess.filename,
                  size: formatBytes(exportSuccess.bytes),
                })}
              </div>
              {exportSuccess.stats && (
                <p className="text-[11px] text-emerald-200/80">
                  {t('backup.exportStatsLine', {
                    rooms: exportSuccess.stats.rooms,
                    devices: exportSuccess.stats.devices,
                    links: exportSuccess.stats.deviceVendorLinks,
                    tariffs: exportSuccess.stats.tariffPeriods,
                    automations: exportSuccess.stats.automations,
                    metrics: exportSuccess.stats.metricReadings.toLocaleString(intlLocale),
                  })}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Colonne Import */}
        <div className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-indigo-400" />
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-200">
                {t('backup.importSectionTitle')}
              </h4>
            </div>
            {(selectedFile || preview || importResult) && (
              <button
                type="button"
                onClick={resetImportSelection}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
              >
                <RefreshCw className="h-3 w-3" />
                {t('backup.resetBtn')}
              </button>
            )}
          </div>

          <div className="space-y-2">
            <input
              ref={fileInputRef}
              id="backup-import-file"
              type="file"
              accept=".gz,.json,application/gzip,application/x-gzip,application/json"
              onChange={(e) => void handleFileSelected(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <label
              htmlFor="backup-import-file"
              className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 hover:border-indigo-400/70 bg-slate-900/50 hover:bg-slate-900/80 px-4 py-5 text-center cursor-pointer transition"
            >
              <FileArchive className="h-6 w-6 text-indigo-400" />
              {selectedFile ? (
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-white">{selectedFile.name}</div>
                  <div className="text-[11px] text-slate-400">
                    {t('backup.selectedFileSub', { size: formatBytes(selectedFile.size) })}
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  <div className="text-xs font-medium text-slate-200">
                    {t('backup.selectFileTitle')}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {t('backup.selectFileSub')}
                  </div>
                </div>
              )}
            </label>
          </div>

          {previewLoading && (
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-400 shrink-0" />
              {t('backup.analyzing')}
            </div>
          )}

          {preview && (
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                <span>
                  {t('backup.exportedAtLabel', {
                    date: formatDateLocal(preview.exportedAt, intlLocale),
                    mode:
                      preview.sourceMode === 'demo'
                        ? t('backup.sourceDemo')
                        : t('backup.sourceLive'),
                  })}
                </span>
                <span>
                  {formatBytes(preview.compressedBytes)} → {formatBytes(preview.uncompressedBytes)}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5">
                  <div className="text-slate-400">{t('backup.statRooms')}</div>
                  <div className="font-semibold text-white">{preview.stats.rooms}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5">
                  <div className="text-slate-400">{t('backup.statDevices')}</div>
                  <div className="font-semibold text-white">{preview.stats.devices}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5">
                  <div className="text-slate-400">{t('backup.statLinks')}</div>
                  <div className="font-semibold text-white">{preview.stats.deviceVendorLinks}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5">
                  <div className="text-slate-400">{t('backup.statTariffsAuto')}</div>
                  <div className="font-semibold text-white">
                    {preview.stats.tariffPeriods} / {preview.stats.automations}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5 col-span-2">
                  <div className="text-slate-400">{t('backup.statMetrics')}</div>
                  <div className="font-semibold text-white">
                    {preview.stats.metricReadings.toLocaleString(intlLocale)}
                    {preview.stats.metricsDateMin && preview.stats.metricsDateMax && (
                      <span className="block font-normal text-[10px] text-slate-400">
                        {preview.stats.metricsDateMin.slice(0, 10)} →{' '}
                        {preview.stats.metricsDateMax.slice(0, 10)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5">
                  <div className="text-slate-400">{t('backup.statVendors')}</div>
                  <div className="font-semibold text-white">{preview.stats.vendorConnections}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5">
                  <div className="text-slate-400">{t('backup.statLogs')}</div>
                  <div className="font-semibold text-white">{preview.stats.collectionLogs}</div>
                </div>
              </div>

              {preview.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-200 space-y-1">
                  {preview.warnings.map((warn, idx) => (
                    <div key={idx} className="flex items-start gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <span>{warn}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Options d'importation */}
              <div className="space-y-2 pt-1">
                <div className="text-xs font-medium text-slate-200">{t('backup.restoreModeTitle')}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label
                    className={`rounded-xl border p-2.5 text-xs cursor-pointer transition ${
                      importMode === 'merge'
                        ? 'border-indigo-500/70 bg-indigo-500/10 text-white'
                        : 'border-slate-800 bg-slate-950/60 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <input
                        type="radio"
                        name="backup-import-mode"
                        checked={importMode === 'merge'}
                        onChange={() => {
                          setImportMode('merge');
                          setConfirmReplace(false);
                        }}
                        className="text-indigo-500 focus:ring-indigo-500"
                      />
                      {t('backup.mergeTitle')}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {t('backup.mergeDesc')}
                    </p>
                  </label>

                  <label
                    className={`rounded-xl border p-2.5 text-xs cursor-pointer transition ${
                      importMode === 'replace'
                        ? 'border-rose-500/70 bg-rose-500/10 text-white'
                        : 'border-slate-800 bg-slate-950/60 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <input
                        type="radio"
                        name="backup-import-mode"
                        checked={importMode === 'replace'}
                        onChange={() => setImportMode('replace')}
                        className="text-rose-500 focus:ring-rose-500"
                      />
                      {t('backup.replaceTitle')}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {t('backup.replaceDesc')}
                    </p>
                  </label>
                </div>

                <label
                  className={`flex items-center gap-2 text-xs pt-1 ${
                    hasMetricsInArchive ? 'text-slate-200 cursor-pointer' : 'text-slate-500'
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={!hasMetricsInArchive}
                    checked={hasMetricsInArchive && importMetrics}
                    onChange={(e) => setImportMetrics(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-950 text-indigo-500"
                  />
                  <span>
                    {t('backup.importMetricsLabel', { count: preview.stats.metricReadings })}
                  </span>
                </label>

                {preview.stats.encryptedSessionsCount > 0 && (
                  <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={importEncryptedSessions}
                      onChange={(e) => setImportEncryptedSessions(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-950 text-indigo-500"
                    />
                    <span>
                      {t('backup.importSessionsLabel', {
                        count: preview.stats.encryptedSessionsCount,
                      })}
                    </span>
                  </label>
                )}

                {importMode === 'replace' && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 space-y-2">
                    <div className="flex items-start gap-2 text-[11px] text-rose-200">
                      <ShieldAlert className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>
                        {t('backup.replaceWarningPrefix', {
                          rooms: preview.currentStats.rooms,
                          devices: preview.currentStats.devices,
                          metricsClause: importMetrics
                            ? t('backup.replaceMetricsDrop', {
                                count: preview.currentStats.metricReadings.toLocaleString(intlLocale),
                              })
                            : t('backup.replaceMetricsKeep'),
                        })}
                      </span>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-rose-100 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={confirmReplace}
                        onChange={(e) => setConfirmReplace(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-rose-500/50 bg-slate-950 text-rose-500"
                      />
                      {t('backup.confirmReplaceCheck')}
                    </label>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleRunImport}
                disabled={importLoading || (importMode === 'replace' && !confirmReplace)}
                className={`w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-white transition disabled:opacity-50 ${
                  importMode === 'replace'
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : 'bg-indigo-600 hover:bg-indigo-500'
                }`}
              >
                {importLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('backup.importingBtn')}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    {importMode === 'replace'
                      ? t('backup.replaceSubmitBtn')
                      : t('backup.mergeSubmitBtn')}
                  </>
                )}
              </button>
            </div>
          )}

          {importError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              {importError}
            </div>
          )}

          {importResult && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                {importResult.message}
              </div>
              <p className="text-[11px] text-emerald-200/80">
                {t('backup.importStatsLine', {
                  rooms: importResult.imported.rooms,
                  devices: importResult.imported.devices,
                  links: importResult.imported.deviceVendorLinks,
                  tariffs: importResult.imported.tariffPeriods,
                  automations: importResult.imported.automations,
                  metrics: importResult.imported.metricReadings,
                })}
                {importResult.skippedMetricsDuplicates > 0 &&
                  t('backup.duplicatesSkipped', {
                    count: importResult.skippedMetricsDuplicates,
                  })}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
