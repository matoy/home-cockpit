import { describe, expect, it } from 'vitest';
import { extractCoverSummary } from '@/lib/covers-utils';
import { SUPPORTED_LOCALES } from '@/lib/i18n';
import {
  VENDOR_SERVER_PLUGINS,
  getVendorServerPlugin,
  getVendorServerPluginBySlug,
} from '@/lib/services/vendors';
import { extractDaikinSummary } from '@/lib/vendors/daikin-display';
import {
  VENDOR_DISPLAY_EXTRACTORS,
  extractVendorDisplaySummary,
} from '@/lib/vendors/display-registry';
import { extractHomeConnectSummary } from '@/lib/vendors/home-connect-display';
import {
  VENDOR_IDS,
  VENDOR_REGISTRY,
  getVendorBySlug,
  isValidVendorId,
} from '@/lib/vendors/registry';
import { extractSomfyDisplaySummary } from '@/lib/vendors/somfy-display';
import { extractXiaomiSummary } from '@/lib/vendors/xiaomi-display';
import { extractXSenseSummary } from '@/lib/vendors/xsense-display';
import type { DeviceRecord } from '@/types';

describe('vendor modularity & localized display extractors', () => {
  it('maintains 1:1 parity across VENDOR_IDS, VENDOR_REGISTRY, and VENDOR_SERVER_PLUGINS', () => {
    expect(Object.keys(VENDOR_REGISTRY).sort()).toEqual([...VENDOR_IDS].sort());
    expect(Object.keys(VENDOR_SERVER_PLUGINS).sort()).toEqual([...VENDOR_IDS].sort());

    for (const id of VENDOR_IDS) {
      expect(isValidVendorId(id)).toBe(true);
      const meta = VENDOR_REGISTRY[id];
      expect(meta.slug.length).toBeGreaterThan(0);
      expect(getVendorBySlug(meta.slug)?.id).toBe(id);
      expect(getVendorBySlug(id)?.id).toBe(id);

      const plugin = getVendorServerPlugin(id);
      expect(plugin.id).toBe(id);
      expect(getVendorServerPluginBySlug(meta.slug)?.id).toBe(id);
      expect(typeof plugin.syncDevices).toBe('function');
      expect(typeof plugin.isConfigured).toBe('function');
      expect(typeof plugin.getConnectionMode).toBe('function');
    }

    expect(isValidVendorId('nonexistent_vendor')).toBe(false);
    expect(getVendorBySlug('nonexistent-vendor')).toBeNull();
    expect(VENDOR_DISPLAY_EXTRACTORS.daikin).toBeDefined();
    expect(VENDOR_DISPLAY_EXTRACTORS.somfy).toBeDefined();
  });

  it('localizes display summaries and cover states cleanly across all 5 languages', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const dk = extractDaikinSummary(
        [
          { code: 'daikin:unitType', value: 'climateControl' },
          { code: 'daikin:onOff', value: 'on' },
          { code: 'daikin:operationMode', value: 'heating' },
        ],
        locale
      );
      expect(dk?.modeLabel.trim().length).toBeGreaterThan(0);

      const hc = extractHomeConnectSummary([{ code: 'operation_state', value: 'Finished' }], locale);
      expect(hc?.operationLabel?.trim().length).toBeGreaterThan(0);

      const mi = extractXiaomiSummary(
        [
          { code: 'xiaomi:unitType', value: 'smokeSensor' },
          { code: 'xiaomi:smokeAlert', value: true },
        ],
        locale
      );
      expect(mi?.isAlert).toBe(true);
      expect(mi?.alertLabel?.trim().length).toBeGreaterThan(0);

      const xs = extractXSenseSummary(
        [
          { code: 'xsense:unitType', value: 'smokeCoDetector' },
          { code: 'xsense:alarmStatus', value: 'smoke' },
        ],
        locale
      );
      expect(xs?.isAlert).toBe(true);
      expect(xs?.alarmLabel.trim().length).toBeGreaterThan(0);

      const cover = extractCoverSummary(
        {
          name: 'Volet Salon',
          primaryVendor: 'somfy',
          tuyaCategory: 'RollerShutter',
          category: 'other',
          lastRawStatus: [
            { code: 'somfy:uiClass', value: 'RollerShutter' },
            { code: 'core:ClosureState', value: 0 },
          ],
          lastBatteryPct: null,
        },
        locale
      );
      expect(cover?.state).toBe('open');
      expect(cover?.stateLabel.trim().length).toBeGreaterThan(0);
    }

    const daikinDevice: DeviceRecord = {
      id: 'dk_test_1',
      name: 'Living Room Heat Pump',
      customName: null,
      primaryVendor: 'daikin',
      systems: ['daikin'],
      roomId: null,
      category: 'climate',
      tuyaCategory: 'climateControl',
      productName: 'Daikin',
      ipAddress: null,
      macAddress: null,
      isOnline: true,
      isMonitored: true,
      excludeFromTotals: false,
      energyMode: 'add_ele',
      dpConfig: {},
      lastRawStatus: [
        { code: 'daikin:unitType', value: 'climateControl' },
        { code: 'daikin:onOff', value: 'on' },
        { code: 'daikin:operationMode', value: 'cooling' },
      ],
      lastSeenAt: null,
      lastPowerW: null,
      lastVoltageV: null,
      lastAddEleKwh: null,
      lastTempC: 21,
      lastHumidityPct: 50,
      lastBatteryPct: null,
      lastContactOpen: null,
    };

    const summaryEn = extractVendorDisplaySummary(daikinDevice, 'en');
    expect(summaryEn?.badgeText).toContain('Cooling');

    const somfySummary = extractSomfyDisplaySummary(
      {
        name: 'Roller Shutter Patio',
        primaryVendor: 'somfy',
        category: 'other',
        tuyaCategory: 'RollerShutter',
        lastRawStatus: [
          { code: 'somfy:uiClass', value: 'RollerShutter' },
          { code: 'core:ClosureState', value: 100 },
        ],
        lastBatteryPct: null,
      },
      'es'
    );
    expect(somfySummary?.cover?.state).toBe('closed');
  });
});
