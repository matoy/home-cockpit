import type { AppLocale } from '@/lib/i18n/types';
import { extractDaikinSummary, isDaikinHvacDevice } from '@/lib/vendors/daikin-display';
import { extractXiaomiSummary, isXiaomiSecurityOrHomeDevice } from '@/lib/vendors/xiaomi-display';
import { extractXSenseSummary, isXSenseSecurityDevice } from '@/lib/vendors/xsense-display';
import type { ComfortStatus, DashboardPayload, DeviceCategory, VendorId } from '@/types';

export const LOW_BATTERY_THRESHOLD = 20;

export interface HomeHealthLowBatteryItem {
  id: string;
  name: string;
  roomName: string;
  roomColor: string;
  batteryPct: number;
  isOnline: boolean;
  category: DeviceCategory;
}

export interface HomeHealthOfflineItem {
  id: string;
  name: string;
  roomName: string;
  roomColor: string;
  lastSeenAt: string | null;
  primaryVendor: VendorId;
  systems: VendorId[];
  category: DeviceCategory;
  productName: string | null;
  tuyaCategory: string | null;
  ignoreOfflineAlert: boolean;
}

export interface HomeHealthExemptedItem extends HomeHealthOfflineItem {
  isOnline: boolean;
}

const BENIGN_VENDOR_NOTICE_PREFIXES = [
  'Aucune pièce/groupe Kasa remonté',
];

export function isBenignVendorNotice(message: string | null | undefined): boolean {
  const trimmed = message?.trim();
  if (!trimmed) return false;
  return BENIGN_VENDOR_NOTICE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export interface HomeHealthVendorIssue {
  vendor: VendorId;
  label: string;
  lastError: string | null;
  connected: boolean;
  lastSyncedAt: string | null;
}

export interface HomeHealthOpenWithHvacRoom {
  roomId: number;
  roomName: string;
  roomColor: string;
  openSensors: string[];
  activeHvacUnits: string[];
}

export interface HomeHealthSafetyAlert {
  id: string;
  name: string;
  roomName: string;
  roomColor: string;
  label: string;
}

export interface HomeHealthComfortAlert {
  roomId: number;
  roomName: string;
  roomColor: string;
  currentTempC: number | null;
  currentHumidityPct: number | null;
  label: string;
  tone: ComfortStatus['tone'];
}

export interface HomeHealthReport {
  status: 'healthy' | 'warning' | 'critical';
  totalIssues: number;
  lowBatteryDevices: HomeHealthLowBatteryItem[];
  offlineDevices: HomeHealthOfflineItem[];
  exemptedOfflineDevices: HomeHealthOfflineItem[];
  exemptedDevices: HomeHealthExemptedItem[];
  vendorIssues: HomeHealthVendorIssue[];
  openWithHvacRooms: HomeHealthOpenWithHvacRoom[];
  safetyAlerts: HomeHealthSafetyAlert[];
  comfortAlerts: HomeHealthComfortAlert[];
  automationWarningsCount: number;
}

/**
 * Agrège la santé globale du logement (piles faibles, appareils hors ligne,
 * erreurs connecteurs, alertes sécurité, confort climatique et anomalies croisées).
 */
export function computeHomeHealth(
  data: DashboardPayload,
  locale: AppLocale
): HomeHealthReport {
  const roomById = new Map(data.rooms.map((r) => [r.id, r]));

  const scopedDevices = data.devices.filter((d) => {
    if (data.selectedSystem !== 'all' && !d.systems.includes(data.selectedSystem)) {
      return false;
    }
    if (data.selectedRoomId !== 'all') {
      if (data.selectedRoomId === 'unassigned') {
        if (d.roomId !== null) return false;
      } else if (String(d.roomId) !== data.selectedRoomId) {
        return false;
      }
    }
    return true;
  });

  const resolveRoomMeta = (roomId: number | null) => {
    const room = roomId !== null ? roomById.get(roomId) : undefined;
    return {
      roomName: room?.name ?? '—',
      roomColor: room?.color ?? '#64748b',
    };
  };

  const lowBatteryDevices: HomeHealthLowBatteryItem[] = scopedDevices
    .filter(
      (d): d is typeof d & { lastBatteryPct: number } =>
        d.lastBatteryPct !== null &&
        Number.isFinite(d.lastBatteryPct) &&
        d.lastBatteryPct <= LOW_BATTERY_THRESHOLD
    )
    .map((d) => {
      const { roomName, roomColor } = resolveRoomMeta(d.roomId);
      return {
        id: d.id,
        name: d.customName || d.name,
        roomName,
        roomColor,
        batteryPct: Math.round(d.lastBatteryPct),
        isOnline: d.isOnline,
        category: d.category,
      };
    })
    .sort((a, b) => a.batteryPct - b.batteryPct || a.name.localeCompare(b.name));

  const sortOfflineItems = <T extends HomeHealthOfflineItem>(items: T[]): T[] =>
    items.sort((a, b) => {
      if (a.lastSeenAt && b.lastSeenAt) {
        return a.lastSeenAt.localeCompare(b.lastSeenAt);
      }
      if (a.lastSeenAt) return -1;
      if (b.lastSeenAt) return 1;
      return a.name.localeCompare(b.name);
    });

  const offlineDevices: HomeHealthOfflineItem[] = sortOfflineItems(
    scopedDevices
      .filter((d) => !d.isOnline && !d.ignoreOfflineAlert)
      .map((d) => {
        const { roomName, roomColor } = resolveRoomMeta(d.roomId);
        return {
          id: d.id,
          name: d.customName || d.name,
          roomName,
          roomColor,
          lastSeenAt: d.lastSeenAt,
          primaryVendor: d.primaryVendor,
          systems: d.systems,
          category: d.category,
          productName: d.productName,
          tuyaCategory: d.tuyaCategory,
          ignoreOfflineAlert: false,
        };
      })
  );

  const exemptedDevices: HomeHealthExemptedItem[] = sortOfflineItems(
    scopedDevices
      .filter((d) => Boolean(d.ignoreOfflineAlert))
      .map((d) => {
        const { roomName, roomColor } = resolveRoomMeta(d.roomId);
        return {
          id: d.id,
          name: d.customName || d.name,
          roomName,
          roomColor,
          lastSeenAt: d.lastSeenAt,
          primaryVendor: d.primaryVendor,
          systems: d.systems,
          category: d.category,
          productName: d.productName,
          tuyaCategory: d.tuyaCategory,
          ignoreOfflineAlert: true,
          isOnline: d.isOnline,
        };
      })
  );

  const exemptedOfflineDevices: HomeHealthOfflineItem[] = exemptedDevices.filter(
    (d) => !d.isOnline
  );

  const vendorIssues: HomeHealthVendorIssue[] = data.vendors
    .filter((v) => {
      if (v.vendor === 'google_home' && !data.env.googleHomeApiEnabled) {
        return false;
      }
      const hasRealError = Boolean(v.lastError) && !isBenignVendorNotice(v.lastError);
      const isDisconnectedLive = v.configured && !v.connected && data.env.mode === 'live';
      return hasRealError || isDisconnectedLive;
    })
    .map((v) => ({
      vendor: v.vendor,
      label: v.label,
      lastError: isBenignVendorNotice(v.lastError) ? null : v.lastError,
      connected: v.connected,
      lastSyncedAt: v.lastSyncedAt,
    }));

  // Corrélation croisée : capteur d'ouverture ouvert + unité Daikin active dans la même pièce
  const openSensorsByRoom = new Map<number, string[]>();
  for (const s of data.contacts.sensors) {
    if (s.isOpen === true && s.roomId !== null) {
      const list = openSensorsByRoom.get(s.roomId) ?? [];
      list.push(s.name);
      openSensorsByRoom.set(s.roomId, list);
    }
  }

  const activeHvacByRoom = new Map<number, string[]>();
  for (const d of scopedDevices) {
    if (d.roomId === null || !isDaikinHvacDevice(d)) continue;
    const summary = extractDaikinSummary(d.lastRawStatus, locale);
    if (summary?.isOn) {
      const list = activeHvacByRoom.get(d.roomId) ?? [];
      list.push(d.customName || d.name);
      activeHvacByRoom.set(d.roomId, list);
    }
  }

  const openWithHvacRooms: HomeHealthOpenWithHvacRoom[] = [];
  for (const [roomId, openSensors] of openSensorsByRoom.entries()) {
    const activeHvacUnits = activeHvacByRoom.get(roomId);
    if (!activeHvacUnits || activeHvacUnits.length === 0) continue;
    const { roomName, roomColor } = resolveRoomMeta(roomId);
    openWithHvacRooms.push({
      roomId,
      roomName,
      roomColor,
      openSensors,
      activeHvacUnits,
    });
  }

  const safetyAlerts: HomeHealthSafetyAlert[] = [];
  for (const d of scopedDevices) {
    if (!isXSenseSecurityDevice(d) && !isXiaomiSecurityOrHomeDevice(d)) continue;
    const xs = extractXSenseSummary(d.lastRawStatus, locale);
    const mi = extractXiaomiSummary(d.lastRawStatus, locale);
    if (xs?.isAlert || mi?.isAlert) {
      const { roomName, roomColor } = resolveRoomMeta(d.roomId);
      safetyAlerts.push({
        id: d.id,
        name: d.customName || d.name,
        roomName,
        roomColor,
        label: xs?.alarmLabel ?? mi?.alertLabel ?? 'Alert',
      });
    }
  }

  const comfortAlerts: HomeHealthComfortAlert[] = data.roomSummaries
    .filter((rs) => rs.comfort.tone !== 'emerald' && rs.comfort.tone !== 'slate')
    .map((rs) => ({
      roomId: rs.room.id,
      roomName: rs.room.name,
      roomColor: rs.room.color,
      currentTempC: rs.currentTempC,
      currentHumidityPct: rs.currentHumidityPct,
      label: rs.comfort.label,
      tone: rs.comfort.tone,
    }));

  const automationWarningsCount = data.automations.summary.warningCount;

  const totalIssues =
    lowBatteryDevices.length +
    offlineDevices.length +
    vendorIssues.length +
    openWithHvacRooms.length +
    safetyAlerts.length +
    comfortAlerts.length +
    automationWarningsCount;

  const status: HomeHealthReport['status'] =
    safetyAlerts.length > 0 || vendorIssues.length > 0
      ? 'critical'
      : totalIssues > 0
        ? 'warning'
        : 'healthy';

  return {
    status,
    totalIssues,
    lowBatteryDevices,
    offlineDevices,
    exemptedOfflineDevices,
    exemptedDevices,
    vendorIssues,
    openWithHvacRooms,
    safetyAlerts,
    comfortAlerts,
    automationWarningsCount,
  };
}
