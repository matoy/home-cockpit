import crypto from 'node:crypto';
import { inferDeviceCategory, LIGHTING_TUYA_CATEGORIES } from './device-utils';
import type {
  AutomationAction,
  AutomationActionCategory,
  AutomationCondition,
  AutomationConditionCategory,
  AutomationEffectiveTime,
  AutomationMatchType,
  AutomationRecord,
  AutomationRuleType,
  DeviceCategory,
  DpConfig,
  RawDpStatus,
} from '@/types';

const TUYA_REGION_ENDPOINTS: Record<string, string> = {
  eu: 'https://openapi.tuyaeu.com',
  weu: 'https://openapi-weaz.tuyaeu.com',
  us: 'https://openapi.tuyaus.com',
  eus: 'https://openapi-ueaz.tuyaus.com',
  cn: 'https://openapi.tuyacn.com',
  in: 'https://openapi.tuyain.com',
};

export interface TuyaRawDevice {
  id: string;
  name: string;
  category: string;
  product_name?: string;
  ip?: string;
  mac?: string;
  online?: boolean;
  uid?: string;
  owner_id?: string | number;
  status?: RawDpStatus[];
}

interface TuyaTokenCache {
  accessToken: string;
  expiresAtMs: number;
  baseUrl: string;
}

let tokenCache: TuyaTokenCache | null = null;

export function getTuyaConfig() {
  const accessId = process.env.TUYA_ACCESS_ID?.trim() ?? '';
  const accessSecret = process.env.TUYA_ACCESS_SECRET?.trim() ?? '';
  const region = (process.env.TUYA_REGION?.trim() || 'eu').toLowerCase();
  const userUid = process.env.TUYA_USER_UID?.trim() ?? '';
  const baseUrl = TUYA_REGION_ENDPOINTS[region] ?? TUYA_REGION_ENDPOINTS.eu;

  return {
    configured: Boolean(accessId && accessSecret),
    accessId,
    accessSecret,
    region,
    userUid,
    baseUrl,
  };
}

function sha256Hex(payload: string): string {
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function hmacSha256Hex(message: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(message, 'utf8').digest('hex').toUpperCase();
}

function canonicalizePathWithQuery(pathWithQuery: string): string {
  const qIdx = pathWithQuery.indexOf('?');
  if (qIdx === -1) return pathWithQuery;

  const path = pathWithQuery.slice(0, qIdx);
  const query = pathWithQuery.slice(qIdx + 1);
  if (!query) return path;

  const map = new Map<string, string>();
  for (const segment of query.split('&')) {
    if (!segment) continue;
    const eqIdx = segment.indexOf('=');
    const rawKey = eqIdx === -1 ? segment : segment.slice(0, eqIdx);
    const rawVal = eqIdx === -1 ? '' : segment.slice(eqIdx + 1);
    const key = decodeURIComponent(rawKey);
    const val = decodeURIComponent(rawVal);
    map.set(key, val);
  }

  const sortedKeys = Array.from(map.keys()).sort();
  const pairs = sortedKeys.map((key) => `${key}=${map.get(key) ?? ''}`);
  return `${path}?${pairs.join('&')}`;
}

function buildSignHeaders(params: {
  method: string;
  pathWithQuery: string;
  body?: string;
  accessToken?: string;
  accessId: string;
  accessSecret: string;
}) {
  const { method, pathWithQuery, body = '', accessToken, accessId, accessSecret } = params;
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const contentHash = sha256Hex(body);
  const canonicalUrl = canonicalizePathWithQuery(pathWithQuery);
  const stringToSign = [method.toUpperCase(), contentHash, '', canonicalUrl].join('\n');
  const signPayload = accessToken
    ? accessId + accessToken + t + nonce + stringToSign
    : accessId + t + nonce + stringToSign;
  const sign = hmacSha256Hex(signPayload, accessSecret);

  const headers: Record<string, string> = {
    client_id: accessId,
    sign,
    t,
    sign_method: 'HMAC-SHA256',
    nonce,
    'Content-Type': 'application/json',
  };

  if (accessToken) {
    headers.access_token = accessToken;
  }

  return headers;
}

async function getAccessToken(): Promise<string> {
  const cfg = getTuyaConfig();
  if (!cfg.configured) {
    throw new Error('Identifiants Tuya manquants (TUYA_ACCESS_ID / TUYA_ACCESS_SECRET).');
  }

  if (tokenCache && tokenCache.baseUrl === cfg.baseUrl && tokenCache.expiresAtMs > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const pathWithQuery = '/v1.0/token?grant_type=1';
  const headers = buildSignHeaders({
    method: 'GET',
    pathWithQuery,
    accessId: cfg.accessId,
    accessSecret: cfg.accessSecret,
  });

  const res = await fetch(`${cfg.baseUrl}${pathWithQuery}`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });

  const data = (await res.json()) as {
    success: boolean;
    msg?: string;
    code?: number;
    result?: { access_token: string; expire_time: number };
  };

  if (!res.ok || !data.success || !data.result?.access_token) {
    throw new Error(`Erreur auth Tuya (${data.code ?? res.status}): ${data.msg ?? 'Token refusé'}`);
  }

  tokenCache = {
    accessToken: data.result.access_token,
    expiresAtMs: Date.now() + data.result.expire_time * 1000,
    baseUrl: cfg.baseUrl,
  };

  return tokenCache.accessToken;
}

async function tuyaRequest<T>(pathWithQuery: string, method = 'GET', body?: unknown): Promise<T> {
  const cfg = getTuyaConfig();
  const accessToken = await getAccessToken();
  const bodyStr = body ? JSON.stringify(body) : '';

  const headers = buildSignHeaders({
    method,
    pathWithQuery,
    body: bodyStr,
    accessToken,
    accessId: cfg.accessId,
    accessSecret: cfg.accessSecret,
  });

  const res = await fetch(`${cfg.baseUrl}${pathWithQuery}`, {
    method,
    headers,
    body: bodyStr || undefined,
    cache: 'no-store',
  });

  const data = (await res.json()) as {
    success: boolean;
    msg?: string;
    code?: number;
    result: T;
  };

  if (!res.ok || !data.success) {
    if (data.code === 1010) {
      tokenCache = null;
    }
    throw new Error(`Erreur Tuya API [${pathWithQuery}] (${data.code ?? res.status}): ${data.msg ?? 'Échec'}`);
  }

  return data.result;
}

export async function fetchTuyaDevices(): Promise<TuyaRawDevice[]> {
  const cfg = getTuyaConfig();
  if (cfg.userUid) {
    try {
      const devices = await tuyaRequest<TuyaRawDevice[]>(
        `/v1.0/users/${encodeURIComponent(cfg.userUid)}/devices`
      );
      if (Array.isArray(devices)) {
        return devices;
      }
    } catch {
      // Si TUYA_USER_UID est invalide ou incomplet, on bascule sur associated-users
    }
  }

  // Pagination sur les appareils associés au projet Cloud
  const collected: TuyaRawDevice[] = [];
  let lastRowKey = '';
  for (let page = 0; page < 5; page++) {
    const query = lastRowKey
      ? `/v1.0/iot-01/associated-users/devices?last_row_key=${encodeURIComponent(lastRowKey)}&size=50`
      : '/v1.0/iot-01/associated-users/devices?size=50';
    const res = await tuyaRequest<{ devices?: TuyaRawDevice[]; last_row_key?: string; has_more?: boolean }>(
      query
    );
    if (res.devices?.length) {
      collected.push(...res.devices);
    }
    if (!res.has_more || !res.last_row_key) break;
    lastRowKey = res.last_row_key;
  }
  return collected;
}

export interface TuyaRoomMappingResult {
  roomNames: string[];
  deviceRoomMap: Map<string, string>;
  warning?: string;
}

interface TuyaHomeInfo {
  home_id?: number | string;
  id?: number | string;
  name?: string;
}

interface TuyaRoomInfo {
  room_id?: number | string;
  id?: number | string;
  name?: string;
}

interface TuyaSpaceNode {
  space_id?: number | string;
  id?: number | string;
  name?: string;
}

async function collectRoomsViaV2Space(
  spaceId: string | null,
  roomNamesSet: Set<string>,
  deviceRoomMap: Map<string, string>
): Promise<boolean> {
  const path = spaceId
    ? `/v2.0/cloud/space/child?space_id=${encodeURIComponent(spaceId)}`
    : '/v2.0/cloud/space/child';
  const res = await tuyaRequest<
    Array<string | number | TuyaSpaceNode> | { data?: Array<string | number | TuyaSpaceNode> }
  >(path);

  const items = Array.isArray(res) ? res : res?.data ?? [];
  if (items.length === 0) return false;

  let foundAny = false;
  for (const item of items) {
    let childId = '';
    let childName = '';

    if (typeof item === 'string' || typeof item === 'number') {
      childId = String(item);
      const detail = await tuyaRequest<TuyaSpaceNode>(
        `/v2.0/cloud/space/${encodeURIComponent(childId)}`
      ).catch(() => null);
      childName = detail?.name?.trim() ?? '';
    } else {
      const rawId = item.space_id ?? item.id;
      childId = rawId !== undefined && rawId !== null ? String(rawId) : '';
      childName = item.name?.trim() ?? '';
      if (childId && !childName) {
        const detail = await tuyaRequest<TuyaSpaceNode>(
          `/v2.0/cloud/space/${encodeURIComponent(childId)}`
        ).catch(() => null);
        childName = detail?.name?.trim() ?? '';
      }
    }

    if (!childId || !childName) continue;
    foundAny = true;
    roomNamesSet.add(childName);

    const devRes = await tuyaRequest<
      Array<{ id?: string }> | { data?: Array<{ id?: string }>; list?: Array<{ id?: string }> }
    >(
      `/v2.0/cloud/thing/space/device?is_recursion=false&page_size=50&space_ids=${encodeURIComponent(childId)}`
    );
    const devList = Array.isArray(devRes) ? devRes : devRes?.data ?? devRes?.list ?? [];
    for (const d of devList) {
      if (d.id) {
        deviceRoomMap.set(d.id, childName);
      }
    }
  }

  return foundAny;
}

export async function resolveTuyaHomeIds(
  rawDevices: TuyaRawDevice[] = []
): Promise<{ homeIds: string[]; lastError?: string }> {
  const cfg = getTuyaConfig();
  const homeIds = new Set<string>();
  const uids = new Set<string>();

  if (cfg.userUid) uids.add(cfg.userUid);
  for (const dev of rawDevices) {
    if (dev.owner_id !== undefined && dev.owner_id !== null && String(dev.owner_id).trim()) {
      homeIds.add(String(dev.owner_id).trim());
    }
    if (dev.uid?.trim()) {
      uids.add(dev.uid.trim());
    }
  }

  let lastError: string | undefined;

  for (const uid of uids) {
    try {
      const homes = await tuyaRequest<TuyaHomeInfo[]>(
        `/v1.0/users/${encodeURIComponent(uid)}/homes`
      );
      for (const h of homes ?? []) {
        const hid = h.home_id ?? h.id;
        if (hid !== undefined && hid !== null && String(hid).trim()) {
          homeIds.add(String(hid).trim());
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { homeIds: Array.from(homeIds), lastError };
}

export async function fetchTuyaRoomMapping(
  rawDevices: TuyaRawDevice[]
): Promise<TuyaRoomMappingResult> {
  const { homeIds, lastError: homeErr } = await resolveTuyaHomeIds(rawDevices);
  let lastError = homeErr;

  const roomNamesSet = new Set<string>();
  const deviceRoomMap = new Map<string, string>();

  if (homeIds.length === 0) {
    try {
      await collectRoomsViaV2Space(null, roomNamesSet, deviceRoomMap);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  for (const homeId of homeIds) {
    let loadedViaV2 = false;
    try {
      loadedViaV2 = await collectRoomsViaV2Space(homeId, roomNamesSet, deviceRoomMap);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (loadedViaV2) continue;

    // Repli sur l'API Smart Home v1.0 si disponible
    try {
      const res = await tuyaRequest<
        TuyaRoomInfo[] | { rooms?: TuyaRoomInfo[] }
      >(`/v1.0/homes/${encodeURIComponent(homeId)}/rooms`);

      const roomsList = Array.isArray(res) ? res : res?.rooms ?? [];
      for (const room of roomsList) {
        const roomId = room.room_id ?? room.id;
        const roomName = room.name?.trim();
        if (!roomId || !roomName) continue;

        roomNamesSet.add(roomName);
        try {
          const roomDevices = await tuyaRequest<Array<{ id?: string }>>(
            `/v1.0/homes/${encodeURIComponent(homeId)}/rooms/${encodeURIComponent(String(roomId))}/devices`
          );
          for (const rd of roomDevices ?? []) {
            if (rd.id) {
              deviceRoomMap.set(rd.id, roomName);
            }
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  if (roomNamesSet.size === 0 && lastError) {
    return {
      roomNames: [],
      deviceRoomMap,
      warning: `Pièces Tuya non importées (vérifiez IoT Core / Smart Home Basic Service sur iot.tuya.com) : ${lastError}`,
    };
  }

  return {
    roomNames: Array.from(roomNamesSet),
    deviceRoomMap,
  };
}

export interface TuyaAutomationsResult {
  automations: AutomationRecord[];
  warning?: string;
}

function formatPropertyPairs(props: Record<string, unknown>): string {
  const entries = Object.entries(props);
  if (entries.length === 0) return 'Action exécutée';
  return entries
    .map(([k, v]) => {
      if (typeof v === 'boolean') return `${k}: ${v ? 'ON' : 'OFF'}`;
      return `${k}: ${String(v)}`;
    })
    .join(', ');
}

function normalizeCondition(raw: Record<string, unknown>): AutomationCondition {
  const entityType = raw.entity_type;
  const display = (raw.display ?? raw.rule ?? {}) as Record<string, unknown>;
  const exprList = Array.isArray(raw.expr) ? (raw.expr as Array<Record<string, unknown>>) : [];
  const firstExpr = exprList[0] ?? {};

  const code =
    (typeof firstExpr.code === 'string' ? firstExpr.code : null) ??
    (typeof display.code === 'string' ? display.code : null) ??
    (typeof raw.cond_type === 'string' ? raw.cond_type : null);

  const operator =
    (typeof firstExpr.operator === 'string' ? firstExpr.operator : null) ??
    (typeof display.operator === 'string' ? display.operator : null) ??
    null;

  const rawVal = firstExpr.value ?? display.value ?? firstExpr.status_value ?? null;
  const value: string | number | boolean | null =
    typeof rawVal === 'string' || typeof rawVal === 'number' || typeof rawVal === 'boolean'
      ? rawVal
      : rawVal !== null && rawVal !== undefined
        ? JSON.stringify(rawVal)
        : null;

  const entityIdRaw = raw.dev_id ?? raw.entity_id;
  const entityId =
    entityIdRaw !== undefined && entityIdRaw !== null && String(entityIdRaw).trim()
      ? String(entityIdRaw).trim()
      : null;
  const entityName = typeof raw.entity_name === 'string' ? raw.entity_name.trim() : null;

  let category: AutomationConditionCategory = 'other';
  if (
    entityType === 4 ||
    entityType === 'timer' ||
    entityType === 6 ||
    code === 'timer' ||
    code === 'time' ||
    typeof display.time === 'string'
  ) {
    category = 'timer';
  } else if (entityType === 3 || entityType === 'weather' || entityType === 10) {
    category = 'weather';
  } else if (entityType === 5 || entityType === 'geofence') {
    category = 'geofence';
  } else if (entityType === 1 || entityType === 'device' || Boolean(raw.dev_id) || Boolean(code)) {
    category = 'device';
  }

  let summary = '';
  if (category === 'timer') {
    const timeVal =
      (typeof display.time === 'string' ? display.time : null) ??
      (value !== null ? String(value) : null) ??
      'Planifié';
    summary = `Horaire : ${timeVal}`;
  } else if (category === 'weather') {
    summary = `Météo (${code ?? 'condition'}${operator ? ` ${operator}` : ''}${value !== null ? ` ${String(value)}` : ''})`;
  } else if (category === 'geofence') {
    summary = `Géolocalisation (${code ?? String(value ?? 'zone')})`;
  } else if (code) {
    const valStr = typeof value === 'boolean' ? (value ? 'true' : 'false') : value !== null ? String(value) : '';
    summary = `${code}${operator ? ` ${operator}` : ' :'}${valStr ? ` ${valStr}` : ''}`.trim();
  } else {
    summary = entityName || 'Condition configurée';
  }

  return {
    category,
    entityId: category === 'device' ? entityId : null,
    entityName,
    code,
    operator,
    value,
    summary,
  };
}

function normalizeAction(raw: Record<string, unknown>): AutomationAction {
  const executor = typeof raw.action_executor === 'string' ? raw.action_executor : null;
  const execLower = (executor ?? '').toLowerCase();
  const entityIdRaw = raw.dev_id ?? raw.entity_id;
  const entityId =
    entityIdRaw !== undefined && entityIdRaw !== null && String(entityIdRaw).trim()
      ? String(entityIdRaw).trim()
      : null;
  const entityName = typeof raw.entity_name === 'string' ? raw.entity_name.trim() : null;

  const propObj = (
    raw.executor_property && typeof raw.executor_property === 'object'
      ? raw.executor_property
      : raw.rule && typeof raw.rule === 'object'
        ? raw.rule
        : {}
  ) as Record<string, unknown>;

  let category: AutomationActionCategory = 'other';
  if (execLower.includes('delay')) {
    category = 'delay';
  } else if (
    execLower.includes('notify') ||
    execLower.includes('push') ||
    execLower.includes('sms') ||
    execLower.includes('message')
  ) {
    category = 'notification';
  } else if (execLower.includes('rule') || execLower.includes('scene') || execLower.includes('automation')) {
    category = 'rule';
  } else if (
    execLower === 'dpissue' ||
    execLower.includes('device') ||
    Boolean(raw.dev_id) ||
    Object.keys(propObj).length > 0
  ) {
    category = 'device';
  }

  let summary = '';
  if (category === 'delay') {
    const mins = propObj.minutes ?? propObj.minute ?? 0;
    const secs = propObj.seconds ?? propObj.second ?? 0;
    summary = `Temporisation : ${mins ? `${mins} min ` : ''}${secs ? `${secs} s` : ''}`.trim();
  } else if (category === 'notification') {
    summary = 'Notification Push Smart Life';
  } else if (category === 'rule') {
    summary = `Exécuter scénario${entityName ? ` (${entityName})` : ''}`;
  } else {
    summary = formatPropertyPairs(propObj);
  }

  return {
    category,
    entityId: category === 'device' ? entityId : null,
    entityName,
    executor,
    properties: propObj,
    summary,
  };
}

function normalizeEffectiveTime(raw: Record<string, unknown>): AutomationEffectiveTime | null {
  const eff = (raw.effective_time ?? null) as Record<string, unknown> | null;
  if (!eff || typeof eff !== 'object') return null;

  return {
    allDay: Boolean(eff.all_day ?? (eff.start_time === '00:00' && eff.end_time === '23:59')),
    startTime: typeof eff.start_time === 'string' ? eff.start_time : '00:00',
    endTime: typeof eff.end_time === 'string' ? eff.end_time : '23:59',
    loops: typeof eff.loops === 'string' ? eff.loops : '1111111',
  };
}

function normalizeTuyaRule(
  raw: Record<string, unknown>,
  homeId: string,
  defaultType: AutomationRuleType,
  nowIso: string
): AutomationRecord | null {
  const rawId = raw.rule_id ?? raw.automation_id ?? raw.scene_id ?? raw.id;
  if (!rawId) return null;
  const id = String(rawId);
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Scénario ${id}`;

  const rawRuleType =
    raw.type === 'scene' || raw.rule_type === 'scene' || defaultType === 'scene'
      ? 'scene'
      : 'automation';

  const enabled =
    typeof raw.enabled === 'boolean'
      ? raw.enabled
      : raw.status !== 0 && raw.status !== false && raw.status !== 'disabled';

  const rawMatch = raw.match_type ?? raw.cond_type;
  const matchType: AutomationMatchType =
    rawRuleType === 'scene' ? 'manual' : rawMatch === 2 ? 'all' : 'any';

  const rawConditions = Array.isArray(raw.conditions)
    ? (raw.conditions as Array<Record<string, unknown>>)
    : [];
  const rawActions = Array.isArray(raw.actions)
    ? (raw.actions as Array<Record<string, unknown>>)
    : [];

  return {
    id,
    homeId,
    name,
    ruleType: rawRuleType,
    enabled,
    matchType,
    effectiveTime: normalizeEffectiveTime(raw),
    conditions: rawConditions.map(normalizeCondition),
    actions: rawActions.map(normalizeAction),
    rawPayload: raw,
    syncedAt: nowIso,
  };
}

export async function fetchTuyaAutomations(
  rawDevices?: TuyaRawDevice[]
): Promise<TuyaAutomationsResult> {
  const devicesSource = rawDevices ?? (await fetchTuyaDevices().catch(() => []));
  const { homeIds, lastError: homeErr } = await resolveTuyaHomeIds(devicesSource);
  let lastError = homeErr;

  const collected = new Map<string, AutomationRecord>();
  const nowIso = new Date().toISOString();

  for (const homeId of homeIds) {
    let foundViaV2 = false;

    for (const ruleKind of ['automation', 'scene'] as const) {
      try {
        const res = await tuyaRequest<
          | Array<Record<string, unknown>>
          | { list?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> }
        >(
          `/v2.0/cloud/scene/rule?page_no=1&page_size=50&space_id=${encodeURIComponent(homeId)}&type=${ruleKind}`
        );

        const list = Array.isArray(res) ? res : res?.list ?? res?.data ?? [];
        if (list.length > 0) foundViaV2 = true;

        for (const item of list) {
          let fullItem = item;
          const rid = item.rule_id ?? item.id;
          const hasConds = Array.isArray(item.conditions) && item.conditions.length > 0;
          const hasActs = Array.isArray(item.actions) && item.actions.length > 0;

          if (rid && (!hasActs || (ruleKind === 'automation' && !hasConds))) {
            const detail = await tuyaRequest<Record<string, unknown>>(
              `/v2.0/cloud/scene/rule/${encodeURIComponent(String(rid))}`
            ).catch(() => null);
            if (detail && typeof detail === 'object') {
              fullItem = { ...item, ...detail };
            }
          }

          const normalized = normalizeTuyaRule(fullItem, homeId, ruleKind, nowIso);
          if (normalized) {
            collected.set(normalized.id, normalized);
          }
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (foundViaV2) continue;

    // Repli v1.0 : automations + scenes
    try {
      const autoList = await tuyaRequest<Array<Record<string, unknown>>>(
        `/v1.0/homes/${encodeURIComponent(homeId)}/automations`
      );
      for (const item of autoList ?? []) {
        let fullItem = item;
        const aid = item.automation_id ?? item.id;
        const hasConds = Array.isArray(item.conditions) && item.conditions.length > 0;
        const hasActs = Array.isArray(item.actions) && item.actions.length > 0;
        if (aid && (!hasConds || !hasActs)) {
          const detail = await tuyaRequest<Record<string, unknown>>(
            `/v1.0/homes/${encodeURIComponent(homeId)}/automations/${encodeURIComponent(String(aid))}`
          ).catch(() => null);
          if (detail && typeof detail === 'object') {
            fullItem = { ...item, ...detail };
          }
        }
        const normalized = normalizeTuyaRule(fullItem, homeId, 'automation', nowIso);
        if (normalized) collected.set(normalized.id, normalized);
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    try {
      const sceneList = await tuyaRequest<Array<Record<string, unknown>>>(
        `/v1.0/homes/${encodeURIComponent(homeId)}/scenes`
      );
      for (const item of sceneList ?? []) {
        const normalized = normalizeTuyaRule(item, homeId, 'scene', nowIso);
        if (normalized) collected.set(normalized.id, normalized);
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  if (collected.size === 0 && lastError) {
    return {
      automations: [],
      warning: `Scénarios Tuya non importés (vérifiez IoT Core / Smart Home Scene Linkage sur iot.tuya.com) : ${lastError}`,
    };
  }

  return {
    automations: Array.from(collected.values()),
  };
}

export interface TuyaDpSpec {
  code: string;
  type: string;
  scale?: number;
  unit?: string;
}

export async function fetchDeviceSpecification(deviceId: string): Promise<Record<string, TuyaDpSpec>> {
  try {
    const res = await tuyaRequest<{
      status?: Array<{ code: string; type: string; values?: string }>;
      functions?: Array<{ code: string; type: string; values?: string }>;
    }>(`/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/specification`);

    const map: Record<string, TuyaDpSpec> = {};
    for (const item of [...(res.status ?? []), ...(res.functions ?? [])]) {
      let scale: number | undefined;
      let unit: string | undefined;
      if (item.values) {
        try {
          const parsed = JSON.parse(item.values) as { scale?: number; unit?: string };
          if (typeof parsed.scale === 'number') scale = parsed.scale;
          if (typeof parsed.unit === 'string') unit = parsed.unit;
        } catch {
          // Ignore malformed values JSON
        }
      }
      map[item.code] = { code: item.code, type: item.type, scale, unit };
    }
    return map;
  } catch {
    return {};
  }
}

export interface TuyaBatchStatusItem {
  id: string;
  status: RawDpStatus[];
}

export async function fetchBatchStatuses(deviceIds: string[]): Promise<Map<string, RawDpStatus[]>> {
  const result = new Map<string, RawDpStatus[]>();
  if (deviceIds.length === 0) return result;

  // Lots de 20 appareils pour optimiser le quota gratuit Tuya IoT Core
  for (let i = 0; i < deviceIds.length; i += 20) {
    const chunk = deviceIds.slice(i, i + 20);
    const idsParam = chunk.join(',');
    const items = await tuyaRequest<TuyaBatchStatusItem[]>(
      `/v1.0/iot-03/devices/status?device_ids=${idsParam}`
    );
    for (const item of items ?? []) {
      result.set(item.id, item.status ?? []);
    }
  }

  return result;
}

export function formatMacAddress(rawMac: string | undefined | null): string | null {
  if (!rawMac) return null;
  const trimmed = rawMac.trim().toUpperCase();
  if (!trimmed) return null;
  const compact = trimmed.replace(/[^A-F0-9]/g, '');
  if (compact.length === 12) {
    return compact.match(/.{1,2}/g)?.join(':') ?? trimmed;
  }
  return trimmed;
}

export async function fetchBatchFactoryInfos(
  deviceIds: string[]
): Promise<Map<string, { mac: string | null }>> {
  const result = new Map<string, { mac: string | null }>();
  if (deviceIds.length === 0) return result;

  for (let i = 0; i < deviceIds.length; i += 20) {
    const chunk = deviceIds.slice(i, i + 20);
    try {
      const items = await tuyaRequest<Array<{ id?: string; mac?: string }>>(
        `/v1.0/devices/factory-infos?device_ids=${chunk.join(',')}`
      );
      for (const item of items ?? []) {
        if (item.id) {
          result.set(item.id, { mac: formatMacAddress(item.mac) });
        }
      }
    } catch {
      // Ignore si la permission factory-infos n'est pas autorisée sur le projet Tuya
    }
  }

  return result;
}

const POWER_CODES = ['cur_power', 'power', 'total_power', 'active_power', 'power_a'];
const VOLTAGE_CODES = ['cur_voltage', 'voltage_a', 'voltage', 'phase_a'];
const CURRENT_CODES = ['cur_current', 'current', 'current_a'];
const ADD_ELE_CODES = ['add_ele', 'forward_energy_total', 'ele', 'total_forward_energy'];
const TEMP_CODES = ['va_temperature', 'temp_current', 'temp_value', 'temperature'];
const HUMIDITY_CODES = ['va_humidity', 'humidity_value', 'humidity_current', 'humidity'];
const BATTERY_CODES = ['battery_percentage', 'va_battery', 'battery_value', 'battery_state'];
const CONTACT_CODES = [
  'doorcontact_state',
  'contact_state',
  'door_state',
  'window_state',
  'open_close',
  'sensor_state',
  'magnet_state',
];

function findMatchingDp(
  rawStatus: RawDpStatus[],
  candidates: string[]
): RawDpStatus | undefined {
  for (const code of candidates) {
    const match = rawStatus.find((item) => item.code === code && typeof item.value === 'number');
    if (match) return match;
  }
  return undefined;
}

function findMatchingAnyDp(
  rawStatus: RawDpStatus[],
  candidates: string[]
): RawDpStatus | undefined {
  for (const code of candidates) {
    const match = rawStatus.find(
      (item) => item.code === code && item.value !== undefined && item.value !== null
    );
    if (match) return match;
  }
  return undefined;
}

function resolveScale(
  code: string,
  rawValue: unknown,
  specMap: Record<string, TuyaDpSpec>,
  defaultScale: number,
  heuristic?: (val: number) => number
): number {
  const spec = specMap[code];
  if (spec && typeof spec.scale === 'number') {
    return Math.pow(10, -spec.scale);
  }
  if (typeof rawValue === 'number' && heuristic) {
    return heuristic(rawValue);
  }
  return defaultScale;
}

export function autoDetectDpConfig(
  rawStatus: RawDpStatus[],
  specMap: Record<string, TuyaDpSpec> = {},
  tuyaCategory?: string
): { dpConfig: DpConfig; category: DeviceCategory } {
  const dpConfig: DpConfig = {};

  const powerDp = findMatchingDp(rawStatus, POWER_CODES);
  if (powerDp) {
    dpConfig.power = {
      code: powerDp.code,
      scale: resolveScale(powerDp.code, powerDp.value, specMap, 0.1),
    };
  }

  const voltageDp = findMatchingDp(rawStatus, VOLTAGE_CODES);
  if (voltageDp) {
    dpConfig.voltage = {
      code: voltageDp.code,
      scale: resolveScale(voltageDp.code, voltageDp.value, specMap, 0.1, (v) => (v > 400 ? 0.1 : 1)),
    };
  }

  const currentDp = findMatchingDp(rawStatus, CURRENT_CODES);
  if (currentDp) {
    dpConfig.current = {
      code: currentDp.code,
      scale: resolveScale(currentDp.code, currentDp.value, specMap, 1),
    };
  }

  const addEleDp = findMatchingDp(rawStatus, ADD_ELE_CODES);
  if (addEleDp) {
    dpConfig.addEle = {
      code: addEleDp.code,
      scale: resolveScale(addEleDp.code, addEleDp.value, specMap, 0.001),
    };
  }

  const isLighting = Boolean(
    tuyaCategory && LIGHTING_TUYA_CATEGORIES.has(tuyaCategory.toLowerCase())
  );
  const tempCandidates = isLighting ? TEMP_CODES.filter((c) => c !== 'temp_value') : TEMP_CODES;
  const tempDp = findMatchingDp(rawStatus, tempCandidates);
  if (tempDp) {
    dpConfig.temp = {
      code: tempDp.code,
      scale: resolveScale(tempDp.code, tempDp.value, specMap, 0.1, (v) =>
        Math.abs(v) > 65 ? 0.1 : 1
      ),
    };
  }

  const humidityDp = findMatchingDp(rawStatus, HUMIDITY_CODES);
  if (humidityDp) {
    dpConfig.humidity = {
      code: humidityDp.code,
      scale: resolveScale(humidityDp.code, humidityDp.value, specMap, 1, (v) => (v > 100 ? 0.1 : 1)),
    };
  }

  const batteryDp = findMatchingAnyDp(rawStatus, BATTERY_CODES);
  if (batteryDp) {
    dpConfig.battery = {
      code: batteryDp.code,
      scale: resolveScale(batteryDp.code, batteryDp.value, specMap, 1),
    };
  }

  let contactDp = findMatchingAnyDp(rawStatus, CONTACT_CODES);
  if (!contactDp && tuyaCategory === 'mcs') {
    contactDp = findMatchingAnyDp(rawStatus, ['switch', 'switch_1']);
  }
  if (contactDp) {
    dpConfig.contact = {
      code: contactDp.code,
      scale: 1,
    };
  }

  const category = inferDeviceCategory(dpConfig, tuyaCategory);

  return { dpConfig, category };
}

export interface ExtractedMetrics {
  powerW: number | null;
  voltageV: number | null;
  currentMa: number | null;
  addEleKwh: number | null;
  tempC: number | null;
  humidityPct: number | null;
  batteryPct: number | null;
  contactOpen: boolean | null;
}

function readScaledMetric(
  rawStatus: RawDpStatus[],
  mapping?: { code: string; scale: number }
): number | null {
  if (!mapping?.code) return null;
  const dp = rawStatus.find((item) => item.code === mapping.code);
  if (!dp || typeof dp.value !== 'number' || !Number.isFinite(dp.value)) {
    return null;
  }
  const scaled = dp.value * (mapping.scale || 1);
  return Math.round(scaled * 1000) / 1000;
}

function readBatteryMetric(
  rawStatus: RawDpStatus[],
  mapping?: { code: string; scale: number }
): number | null {
  const numeric = readScaledMetric(rawStatus, mapping);
  if (numeric !== null) return numeric;
  if (!mapping?.code) return null;
  const dp = rawStatus.find((item) => item.code === mapping.code);
  if (!dp || typeof dp.value !== 'string') return null;
  const val = dp.value.trim().toLowerCase();
  if (val === 'high') return 100;
  if (val === 'middle' || val === 'medium') return 60;
  if (val === 'low') return 15;
  return null;
}

function readContactMetric(
  rawStatus: RawDpStatus[],
  mapping?: { code: string; scale: number }
): boolean | null {
  if (!mapping?.code) return null;
  const dp = rawStatus.find((item) => item.code === mapping.code);
  if (!dp || dp.value === undefined || dp.value === null) return null;

  let isOpen: boolean | null = null;
  if (typeof dp.value === 'boolean') {
    isOpen = dp.value;
  } else if (typeof dp.value === 'number' && Number.isFinite(dp.value)) {
    isOpen = dp.value > 0;
  } else if (typeof dp.value === 'string') {
    const v = dp.value.trim().toLowerCase();
    if (v === 'open' || v === 'opened' || v === 'true' || v === '1' || v === 'alarm') {
      isOpen = true;
    } else if (v === 'close' || v === 'closed' || v === 'false' || v === '0' || v === 'normal') {
      isOpen = false;
    }
  }

  if (isOpen === null) return null;
  return mapping.scale < 0 ? !isOpen : isOpen;
}

export function extractMetricsFromStatus(
  rawStatus: RawDpStatus[],
  dpConfig: DpConfig
): ExtractedMetrics {
  return {
    powerW: readScaledMetric(rawStatus, dpConfig.power),
    voltageV: readScaledMetric(rawStatus, dpConfig.voltage),
    currentMa: readScaledMetric(rawStatus, dpConfig.current),
    addEleKwh: readScaledMetric(rawStatus, dpConfig.addEle),
    tempC: readScaledMetric(rawStatus, dpConfig.temp),
    humidityPct: readScaledMetric(rawStatus, dpConfig.humidity),
    batteryPct: readBatteryMetric(rawStatus, dpConfig.battery),
    contactOpen: readContactMetric(rawStatus, dpConfig.contact),
  };
}
