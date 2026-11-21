import type { DeviceCategory, DeviceRecord, DpConfig } from '@/types';

export const LIGHTING_TUYA_CATEGORIES = new Set([
  'dj',
  'dd',
  'dc',
  'xdd',
  'fwd',
  'tgq',
  'fsd',
  'tyndj',
  'ykq',
]);

function hasExplicitDpMapping(dpConfig: DpConfig | null | undefined): boolean {
  return Object.values(dpConfig ?? {}).some((v) => Boolean(v?.code));
}

/**
 * Retourne vrai si le DP température auto-détecté ne représente pas une sonde ambiante
 * (ex: consigne de radiateur `temp_set` ou température de couleur `temp_value` sur un luminaire).
 */
export function isInvalidAutoTempDp(
  dpConfig: DpConfig | null | undefined,
  tuyaCategory?: string | null
): boolean {
  const tempCode = dpConfig?.temp?.code;
  if (!tempCode) return false;
  if (tempCode === 'temp_set') return true;
  if (tempCode === 'temp_value' && tuyaCategory) {
    return LIGHTING_TUYA_CATEGORIES.has(tuyaCategory.toLowerCase());
  }
  return false;
}

/**
 * Nettoie un DpConfig des faux positifs de température auto-détectés (`temp_set`, luminaires `temp_value`).
 */
export function sanitizeDeviceDpConfig(
  dpConfig: DpConfig,
  tuyaCategory?: string | null
): { dpConfig: DpConfig; changed: boolean } {
  if (!isInvalidAutoTempDp(dpConfig, tuyaCategory)) {
    return { dpConfig, changed: false };
  }
  const next: DpConfig = { ...dpConfig };
  delete next.temp;
  return { dpConfig: next, changed: true };
}

/**
 * Déduit la catégorie fonctionnelle d'un appareil à partir de son mapping DP.
 */
export function inferDeviceCategory(
  dpConfig: DpConfig,
  tuyaCategory?: string | null
): DeviceCategory {
  const hasPower = Boolean(dpConfig.power || dpConfig.addEle);
  const hasClimate = Boolean(dpConfig.temp || dpConfig.humidity);
  const hasContact = Boolean(dpConfig.contact || tuyaCategory === 'mcs');
  const activeKinds = [hasPower, hasClimate, hasContact].filter(Boolean).length;
  return activeKinds > 1
    ? 'hybrid'
    : hasPower
      ? 'power'
      : hasClimate
        ? 'climate'
        : hasContact
          ? 'contact'
          : 'other';
}

/**
 * Détermine si un appareil doit être comptabilisé comme sonde climat active (température / humidité).
 */
export function isActiveClimateSensor(device: DeviceRecord): boolean {
  if (!device.isMonitored || device.excludeFromTotals) return false;

  const hasValidTempDp =
    Boolean(device.dpConfig?.temp?.code) &&
    !isInvalidAutoTempDp(device.dpConfig, device.tuyaCategory);
  const hasHumidityDp = Boolean(device.dpConfig?.humidity?.code);

  if (hasValidTempDp || hasHumidityDp) return true;
  if (isInvalidAutoTempDp(device.dpConfig, device.tuyaCategory)) return false;
  if (hasExplicitDpMapping(device.dpConfig)) return false;

  return (
    device.category === 'climate' ||
    device.lastTempC !== null ||
    device.lastHumidityPct !== null
  );
}

/**
 * Indique si les mesures de température de cet appareil sont valides pour les graphiques et moyennes climat.
 */
export function hasValidTempMeasurement(device: DeviceRecord): boolean {
  if (!isActiveClimateSensor(device) || isInvalidAutoTempDp(device.dpConfig, device.tuyaCategory)) {
    return false;
  }
  if (hasExplicitDpMapping(device.dpConfig) && !device.dpConfig?.temp?.code) {
    return false;
  }
  return true;
}

/**
 * Indique si les mesures d'humidité de cet appareil sont valides pour les graphiques et moyennes climat.
 */
export function hasValidHumidityMeasurement(device: DeviceRecord): boolean {
  if (!isActiveClimateSensor(device)) return false;
  if (hasExplicitDpMapping(device.dpConfig) && !device.dpConfig?.humidity?.code) {
    return false;
  }
  return true;
}
