'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  Sliders,
  CheckCircle2,
  AlertCircle,
  X,
  Home,
  Wifi,
  WifiOff,
  Layers,
  Link2,
  Unlink,
  Search,
  ArrowRight,
  Archive,
  Plug,
} from 'lucide-react';
import { VENDOR_IDS, VENDOR_REGISTRY } from '@/lib/vendors/registry';
import { extractDaikinSummary } from '@/lib/vendors/daikin-display';
import { extractHomeConnectSummary } from '@/lib/vendors/home-connect-display';
import { extractSomfyDisplaySummary } from '@/lib/vendors/somfy-display';
import { extractXSenseSummary } from '@/lib/vendors/xsense-display';
import { extractXiaomiSummary } from '@/lib/vendors/xiaomi-display';
import type { AppLocale } from '@/lib/i18n/types';
import { normalizeSearchText } from '@/lib/utils';
import { useI18n } from './I18nProvider';
import { DeviceSystemsModal } from './devices/DeviceSystemsModal';
import { DpInspectorModal } from './devices/DpInspectorModal';
import { DuplicatesBanner } from './devices/DuplicatesBanner';
import { ManualDeviceModal } from './devices/ManualDeviceModal';
import type {
  DashboardPayload,
  DeviceCategory,
  DeviceRecord,
  DpConfig,
  EnergyMode,
  SystemFilter,
  VendorId,
} from '@/types';

interface DevicesRoomsTabProps {
  data: DashboardPayload;
  onRefresh: () => Promise<void>;
  initialRoomFilter?: string | null;
  onOpenRoomsTab?: () => void;
  onOpenSystemsTab?: () => void;
  onOpenBackupSection?: () => void;
}

function buildDeviceSearchHaystack(
  dev: DeviceRecord,
  locale: AppLocale,
  roomName?: string
): string {
  const hcSummary = extractHomeConnectSummary(dev.lastRawStatus, locale);
  const dkSummary = extractDaikinSummary(dev.lastRawStatus, locale);
  const somfySummary = extractSomfyDisplaySummary(dev, locale);
  const xsSummary = extractXSenseSummary(dev.lastRawStatus, locale);
  const miSummary = extractXiaomiSummary(dev.lastRawStatus, locale);
  const parts: Array<string | number | null | undefined> = [
    dev.id,
    dev.id.startsWith('manual_') ? 'manuel manual' : null,
    dev.name,
    dev.customName,
    dev.productName,
    dev.tuyaCategory,
    dev.category,
    dev.ipAddress,
    dev.macAddress,
    dev.macAddress ? dev.macAddress.replace(/[^a-zA-Z0-9]/g, '') : null,
    roomName ?? 'non assignée sans pièce',
    dev.systems.length > 1 ? 'multi-systèmes multi' : null,
    ...dev.systems.flatMap((s) => [s, VENDOR_REGISTRY[s].label]),
    ...(dev.vendorLinks ?? []).flatMap((l) => [l.externalId, l.externalName]),
    dev.energyMode,
    dev.energyMode === 'hybrid'
      ? 'hybride'
      : dev.energyMode === 'add_ele'
        ? 'compteur'
        : 'integration',
    dev.isOnline ? 'en ligne online' : 'hors ligne offline',
    dev.excludeFromTotals ? 'exclu cascade' : null,
    dev.isMonitored ? 'suivi' : 'non suivi ignore',
    ...Object.values(dev.dpConfig ?? {}).map((f) => f?.code),
    dev.lastPowerW !== null ? `${dev.lastPowerW}w` : null,
    dev.lastTempC !== null ? `${dev.lastTempC}°c` : null,
    dev.lastHumidityPct !== null ? `${dev.lastHumidityPct}%` : null,
    dev.lastBatteryPct !== null ? `${dev.lastBatteryPct}%` : null,
    hcSummary?.searchableText,
    dkSummary?.searchableText,
    xsSummary?.searchableText,
    miSummary?.searchableText,
    somfySummary?.protocol,
    somfySummary?.gatewayId,
    somfySummary?.cover?.kindLabel,
    somfySummary?.cover?.stateLabel,
  ];

  return normalizeSearchText(parts.filter((p) => p !== null && p !== undefined && p !== '').join(' '));
}

export function DevicesRoomsTab({
  data,
  onRefresh,
  initialRoomFilter,
  onOpenRoomsTab,
  onOpenSystemsTab,
  onOpenBackupSection,
}: DevicesRoomsTabProps) {
  const { t, locale } = useI18n();
  const showKasa = data.env.kasaConfigured;
  const showHomeConnect = data.env.homeConnectConfigured;
  const showSomfy = data.env.somfyConfigured;
  const showDaikin = data.env.daikinConfigured;
  const showXSense = data.env.xsenseConfigured || data.env.mode === 'demo';
  const showXiaomi = true;
  const showGoogleHomeApi = data.env.googleHomeApiEnabled;
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dismissedDuplicates, setDismissedDuplicates] = useState<string[]>([]);
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [bulkMergingAll, setBulkMergingAll] = useState(false);

  // Sélection et liaison multi-systèmes en masse
  const [rawSelectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [bulkVendor, setBulkVendor] = useState<VendorId>('google_home');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkFeedback, setBulkFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const lastSelectedIdRef = useRef<string | null>(null);
  const lastShiftKeyRef = useRef<boolean>(false);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);

  // Inspecteur DP & réseau local (IP / MAC)
  const [inspectDevice, setInspectDevice] = useState<DeviceRecord | null>(null);
  const [dpDraft, setDpDraft] = useState<DpConfig>({});
  const [inspectorIp, setInspectorIp] = useState('');
  const [inspectorMac, setInspectorMac] = useState('');
  const [savingDp, setSavingDp] = useState(false);

  // Modale Systèmes & Fusion
  const [manageSystemsDeviceId, setManageSystemsDeviceId] = useState<string | null>(null);
  const [mergeSourceId, setMergeSourceId] = useState<string>('');
  const [savingLink, setSavingLink] = useState(false);
  const [linkFeedback, setLinkFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Modale Déclaration / Édition appareil manuel
  const [showManualModal, setShowManualModal] = useState(false);
  const [editingManualDeviceId, setEditingManualDeviceId] = useState<string | null>(null);
  const [manualName, setManualName] = useState('');
  const [manualCustomName, setManualCustomName] = useState('');
  const [manualProductName, setManualProductName] = useState('');
  const [manualRoomId, setManualRoomId] = useState<string>('');
  const [manualCategory, setManualCategory] = useState<DeviceCategory>('other');
  const [manualSystems, setManualSystems] = useState<VendorId[]>(['google_home']);
  const [manualPrimaryVendor, setManualPrimaryVendor] = useState<VendorId>('google_home');
  const [manualIpAddress, setManualIpAddress] = useState('');
  const [manualMacAddress, setManualMacAddress] = useState('');
  const [manualIsOnline, setManualIsOnline] = useState(true);
  const [manualIsMonitored, setManualIsMonitored] = useState(true);
  const [manualExcludeFromTotals, setManualExcludeFromTotals] = useState(false);
  const [savingManualDevice, setSavingManualDevice] = useState(false);
  const [manualFeedback, setManualFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Filtres des appareils (système, pièce, recherche textuelle)
  const [systemFilter, setSystemFilter] = useState<SystemFilter | 'multi' | 'manual'>(
    data.selectedSystem ?? 'all'
  );
  const [roomFilter, setRoomFilter] = useState<string>(initialRoomFilter ?? 'all');
  const [searchQuery, setSearchQuery] = useState('');

  const [prevSelectedSystem, setPrevSelectedSystem] = useState(data.selectedSystem);
  if (data.selectedSystem !== prevSelectedSystem) {
    setPrevSelectedSystem(data.selectedSystem);
    setSystemFilter(data.selectedSystem ?? 'all');
  }

  const [prevInitialRoomFilter, setPrevInitialRoomFilter] = useState(initialRoomFilter);
  if (initialRoomFilter !== prevInitialRoomFilter) {
    setPrevInitialRoomFilter(initialRoomFilter);
    if (initialRoomFilter) {
      setRoomFilter(initialRoomFilter);
    }
  }

  function openCreateManualDeviceModal() {
    setEditingManualDeviceId(null);
    setManualName('');
    setManualCustomName('');
    setManualProductName('');
    setManualRoomId(roomFilter !== 'all' && roomFilter !== 'unassigned' ? roomFilter : '');
    setManualCategory('other');
    setManualSystems(['google_home']);
    setManualPrimaryVendor('google_home');
    setManualIpAddress('');
    setManualMacAddress('');
    setManualIsOnline(true);
    setManualIsMonitored(true);
    setManualExcludeFromTotals(false);
    setManualFeedback(null);
    setShowManualModal(true);
  }

  function openEditManualDeviceModal(dev: DeviceRecord) {
    setEditingManualDeviceId(dev.id);
    setManualName(dev.name);
    setManualCustomName(dev.customName ?? '');
    setManualProductName(dev.productName ?? '');
    setManualRoomId(dev.roomId !== null ? String(dev.roomId) : '');
    setManualCategory(dev.category);
    const nextSystems: VendorId[] = dev.systems.length > 0 ? [...dev.systems] : [dev.primaryVendor];
    setManualSystems(nextSystems);
    setManualPrimaryVendor(
      nextSystems.includes(dev.primaryVendor) ? dev.primaryVendor : nextSystems[0]
    );
    setManualIpAddress(dev.ipAddress ?? '');
    setManualMacAddress(dev.macAddress ?? '');
    setManualIsOnline(dev.isOnline);
    setManualIsMonitored(dev.isMonitored);
    setManualExcludeFromTotals(dev.excludeFromTotals);
    setManualFeedback(null);
    setShowManualModal(true);
  }

  function closeManualModal() {
    if (savingManualDevice) return;
    setShowManualModal(false);
    setEditingManualDeviceId(null);
    setManualFeedback(null);
  }

  function handleToggleManualSystem(vId: VendorId) {
    setManualSystems((prev) => {
      if (prev.includes(vId)) {
        if (prev.length === 1) return prev;
        const next = prev.filter((item) => item !== vId);
        if (manualPrimaryVendor === vId) {
          setManualPrimaryVendor(next[0]);
        }
        return next;
      }
      return [...prev, vId];
    });
  }

  async function handleSaveManualDevice(e: FormEvent) {
    e.preventDefault();
    const trimmedName = manualName.trim();
    if (!trimmedName) {
      setManualFeedback({ ok: false, text: t('devices.manualNameRequired') });
      return;
    }

    const activeSystems: VendorId[] =
      manualSystems.length > 0 ? manualSystems : [manualPrimaryVendor];
    const effectivePrimary: VendorId = activeSystems.includes(manualPrimaryVendor)
      ? manualPrimaryVendor
      : activeSystems[0];

    setSavingManualDevice(true);
    setManualFeedback(null);
    try {
      const payload = {
        ...(editingManualDeviceId ? { id: editingManualDeviceId } : {}),
        name: trimmedName,
        customName: manualCustomName.trim() || null,
        productName: manualProductName.trim() || null,
        roomId: manualRoomId ? Number(manualRoomId) : null,
        category: manualCategory,
        systems: activeSystems,
        primaryVendor: effectivePrimary,
        ipAddress: manualIpAddress.trim() || null,
        macAddress: manualMacAddress.trim() || null,
        isOnline: manualIsOnline,
        isMonitored: manualIsMonitored,
        excludeFromTotals: manualExcludeFromTotals,
      };

      const res = await fetch('/api/devices', {
        method: editingManualDeviceId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error || t('devices.manualSaveError'));
      }

      setShowManualModal(false);
      setEditingManualDeviceId(null);
      setSyncMessage({
        ok: true,
        text: editingManualDeviceId
          ? t('devices.manualUpdated', { name: trimmedName })
          : t('devices.manualCreated', { name: trimmedName }),
      });
      await onRefresh();
    } catch (err) {
      setManualFeedback({
        ok: false,
        text: err instanceof Error ? err.message : t('devices.manualSaveError'),
      });
    } finally {
      setSavingManualDevice(false);
    }
  }

  async function handleDeleteManualDevice(dev: DeviceRecord) {
    const label = dev.customName || dev.name;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(t('devices.manualDeleteConfirm', { name: label }))
    ) {
      return;
    }

    setSyncMessage(null);
    try {
      const res = await fetch(`/api/devices?id=${encodeURIComponent(dev.id)}`, {
        method: 'DELETE',
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error || t('devices.manualDeleteError'));
      }
      setSyncMessage({
        ok: true,
        text: t('devices.manualDeleted', { name: label }),
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : t('devices.manualDeleteError'),
      });
    }
  }

  const manageSystemsDevice = useMemo(
    () =>
      manageSystemsDeviceId
        ? data.devices.find((d) => d.id === manageSystemsDeviceId) ?? null
        : null,
    [data.devices, manageSystemsDeviceId]
  );

  const mergeableCandidatesForModal = useMemo(() => {
    if (!manageSystemsDevice) return [];
    return data.devices.filter((other) => {
      if (other.id === manageSystemsDevice.id) return false;
      return other.primaryVendor !== manageSystemsDevice.primaryVendor;
    });
  }, [data.devices, manageSystemsDevice]);

  const visibleDuplicateCandidates = useMemo(
    () => data.duplicateCandidates.filter((c) => !dismissedDuplicates.includes(c.sourceDeviceId)),
    [data.duplicateCandidates, dismissedDuplicates]
  );

  const { systemCounts, unassignedCount, roomDeviceCounts, filteredDevices } = useMemo(() => {
    const sysCounts: Record<'all' | VendorId | 'multi' | 'manual', number> = {
      all: data.devices.length,
      tuya: 0,
      kasa: 0,
      home_connect: 0,
      somfy: 0,
      daikin: 0,
      xsense: 0,
      xiaomi: 0,
      google_home: 0,
      multi: 0,
      manual: 0,
    };

    const roomNameById = new Map<number, string>(data.rooms.map((r) => [r.id, r.name]));
    const searchTokens = normalizeSearchText(searchQuery).trim().split(/\s+/).filter(Boolean);

    const matchesSystem = (dev: DeviceRecord): boolean => {
      if (systemFilter === 'all') return true;
      if (systemFilter === 'multi') return dev.systems.length > 1;
      if (systemFilter === 'manual') return dev.id.startsWith('manual_');
      return dev.systems.includes(systemFilter);
    };

    const matchesSearch = (dev: DeviceRecord): boolean => {
      if (searchTokens.length === 0) return true;
      const haystack = buildDeviceSearchHaystack(
        dev,
        locale,
        dev.roomId !== null ? roomNameById.get(dev.roomId) : undefined
      );
      return searchTokens.every((token) => haystack.includes(token));
    };

    const counts = new Map<number, number>();
    let unassigned = 0;

    for (const dev of data.devices) {
      if (dev.systems.includes('tuya')) sysCounts.tuya += 1;
      if (dev.systems.includes('kasa')) sysCounts.kasa += 1;
      if (dev.systems.includes('home_connect')) sysCounts.home_connect += 1;
      if (dev.systems.includes('somfy')) sysCounts.somfy += 1;
      if (dev.systems.includes('daikin')) sysCounts.daikin += 1;
      if (dev.systems.includes('xsense')) sysCounts.xsense += 1;
      if (dev.systems.includes('xiaomi')) sysCounts.xiaomi += 1;
      if (dev.systems.includes('google_home')) sysCounts.google_home += 1;
      if (dev.systems.length > 1) sysCounts.multi += 1;
      if (dev.id.startsWith('manual_')) sysCounts.manual += 1;

      if (!matchesSystem(dev) || !matchesSearch(dev)) continue;

      if (dev.roomId === null) {
        unassigned += 1;
      } else {
        counts.set(dev.roomId, (counts.get(dev.roomId) ?? 0) + 1);
      }
    }

    const filtered = data.devices.filter((dev) => {
      if (!matchesSystem(dev) || !matchesSearch(dev)) return false;
      if (roomFilter === 'all') return true;
      if (roomFilter === 'unassigned') return dev.roomId === null;
      return String(dev.roomId) === roomFilter;
    });

    return {
      systemCounts: sysCounts,
      unassignedCount: unassigned,
      roomDeviceCounts: counts,
      filteredDevices: filtered,
    };
  }, [data.devices, data.rooms, roomFilter, systemFilter, searchQuery, locale]);

  const selectedDeviceIds = useMemo(() => {
    const validIds = new Set(data.devices.map((d) => d.id));
    return rawSelectedDeviceIds.filter((id) => validIds.has(id));
  }, [rawSelectedDeviceIds, data.devices]);

  const selectedDeviceIdSet = useMemo(
    () => new Set(selectedDeviceIds),
    [selectedDeviceIds]
  );

  const filteredDeviceIds = useMemo(
    () => filteredDevices.map((d) => d.id),
    [filteredDevices]
  );

  const selectedFilteredCount = useMemo(
    () => filteredDeviceIds.filter((id) => selectedDeviceIdSet.has(id)).length,
    [filteredDeviceIds, selectedDeviceIdSet]
  );

  const allFilteredSelected =
    filteredDeviceIds.length > 0 && selectedFilteredCount === filteredDeviceIds.length;

  const someFilteredSelected =
    selectedFilteredCount > 0 && !allFilteredSelected;

  const filteredNotLinkedToBulkVendorIds = useMemo(
    () =>
      filteredDevices
        .filter((d) => !d.systems.includes(bulkVendor))
        .map((d) => d.id),
    [filteredDevices, bulkVendor]
  );

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = someFilteredSelected;
    }
  }, [someFilteredSelected]);

  const showBulkBar =
    bulkPanelOpen || selectedDeviceIds.length > 0 || bulkFeedback !== null;

  function toggleSelectDevice(deviceId: string, shiftKey = false) {
    setBulkFeedback(null);
    setSelectedDeviceIds((prev) => {
      const prevSet = new Set(prev);
      const targetChecked = !prevSet.has(deviceId);

      if (shiftKey && lastSelectedIdRef.current) {
        const startIdx = filteredDeviceIds.indexOf(lastSelectedIdRef.current);
        const endIdx = filteredDeviceIds.indexOf(deviceId);
        if (startIdx !== -1 && endIdx !== -1) {
          const low = Math.min(startIdx, endIdx);
          const high = Math.max(startIdx, endIdx);
          for (let i = low; i <= high; i++) {
            if (targetChecked) {
              prevSet.add(filteredDeviceIds[i]);
            } else {
              prevSet.delete(filteredDeviceIds[i]);
            }
          }
          return Array.from(prevSet);
        }
      }

      if (targetChecked) {
        prevSet.add(deviceId);
      } else {
        prevSet.delete(deviceId);
      }
      return Array.from(prevSet);
    });
    lastSelectedIdRef.current = deviceId;
  }

  function handleToggleSelectAllFiltered() {
    setBulkFeedback(null);
    setSelectedDeviceIds((prev) => {
      const filteredSet = new Set(filteredDeviceIds);
      if (allFilteredSelected) {
        return prev.filter((id) => !filteredSet.has(id));
      }
      return Array.from(new Set([...prev, ...filteredDeviceIds]));
    });
  }

  function handleSelectNotLinkedToBulkVendor() {
    setBulkFeedback(null);
    setBulkPanelOpen(true);
    setSelectedDeviceIds(filteredNotLinkedToBulkVendorIds);
  }

  async function handleBulkSystemAction(enabled: boolean) {
    if (selectedDeviceIds.length === 0) return;
    setBulkSaving(true);
    setBulkFeedback(null);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/devices/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_toggle_system',
          deviceIds: selectedDeviceIds,
          vendor: bulkVendor,
          enabled,
        }),
      });
      const json = (await res.json()) as {
        updatedCount?: number;
        alreadySetCount?: number;
        skippedPrimaryCount?: number;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || t('devices.bulkError'));
      }

      const updatedCount = json.updatedCount ?? 0;
      const alreadySetCount = json.alreadySetCount ?? 0;
      const skippedPrimaryCount = json.skippedPrimaryCount ?? 0;
      const hasOnlyPrimarySkip =
        updatedCount === 0 && skippedPrimaryCount > 0 && alreadySetCount === 0;
      const ok = !hasOnlyPrimarySkip;
      const text = json.message || t('devices.bulkUpdated');

      setBulkFeedback({ ok, text });
      setSyncMessage({ ok, text });
      if (updatedCount > 0) {
        await onRefresh();
        setSelectedDeviceIds([]);
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : t('devices.bulkError');
      setBulkFeedback({ ok: false, text });
      setSyncMessage({ ok: false, text });
    } finally {
      setBulkSaving(false);
    }
  }

  async function handleBulkMergeDuplicates() {
    if (visibleDuplicateCandidates.length === 0) return;
    setBulkMergingAll(true);
    setSavingLink(true);
    setLinkFeedback(null);
    setSyncMessage(null);
    try {
      const pairs = visibleDuplicateCandidates.map((c) => ({
        targetDeviceId: c.targetDeviceId,
        sourceDeviceId: c.sourceDeviceId,
      }));
      const res = await fetch('/api/devices/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_merge', pairs }),
      });
      const json = (await res.json()) as {
        mergedCount?: number;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || t('devices.bulkMergeError'));
      const ok = (json.mergedCount ?? 0) > 0;
      const text = json.message || t('devices.bulkMergeDone');
      setSyncMessage({ ok, text });
      setLinkFeedback({ ok, text });
      await onRefresh();
    } catch (err) {
      const text = err instanceof Error ? err.message : t('devices.bulkMergeError');
      setSyncMessage({ ok: false, text });
      setLinkFeedback({ ok: false, text });
    } finally {
      setBulkMergingAll(false);
      setSavingLink(false);
    }
  }

  async function handleMergeDevices(targetDeviceId: string, sourceDeviceId: string) {
    setMergingId(sourceDeviceId);
    setSavingLink(true);
    setLinkFeedback(null);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/devices/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge', targetDeviceId, sourceDeviceId }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || t('devices.mergeError'));
      setMergeSourceId('');
      setLinkFeedback({
        ok: true,
        text: t('devices.mergeDone'),
      });
      setSyncMessage({
        ok: true,
        text: t('devices.mergeSyncMsg'),
      });
      await onRefresh();
    } catch (err) {
      const text = err instanceof Error ? err.message : t('devices.mergeError');
      setLinkFeedback({ ok: false, text });
      setSyncMessage({ ok: false, text });
    } finally {
      setMergingId(null);
      setSavingLink(false);
    }
  }

  async function handleToggleSystemTag(deviceId: string, vendor: VendorId, enabled: boolean) {
    setSavingLink(true);
    setLinkFeedback(null);
    try {
      const res = await fetch('/api/devices/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_system', deviceId, vendor, enabled }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || t('devices.toggleSystemError'));
      setLinkFeedback({ ok: true, text: t('devices.toggleSystemDone') });
      await onRefresh();
    } catch (err) {
      setLinkFeedback({
        ok: false,
        text: err instanceof Error ? err.message : t('devices.toggleSystemError'),
      });
    } finally {
      setSavingLink(false);
    }
  }

  async function handleUnlinkVendor(deviceId: string, vendor: VendorId) {
    setSavingLink(true);
    setLinkFeedback(null);
    try {
      const res = await fetch(
        `/api/devices/links?deviceId=${encodeURIComponent(deviceId)}&vendor=${encodeURIComponent(vendor)}`,
        { method: 'DELETE' }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || t('devices.unlinkError'));
      setLinkFeedback({ ok: true, text: t('devices.unlinkDone') });
      await onRefresh();
    } catch (err) {
      setLinkFeedback({
        ok: false,
        text: err instanceof Error ? err.message : t('devices.unlinkError'),
      });
    } finally {
      setSavingLink(false);
    }
  }

  function openManageSystems(dev: DeviceRecord) {
    setManageSystemsDeviceId(dev.id);
    setMergeSourceId('');
    setLinkFeedback(null);
  }

  async function handleDeviceUpdate(
    deviceId: string,
    updates: Partial<{
      customName: string | null;
      roomId: number | null;
      ipAddress: string | null;
      macAddress: string | null;
      isMonitored: boolean;
      excludeFromTotals: boolean;
      energyMode: EnergyMode;
      dpConfig: DpConfig;
    }>
  ) {
    await fetch('/api/devices', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deviceId, ...updates }),
    });
    await onRefresh();
  }

  function openInspector(dev: DeviceRecord) {
    setInspectDevice(dev);
    setDpDraft(structuredClone(dev.dpConfig ?? {}));
    setInspectorIp(dev.ipAddress ?? '');
    setInspectorMac(dev.macAddress ?? '');
  }

  async function saveInspector() {
    if (!inspectDevice) return;
    setSavingDp(true);
    try {
      const updates: Parameters<typeof handleDeviceUpdate>[1] = {
        ipAddress: inspectorIp.trim() || null,
        macAddress: inspectorMac.trim() || null,
      };
      if (JSON.stringify(dpDraft) !== JSON.stringify(inspectDevice.dpConfig ?? {})) {
        updates.dpConfig = dpDraft;
      }
      await handleDeviceUpdate(inspectDevice.id, updates);
      setInspectDevice(null);
    } finally {
      setSavingDp(false);
    }
  }

  return (
    <div className="space-y-6">
      {syncMessage && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs ${syncMessage.ok
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
            }`}
        >
          {syncMessage.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{syncMessage.text}</span>
        </div>
      )}

      {/* Bannière de déduplication multi-systèmes */}
      <DuplicatesBanner
        candidates={visibleDuplicateCandidates}
        mergingId={mergingId}
        bulkMergingAll={bulkMergingAll}
        onMergeOne={(targetId, sourceId) => void handleMergeDevices(targetId, sourceId)}
        onBulkMergeAll={() => void handleBulkMergeDuplicates()}
        onDismiss={(sourceDeviceId) =>
          setDismissedDuplicates((prev) => [...prev, sourceDeviceId])
        }
      />

      {/* Liste des appareils */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">
                {t('devices.listTitle', {
                  count:
                    roomFilter !== 'all' || systemFilter !== 'all' || searchQuery.trim() !== ''
                      ? `${filteredDevices.length} / ${data.devices.length}`
                      : filteredDevices.length,
                })}
              </h3>
              <p className="text-xs text-slate-400">
                {t('devices.listSubtitle')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('devices.searchPlaceholder')}
                  aria-label={t('devices.searchAria')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-8 pr-8 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    title={t('common.clearSearch')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  if (bulkPanelOpen && selectedDeviceIds.length === 0) {
                    setBulkPanelOpen(false);
                    setBulkFeedback(null);
                  } else {
                    setBulkPanelOpen(true);
                  }
                }}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition shrink-0 ${bulkPanelOpen || selectedDeviceIds.length > 0
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
                onClick={openCreateManualDeviceModal}
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
              onClick={() => setSystemFilter('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${systemFilter === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                }`}
            >
              {t('devices.filterAll', { count: systemCounts.all })}
            </button>
            {VENDOR_IDS.filter((vId) => {
              const count = systemCounts[vId];
              if (vId === 'tuya' || systemFilter === vId) return true;
              if (vId === 'kasa') return showKasa || (data.env.mode === 'live' && count > 0);
              if (vId === 'home_connect')
                return showHomeConnect || (data.env.mode === 'live' && count > 0);
              if (vId === 'somfy')
                return showSomfy || (data.env.mode === 'live' && count > 0);
              if (vId === 'daikin')
                return showDaikin || count > 0;
              if (vId === 'xsense')
                return showXSense || count > 0;
              if (vId === 'xiaomi')
                return showXiaomi || count > 0;
              if (vId === 'google_home')
                return showGoogleHomeApi || (data.env.mode === 'live' && count > 0);
              return true;
            }).map((vId) => {
              const meta = VENDOR_REGISTRY[vId];
              const active = systemFilter === vId;
              const count = systemCounts[vId];
              return (
                <button
                  key={vId}
                  type="button"
                  onClick={() => setSystemFilter(vId)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition border ${active
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
              onClick={() => setSystemFilter('multi')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition border ${systemFilter === 'multi'
                ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200'
                : 'border-transparent bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                }`}
            >
              <Link2 className="h-3 w-3" />
              {t('devices.filterMulti', { count: systemCounts.multi })}
            </button>
            <button
              type="button"
              onClick={() => setSystemFilter('manual')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition border ${systemFilter === 'manual'
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
              onClick={() => setRoomFilter('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${roomFilter === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                }`}
            >
              {t('devices.roomFilterAll', {
                count:
                  systemCounts.all === filteredDevices.length && roomFilter === 'all'
                    ? systemCounts.all
                    : unassignedCount + Array.from(roomDeviceCounts.values()).reduce((a, b) => a + b, 0),
              })}
            </button>

            <button
              type="button"
              onClick={() => setRoomFilter('unassigned')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition border ${roomFilter === 'unassigned'
                ? 'border-amber-500 bg-amber-500/20 text-amber-200'
                : unassignedCount > 0
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                  : 'border-transparent bg-slate-800/80 text-slate-400 hover:bg-slate-800'
                }`}
            >
              {t('devices.roomFilterUnassigned', { count: unassignedCount })}
            </button>

            {data.rooms.map((r) => {
              const key = String(r.id);
              const active = roomFilter === key;
              const count = roomDeviceCounts.get(r.id) ?? 0;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRoomFilter(key)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition border ${active
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
                    onClick={() => {
                      setBulkFeedback(null);
                      setSelectedDeviceIds((prev) =>
                        Array.from(new Set([...prev, ...filteredDeviceIds]))
                      );
                    }}
                    className="rounded-lg border border-slate-700 bg-slate-900/90 hover:bg-slate-800 disabled:opacity-40 px-2.5 py-1 text-[11px] text-slate-200 transition"
                  >
                    {t('devices.bulkSelectAllVisible', { count: filteredDevices.length })}
                  </button>
                  <button
                    type="button"
                    disabled={bulkSaving || filteredNotLinkedToBulkVendorIds.length === 0}
                    onClick={handleSelectNotLinkedToBulkVendor}
                    className="rounded-lg border border-slate-700 bg-slate-900/90 hover:bg-slate-800 disabled:opacity-40 px-2.5 py-1 text-[11px] text-slate-200 transition"
                  >
                    {t('devices.bulkSelectNotLinked', {
                      vendor: VENDOR_REGISTRY[bulkVendor].label,
                      count: filteredNotLinkedToBulkVendorIds.length,
                    })}
                  </button>
                  {selectedDeviceIds.length > 0 && (
                    <button
                      type="button"
                      disabled={bulkSaving}
                      onClick={() => {
                        setSelectedDeviceIds([]);
                        setBulkFeedback(null);
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-900/90 hover:bg-slate-800 disabled:opacity-40 px-2.5 py-1 text-[11px] text-slate-300 transition"
                    >
                      {t('devices.bulkClear')}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label
                  htmlFor="bulk-vendor-select"
                  className="text-[11px] font-medium text-slate-300"
                >
                  {t('devices.bulkTargetSystem')}
                </label>
                <select
                  id="bulk-vendor-select"
                  value={bulkVendor}
                  disabled={bulkSaving}
                  onChange={(e) => {
                    setBulkVendor(e.target.value as VendorId);
                    setBulkFeedback(null);
                  }}
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
                  onClick={() => void handleBulkSystemAction(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-3 py-1.5 text-xs font-medium text-white transition"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {bulkSaving ? t('devices.bulkApplying') : t('devices.bulkLinkAction')}
                </button>

                <button
                  type="button"
                  disabled={bulkSaving || selectedDeviceIds.length === 0}
                  onClick={() => void handleBulkSystemAction(false)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-40 px-3 py-1.5 text-xs font-medium text-slate-200 transition"
                >
                  <Unlink className="h-3.5 w-3.5" />
                  {t('devices.bulkUnlinkAction')}
                </button>

                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={() => {
                    setBulkPanelOpen(false);
                    setSelectedDeviceIds([]);
                    setBulkFeedback(null);
                  }}
                  title={t('devices.bulkCloseBar')}
                  aria-label={t('devices.bulkCloseBar')}
                  className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {bulkFeedback && (
                <div
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs ${bulkFeedback.ok
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
                    onClick={() => setBulkFeedback(null)}
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

        {/* Vue Desktop sans scrollbar horizontale (table-fixed 100 %) */}
        <div className="hidden lg:block">
          <table className="w-full table-fixed text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider text-[10.5px]">
              <tr>
                <th className="w-[21%] px-2.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      ref={selectAllCheckboxRef}
                      type="checkbox"
                      checked={allFilteredSelected}
                      disabled={filteredDevices.length === 0 || bulkSaving}
                      onChange={handleToggleSelectAllFiltered}
                      aria-label={t('devices.selectAllAria')}
                      title={
                        allFilteredSelected
                          ? t('devices.deselectAllTitle')
                          : t('devices.selectAllTitle')
                      }
                      className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500 shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                    />
                    <span>{t('devices.colDeviceName')}</span>
                  </div>
                </th>
                <th className="w-[13%] px-2.5 py-2.5">{t('devices.colSystem')}</th>
                <th className="w-[12%] px-2.5 py-2.5">{t('devices.colIpMac')}</th>
                <th className="w-[13%] px-2.5 py-2.5">{t('devices.colRoom')}</th>
                <th className="w-[12%] px-2.5 py-2.5">{t('devices.colKwhMode')}</th>
                <th className="w-[11%] px-2.5 py-2.5">{t('devices.colValues')}</th>
                <th
                  className="w-[5%] px-2 py-2.5 text-center"
                  title={t('devices.colMonitoredTitle')}
                >
                  {t('devices.colMonitored')}
                </th>
                <th
                  className="w-[6%] px-2 py-2.5 text-center"
                  title={t('devices.colExcludeTitle')}
                >
                  {t('devices.colExclude')}
                </th>
                <th className="w-[7%] px-2.5 py-2.5 text-right">{t('devices.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredDevices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-xs text-slate-500">
                    <div>{t('devices.noMatchingDevices')}</div>
                    {(roomFilter !== 'all' || systemFilter !== 'all' || searchQuery.trim() !== '') && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          setRoomFilter('all');
                          setSystemFilter('all');
                        }}
                        className="mt-2.5 inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-1 text-[11px] text-slate-200 transition"
                      >
                        {t('common.resetFilters')}
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredDevices.map((dev) => {
                  const isManual = dev.id.startsWith('manual_');
                  const isSelected = selectedDeviceIdSet.has(dev.id);
                  return (
                    <tr
                      key={dev.id}
                      className={`align-top transition-colors ${isSelected
                        ? 'bg-indigo-500/10 hover:bg-indigo-500/15'
                        : 'hover:bg-slate-800/30'
                        }`}
                    >
                      <td className="px-2.5 py-2.5 min-w-0">
                        <div className="flex items-start gap-1.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={bulkSaving}
                            onClick={(e) => {
                              lastShiftKeyRef.current = e.shiftKey;
                            }}
                            onChange={() => {
                              const shift = lastShiftKeyRef.current;
                              lastShiftKeyRef.current = false;
                              toggleSelectDevice(dev.id, shift);
                            }}
                            aria-label={t('devices.selectDeviceAria', { name: dev.customName || dev.name })}
                            title={t('devices.selectDeviceTitle')}
                            className="mt-0.5 h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500 shrink-0 cursor-pointer"
                          />
                          {dev.isOnline ? (
                            <Wifi className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          ) : (
                            <WifiOff className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-medium text-white truncate" title={dev.name}>
                                {dev.name}
                              </span>
                              {isManual && (
                                <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.2 text-[9.5px] font-medium text-emerald-300">
                                  {t('devices.manualBadge')}
                                </span>
                              )}
                            </div>
                            <div
                              className="text-[10px] text-slate-500 font-mono truncate"
                              title={dev.productName || dev.tuyaCategory || dev.id}
                            >
                              {dev.productName || dev.tuyaCategory || dev.id}
                            </div>
                            <input
                              key={`name-${dev.id}-${dev.customName ?? ''}`}
                              type="text"
                              defaultValue={dev.customName ?? ''}
                              placeholder={t('devices.customNamePlaceholder')}
                              aria-label={t('devices.customNameAria', { name: dev.name })}
                              onBlur={(e) => {
                                const val = e.target.value.trim();
                                if (val !== (dev.customName ?? '')) {
                                  void handleDeviceUpdate(dev.id, { customName: val || null });
                                }
                              }}
                              className="w-full min-w-0 rounded-md border border-slate-700/80 bg-slate-950 px-2 py-1 text-[11px] text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      </td>

                      <td className="px-2.5 py-2.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-1">
                          {dev.systems.map((sys) => {
                            const meta = VENDOR_REGISTRY[sys];
                            const isPrimary = sys === dev.primaryVendor;
                            return (
                              <span
                                key={sys}
                                title={
                                  isPrimary
                                    ? t('devices.primarySourceTitle', { vendor: meta.label })
                                    : t('devices.linkedNoDupTitle', { vendor: meta.label })
                                }
                                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${meta.dotClass}`} />
                                {meta.label}
                              </span>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => openManageSystems(dev)}
                            title={t('devices.manageSystemsTitle')}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/80 hover:border-slate-500 hover:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 transition"
                          >
                            <Link2 className="h-2.5 w-2.5" />
                            {t('devices.linkBtn')}
                          </button>
                        </div>
                      </td>

                      <td className="px-2.5 py-2.5 font-mono text-[10.5px] leading-tight min-w-0">
                        {(() => {
                          const somfyNet = extractSomfyDisplaySummary(dev, locale);
                          const ipLabel = dev.ipAddress || '—';
                          const macLabel =
                            dev.macAddress ||
                            (somfyNet?.gatewayId ? `GW ${somfyNet.gatewayId}` : '—');
                          const gatewayName =
                            somfyNet?.gatewayId || t('devices.somfyGatewayLabel');
                          const ipTitle =
                            dev.ipAddress && somfyNet?.isGatewayNetwork
                              ? t('devices.somfyGatewayIpTitle', {
                                  gateway: gatewayName,
                                  ip: dev.ipAddress,
                                })
                              : somfyNet && !dev.ipAddress
                                ? t('devices.somfyIpMissingTitle')
                                : dev.primaryVendor === 'home_connect' && !dev.ipAddress
                                  ? t('devices.hcIpMissingTitle')
                                  : ipLabel;
                          const macTitle =
                            dev.macAddress && somfyNet?.isGatewayNetwork
                              ? t('devices.somfyGatewayMacTitle', {
                                  gateway: gatewayName,
                                  mac: dev.macAddress,
                                })
                              : somfyNet && !dev.macAddress
                                ? t('devices.somfyMacMissingTitle')
                                : dev.primaryVendor === 'home_connect' && !dev.macAddress
                                  ? t('devices.hcMacMissingTitle')
                                  : macLabel;
                          return (
                            <>
                              <div className="text-slate-200 truncate" title={ipTitle}>
                                {ipLabel}
                              </div>
                              <div
                                className="text-[10px] text-slate-400 mt-0.5 truncate"
                                title={macTitle}
                              >
                                {macLabel}
                              </div>
                            </>
                          );
                        })()}
                      </td>

                      <td className="px-2.5 py-2.5 min-w-0">
                        <select
                          value={dev.roomId ?? ''}
                          aria-label={t('devices.roomAria', { name: dev.name })}
                          onChange={(e) =>
                            void handleDeviceUpdate(dev.id, {
                              roomId: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                          className="w-full min-w-0 truncate rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="">{t('common.unassigned')}</option>
                          {data.rooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="px-2.5 py-2.5 min-w-0">
                        <select
                          value={dev.energyMode}
                          aria-label={t('devices.energyModeAria', { name: dev.name })}
                          onChange={(e) =>
                            void handleDeviceUpdate(dev.id, {
                              energyMode: e.target.value as EnergyMode,
                            })
                          }
                          className="w-full min-w-0 truncate rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="hybrid">{t('devices.energyHybrid')}</option>
                          <option value="add_ele">{t('devices.energyAddEle')}</option>
                          <option value="integration">{t('devices.energyIntegration')}</option>
                        </select>
                      </td>

                      <td className="px-2.5 py-2.5 font-mono text-[11px] text-slate-300 min-w-0">
                        {(() => {
                          const hcSummary = extractHomeConnectSummary(dev.lastRawStatus, locale);
                          const dkSummary = extractDaikinSummary(dev.lastRawStatus, locale);
                          const somfySummary = extractSomfyDisplaySummary(dev, locale);
                          const xsSummary = extractXSenseSummary(dev.lastRawStatus, locale);
                          const miSummary = extractXiaomiSummary(dev.lastRawStatus, locale);
                          return (
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                              {dev.lastPowerW !== null && (
                                <span className="text-indigo-300">{dev.lastPowerW} W</span>
                              )}
                              {dev.lastTempC !== null && (
                                <span className="text-emerald-300">{dev.lastTempC} °C</span>
                              )}
                              {dev.lastHumidityPct !== null && (
                                <span className="text-sky-300">{dev.lastHumidityPct} %</span>
                              )}
                              {dev.lastContactOpen !== null && (
                                <span
                                  className={
                                    dev.lastContactOpen ? 'text-amber-300' : 'text-emerald-300'
                                  }
                                >
                                  {dev.lastContactOpen ? t('common.open') : t('common.closed')}
                                </span>
                              )}
                              {somfySummary?.cover && (
                                <span
                                  title={`${somfySummary.cover.kindLabel} (${somfySummary.protocol})`}
                                  className={
                                    somfySummary.cover.state === 'closed'
                                      ? 'text-emerald-300'
                                      : somfySummary.cover.state === 'open'
                                        ? 'text-sky-300'
                                        : 'text-amber-300'
                                  }
                                >
                                  {somfySummary.compactBadge}
                                </span>
                              )}
                              {hcSummary?.operationLabel && (
                                <span
                                  title={hcSummary.activeProgram ?? undefined}
                                  className={
                                    hcSummary.operationTone === 'cyan'
                                      ? 'text-cyan-300'
                                      : hcSummary.operationTone === 'emerald'
                                        ? 'text-emerald-300'
                                        : hcSummary.operationTone === 'amber'
                                          ? 'text-amber-300'
                                          : hcSummary.operationTone === 'rose'
                                            ? 'text-rose-300'
                                            : 'text-slate-400'
                                  }
                                >
                                  {hcSummary.operationLabel}
                                  {hcSummary.progressPct !== null
                                    ? ` · ${hcSummary.progressPct}%`
                                    : ''}
                                  {hcSummary.remainingLabel
                                    ? ` · ${hcSummary.remainingLabel}`
                                    : ''}
                                </span>
                              )}
                              {hcSummary?.tempsLabel && (
                                <span className="text-sky-300">{hcSummary.tempsLabel}</span>
                              )}
                              {hcSummary?.doorOpen && (
                                <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1 py-0.2 text-[9.5px] text-amber-300">
                                  {t('common.doorOpen')}
                                </span>
                              )}
                              {dkSummary && (
                                <span
                                  title={dkSummary.compactText}
                                  className={
                                    dkSummary.modeTone === 'amber'
                                      ? 'text-amber-300'
                                      : dkSummary.modeTone === 'sky'
                                        ? 'text-sky-300'
                                        : dkSummary.modeTone === 'indigo'
                                          ? 'text-indigo-300'
                                          : 'text-slate-400'
                                  }
                                >
                                  {dkSummary.modeLabel}
                                  {dkSummary.targetTempC !== null ? ` · Cible ${dkSummary.targetTempC}°C` : ''}
                                  {dkSummary.outdoorTempC !== null ? ` · Ext ${dkSummary.outdoorTempC}°C` : ''}
                                  {dkSummary.todayKwh !== null ? ` · ${dkSummary.todayKwh.toFixed(1)} kWh/j` : ''}
                                </span>
                              )}
                              {xsSummary && (
                                <span
                                  title={xsSummary.compactText}
                                  className={
                                    xsSummary.isAlert
                                      ? 'text-rose-300 font-semibold'
                                      : xsSummary.alarmTone === 'amber'
                                        ? 'text-amber-300'
                                        : 'text-emerald-300'
                                  }
                                >
                                  {xsSummary.compactText}
                                </span>
                              )}
                              {miSummary && (
                                <span
                                  title={miSummary.compactText}
                                  className={
                                    miSummary.isAlert ? 'text-rose-300 font-semibold' : 'text-orange-300'
                                  }
                                >
                                  {miSummary.compactText}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      <td className="px-2 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={dev.isMonitored}
                          aria-label={t('devices.colMonitored') + ' ' + dev.name}
                          onChange={(e) =>
                            void handleDeviceUpdate(dev.id, { isMonitored: e.target.checked })
                          }
                          className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>

                      <td className="px-2 py-2.5 text-center">
                        <label
                          className="inline-flex flex-col items-center gap-0.5 cursor-pointer"
                          title={t('devices.colExcludeTitle')}
                        >
                          <input
                            type="checkbox"
                            checked={dev.excludeFromTotals}
                            aria-label={t('devices.colExclude') + ' ' + dev.name}
                            onChange={(e) =>
                              void handleDeviceUpdate(dev.id, {
                                excludeFromTotals: e.target.checked,
                              })
                            }
                            className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-amber-500 focus:ring-amber-500"
                          />
                          {dev.excludeFromTotals && (
                            <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1 py-0.2 text-[9.5px] leading-tight text-amber-300">
                              {t('devices.colExclude')}
                            </span>
                          )}
                        </label>
                      </td>

                      <td className="px-2.5 py-2.5 text-right">
                        {isManual ? (
                          <div className="inline-flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openEditManualDeviceModal(dev)}
                              title={t('common.edit')}
                              className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 p-1.5 text-slate-200 transition"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteManualDevice(dev)}
                              title={t('devices.deleteManualTitle')}
                              className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300 p-1.5 text-slate-300 transition"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openInspector(dev)}
                            title={t('devices.dpInspectorBtn')}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2 py-1 text-[11px] text-slate-200 transition"
                          >
                            <Sliders className="h-3 w-3" />
                            {t('devices.dpBtnShort')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Vue Mobile / Tablette (< 1024px) empilée sans scrollbar */}
        <div className="lg:hidden divide-y divide-slate-800/80">
          {filteredDevices.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500">
              <div>{t('devices.noMatchingDevices')}</div>
              {(roomFilter !== 'all' || systemFilter !== 'all' || searchQuery.trim() !== '') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setRoomFilter('all');
                    setSystemFilter('all');
                  }}
                  className="mt-2.5 inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-1 text-[11px] text-slate-200 transition"
                >
                  {t('common.resetFilters')}
                </button>
              )}
            </div>
          ) : (
            filteredDevices.map((dev) => {
              const isManual = dev.id.startsWith('manual_');
              const isSelected = selectedDeviceIdSet.has(dev.id);
              return (
                <div
                  key={dev.id}
                  className={`p-4 space-y-3 text-xs transition-colors ${isSelected ? 'bg-indigo-500/10' : ''
                    }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={bulkSaving}
                        onClick={(e) => {
                          lastShiftKeyRef.current = e.shiftKey;
                        }}
                        onChange={() => {
                          const shift = lastShiftKeyRef.current;
                          lastShiftKeyRef.current = false;
                          toggleSelectDevice(dev.id, shift);
                        }}
                        aria-label={t('devices.selectDeviceAria', { name: dev.customName || dev.name })}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500 shrink-0 cursor-pointer"
                      />
                      {dev.isOnline ? (
                        <Wifi className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <WifiOff className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-medium text-white truncate">{dev.name}</span>
                          {isManual && (
                            <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.2 text-[9.5px] font-medium text-emerald-300">
                              {t('devices.manualBadge')}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono truncate">
                          {dev.productName || dev.tuyaCategory || dev.id}
                        </div>
                      </div>
                    </div>

                    {isManual ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditManualDeviceModal(dev)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] text-slate-200"
                        >
                          <Pencil className="h-3 w-3" />
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteManualDevice(dev)}
                          title={t('devices.deleteManualTitle')}
                          className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300 p-1.5 text-slate-300"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openInspector(dev)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] text-slate-200 shrink-0"
                      >
                        <Sliders className="h-3 w-3" />
                        {t('devices.dpInspectorBtn')}
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {dev.systems.map((sys) => {
                      const meta = VENDOR_REGISTRY[sys];
                      return (
                        <span
                          key={sys}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                          {meta.label}
                        </span>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => openManageSystems(dev)}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300"
                    >
                      <Link2 className="h-2.5 w-2.5" />
                      {t('devices.linkBtn')}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">{t('devices.customNameLabel')}</label>
                      <input
                        key={`mob-name-${dev.id}-${dev.customName ?? ''}`}
                        type="text"
                        defaultValue={dev.customName ?? ''}
                        placeholder={dev.name}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          if (val !== (dev.customName ?? '')) {
                            void handleDeviceUpdate(dev.id, { customName: val || null });
                          }
                        }}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">{t('devices.colIpMac')}</label>
                      {(() => {
                        const somfyNet = extractSomfyDisplaySummary(dev, locale);
                        const ipLabel = dev.ipAddress || '—';
                        const macLabel =
                          dev.macAddress ||
                          (somfyNet?.gatewayId ? `GW ${somfyNet.gatewayId}` : '—');
                        return (
                          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 font-mono text-[11px] text-slate-300 truncate">
                            {ipLabel} · {macLabel}
                          </div>
                        );
                      })()}
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">{t('devices.colRoom')}</label>
                      <select
                        value={dev.roomId ?? ''}
                        onChange={(e) =>
                          void handleDeviceUpdate(dev.id, {
                            roomId: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="">{t('common.unassigned')}</option>
                        {data.rooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">{t('devices.colKwhMode')}</label>
                      <select
                        value={dev.energyMode}
                        onChange={(e) =>
                          void handleDeviceUpdate(dev.id, {
                            energyMode: e.target.value as EnergyMode,
                          })
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="hybrid">{t('devices.energyHybrid')}</option>
                        <option value="add_ele">{t('devices.energyAddEle')}</option>
                        <option value="integration">{t('devices.energyIntegration')}</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    {(() => {
                      const hcSummary = extractHomeConnectSummary(dev.lastRawStatus, locale);
                      const dkSummary = extractDaikinSummary(dev.lastRawStatus, locale);
                      const somfySummary = extractSomfyDisplaySummary(dev, locale);
                      const xsSummary = extractXSenseSummary(dev.lastRawStatus, locale);
                      const miSummary = extractXiaomiSummary(dev.lastRawStatus, locale);
                      return (
                        <div className="flex flex-wrap gap-2 font-mono text-[11px] text-slate-300">
                          {somfySummary?.cover && (
                            <span
                              title={`${somfySummary.cover.kindLabel} (${somfySummary.protocol})`}
                              className={
                                somfySummary.cover.state === 'closed'
                                  ? 'text-emerald-300'
                                  : somfySummary.cover.state === 'open'
                                    ? 'text-sky-300'
                                    : 'text-amber-300'
                              }
                            >
                              {somfySummary.compactBadge}
                            </span>
                          )}
                          {dev.lastPowerW !== null && (
                            <span className="text-indigo-300">{dev.lastPowerW} W</span>
                          )}
                          {dev.lastTempC !== null && (
                            <span className="text-emerald-300">{dev.lastTempC} °C</span>
                          )}
                          {dev.lastHumidityPct !== null && (
                            <span className="text-sky-300">{dev.lastHumidityPct} %</span>
                          )}
                          {dev.lastContactOpen !== null && (
                            <span className={dev.lastContactOpen ? 'text-amber-300' : 'text-emerald-300'}>
                              {dev.lastContactOpen ? t('common.open') : t('common.closed')}
                            </span>
                          )}
                          {hcSummary?.operationLabel && (
                            <span
                              title={hcSummary.activeProgram ?? undefined}
                              className={
                                hcSummary.operationTone === 'cyan'
                                  ? 'text-cyan-300'
                                  : hcSummary.operationTone === 'emerald'
                                    ? 'text-emerald-300'
                                    : hcSummary.operationTone === 'amber'
                                      ? 'text-amber-300'
                                      : hcSummary.operationTone === 'rose'
                                        ? 'text-rose-300'
                                        : 'text-slate-400'
                              }
                            >
                              {hcSummary.operationLabel}
                              {hcSummary.progressPct !== null ? ` · ${hcSummary.progressPct}%` : ''}
                              {hcSummary.remainingLabel ? ` · ${hcSummary.remainingLabel}` : ''}
                            </span>
                          )}
                          {hcSummary?.tempsLabel && (
                            <span className="text-sky-300">{hcSummary.tempsLabel}</span>
                          )}
                          {hcSummary?.doorOpen && (
                            <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-300">
                              {t('common.doorOpen')}
                            </span>
                          )}
                          {dkSummary && (
                            <span
                              title={dkSummary.compactText}
                              className={
                                dkSummary.modeTone === 'amber'
                                  ? 'text-amber-300'
                                  : dkSummary.modeTone === 'sky'
                                    ? 'text-sky-300'
                                    : dkSummary.modeTone === 'indigo'
                                      ? 'text-indigo-300'
                                      : 'text-slate-400'
                              }
                            >
                              {dkSummary.compactText}
                            </span>
                          )}
                          {xsSummary && (
                            <span
                              title={xsSummary.compactText}
                              className={
                                xsSummary.isAlert
                                  ? 'text-rose-300 font-semibold'
                                  : xsSummary.alarmTone === 'amber'
                                    ? 'text-amber-300'
                                    : 'text-emerald-300'
                              }
                            >
                              {xsSummary.compactText}
                            </span>
                          )}
                          {miSummary && (
                            <span
                              title={miSummary.compactText}
                              className={
                                miSummary.isAlert ? 'text-rose-300 font-semibold' : 'text-orange-300'
                              }
                            >
                              {miSummary.compactText}
                            </span>
                          )}
                        </div>
                      );
                    })()}

                    <div className="flex items-center gap-4 text-[11px] text-slate-300">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={dev.isMonitored}
                          onChange={(e) =>
                            void handleDeviceUpdate(dev.id, { isMonitored: e.target.checked })
                          }
                          className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-600"
                        />
                        {t('devices.colMonitored')}
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={dev.excludeFromTotals}
                          onChange={(e) =>
                            void handleDeviceUpdate(dev.id, {
                              excludeFromTotals: e.target.checked,
                            })
                          }
                          className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-amber-500"
                        />
                        {t('devices.colExclude')}
                      </label>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modale Inspecteur DP */}
      {inspectDevice && (
        <DpInspectorModal
          device={inspectDevice}
          inspectorIp={inspectorIp}
          inspectorMac={inspectorMac}
          dpDraft={dpDraft}
          savingDp={savingDp}
          onChangeIp={setInspectorIp}
          onChangeMac={setInspectorMac}
          onChangeDpDraft={setDpDraft}
          onClose={() => setInspectDevice(null)}
          onSave={saveInspector}
        />
      )}

      {/* Modale Systèmes & Fusion (Multi-Vendors sans doublon) */}
      {manageSystemsDevice && (
        <DeviceSystemsModal
          device={manageSystemsDevice}
          rooms={data.rooms}
          mergeableCandidates={mergeableCandidatesForModal}
          mergeSourceId={mergeSourceId}
          savingLink={savingLink}
          linkFeedback={linkFeedback}
          onChangeMergeSourceId={setMergeSourceId}
          onToggleSystemTag={(deviceId, vendor, enabled) =>
            void handleToggleSystemTag(deviceId, vendor, enabled)
          }
          onMergeDevices={(targetId, sourceId) =>
            void handleMergeDevices(targetId, sourceId)
          }
          onUnlinkVendor={(deviceId, vendor) =>
            void handleUnlinkVendor(deviceId, vendor)
          }
          onClose={() => setManageSystemsDeviceId(null)}
        />
      )}

      {/* Modale Déclaration / Édition appareil manuel */}
      {showManualModal && (
        <ManualDeviceModal
          editingDeviceId={editingManualDeviceId}
          rooms={data.rooms}
          name={manualName}
          customName={manualCustomName}
          productName={manualProductName}
          roomId={manualRoomId}
          category={manualCategory}
          ipAddress={manualIpAddress}
          macAddress={manualMacAddress}
          systems={manualSystems}
          primaryVendor={manualPrimaryVendor}
          isOnline={manualIsOnline}
          isMonitored={manualIsMonitored}
          excludeFromTotals={manualExcludeFromTotals}
          saving={savingManualDevice}
          feedback={manualFeedback}
          onChangeName={setManualName}
          onChangeCustomName={setManualCustomName}
          onChangeProductName={setManualProductName}
          onChangeRoomId={setManualRoomId}
          onChangeCategory={setManualCategory}
          onChangeIpAddress={setManualIpAddress}
          onChangeMacAddress={setManualMacAddress}
          onToggleSystem={handleToggleManualSystem}
          onChangePrimaryVendor={setManualPrimaryVendor}
          onChangeIsOnline={setManualIsOnline}
          onChangeIsMonitored={setManualIsMonitored}
          onChangeExcludeFromTotals={setManualExcludeFromTotals}
          onClose={closeManualModal}
          onSubmit={handleSaveManualDevice}
        />
      )}
    </div>
  );
}
