import type { DeviceRecord } from '@/types';
import { extractCoverSummary, type CoverSummary } from '@/lib/covers-utils';

export interface SomfyDisplaySummary {
  protocol: string;
  uiClass: string;
  gatewayId: string | null;
  isGatewayNetwork: boolean;
  cover: CoverSummary | null;
  rssiLevel: string | null;
  batteryPct: number | null;
  compactBadge: string;
}

const DISCRETE_RSSI_FR: Record<string, string> = {
  good: 'Bon',
  normal: 'Moyen',
  low: 'Faible',
  verylow: 'Très faible',
};

export function extractSomfyDisplaySummary(
  device: Pick<
    DeviceRecord,
    | 'name'
    | 'primaryVendor'
    | 'tuyaCategory'
    | 'category'
    | 'lastRawStatus'
    | 'lastBatteryPct'
  >
): SomfyDisplaySummary | null {
  const cover = extractCoverSummary(device);
  const raw = Array.isArray(device.lastRawStatus) ? device.lastRawStatus : [];
  const isSomfy =
    device.primaryVendor === 'somfy' || raw.some((item) => item.code === 'somfy:uiClass');

  if (!isSomfy && !cover) return null;

  const map = new Map<string, unknown>();
  for (const item of raw) {
    if (item && typeof item.code === 'string') {
      map.set(item.code, item.value);
    }
  }

  const uiClass =
    (typeof map.get('somfy:uiClass') === 'string'
      ? (map.get('somfy:uiClass') as string)
      : null) ??
    device.tuyaCategory ??
    (cover?.kindLabel ?? 'Tuya');
  const protocol =
    cover?.protocol ??
    (typeof map.get('somfy:protocol') === 'string'
      ? (map.get('somfy:protocol') as string)
      : 'Overkiz');
  const gatewayId =
    typeof map.get('somfy:gatewayId') === 'string' && (map.get('somfy:gatewayId') as string).trim()
      ? (map.get('somfy:gatewayId') as string).trim()
      : null;
  const isGatewayNetwork = map.get('somfy:networkSource') === 'gateway';

  const rssiRaw = map.get('core:DiscreteRSSILevelState');
  const rssiLevel =
    cover?.rssiLevel ??
    (typeof rssiRaw === 'string'
      ? DISCRETE_RSSI_FR[rssiRaw.toLowerCase()] ?? rssiRaw
      : null);

  let compactBadge: string;
  if (cover) {
    compactBadge =
      cover.source === 'tuya'
        ? `${cover.kindLabel.split(' ')[0]} · ${cover.stateLabel}`
        : `${protocol} · ${cover.stateLabel}`;
  } else {
    compactBadge = `${protocol} · ${uiClass}`;
  }

  return {
    protocol,
    uiClass,
    gatewayId,
    isGatewayNetwork,
    cover,
    rssiLevel,
    batteryPct: cover?.batteryPct ?? device.lastBatteryPct,
    compactBadge,
  };
}
