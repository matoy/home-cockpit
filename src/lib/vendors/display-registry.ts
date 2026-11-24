import { extractDaikinSummary } from '@/lib/vendors/daikin-display';
import { extractHomeConnectSummary } from '@/lib/vendors/home-connect-display';
import { extractSomfyDisplaySummary } from '@/lib/vendors/somfy-display';
import { extractXiaomiSummary } from '@/lib/vendors/xiaomi-display';
import { extractXSenseSummary } from '@/lib/vendors/xsense-display';
import type { AppLocale } from '@/lib/i18n/types';
import type { DeviceRecord, VendorId } from '@/types';

export type VendorDisplayTone =
  | 'emerald'
  | 'cyan'
  | 'sky'
  | 'amber'
  | 'rose'
  | 'indigo'
  | 'teal'
  | 'slate';

export interface VendorDeviceDisplaySummary {
  vendor: VendorId;
  badgeText: string;
  tone: VendorDisplayTone;
  detailLine?: string | null;
  searchableText: string;
  isAlert?: boolean;
}

export type VendorDisplayExtractor = (
  device: DeviceRecord,
  locale?: AppLocale
) => VendorDeviceDisplaySummary | null;

function mapDaikinTone(tone: string): VendorDisplayTone {
  if (tone === 'amber' || tone === 'sky' || tone === 'indigo' || tone === 'teal') return tone;
  return 'slate';
}

function mapHomeConnectTone(tone: string): VendorDisplayTone {
  if (tone === 'cyan' || tone === 'emerald' || tone === 'amber' || tone === 'rose') return tone;
  return 'slate';
}

function mapXSenseTone(tone: string): VendorDisplayTone {
  if (tone === 'emerald' || tone === 'rose' || tone === 'amber') return tone;
  return 'slate';
}

/**
 * Registre client des extracteurs d'affichage par fournisseur.
 * Chaque nouveau vendor n'a qu'à enregistrer son extracteur ici pour être affiché
 * automatiquement dans l'aperçu et la liste unifiée des appareils.
 */
export const VENDOR_DISPLAY_EXTRACTORS: Partial<Record<VendorId, VendorDisplayExtractor>> = {
  home_connect: (device) => {
    const hc = extractHomeConnectSummary(device.lastRawStatus);
    if (!hc) return null;
    const badgeText = [hc.operationLabel, hc.activeProgram, hc.remainingLabel]
      .filter(Boolean)
      .join(' · ');
    return {
      vendor: 'home_connect',
      badgeText: badgeText || hc.applianceType || 'Home Connect',
      tone: mapHomeConnectTone(hc.operationTone),
      detailLine: hc.tempsLabel,
      searchableText: hc.searchableText,
      isAlert: hc.doorOpen,
    };
  },
  daikin: (device) => {
    const dk = extractDaikinSummary(device.lastRawStatus);
    if (!dk) return null;
    return {
      vendor: 'daikin',
      badgeText: dk.compactText,
      tone: mapDaikinTone(dk.modeTone),
      detailLine: dk.unitTypeLabel,
      searchableText: dk.searchableText,
    };
  },
  somfy: (device) => {
    const sf = extractSomfyDisplaySummary(device);
    if (!sf) return null;
    return {
      vendor: 'somfy',
      badgeText: sf.compactBadge,
      tone: sf.cover?.state === 'open' || sf.cover?.state === 'partial' ? 'amber' : 'slate',
      detailLine: sf.rssiLevel,
      searchableText: [sf.protocol, sf.uiClass, sf.compactBadge, sf.rssiLevel].filter(Boolean).join(' '),
    };
  },
  xsense: (device) => {
    const xs = extractXSenseSummary(device.lastRawStatus);
    if (!xs) return null;
    return {
      vendor: 'xsense',
      badgeText: xs.compactText,
      tone: mapXSenseTone(xs.alarmTone),
      detailLine: xs.stationName || xs.unitTypeLabel,
      searchableText: xs.searchableText,
      isAlert: xs.isAlert,
    };
  },
  xiaomi: (device) => {
    const mi = extractXiaomiSummary(device.lastRawStatus);
    if (!mi) return null;
    return {
      vendor: 'xiaomi',
      badgeText: mi.compactText,
      tone: mi.isAlert ? 'rose' : 'sky',
      detailLine: mi.unitTypeLabel,
      searchableText: mi.searchableText,
      isAlert: mi.isAlert,
    };
  },
};

const DISPLAY_EXTRACT_ORDER: readonly VendorId[] = [
  'home_connect',
  'daikin',
  'xsense',
  'xiaomi',
  'somfy',
];

/**
 * Extrait un résumé d'affichage unifié pour n'importe quel appareil multi-écosystème.
 */
export function extractVendorDisplaySummary(
  device: DeviceRecord,
  locale: AppLocale = 'fr'
): VendorDeviceDisplaySummary | null {
  const ordered: VendorId[] = [
    device.primaryVendor,
    ...DISPLAY_EXTRACT_ORDER.filter((v) => v !== device.primaryVendor),
  ];

  for (const vendorId of ordered) {
    const extractor = VENDOR_DISPLAY_EXTRACTORS[vendorId];
    if (!extractor) continue;
    const summary = extractor(device, locale);
    if (summary) return summary;
  }

  // Repli universel pour un futur vendor utilisant des traits normalisés sans extracteur dédié
  const coverExtractor = VENDOR_DISPLAY_EXTRACTORS.somfy;
  if (coverExtractor && !ordered.includes('somfy')) {
    return coverExtractor(device, locale);
  }
  return null;
}
