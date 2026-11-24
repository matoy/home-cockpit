import type { vendorConnections } from '@/db/schema';
import type { DemoVendorConnectionState } from '@/lib/demo-store';
import { consoApiPlugin } from '@/lib/services/vendors/conso-api-sync';
import { daikinPlugin } from '@/lib/services/vendors/daikin-sync';
import { googleHomePlugin } from '@/lib/services/vendors/google-home-sync';
import { homeConnectPlugin } from '@/lib/services/vendors/home-connect-sync';
import { kasaPlugin } from '@/lib/services/vendors/kasa-sync';
import { somfyPlugin } from '@/lib/services/vendors/somfy-sync';
import { tuyaPlugin } from '@/lib/services/vendors/tuya-sync';
import type { VendorServerPlugin } from '@/lib/services/vendors/types';
import { xiaomiPlugin } from '@/lib/services/vendors/xiaomi-sync';
import { xsensePlugin } from '@/lib/services/vendors/xsense-sync';
import {
  getVendorBySlug,
  normalizeSystems,
  VENDOR_IDS,
  VENDOR_REGISTRY,
} from '@/lib/vendors/registry';
import type { DeviceRecord, VendorConnectionSummary, VendorId } from '@/types';

/**
 * Registre central des plugins serveur par fournisseur.
 * Pour ajouter un futur écosystème, implémentez `VendorServerPlugin` et enregistrez-le ici.
 */
export const VENDOR_SERVER_PLUGINS: Record<VendorId, VendorServerPlugin> = {
  tuya: tuyaPlugin,
  kasa: kasaPlugin,
  home_connect: homeConnectPlugin,
  somfy: somfyPlugin,
  daikin: daikinPlugin,
  xsense: xsensePlugin,
  xiaomi: xiaomiPlugin,
  google_home: googleHomePlugin,
  conso_api: consoApiPlugin,
};

export function getVendorServerPlugin(vendor: VendorId): VendorServerPlugin {
  return VENDOR_SERVER_PLUGINS[vendor];
}

export function getVendorServerPluginBySlug(slugOrId: string): VendorServerPlugin | null {
  const meta = getVendorBySlug(slugOrId);
  return meta ? VENDOR_SERVER_PLUGINS[meta.id] : null;
}

export function buildVendorConnectionSummariesFromState(params: {
  devices: DeviceRecord[];
  connByVendor?: Map<VendorId, typeof vendorConnections.$inferSelect>;
  demoConnections?: Record<VendorId, DemoVendorConnectionState>;
}): VendorConnectionSummary[] {
  const countFor = (vendor: VendorId) =>
    params.devices.filter((d) => normalizeSystems(d.systems, d.primaryVendor).includes(vendor))
      .length;

  return VENDOR_IDS.map((vendorId) => {
    const plugin = VENDOR_SERVER_PLUGINS[vendorId];
    const meta = VENDOR_REGISTRY[vendorId];
    const dbConn = params.connByVendor?.get(vendorId);
    const demoConn = params.demoConnections?.[vendorId];

    if (demoConn) {
      const configured =
        vendorId === 'xiaomi'
          ? plugin.isConfigured() || demoConn.connected
          : plugin.isConfigured();
      return {
        vendor: vendorId,
        label: meta.label,
        mode: plugin.getConnectionMode(
          demoConn.mode
            ? ({ mode: demoConn.mode } as typeof vendorConnections.$inferSelect)
            : undefined
        ),
        configured,
        connected: demoConn.connected,
        devicesCount: countFor(vendorId),
        lastSyncedAt: demoConn.lastSyncedAt,
        lastError: demoConn.lastError,
      };
    }

    const ctx = { conn: dbConn, devices: params.devices };
    const connected = plugin.isConnectedLive(ctx);
    const configured = plugin.isConfiguredLive
      ? plugin.isConfiguredLive(ctx)
      : plugin.isConfigured();

    return {
      vendor: vendorId,
      label: meta.label,
      mode: plugin.getConnectionMode(dbConn),
      configured,
      connected,
      devicesCount: countFor(vendorId),
      lastSyncedAt: dbConn?.lastSyncedAt ? dbConn.lastSyncedAt.toISOString() : null,
      lastError: dbConn?.lastError ?? null,
    };
  });
}
