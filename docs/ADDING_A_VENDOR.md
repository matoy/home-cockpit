# Adding a New Vendor to Home Cockpit

**Home Cockpit** uses a declarative plugin architecture on both the server and client so contributors can add a new smart home ecosystem with minimal boilerplate and full backward compatibility.

---

## What Works Out of the Box

Once you register a vendor in the central registries, the following platform features work **automatically** with no extra wiring:

- **Dynamic API Endpoints:** `POST /api/vendors/[vendor]/sync` and `POST /api/vendors/[vendor]/disconnect` (via `src/app/api/vendors/[vendor]/sync/route.ts` and `src/app/api/vendors/[vendor]/disconnect/route.ts`, resolved via `getVendorServerPluginBySlug`).
- **30-Minute Telemetry Collection:** Automatic inclusion in `collectAllMonitoredDevices` (`src/lib/services/collection-service.ts`) whenever `collectReadings` is implemented on your `VendorServerPlugin`.
- **Cross-Vendor Room Sync:** Automatic inclusion in `syncAllVendorRooms` (`POST /api/rooms/sync` via `src/lib/services/rooms-service.ts`) when `syncRooms` and `isReadyForRoomSync` are provided.
- **Cross-Vendor Device Linking & Deduplication:** Physical device merging and primary telemetry selection via `device_vendor_links`.
- **Dashboard Vendor Summaries & UI Card:** Status badges, last-sync timestamps, error reporting, device counts, a generic card inside **Systems & Connections** (`SystemsTab.tsx` calling `meta.syncEndpoint` / `meta.disconnectEndpoint`), and the header system filter (`DashboardApp.tsx`) are automatically generated from `VENDOR_REGISTRY` and `buildVendorConnectionSummariesFromState` (`src/lib/services/vendors/index.ts`).
- **Gzip Backup & Restore:** Device metadata, vendor links, vendor connection states, and metric readings are automatically included in JSON/Gzip exports and imports.
- **Unified Overview & Device Inventory Display:** Rich inline status badges and searchable metadata driven by `extractVendorDisplaySummary` (`src/lib/vendors/display-registry.ts`).

---

## Step-by-Step Guide

### Step 1 — Register Vendor Identity & Metadata

1. Add your vendor key (snake_case) to `VendorId` in `src/types/index.ts`:

```ts
export type VendorId =
  | 'tuya'
  | 'kasa'
  | 'home_connect'
  | 'somfy'
  | 'daikin'
  | 'xsense'
  | 'xiaomi'
  | 'google_home'
  | 'my_vendor';
```

2. Add `'my_vendor'` to `VENDOR_IDS` and its metadata entry to `VENDOR_REGISTRY` in `src/lib/vendors/registry.ts`:

```ts
export const VENDOR_IDS: readonly VendorId[] = [
  'tuya',
  'google_home',
  'kasa',
  'home_connect',
  'somfy',
  'daikin',
  'xsense',
  'xiaomi',
  'my_vendor',
] as const;

// Inside VENDOR_REGISTRY:
my_vendor: {
  id: 'my_vendor',
  slug: 'my-vendor', // URL slug for /api/vendors/my-vendor/{sync,disconnect}
  label: 'My Vendor Cloud',
  shortLabel: 'MyVendor',
  badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  description: 'Smart plugs, climate sensors, and energy meters via My Vendor API.',
  authKind: 'env', // 'env' | 'oauth' | 'qr_or_credentials'
  capabilities: {
    hasPower: true,
    hasClimate: true,
    hasCovers: false,
    hasSecurity: false,
    hasAppliances: false,
    hasRoomsSync: true,
    hasAutomationsSync: false,
    supportsDisconnect: false,
  },
  envVars: ['MY_VENDOR_API_KEY', 'MY_VENDOR_REGION'],
  syncEndpoint: '/api/vendors/my-vendor/sync',
},
```

---

### Step 2 — Build the Vendor Client (`src/lib/vendors/my-vendor-client.ts`)

Create a focused API client under `src/lib/vendors/my-vendor-client.ts`. Reuse the shared zero-dependency parsing utilities in `src/lib/utils.ts`:

- `asRecord(value)` — safe `Record<string, unknown> | null` narrowing
- `toFiniteNumber(value)` — finite number parsing (including numeric strings)
- `toStr(value)` — trimmed non-empty string extraction
- `toBool(value)` — boolean parsing (`true`, `1`, `'true'`, `'1'`, `'open'`, `'on'`)

For **OAuth 2.0** vendors, reuse `getPublicOrigin` and `buildOAuthRedirectUrl` from `src/lib/http-utils.ts` and encrypt stored tokens with `encryptSecret` / `decryptSecret` from `src/lib/crypto.ts`.

---

### Step 3 — Add Localized Display Extractor (`src/lib/vendors/my-vendor-display.ts`)

If your devices expose vendor-specific status fields in `device.lastRawStatus`, write a localized summary extractor accepting `locale: AppLocale = 'fr'` (supporting `'fr' | 'en' | 'es' | 'de' | 'it'`):

```ts
import type { AppLocale } from '@/lib/i18n/types';
import type { DeviceRecord } from '@/types';
import type { VendorDeviceDisplaySummary } from '@/lib/vendors/display-registry';

export function extractMyVendorDisplaySummary(
  device: DeviceRecord,
  locale: AppLocale = 'fr'
): VendorDeviceDisplaySummary | null {
  // Parse device.lastRawStatus and format badgeText / detailLine in `locale`
  return null;
}
```

Then register it in `VENDOR_DISPLAY_EXTRACTORS` inside `src/lib/vendors/display-registry.ts`:

```ts
my_vendor: (device, locale = 'fr') => extractMyVendorDisplaySummary(device, locale),
```

`OverviewTab` and `DevicesRoomsTab` will automatically render your vendor badge, searchable text, and alert highlight without touching tab components.

---

### Step 4 — Implement & Register `VendorServerPlugin`

Create `src/lib/services/vendors/my-vendor-sync.ts` implementing `VendorServerPlugin` (`src/lib/services/vendors/types.ts`).

Reuse the shared database/session helpers from `src/lib/services/vendors/upsert-helper.ts`:
- `loadVendorDeviceIndex(db, 'my_vendor')`
- `loadVendorExternalDeviceMap(db, 'my_vendor')`
- `ensureUniqueDeviceId(baseId, hasId, now)`
- `backfillMissingReadingRoomId(db, deviceId, roomId, prevRoomId)`
- `upsertVendorConnectionState(db, { ... })`
- `disconnectVendorConnection('my_vendor')`

Minimal skeleton:

```ts
import type { VendorServerPlugin } from '@/lib/services/vendors/types';
import {
  disconnectVendorConnection,
  loadVendorDeviceIndex,
} from '@/lib/services/vendors/upsert-helper';

export const myVendorPlugin: VendorServerPlugin = {
  id: 'my_vendor',

  isConfigured: () => Boolean(process.env.MY_VENDOR_API_KEY?.trim()),

  getConnectionMode: () => 'api_key',

  isConnectedLive: ({ conn, devices }) =>
    conn?.status === 'connected' || devices.some((d) => d.systems.includes('my_vendor')),

  syncDevices: async () => {
    // 1. Fetch remote inventory from my-vendor-client
    // 2. If Demo Mode (!getDb()), update getDemoState() and return mode: 'demo'
    // 3. Otherwise call loadVendorDeviceIndex(db, 'my_vendor'), upsert devices & device_vendor_links
    return {
      syncedCount: 0,
      newCount: 0,
      mode: 'live',
      message: 'Synced My Vendor devices.',
    };
  },

  // Optional: runs automatically inside /api/schedule/collect every 30 min
  collectReadings: async ({ db, monitoredDevices, now }) => {
    // Fetch live telemetry for monitoredDevices belonging to 'my_vendor' and insert into metric_readings
    return { devicesCount: monitoredDevices.length, readingsInserted: 0, updatedCount: 0 };
  },

  // Optional: enables POST /api/vendors/my-vendor/disconnect
  disconnect: async () => {
    await disconnectVendorConnection('my_vendor');
  },
};
```

Register your plugin in `VENDOR_SERVER_PLUGINS` inside `src/lib/services/vendors/index.ts`:

```ts
import { myVendorPlugin } from '@/lib/services/vendors/my-vendor-sync';

export const VENDOR_SERVER_PLUGINS: Record<VendorId, VendorServerPlugin> = {
  tuya: tuyaPlugin,
  kasa: kasaPlugin,
  home_connect: homeConnectPlugin,
  somfy: somfyPlugin,
  daikin: daikinPlugin,
  xsense: xsensePlugin,
  xiaomi: xiaomiPlugin,
  google_home: googleHomePlugin,
  my_vendor: myVendorPlugin,
};
```

> **Type Safety Guarantee:** Because `VENDOR_REGISTRY` and `VENDOR_SERVER_PLUGINS` are typed as `Record<VendorId, ...>`, TypeScript (`npm run typecheck`) will flag any missing entry at compile time.

---

### Step 5 — Translations, Setup Guide, and Environment Template

1. Add any vendor-specific UI keys in strict parity across all 5 locale dictionaries:
   - `src/lib/i18n/dictionaries/en.ts`
   - `src/lib/i18n/dictionaries/fr.ts`
   - `src/lib/i18n/dictionaries/es.ts`
   - `src/lib/i18n/dictionaries/de.ts`
   - `src/lib/i18n/dictionaries/it.ts`
2. If your vendor uses a custom login/OAuth button flow (such as QR Code or PKCE), add a dedicated control section in `src/components/SystemsTab.tsx` and optional setup notes in `src/components/SetupGuideTab.tsx`.
3. Document required environment variables in `.env.example` and `README.md`.

---

## Contributor Verification Checklist

Before opening a pull request, run the full verification suite:

```bash
npm run typecheck
npm run lint
npm run build
```

All three commands must exit with `0` errors and `0` ESLint warnings.
