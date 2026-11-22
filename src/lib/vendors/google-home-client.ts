import crypto from 'node:crypto';
import type { DeviceCategory, GoogleHomeMode, RawDpStatus } from '@/types';
import type { NormalizedVendorDevice, VendorInventoryResult } from './registry';

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_HOME_MCP_URL = 'https://home.googleapis.com/mcp';
const GOOGLE_SDM_BASE_URL = 'https://smartdevicemanagement.googleapis.com/v1';

export const GOOGLE_MCP_SCOPE = 'https://www.googleapis.com/auth/home.platform.v2';
export const GOOGLE_SDM_SCOPE = 'https://www.googleapis.com/auth/sdm.service';

export interface GoogleHomeConfig {
  configured: boolean;
  clientId: string;
  clientSecret: string;
  sdmProjectId: string;
  defaultMode: GoogleHomeMode;
}

export function getGoogleHomeConfig(): GoogleHomeConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
  const sdmProjectId = process.env.GOOGLE_SDM_PROJECT_ID?.trim() ?? '';
  const rawMode = process.env.GOOGLE_HOME_MODE?.trim().toLowerCase();

  const defaultMode: GoogleHomeMode =
    rawMode === 'mcp' || rawMode === 'sdm'
      ? rawMode
      : sdmProjectId
        ? 'sdm'
        : 'mcp';

  return {
    configured: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    sdmProjectId,
    defaultMode,
  };
}

export function makeGoogleDeviceId(externalId: string): string {
  const hash = crypto.createHash('sha256').update(externalId).digest('hex').slice(0, 16);
  return `gh_${hash}`;
}

export function buildGoogleOAuthAuthorizeUrl(params: {
  mode: GoogleHomeMode;
  redirectUri: string;
  state: string;
}): string {
  const cfg = getGoogleHomeConfig();
  if (!cfg.configured) {
    throw new Error(
      'GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET doivent être configurés dans les variables d’environnement.'
    );
  }

  if (params.mode === 'sdm') {
    if (!cfg.sdmProjectId) {
      throw new Error(
        'GOOGLE_SDM_PROJECT_ID est requis pour utiliser le mode Google Nest SDM API.'
      );
    }
    const qs = new URLSearchParams({
      redirect_uri: params.redirectUri,
      access_type: 'offline',
      prompt: 'consent',
      client_id: cfg.clientId,
      response_type: 'code',
      scope: GOOGLE_SDM_SCOPE,
      state: params.state,
    });
    return `https://nestservices.google.com/partnerconnections/${encodeURIComponent(cfg.sdmProjectId)}/auth?${qs.toString()}`;
  }

  const qs = new URLSearchParams({
    redirect_uri: params.redirectUri,
    access_type: 'offline',
    prompt: 'consent',
    client_id: cfg.clientId,
    response_type: 'code',
    scope: GOOGLE_MCP_SCOPE,
    state: params.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${qs.toString()}`;
}

export interface GoogleTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number;
}

export async function exchangeGoogleCodeForTokens(params: {
  code: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const cfg = getGoogleHomeConfig();
  if (!cfg.configured) {
    throw new Error('Identifiants Google OAuth non configurés.');
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  });

  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    throw new Error(
      `Échec échange OAuth Google : ${json.error_description || json.error || res.statusText}`
    );
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresInSec: typeof json.expires_in === 'number' ? json.expires_in : 3600,
  };
}

export async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<GoogleTokenResponse> {
  const cfg = getGoogleHomeConfig();
  if (!cfg.configured) {
    throw new Error('Identifiants Google OAuth non configurés.');
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    throw new Error(
      `Échec renouvellement token Google : ${json.error_description || json.error || res.statusText}`
    );
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresInSec: typeof json.expires_in === 'number' ? json.expires_in : 3600,
  };
}

function inferNormalizedCategory(metrics: {
  powerW: number | null;
  tempC: number | null;
  humidityPct: number | null;
  contactOpen: boolean | null;
}): DeviceCategory {
  const hasPower = metrics.powerW !== null;
  const hasClimate = metrics.tempC !== null || metrics.humidityPct !== null;
  const hasContact = metrics.contactOpen !== null;
  const count = [hasPower, hasClimate, hasContact].filter(Boolean).length;
  if (count > 1) return 'hybrid';
  if (hasPower) return 'power';
  if (hasClimate) return 'climate';
  if (hasContact) return 'contact';
  return 'other';
}

function extractMcpToolPayload(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {};
  const obj = result as Record<string, unknown>;

  if (obj.structuredContent && typeof obj.structuredContent === 'object') {
    return obj.structuredContent as Record<string, unknown>;
  }

  if (Array.isArray(obj.content)) {
    const merged: Record<string, unknown> = {};
    for (const part of obj.content) {
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
        const rawText = ((part as { text: string }).text || '').trim();
        if (rawText.startsWith('{') || rawText.startsWith('[')) {
          try {
            const parsed = JSON.parse(rawText) as unknown;
            if (Array.isArray(parsed)) {
              merged.items = parsed;
            } else if (parsed && typeof parsed === 'object') {
              Object.assign(merged, parsed as Record<string, unknown>);
            }
          } catch {
            // Ignorer texte non JSON
          }
        }
      }
    }
    if (Object.keys(merged).length > 0) return merged;
  }

  return obj;
}

type McpRpcEnvelope = {
  result?: unknown;
  error?: { message?: string; code?: number };
};

function parseMcpRpcEnvelope(rawBody: string): McpRpcEnvelope | null {
  const trimmed = rawBody.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:') || trimmed.includes('\ndata:')) {
    const dataLines = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== '[DONE]');
    for (let i = dataLines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(dataLines[i]) as McpRpcEnvelope;
      } catch {
        // Chercher la ligne JSON suivante
      }
    }
    return null;
  }

  try {
    return JSON.parse(trimmed) as McpRpcEnvelope;
  } catch {
    throw new Error(`Réponse Google MCP invalide : ${trimmed.slice(0, 180)}`);
  }
}

let mcpRequestSeq = 1;

async function callGoogleMcp(params: {
  accessToken: string;
  method: string;
  rpcParams?: Record<string, unknown>;
  sessionId?: string | null;
}): Promise<{ payload: Record<string, unknown>; sessionId: string | null }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (params.sessionId) {
    headers['Mcp-Session-Id'] = params.sessionId;
  }

  const res = await fetch(GOOGLE_HOME_MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: mcpRequestSeq++,
      method: params.method,
      params: params.rpcParams ?? {},
    }),
    cache: 'no-store',
  });

  const nextSessionId = res.headers.get('mcp-session-id') ?? params.sessionId ?? null;
  const rawBody = await res.text();

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Session Google OAuth expirée. Reconnectez Google Home.');
    }
    if (res.status === 403) {
      throw new Error(
        'Accès refusé par Google Home MCP (vérifiez que votre compte dispose bien de Google Home Premium Advanced et que la Home API est activée).'
      );
    }
    throw new Error(`Erreur Google Home MCP (${res.status}) : ${rawBody.slice(0, 220)}`);
  }

  const rpcJson = parseMcpRpcEnvelope(rawBody);

  if (rpcJson?.error) {
    throw new Error(`Google Home MCP : ${rpcJson.error.message || 'erreur inconnue'}`);
  }

  return {
    payload: extractMcpToolPayload(rpcJson?.result),
    sessionId: nextSessionId,
  };
}

function normalizeTemperatureValue(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  // Matter TemperatureMeasurement encode souvent en centièmes de °C (ex: 2150 => 21.5)
  const val = Math.abs(raw) > 100 ? raw / 100 : raw;
  return Math.round(val * 100) / 100;
}

function normalizeHumidityValue(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  // Matter RelativeHumidityMeasurement encode souvent en centièmes de % (ex: 4850 => 48.5)
  const val = raw > 100 ? raw / 100 : raw;
  if (val < 0 || val > 100) return null;
  return Math.round(val * 10) / 10;
}

function findArrayProp(obj: Record<string, unknown>, keys: string[]): Array<Record<string, unknown>> {
  for (const k of keys) {
    if (Array.isArray(obj[k])) {
      return obj[k] as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function parseMcpDeviceTraits(
  rawItem: Record<string, unknown>,
  stateObj?: Record<string, unknown>
): {
  isOnline: boolean;
  tempC: number | null;
  humidityPct: number | null;
  batteryPct: number | null;
  contactOpen: boolean | null;
  powerW: number | null;
  rawTraits: RawDpStatus[];
} {
  let isOnline = true;
  let tempC: number | null = null;
  let humidityPct: number | null = null;
  let batteryPct: number | null = null;
  let contactOpen: boolean | null = null;
  let powerW: number | null = null;
  const rawTraits: RawDpStatus[] = [];

  const merged = { ...rawItem, ...(stateObj ?? {}) };
  if (typeof merged.online === 'boolean') isOnline = merged.online;
  if (typeof merged.isOnline === 'boolean') isOnline = merged.isOnline;
  if (typeof merged.connectivity === 'string') {
    isOnline = merged.connectivity.toUpperCase() === 'ONLINE';
  }

  const statesMap: Record<string, unknown> = {};
  for (const src of [rawItem.traits, rawItem.states, stateObj?.traits, stateObj?.states, stateObj]) {
    if (src && typeof src === 'object' && !Array.isArray(src)) {
      Object.assign(statesMap, src as Record<string, unknown>);
    }
  }

  for (const [traitKey, traitVal] of Object.entries(statesMap)) {
    const keyLower = traitKey.toLowerCase();
    rawTraits.push({ code: traitKey, value: traitVal });
    const obj =
      traitVal && typeof traitVal === 'object' && !Array.isArray(traitVal)
        ? (traitVal as Record<string, unknown>)
        : null;

    if (keyLower.includes('connectivity')) {
      const status = typeof obj?.status === 'string' ? obj.status : typeof traitVal === 'string' ? traitVal : null;
      if (status) isOnline = status.toUpperCase() === 'ONLINE';
      if (typeof obj?.online === 'boolean') isOnline = obj.online;
    }

    if (keyLower.includes('temperature') && !keyLower.includes('setpoint') && tempC === null) {
      const candidate =
        obj?.ambientTemperatureCelsius ??
        obj?.measuredValue ??
        obj?.temperature ??
        (typeof traitVal === 'number' ? traitVal : null);
      tempC = normalizeTemperatureValue(candidate);
    }

    if (keyLower.includes('humidity') && humidityPct === null) {
      const candidate =
        obj?.ambientHumidityPercent ??
        obj?.measuredValue ??
        obj?.humidity ??
        (typeof traitVal === 'number' ? traitVal : null);
      humidityPct = normalizeHumidityValue(candidate);
    }

    if ((keyLower.includes('powersource') || keyLower.includes('battery')) && batteryPct === null) {
      const pctRaw = obj?.batPercentRemaining ?? obj?.batteryPercentage ?? obj?.percentage;
      if (typeof pctRaw === 'number' && Number.isFinite(pctRaw)) {
        // Matter batPercentRemaining utilise une échelle 0..200 (0.5 %)
        batteryPct = Math.round(pctRaw > 100 ? pctRaw / 2 : pctRaw);
      }
    }

    if (
      (keyLower.includes('booleanstate') || keyLower.includes('contact') || keyLower.includes('openclose')) &&
      contactOpen === null
    ) {
      const stateVal = obj?.stateValue ?? obj?.open ?? obj?.isOpen ?? obj?.contactState;
      if (typeof stateVal === 'boolean') {
        // Sur Matter BooleanState sur capteur contact, false = ouvert, true = fermé selon spec,
        // mais certaines exposants Google exposent boolean inversé ou open: boolean. On reste prudent sur stateValue direct si open absent.
        contactOpen = typeof obj?.open === 'boolean' ? obj.open : typeof obj?.isOpen === 'boolean' ? obj.isOpen : !stateVal;
      }
    }

    if ((keyLower.includes('electricalpower') || keyLower.includes('powermeasurement')) && powerW === null) {
      const pRaw = obj?.activePower ?? obj?.powerW ?? obj?.power;
      if (typeof pRaw === 'number' && Number.isFinite(pRaw)) {
        // Matter ElectricalPowerMeasurement expose en milliwatts
        powerW = Math.round((Math.abs(pRaw) > 20000 ? pRaw / 1000 : pRaw) * 100) / 100;
      }
    }
  }

  return {
    isOnline,
    tempC,
    humidityPct,
    batteryPct,
    contactOpen,
    powerW,
    rawTraits,
  };
}

/**
 * Synchronise l'inventaire Google Home en mode MCP (100 % lecture seule).
 */
export async function fetchGoogleHomeViaMcp(accessToken: string): Promise<VendorInventoryResult> {
  const initRes = await callGoogleMcp({
    accessToken,
    method: 'initialize',
    rpcParams: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'home-cockpit', version: '1.0.0' },
    },
  });
  let sessionId = initRes.sessionId;

  const homesRes = await callGoogleMcp({
    accessToken,
    method: 'tools/call',
    rpcParams: { name: 'list_homes', arguments: {} },
    sessionId,
  });
  sessionId = homesRes.sessionId;

  const homesList = findArrayProp(homesRes.payload, ['homes', 'structures', 'items']);
  const homeIds = homesList
    .map((h) => String(h.id ?? h.home_id ?? h.structure_id ?? h.name ?? '').trim())
    .filter(Boolean);

  const roomNameSet = new Set<string>();
  const normalizedDevices: NormalizedVendorDevice[] = [];
  const seenExternalIds = new Set<string>();

  const targetCalls = homeIds.length > 0 ? homeIds.map((id) => ({ home_id: id })) : [{}];

  for (const args of targetCalls) {
    const [resourcesRes, statesRes] = await Promise.all([
      callGoogleMcp({
        accessToken,
        method: 'tools/call',
        rpcParams: { name: 'list_home_resources', arguments: args },
        sessionId,
      }),
      callGoogleMcp({
        accessToken,
        method: 'tools/call',
        rpcParams: { name: 'list_home_states', arguments: args },
        sessionId,
      }).catch(() => ({ payload: {}, sessionId })),
    ]);

    const roomIdToName = new Map<string, string>();
    for (const roomObj of findArrayProp(resourcesRes.payload, ['rooms', 'areas'])) {
      const rId = String(roomObj.id ?? roomObj.room_id ?? '').trim();
      const rName = typeof roomObj.name === 'string' ? roomObj.name.trim() : '';
      if (rName) roomNameSet.add(rName);
      if (rId && rName) roomIdToName.set(rId, rName);
    }

    const stateByDeviceId = new Map<string, Record<string, unknown>>();
    for (const st of findArrayProp(statesRes.payload, ['states', 'devices', 'items'])) {
      const dId = String(st.id ?? st.device_id ?? st.deviceId ?? '').trim();
      if (dId) stateByDeviceId.set(dId, st);
    }

    for (const dev of findArrayProp(resourcesRes.payload, ['devices', 'resources', 'items'])) {
      const externalId = String(dev.id ?? dev.device_id ?? dev.name ?? '').trim();
      if (!externalId || seenExternalIds.has(externalId)) continue;
      seenExternalIds.add(externalId);

      const displayName =
        (typeof dev.displayName === 'string' ? dev.displayName.trim() : null) ??
        (typeof dev.name === 'string' ? dev.name.trim() : null) ??
        `Appareil Google ${externalId.slice(0, 8)}`;

      const rawRoomId = dev.room_id ?? dev.roomId ?? dev.room;
      const resolvedRoomName =
        (typeof dev.roomName === 'string' ? dev.roomName.trim() : null) ??
        (typeof dev.room_name === 'string' ? dev.room_name.trim() : null) ??
        (rawRoomId ? roomIdToName.get(String(rawRoomId)) ?? null : null);

      if (resolvedRoomName) roomNameSet.add(resolvedRoomName);

      const parsed = parseMcpDeviceTraits(dev, stateByDeviceId.get(externalId));

      normalizedDevices.push({
        externalId,
        name: displayName,
        roomName: resolvedRoomName,
        manufacturer:
          typeof dev.manufacturer === 'string'
            ? dev.manufacturer
            : typeof dev.vendorName === 'string'
              ? dev.vendorName
              : null,
        model: typeof dev.model === 'string' ? dev.model : null,
        deviceType: typeof dev.type === 'string' ? dev.type : null,
        category: inferNormalizedCategory(parsed),
        isOnline: parsed.isOnline,
        tempC: parsed.tempC,
        humidityPct: parsed.humidityPct,
        batteryPct: parsed.batteryPct,
        contactOpen: parsed.contactOpen,
        powerW: parsed.powerW,
        rawTraits: parsed.rawTraits,
      });
    }
  }

  return {
    roomNames: Array.from(roomNameSet),
    devices: normalizedDevices,
  };
}

interface SdmDeviceResponse {
  name: string;
  type?: string;
  assignee?: string;
  traits?: Record<string, Record<string, unknown>>;
  parentRelations?: Array<{ parent?: string; displayName?: string }>;
}

/**
 * Synchronise l'inventaire Google Nest via l'API Smart Device Management (SDM) — 100 % lecture seule.
 */
export async function fetchGoogleHomeViaSdm(
  accessToken: string,
  projectId: string
): Promise<VendorInventoryResult> {
  if (!projectId) {
    throw new Error('GOOGLE_SDM_PROJECT_ID est requis pour interroger l’API SDM.');
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const roomNameSet = new Set<string>();
  const roomPathToName = new Map<string, string>();

  const structRes = await fetch(
    `${GOOGLE_SDM_BASE_URL}/enterprises/${encodeURIComponent(projectId)}/structures`,
    { headers, cache: 'no-store' }
  );

  if (structRes.status === 401) {
    throw new Error('Session Google OAuth expirée. Reconnectez Google Home.');
  }

  if (structRes.ok) {
    const structJson = (await structRes.json()) as {
      structures?: Array<{ name?: string; traits?: Record<string, Record<string, unknown>> }>;
    };
    for (const s of structJson.structures ?? []) {
      if (!s.name) continue;
      const roomsRes = await fetch(`${GOOGLE_SDM_BASE_URL}/${s.name}/rooms`, {
        headers,
        cache: 'no-store',
      }).catch(() => null);
      if (roomsRes?.ok) {
        const roomsJson = (await roomsRes.json()) as {
          rooms?: Array<{ name?: string; traits?: Record<string, Record<string, unknown>> }>;
        };
        for (const r of roomsJson.rooms ?? []) {
          const roomName =
            typeof r.traits?.['sdm.devices.traits.RoomInfo']?.customName === 'string'
              ? String(r.traits['sdm.devices.traits.RoomInfo'].customName).trim()
              : null;
          if (roomName) {
            roomNameSet.add(roomName);
            if (r.name) roomPathToName.set(r.name, roomName);
          }
        }
      }
    }
  }

  const devRes = await fetch(
    `${GOOGLE_SDM_BASE_URL}/enterprises/${encodeURIComponent(projectId)}/devices`,
    { headers, cache: 'no-store' }
  );

  if (!devRes.ok) {
    const errText = await devRes.text().catch(() => devRes.statusText);
    if (devRes.status === 401) {
      throw new Error('Session Google OAuth expirée. Reconnectez Google Home.');
    }
    throw new Error(`Erreur API Google SDM (${devRes.status}) : ${errText.slice(0, 200)}`);
  }

  const devJson = (await devRes.json()) as { devices?: SdmDeviceResponse[] };
  const devices: NormalizedVendorDevice[] = [];

  for (const raw of devJson.devices ?? []) {
    const traits = raw.traits ?? {};
    const infoName =
      typeof traits['sdm.devices.traits.Info']?.customName === 'string'
        ? String(traits['sdm.devices.traits.Info'].customName).trim()
        : '';
    const parentRel = raw.parentRelations?.[0];
    const roomFromParent =
      (raw.assignee ? roomPathToName.get(raw.assignee) : undefined) ??
      (parentRel?.parent ? roomPathToName.get(parentRel.parent) : undefined) ??
      (typeof parentRel?.displayName === 'string' ? parentRel.displayName.trim() : null) ??
      null;

    if (roomFromParent) roomNameSet.add(roomFromParent);

    const shortType = raw.type?.split('.').pop() ?? 'Nest Device';
    const name = infoName || (roomFromParent ? `${shortType} ${roomFromParent}` : shortType);

    const connStatus = traits['sdm.devices.traits.Connectivity']?.status;
    const isOnline = typeof connStatus === 'string' ? connStatus.toUpperCase() === 'ONLINE' : true;

    const rawTemp = traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius;
    const tempC =
      typeof rawTemp === 'number' && Number.isFinite(rawTemp)
        ? Math.round(rawTemp * 100) / 100
        : null;

    const rawHum = traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent;
    const humidityPct =
      typeof rawHum === 'number' && Number.isFinite(rawHum) ? Math.round(rawHum * 10) / 10 : null;

    const rawTraits: RawDpStatus[] = Object.entries(traits).map(([code, value]) => ({
      code,
      value,
    }));

    devices.push({
      externalId: raw.name,
      name,
      roomName: roomFromParent,
      manufacturer: 'Google Nest',
      model: shortType,
      deviceType: raw.type ?? null,
      category: inferNormalizedCategory({ powerW: null, tempC, humidityPct, contactOpen: null }),
      isOnline,
      tempC,
      humidityPct,
      batteryPct: null,
      contactOpen: null,
      powerW: null,
      rawTraits,
    });
  }

  return {
    roomNames: Array.from(roomNameSet),
    devices,
  };
}

export async function fetchGoogleHomeInventory(params: {
  accessToken: string;
  mode: GoogleHomeMode;
  projectId?: string;
}): Promise<VendorInventoryResult> {
  if (params.mode === 'sdm') {
    return fetchGoogleHomeViaSdm(params.accessToken, params.projectId || getGoogleHomeConfig().sdmProjectId);
  }
  return fetchGoogleHomeViaMcp(params.accessToken);
}
