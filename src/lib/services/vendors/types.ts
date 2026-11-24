import type { AppDatabase } from '@/db';
import type { devices, vendorConnections } from '@/db/schema';
import type { DeviceRecord, VendorConnectionSummary, VendorId } from '@/types';

export interface VendorSyncResult {
  syncedCount: number;
  newCount: number;
  mode: 'live' | 'demo';
  message: string;
}

export interface VendorRoomSyncResult {
  vendor: VendorId;
  roomsFound: number;
  createdCount: number;
  assignedDevicesCount: number;
  mode: 'live' | 'demo';
  message: string;
}

export interface VendorCollectionResult {
  devicesCount: number;
  readingsInserted: number;
  updatedCount: number;
}

export interface VendorConnectionCheckContext {
  conn?: typeof vendorConnections.$inferSelect;
  devices: DeviceRecord[];
}

export interface VendorServerPlugin {
  /** Identifiant unique du système / écosystème. */
  id: VendorId;

  /** Indique si les variables d'environnement ou identifiants requis sont configurés. */
  isConfigured: () => boolean;

  /** Masque éventuellement le système dans les résumés (ex: GOOGLE_HOME_MODE=off). */
  isVisible?: () => boolean;

  /** Mode d'authentification / d'intégration affiché dans l'UI. */
  getConnectionMode: (conn?: typeof vendorConnections.$inferSelect) => VendorConnectionSummary['mode'];

  /** Détermine si le système est connecté en mode Live (BDD). */
  isConnectedLive: (ctx: VendorConnectionCheckContext) => boolean;

  /** Indique si le système est prêt côté environnement/session pour apparaître comme configuré. */
  isConfiguredLive?: (ctx: VendorConnectionCheckContext) => boolean;

  /** Synchronise l'inventaire des appareils en base ou en mode démo. */
  syncDevices: () => Promise<VendorSyncResult>;

  /** Collecte les mesures périodiques des appareils supervisés en base Postgres. */
  collectReadings?: (params: {
    db: AppDatabase;
    monitoredDevices: Array<typeof devices.$inferSelect>;
    now: Date;
  }) => Promise<VendorCollectionResult>;

  /** Synchronise les pièces depuis l'écosystème, si supporté. */
  syncRooms?: () => Promise<VendorRoomSyncResult>;

  /** Vérifie côté serveur si une synchro globale des pièces peut inclure ce vendor. */
  isReadyForRoomSync?: (db: AppDatabase | null) => Promise<boolean>;

  /** Révoque la connexion / session locale OAuth ou QR Code si supporté. */
  disconnect?: () => Promise<void>;
}
