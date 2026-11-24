'use client';

import {
  AlertCircle,
  Archive,
  ArrowRight,
  CheckCircle2,
  Home,
  Layers,
  Link2,
  Pencil,
  Plug,
  Plus,
  Search,
  Unlink,
  X,
} from 'lucide-react';
import { VENDOR_IDS, VENDOR_REGISTRY } from '@/lib/vendors/registry';
import { useI18n } from '@/components/I18nProvider';
import type { DeviceRecord, RoomRecord, VendorId } from '@/types';

type DeviceSystemFilter = 'all' | VendorId | 'multi' | 'manual';

interface DevicesFilterBarProps {
  filteredCount: number;
  totalCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  roomFilter: string;
  onRoomFilterChange: (roomId: string) => void;
  systemFilter: DeviceSystemFilter;
  onSystemFilterChange: (sys: DeviceSystemFilter) => void;
  systemCounts: Record<DeviceSystemFilter, number>;
  rooms: RoomRecord[];
  roomDeviceCounts: Map<number, number>;
  unassignedCount: number;
  envMode: 'live' | 'demo';
  showKasa: boolean;
  showHomeConnect: boolean;
  showSomfy: boolean;
  showDaikin: boolean;
  showXSense: boolean;
  showXiaomi: boolean;
  showGoogleHomeApi: boolean;
  bulkPanelOpen: boolean;
  onToggleBulkPanel: () => void;
  selectedDeviceIds: string[];
  onClearSelected: () => void;
  onSelectAllVisible: () => void;
  filteredDevices: DeviceRecord[];
  selectedFilteredCount: number;
  bulkVendor: VendorId;
  onBulkVendorChange: (v: VendorId) => void;
  bulkSaving: boolean;
  filteredNotLinkedCount: number;
  onSelectNotLinked: () => void;
  onBulkSystemAction: (link: boolean) => void;
  onCloseBulkBar: () => void;
  bulkFeedback: { ok: boolean; text: string } | null;
  onClearBulkFeedback: () => void;
  showBulkBar: boolean;
  onOpenSystemsTab?: () => void;
  onOpenBackupSection?: () => void;
  onOpenRoomsTab?: () => void;
  onCreateManualDevice: () => void;
}

export function DevicesFilterBar({
  filteredCount,
  totalCount,
  searchQuery,
  onSearchChange,
  roomFilter,
  onRoomFilterChange,
  systemFilter,
  onSystemFilterChange,
  systemCounts,
  rooms,
  roomDeviceCounts,
  unassignedCount,
  envMode,
  showKasa,
  showHomeConnect,
  showSomfy,
  showDaikin,
  showXSense,
  showXiaomi,
  showGoogleHomeApi,
  bulkPanelOpen,
  onToggleBulkPanel,
  selectedDeviceIds,
  onClearSelected,
  onSelectAllVisible,
  filteredDevices,
  selectedFilteredCount,
  bulkVendor,
  onBulkVendorChange,
  bulkSaving,
  filteredNotLinkedCount,
  onSelectNotLinked,
  onBulkSystemAction,
  onCloseBulkBar,
  bulkFeedback,
  onClearBulkFeedback,
  showBulkBar,
  onOpenSystemsTab,
  onOpenBackupSection,
  onOpenRoomsTab,
  onCreateManualDevice,
}: DevicesFilterBarProps) {
  const { t } = useI18n();

  return (
    <div className="px-5 py-4 border-b border-slate-800 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            {t('devices.listTitle', {
              count:
                roomFilter !== 'all' || systemFilter !== 'all' || searchQuery.trim() !== ''
                  ? `${filteredCount} / ${totalCount}`
                  : filteredCount,
            })}
          </h3>
          <p className="text-xs text-slate-400">{t('devices.listSubtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('devices.searchPlaceholder')}
              aria-label={t('devices.searchAria')}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-8 pr-8 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                title={t('common.clearSearch')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onToggleBulkPanel}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition shrink-0 ${
              bulkPanelOpen || selectedDeviceIds.length > 0
                ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/30'
                : 'border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Link2 className="h-3.5 w-3.5" />
            {t('devices.bulkLinkBtn')}
            {selectedDeviceIds.length > 0 && (
              <span className="rounded-full bg-indigo-500 px-1.5 py-0.2 text-[10px] font-semibold text-white">
                {selectedDeviceIds.length}
              </span>
            )}
          </button>

          {onOpenSystemsTab && (
            <button
              type="button"
              onClick={onOpenSystemsTab}
              title={t('devices.systemsShortcutTitle')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition shrink-0"
            >
              <Plug className="h-3.5 w-3.5 text-indigo-400" />
              {t('devices.systemsShortcutBtn')}
            </button>
          )}

          {onOpenBackupSection && (
            <button
              type="button"
              onClick={onOpenBackupSection}
              title={t('devices.exportImportTitle')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition shrink-0"
            >
              <Archive className="h-3.5 w-3.5 text-indigo-400" />
              {t('devices.exportImportBtn')}
            </button>
          )}

          <button
            type="button"
            onClick={onCreateManualDevice}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('devices.declareManualBtn')}
          </button>
        </div>
      </div>

      {/* Barre de filtres par système (Vendor) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 mr-1">
          <Layers className="h-3.5 w-3.5 text-slate-500" />
          {t('devices.systemFilterLabel')}
        </span>
        <button
          type="button"
          onClick={() => onSystemFilterChange('all')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            systemFilter === 'all'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
          }`}
        >
          {t('devices.filterAll', { count: systemCounts.all })}
        </button>
        {VENDOR_IDS.filter((vId) => {
          const count = systemCounts[vId];
          if (vId === 'tuya' || systemFilter === vId) return true;
          if (vId === 'kasa') return showKasa || (envMode === 'live' && count > 0);
          if (vId === 'home_connect')
            return showHomeConnect || (envMode === 'live' && count > 0);
          if (vId === 'somfy') return showSomfy || (envMode === 'live' && count > 0);
          if (vId === 'daikin') return showDaikin || count > 0;
          if (vId === 'xsense') return showXSense || count > 0;
          if (vId === 'xiaomi') return showXiaomi || count > 0;
          if (vId === 'google_home')
            return showGoogleHomeApi || (envMode === 'live' && count > 0);
          return true;
        }).map((vId) => {
          const meta = VENDOR_REGISTRY[vId];
          const active = systemFilter === vId;
          const count = systemCounts[vId];
          return (
            <button
              key={vId}
              type="button"
              onClick={() => onSystemFilterChange(vId)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition border ${
                active
                  ? meta.badgeClass
                  : 'border-transparent bg-slate-800/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span className={`h-2 w-2 rounded-full shrink-0 ${meta.dotClass}`} />
              {meta.label} ({count})
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onSystemFilterChange('multi')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition border ${
            systemFilter === 'multi'
              ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200'
              : 'border-transparent bg-slate-800/80 text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Link2 className="h-3 w-3" />
          {t('devices.filterMulti', { count: systemCounts.multi })}
        </button>
        <button
          type="button"
          onClick={() => onSystemFilterChange('manual')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition border ${
            systemFilter === 'manual'
              ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200'
              : 'border-transparent bg-slate-800/80 text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Pencil className="h-3 w-3" />
          {t('devices.filterManual', { count: systemCounts.manual })}
        </button>
      </div>

      {/* Barre de filtres par pièce */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 mr-1">
          <Home className="h-3.5 w-3.5 text-slate-500" />
          {t('devices.roomFilterLabel')}
        </span>
        <button
          type="button"
          onClick={() => onRoomFilterChange('all')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            roomFilter === 'all'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
          }`}
        >
          {t('devices.roomFilterAll', {
            count:
              systemCounts.all === filteredCount && roomFilter === 'all'
                ? systemCounts.all
                : unassignedCount +
                  Array.from(roomDeviceCounts.values()).reduce((a, b) => a + b, 0),
          })}
        </button>

        <button
          type="button"
          onClick={() => onRoomFilterChange('unassigned')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition border ${
            roomFilter === 'unassigned'
              ? 'border-amber-500 bg-amber-500/20 text-amber-200'
              : unassignedCount > 0
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                : 'border-transparent bg-slate-800/80 text-slate-400 hover:bg-slate-800'
          }`}
        >
          {t('devices.roomFilterUnassigned', { count: unassignedCount })}
        </button>

        {rooms.map((r) => {
          const key = String(r.id);
          const active = roomFilter === key;
          const count = roomDeviceCounts.get(r.id) ?? 0;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onRoomFilterChange(key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition border ${
                active
                  ? 'border-indigo-500 bg-indigo-600/25 text-white'
                  : 'border-transparent bg-slate-800/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: r.color }}
              />
              {r.name} ({count})
            </button>
          );
        })}

        {onOpenRoomsTab && (
          <button
            type="button"
            onClick={onOpenRoomsTab}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition"
          >
            {t('devices.manageRoomsBtn')}
            <ArrowRight className="h-3 w-3 text-indigo-400" />
          </button>
        )}
      </div>

      {showBulkBar && (
        <div className="rounded-xl border border-indigo-500/35 bg-indigo-500/10 p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-indigo-200">
                <Link2 className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                {t('devices.bulkBarTitle')}
              </span>
              <span className="rounded-full bg-indigo-500/25 px-2 py-0.5 text-[11px] font-medium text-indigo-100">
                {t('devices.bulkSelectedCount', { count: selectedDeviceIds.length })}
              </span>
              {selectedDeviceIds.length > selectedFilteredCount && (
                <span className="text-[11px] text-amber-300/90">
                  {t('devices.bulkOutsideFilter', {
                    count: selectedDeviceIds.length - selectedFilteredCount,
                  })}
                </span>
              )}
              <span className="text-[11px] text-slate-400 hidden sm:inline">
                {t('devices.bulkShiftHint')}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={bulkSaving || filteredDevices.length === 0}
                onClick={onSelectAllVisible}
                className="rounded-lg border border-slate-700 bg-slate-900/90 hover:bg-slate-800 disabled:opacity-40 px-2.5 py-1 text-[11px] text-slate-200 transition"
              >
                {t('devices.bulkSelectAllVisible', { count: filteredDevices.length })}
              </button>
              <button
                type="button"
                disabled={bulkSaving || filteredNotLinkedCount === 0}
                onClick={onSelectNotLinked}
                className="rounded-lg border border-slate-700 bg-slate-900/90 hover:bg-slate-800 disabled:opacity-40 px-2.5 py-1 text-[11px] text-slate-200 transition"
              >
                {t('devices.bulkSelectNotLinked', {
                  vendor: VENDOR_REGISTRY[bulkVendor].label,
                  count: filteredNotLinkedCount,
                })}
              </button>
              {selectedDeviceIds.length > 0 && (
                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={onClearSelected}
                  className="rounded-lg border border-slate-700 bg-slate-900/90 hover:bg-slate-800 disabled:opacity-40 px-2.5 py-1 text-[11px] text-slate-300 transition"
                >
                  {t('devices.bulkClear')}
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="bulk-vendor-select" className="text-[11px] font-medium text-slate-300">
              {t('devices.bulkTargetSystem')}
            </label>
            <select
              id="bulk-vendor-select"
              value={bulkVendor}
              disabled={bulkSaving}
              onChange={(e) => onBulkVendorChange(e.target.value as VendorId)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              {VENDOR_IDS.map((vId) => (
                <option key={vId} value={vId}>
                  {VENDOR_REGISTRY[vId].label}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={bulkSaving || selectedDeviceIds.length === 0}
              onClick={() => onBulkSystemAction(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-3 py-1.5 text-xs font-medium text-white transition"
            >
              <Link2 className="h-3.5 w-3.5" />
              {bulkSaving ? t('devices.bulkApplying') : t('devices.bulkLinkAction')}
            </button>

            <button
              type="button"
              disabled={bulkSaving || selectedDeviceIds.length === 0}
              onClick={() => onBulkSystemAction(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-40 px-3 py-1.5 text-xs font-medium text-slate-200 transition"
            >
              <Unlink className="h-3.5 w-3.5" />
              {t('devices.bulkUnlinkAction')}
            </button>

            <button
              type="button"
              disabled={bulkSaving}
              onClick={onCloseBulkBar}
              title={t('devices.bulkCloseBar')}
              aria-label={t('devices.bulkCloseBar')}
              className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {bulkFeedback && (
            <div
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                bulkFeedback.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
              }`}
            >
              <div className="flex items-center gap-2">
                {bulkFeedback.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                )}
                <span>{bulkFeedback.text}</span>
              </div>
              <button
                type="button"
                onClick={onClearBulkFeedback}
                aria-label={t('devices.closeMessage')}
                className="rounded p-0.5 opacity-70 hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
