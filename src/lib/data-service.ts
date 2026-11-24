/**
 * Façade rétrocompatible des services métier Home Cockpit.
 * Les implémentations modulaires sont découpées dans `src/lib/services/`.
 */
export { getEnvStatus, ensureSchemaInitialized } from '@/lib/services/shared';
export { getDashboardData } from '@/lib/services/dashboard-service';
export { runCollection } from '@/lib/services/collection-service';
export {
  createRoom,
  updateRoom,
  deleteRoom,
  syncRoomsFromVendor,
  type RoomVendorSyncResult,
} from '@/lib/services/rooms-service';
export {
  createManualDevice,
  updateDevice,
  deleteDevice,
  deleteDevices,
  deleteManualDevice,
  type CreateManualDeviceInput,
} from '@/lib/services/devices-service';
export {
  toggleDeviceSystemTag,
  mergeDevices,
  unlinkDeviceVendor,
  bulkToggleDeviceSystemTag,
  bulkMergeDevices,
  type BulkToggleSystemResult,
  type BulkMergeDevicesResult,
} from '@/lib/services/device-links-service';
export {
  createTariff,
  updateTariff,
  deleteTariff,
  type TariffInput,
} from '@/lib/services/tariffs-service';

export { syncTuyaDevices, syncTuyaAutomations } from '@/lib/services/vendors/tuya-sync';
export {
  saveGoogleHomeConnection,
  disconnectGoogleHome,
  syncGoogleHomeDevices,
} from '@/lib/services/vendors/google-home-sync';
export { syncKasaDevices } from '@/lib/services/vendors/kasa-sync';
export {
  saveHomeConnectConnection,
  disconnectHomeConnect,
  syncHomeConnectDevices,
} from '@/lib/services/vendors/home-connect-sync';
export { syncSomfyDevices } from '@/lib/services/vendors/somfy-sync';
export {
  saveDaikinConnection,
  disconnectDaikin,
  syncDaikinDevices,
} from '@/lib/services/vendors/daikin-sync';
export { syncXSenseDevices } from '@/lib/services/vendors/xsense-sync';
export {
  saveXiaomiConnection,
  disconnectXiaomi,
  syncXiaomiDevices,
} from '@/lib/services/vendors/xiaomi-sync';
export { VENDOR_SERVER_PLUGINS, getVendorServerPlugin } from '@/lib/services/vendors';
