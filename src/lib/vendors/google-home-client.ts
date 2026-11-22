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

function stripMarkdownCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*\r?\n?/i, '')
    .replace(/\r?\n?```\s*$/i, '')
    .trim();
}

function extractTextFromMcpContent(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  const obj = result as Record<string, unknown>;
  if (!Array.isArray(obj.content)) return '';

  const chunks: string[] = [];
  for (const part of obj.content) {
    if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
      const txt = (part as { text: string }).text;
      if (txt.trim()) chunks.push(txt);
    }
  }
  return chunks.join('\n');
}

export function extractMcpToolPayload(result: unknown): {
  payload: Record<string, unknown>;
  isError: boolean;
  errorText: string | null;
  rawText: string;
} {
  if (!result || typeof result !== 'object') {
    return { payload: {}, isError: false, errorText: null, rawText: '' };
  }
  const obj = result as Record<string, unknown>;
  const rawText = extractTextFromMcpContent(obj);
  const isError = obj.isError === true;

  if (isError) {
    const fallbackText = obj.structuredContent
      ? JSON.stringify(obj.structuredContent).slice(0, 300)
      : null;
    return {
      payload: {},
      isError: true,
      errorText: rawText.trim() || fallbackText || 'erreur outil MCP',
      rawText,
    };
  }

  const merged: Record<string, unknown> = {};
  if (obj.structuredContent) {
    if (Array.isArray(obj.structuredContent)) {
      merged.items = obj.structuredContent;
    } else if (typeof obj.structuredContent === 'object') {
      Object.assign(merged, obj.structuredContent as Record<string, unknown>);
    }
  }

  if (Array.isArray(obj.content)) {
    for (const part of obj.content) {
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
        const cleaned = stripMarkdownCodeFence((part as { text: string }).text);
        if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
          try {
            const parsed = JSON.parse(cleaned) as unknown;
            if (Array.isArray(parsed)) {
              const prev = Array.isArray(merged.items) ? (merged.items as unknown[]) : [];
              merged.items = [...prev, ...parsed];
            } else if (parsed && typeof parsed === 'object') {
              Object.assign(merged, parsed as Record<string, unknown>);
            }
          } catch {
            // Ignorer texte non JSON
          }
        }
      }
    }
  }

  if (Object.keys(merged).length > 0) {
    return { payload: merged, isError: false, errorText: null, rawText };
  }

  if (!Array.isArray(obj.content) && !obj.structuredContent) {
    return { payload: obj, isError: false, errorText: null, rawText };
  }

  return { payload: {}, isError: false, errorText: null, rawText };
}

type McpRpcEnvelope = {
  result?: unknown;
  error?: { message?: string; code?: number };
};

export function parseMcpRpcEnvelope(rawBody: string): McpRpcEnvelope | null {
  const trimmed = rawBody.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:') || trimmed.includes('\ndata:')) {
    const dataLines = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== '[DONE]');

    let fallbackEnvelope: McpRpcEnvelope | null = null;
    for (let i = dataLines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(dataLines[i]) as McpRpcEnvelope;
        if (parsed && typeof parsed === 'object') {
          if (parsed.result !== undefined || parsed.error !== undefined) {
            return parsed;
          }
          if (!fallbackEnvelope) fallbackEnvelope = parsed;
        }
      } catch {
        // Chercher la ligne JSON suivante
      }
    }
    return fallbackEnvelope;
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
  toolLabel?: string;
  isNotification?: boolean;
}): Promise<{ payload: Record<string, unknown>; rawText: string; sessionId: string | null }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (params.sessionId) {
    headers['Mcp-Session-Id'] = params.sessionId;
  }

  const rpcBody: Record<string, unknown> = {
    jsonrpc: '2.0',
    method: params.method,
    params: params.rpcParams ?? {},
  };
  if (!params.isNotification) {
    rpcBody.id = mcpRequestSeq++;
  }

  const res = await fetch(GOOGLE_HOME_MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(rpcBody),
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

  if (params.isNotification && !rawBody.trim()) {
    return { payload: {}, rawText: '', sessionId: nextSessionId };
  }

  const rpcJson = parseMcpRpcEnvelope(rawBody);

  if (rpcJson?.error) {
    throw new Error(`Google Home MCP : ${rpcJson.error.message || 'erreur inconnue'}`);
  }

  const extracted = extractMcpToolPayload(rpcJson?.result);
  if (extracted.isError) {
    const label = params.toolLabel || params.method;
    throw new Error(`Google Home MCP (${label}) : ${extracted.errorText || 'erreur outil'}`);
  }

  return {
    payload: extracted.payload,
    rawText: extracted.rawText,
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

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const val of values) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

function stripResourcePrefix(value: string, prefixes: string[]): string {
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) {
      return value.slice(prefix.length);
    }
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function findArraysDeep(
  root: unknown,
  keys: string[],
  maxDepth = 2
): Array<Record<string, unknown>> {
  const collected: Array<Record<string, unknown>> = [];
  const seenArrays = new Set<unknown[]>();
  const visitedObjects = new Set<object>();

  function visit(node: unknown, depth: number) {
    if (!isPlainObject(node) || visitedObjects.has(node)) return;
    visitedObjects.add(node);

    for (const k of keys) {
      const candidate = node[k];
      if (Array.isArray(candidate) && !seenArrays.has(candidate)) {
        seenArrays.add(candidate);
        for (const item of candidate) {
          if (isPlainObject(item)) collected.push(item);
        }
      }
    }

    if (depth >= maxDepth) return;
    for (const [propKey, propVal] of Object.entries(node)) {
      if (keys.includes(propKey)) continue;
      if (isPlainObject(propVal)) {
        visit(propVal, depth + 1);
      }
    }
  }

  visit(root, 0);
  return collected;
}

export function parseGoogleMcpStructures(
  payload: Record<string, unknown>,
  rawText = ''
): string[] {
  const ids = new Set<string>();
  const candidates = findArraysDeep(payload, ['structures', 'homes', 'items', 'results']);
  if (isPlainObject(payload.structure)) {
    candidates.push(payload.structure);
  }

  for (const item of candidates) {
    const id = firstNonEmptyString(
      item.structureId,
      item.structure_id,
      item.id,
      item.homeId,
      item.home_id,
      item.resourceId,
      item.name
    );
    if (id) ids.add(id);
  }

  if (ids.size === 0 && rawText) {
    const matches = rawText.match(/\bstructure@[A-Za-z0-9._:-]+/g);
    if (matches) {
      for (const m of matches) ids.add(m);
    }
  }

  return Array.from(ids);
}

export function parseGoogleMcpStates(
  payload: Record<string, unknown>
): Map<string, Record<string, unknown>> {
  const stateById = new Map<string, Record<string, unknown>>();

  const indexEntry = (rawKey: string | null, st: Record<string, unknown>) => {
    const id = firstNonEmptyString(
      rawKey,
      st.resourceId,
      st.resource_id,
      st.id,
      st.deviceId,
      st.device_id
    );
    if (!id) return;
    if (!stateById.has(id)) stateById.set(id, st);
    if (id.startsWith('device@')) {
      const bare = id.slice('device@'.length);
      if (bare && !stateById.has(bare)) stateById.set(bare, st);
    }
  };

  for (const container of [payload, payload.data, payload.result, payload.response]) {
    if (!isPlainObject(container)) continue;
    for (const mapKey of ['resourceStates', 'states']) {
      const maybeMap = container[mapKey];
      if (isPlainObject(maybeMap)) {
        for (const [k, v] of Object.entries(maybeMap)) {
          if (isPlainObject(v)) indexEntry(k, v);
        }
      }
    }
  }

  const listEntries = findArraysDeep(payload, [
    'resourceStates',
    'states',
    'resources',
    'devices',
    'items',
    'results',
  ]);
  for (const st of listEntries) {
    indexEntry(null, st);
  }

  return stateById;
}

function isRoomResource(item: Record<string, unknown>): boolean {
  const idLower = (
    firstNonEmptyString(item.resourceId, item.resource_id, item.id, item.roomId, item.room_id) ?? ''
  ).toLowerCase();
  if (idLower.startsWith('room@') || idLower.startsWith('area@')) return true;

  const typeStr = (
    firstNonEmptyString(item.type, item.resourceType, item.kind) ?? ''
  ).toLowerCase();
  return /(?:^|[./:_])(room|area|space)$/.test(typeStr);
}

function isNonDeviceResource(externalId: string, item: Record<string, unknown>): boolean {
  const idLower = externalId.toLowerCase();
  if (
    idLower.startsWith('room@') ||
    idLower.startsWith('area@') ||
    idLower.startsWith('structure@') ||
    idLower.startsWith('home@') ||
    idLower.startsWith('scene@') ||
    idLower.startsWith('automation@') ||
    idLower.startsWith('routine@')
  ) {
    return true;
  }

  const typeStr = (
    firstNonEmptyString(item.type, item.resourceType, item.kind) ?? ''
  ).toLowerCase();
  return /(?:^|[./:_])(room|area|space|structure|home|scene|automation|routine)$/.test(typeStr);
}

function looksLikeRawGoogleResourceId(value: string): boolean {
  return /^(device|room|area|structure|home|scene|automation)@/i.test(value);
}

function extractReadableName(
  item: Record<string, unknown>,
  fallback: string
): string {
  const attrs = isPlainObject(item.attributes) ? item.attributes : {};
  const meta = isPlainObject(item.metadata) ? item.metadata : {};
  const candidates = [
    item.displayName,
    item.customName,
    item.label,
    item.title,
    attrs.displayName,
    attrs.name,
    meta.displayName,
    item.name,
  ];
  for (const cand of candidates) {
    if (typeof cand === 'string' && cand.trim() && !looksLikeRawGoogleResourceId(cand.trim())) {
      return cand.trim();
    }
  }
  return firstNonEmptyString(...candidates) ?? fallback;
}

function registerIdVariants(
  map: Map<string, string>,
  rawId: string,
  value: string,
  prefixes: string[]
) {
  if (!rawId) return;
  if (!map.has(rawId)) map.set(rawId, value);
  const bare = stripResourcePrefix(rawId, prefixes);
  if (bare && !map.has(bare)) map.set(bare, value);
}

function extractParentRefIds(item: Record<string, unknown>): string[] {
  const refs: string[] = [];
  const directCandidates = [
    item.roomId,
    item.room_id,
    item.parentResourceId,
    item.parent_resource_id,
    item.parentId,
    item.parent_id,
    item.areaId,
    item.spaceId,
    typeof item.room === 'string' ? item.room : null,
    typeof item.parent === 'string' ? item.parent : null,
    isPlainObject(item.room) ? item.room.resourceId ?? item.room.id ?? item.room.roomId : null,
    isPlainObject(item.parent) ? item.parent.resourceId ?? item.parent.id : null,
  ];
  for (const cand of directCandidates) {
    if (typeof cand === 'string' && cand.trim()) refs.push(cand.trim());
  }

  for (const listKey of ['parentResources', 'parents', 'relations', 'ancestors', 'memberOf']) {
    const arr = item[listKey];
    if (!Array.isArray(arr)) continue;
    for (const el of arr) {
      if (typeof el === 'string' && el.trim()) {
        refs.push(el.trim());
      } else if (isPlainObject(el)) {
        const refId = firstNonEmptyString(el.resourceId, el.id, el.roomId, el.parent);
        if (refId) refs.push(refId);
      }
    }
  }

  return refs;
}

export function parseGoogleMcpHomeResources(
  payloads: Array<Record<string, unknown>>,
  stateByDeviceId: Map<string, Record<string, unknown>>
): { roomNames: string[]; devices: NormalizedVendorDevice[] } {
  const roomNameSet = new Set<string>();
  const roomIdToName = new Map<string, string>();
  const deviceIdToRoomName = new Map<string, string>();

  // Passe 1 : collecter toutes les pièces (tableaux dédiés + ressources typées Room)
  for (const payload of payloads) {
    const explicitRooms = findArraysDeep(payload, ['rooms', 'areas', 'spaces']);
    const genericResources = findArraysDeep(payload, ['resources', 'devices', 'items', 'results']);
    const roomEntries = [...explicitRooms, ...genericResources.filter(isRoomResource)];

    for (const roomObj of roomEntries) {
      const rId = firstNonEmptyString(
        roomObj.resourceId,
        roomObj.resource_id,
        roomObj.roomId,
        roomObj.room_id,
        roomObj.id
      );
      const rName = extractReadableName(roomObj, '');
      if (!rName || looksLikeRawGoogleResourceId(rName)) continue;

      roomNameSet.add(rName);
      if (rId) {
        registerIdVariants(roomIdToName, rId, rName, ['room@', 'area@']);
      }

      for (const childKey of [
        'deviceIds',
        'childResourceIds',
        'children',
        'members',
        'devices',
        'resourceIds',
      ]) {
        const childList = roomObj[childKey];
        if (!Array.isArray(childList)) continue;
        for (const child of childList) {
          const childId =
            typeof child === 'string'
              ? child.trim()
              : isPlainObject(child)
                ? firstNonEmptyString(child.resourceId, child.id, child.deviceId)
                : null;
          if (childId) {
            registerIdVariants(deviceIdToRoomName, childId, rName, ['device@']);
          }
        }
      }
    }
  }

  // Passe 2 : collecter tous les appareils et résoudre leur pièce + état
  const normalizedDevices: NormalizedVendorDevice[] = [];
  const seenExternalIds = new Set<string>();

  for (const payload of payloads) {
    const candidates = findArraysDeep(payload, ['devices', 'resources', 'items', 'results']);
    for (const dev of candidates) {
      const externalId = firstNonEmptyString(
        dev.resourceId,
        dev.resource_id,
        dev.id,
        dev.deviceId,
        dev.device_id,
        dev.name
      );
      if (!externalId || seenExternalIds.has(externalId)) continue;
      if (isNonDeviceResource(externalId, dev)) continue;
      seenExternalIds.add(externalId);

      const bareId = stripResourcePrefix(externalId, ['device@']);
      const displayName = extractReadableName(dev, `Appareil Google ${bareId.slice(0, 8)}`);

      let resolvedRoomName = firstNonEmptyString(
        dev.roomName,
        dev.room_name,
        dev.areaName,
        isPlainObject(dev.room) ? dev.room.displayName ?? dev.room.name : null
      );

      if (!resolvedRoomName) {
        for (const refId of extractParentRefIds(dev)) {
          const hit =
            roomIdToName.get(refId) ??
            roomIdToName.get(stripResourcePrefix(refId, ['room@', 'area@']));
          if (hit) {
            resolvedRoomName = hit;
            break;
          }
        }
      }

      if (!resolvedRoomName) {
        resolvedRoomName =
          deviceIdToRoomName.get(externalId) ?? deviceIdToRoomName.get(bareId) ?? null;
      }

      if (resolvedRoomName) roomNameSet.add(resolvedRoomName);

      const matchedState =
        stateByDeviceId.get(externalId) ?? stateByDeviceId.get(bareId) ?? undefined;
      const parsed = parseMcpDeviceTraits(dev, matchedState);

      const attrs = isPlainObject(dev.attributes) ? dev.attributes : {};
      const meta = isPlainObject(dev.metadata) ? dev.metadata : {};

      normalizedDevices.push({
        externalId,
        name: displayName,
        roomName: resolvedRoomName,
        manufacturer: firstNonEmptyString(
          dev.manufacturer,
          dev.vendorName,
          attrs.manufacturer,
          meta.manufacturer
        ),
        model: firstNonEmptyString(dev.model, attrs.model, meta.model),
        deviceType: firstNonEmptyString(dev.type, dev.resourceType, attrs.deviceType),
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
  const connLabel =
    typeof merged.connectivityState === 'string'
      ? merged.connectivityState
      : typeof merged.connectivity === 'string'
        ? merged.connectivity
        : null;
  if (connLabel) {
    isOnline = connLabel.toUpperCase() === 'ONLINE';
  }

  const statesMap: Record<string, unknown> = {};
  for (const src of [
    rawItem.attributes,
    rawItem.traits,
    rawItem.states,
    stateObj?.resourceStates,
    stateObj?.traits,
    stateObj?.states,
    stateObj,
  ]) {
    if (isPlainObject(src)) {
      Object.assign(statesMap, src);
    }
  }

  for (const [traitKey, traitVal] of Object.entries(statesMap)) {
    const keyLower = traitKey.toLowerCase();
    rawTraits.push({ code: traitKey, value: traitVal });
    const obj = isPlainObject(traitVal) ? traitVal : null;

    if (keyLower.includes('connectivity')) {
      const status =
        typeof obj?.status === 'string'
          ? obj.status
          : typeof obj?.connectivityState === 'string'
            ? obj.connectivityState
            : typeof traitVal === 'string'
              ? traitVal
              : null;
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

async function fetchPaginatedMcpResourcesForStructure(params: {
  accessToken: string;
  structureId: string;
  sessionId: string | null;
}): Promise<{ payloads: Array<Record<string, unknown>>; sessionId: string | null }> {
  let sessionId = params.sessionId;
  let argKey: 'structureId' | 'structure_id' | 'home_id' = 'structureId';
  let pageToken: string | null = null;
  const payloads: Array<Record<string, unknown>> = [];

  for (let page = 0; page < 10; page++) {
    const args: Record<string, unknown> = { [argKey]: params.structureId };
    if (pageToken) args.pageToken = pageToken;

    let res;
    try {
      res = await callGoogleMcp({
        accessToken: params.accessToken,
        method: 'tools/call',
        rpcParams: { name: 'list_home_resources', arguments: args },
        sessionId,
        toolLabel: 'list_home_resources',
      });
    } catch (err) {
      if (page === 0 && argKey === 'structureId') {
        const msg = err instanceof Error ? err.message : '';
        if (/home_id|structure_id|argument|invalid|required/i.test(msg)) {
          argKey = msg.toLowerCase().includes('home_id') ? 'home_id' : 'structure_id';
          res = await callGoogleMcp({
            accessToken: params.accessToken,
            method: 'tools/call',
            rpcParams: {
              name: 'list_home_resources',
              arguments: { [argKey]: params.structureId },
            },
            sessionId,
            toolLabel: 'list_home_resources',
          });
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    sessionId = res.sessionId;
    payloads.push(res.payload);

    const nextToken = firstNonEmptyString(res.payload.nextPageToken, res.payload.next_page_token);
    if (!nextToken) break;
    pageToken = nextToken;
  }

  return { payloads, sessionId };
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
    toolLabel: 'initialize',
  });
  let sessionId = initRes.sessionId;

  await callGoogleMcp({
    accessToken,
    method: 'notifications/initialized',
    rpcParams: {},
    sessionId,
    toolLabel: 'notifications/initialized',
    isNotification: true,
  }).catch(() => null);

  const homesRes = await callGoogleMcp({
    accessToken,
    method: 'tools/call',
    rpcParams: { name: 'list_homes', arguments: {} },
    sessionId,
    toolLabel: 'list_homes',
  });
  sessionId = homesRes.sessionId;

  const structureIds = parseGoogleMcpStructures(homesRes.payload, homesRes.rawText);

  if (structureIds.length === 0) {
    const keys = Object.keys(homesRes.payload).join(', ') || 'aucune';
    const rawPreview = homesRes.rawText.trim().slice(0, 140);
    const detail = rawPreview ? ` · texte : ${rawPreview}` : '';
    return {
      roomNames: [],
      devices: [],
      warning: `list_homes n'a retourné aucune maison (clés reçues : ${keys}${detail}).`,
    };
  }

  const allResourcePayloads: Array<Record<string, unknown>> = [];
  const mergedStates = new Map<string, Record<string, unknown>>();

  for (const structureId of structureIds) {
    const [resourcesRes, statesRes] = await Promise.all([
      fetchPaginatedMcpResourcesForStructure({
        accessToken,
        structureId,
        sessionId,
      }),
      callGoogleMcp({
        accessToken,
        method: 'tools/call',
        rpcParams: { name: 'list_home_states', arguments: { structureId } },
        sessionId,
        toolLabel: 'list_home_states',
      }).catch(() => ({ payload: {}, rawText: '', sessionId })),
    ]);

    sessionId = resourcesRes.sessionId ?? statesRes.sessionId;
    allResourcePayloads.push(...resourcesRes.payloads);

    const parsedStates = parseGoogleMcpStates(statesRes.payload);
    for (const [k, v] of parsedStates.entries()) {
      mergedStates.set(k, v);
    }
  }

  const parsed = parseGoogleMcpHomeResources(allResourcePayloads, mergedStates);

  let warning: string | undefined;
  if (parsed.devices.length === 0 && parsed.roomNames.length === 0) {
    const keys = Array.from(
      new Set(allResourcePayloads.flatMap((p) => Object.keys(p)))
    )
      .join(', ')
      .slice(0, 180);
    warning = `list_home_resources n'a remonté aucune pièce ni appareil exploitable pour ${structureIds.length} maison(s) (clés reçues : ${keys || 'aucune'}).`;
  }

  return {
    roomNames: parsed.roomNames,
    devices: parsed.devices,
    warning,
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
