import crypto from 'node:crypto';
import { formatMacAddress } from '@/lib/tuya-client';
import type { DeviceCategory, RawDpStatus } from '@/types';
import type { NormalizedVendorDevice, VendorInventoryResult } from './registry';

const DEFAULT_XSENSE_API_URL = 'https://api.x-sense-iot.com';
const DEFAULT_CLIENT_SECRET = '3412567890abcdef1234567890abcdef';
const X_SENSE_APP_VERSION = 'v1.22.0_20240914.1';
const X_SENSE_APP_CODE = '1220';

// Nombre premier sûr 3072-bit AWS Cognito SRP (RFC 5054 / AWS Cognito standard)
const COGNITO_N_HEX =
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
  '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
  'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D' +
  'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
  '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9' +
  'DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
  '15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64' +
  'ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
  'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6B' +
  'F12FFA06D98A0864D87602733EC86A64521F2B18177B200C' +
  'BBE117577A615D6C770988C0BAD946E208E24FA074E5AB31' +
  '43DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF';

const COGNITO_G = 2n;
const COGNITO_N = BigInt(`0x${COGNITO_N_HEX}`);
const DERIVED_KEY_INFO = Buffer.from('Caldera Derived Key', 'utf8');

export interface XSenseConfig {
  email: string;
  password: string;
  refreshToken: string | null;
  apiUrl: string;
  configured: boolean;
}

export interface XSenseSession {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  userId?: string;
  clientId?: string;
  userPoolId?: string;
  region?: string;
  clientSecret?: string;
}

export function getXSenseConfig(): XSenseConfig {
  const email = process.env.XSENSE_EMAIL?.trim() || '';
  const password = process.env.XSENSE_PASSWORD?.trim() || '';
  const refreshToken = process.env.XSENSE_REFRESH_TOKEN?.trim() || null;
  const apiUrl = (process.env.XSENSE_API_URL?.trim() || DEFAULT_XSENSE_API_URL).replace(/\/+$/, '');

  return {
    email,
    password,
    refreshToken,
    apiUrl,
    configured: Boolean((email && password) || refreshToken),
  };
}

export function makeXSenseDeviceId(externalId: string): string {
  const safe = externalId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  return `xsense_${safe}`;
}

function asRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : null;
}

function toNum(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toStr(val: unknown): string | null {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed || null;
  }
  return null;
}

function toBool(val: unknown): boolean | null {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'on' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'off' || lower === 'no') return false;
  }
  return null;
}

/**
 * Calcule la signature MD5 `mac` attendue par l'API REST X-Sense (`api.x-sense-iot.com`).
 */
export function calculateXSenseMac(
  params: Record<string, unknown>,
  clientSecret: string = DEFAULT_CLIENT_SECRET
): string {
  let acc = '';
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      acc += JSON.stringify(value);
    } else {
      acc += String(value);
    }
  }
  return crypto.createHash('md5').update(`${acc}${clientSecret}`, 'utf8').digest('hex');
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let res = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) res = (res * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return res;
}

function padHex(hex: string): string {
  const clean = hex.replace(/^0+/, '') || '0';
  const even = clean.length % 2 === 1 ? `0${clean}` : clean;
  const firstByte = parseInt(even.slice(0, 2), 16);
  return firstByte >= 0x80 ? `00${even}` : even;
}

function hashHex(hexStr: string): string {
  return crypto.createHash('sha256').update(Buffer.from(hexStr, 'hex')).digest('hex');
}

function hkdfSha25616(ikm: Buffer, salt: Buffer, info: Buffer): Buffer {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  const t1 = crypto
    .createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest();
  return t1.subarray(0, 16);
}

function formatCognitoTimestamp(date: Date = new Date()): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const day = days[date.getUTCDay()];
  const month = months[date.getUTCMonth()];
  const d = String(date.getUTCDate());
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  const yyyy = date.getUTCFullYear();
  return `${day} ${month} ${d} ${hh}:${mm}:${ss} UTC ${yyyy}`;
}

async function callCognitoAction(
  region: string,
  target: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const endpoint = `https://cognito-idp.${region}.amazonaws.com/`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errMsg =
      toStr(json.message) ||
      toStr(json.Message) ||
      toStr(json.__type) ||
      `Erreur AWS Cognito (${res.status})`;
    throw new Error(`Authentification X-Sense refusée : ${errMsg}`);
  }
  return json;
}

async function authenticateCognitoSrp(params: {
  region: string;
  userPoolId: string;
  clientId: string;
  email: string;
  password: string;
  clientSecret?: string;
}): Promise<XSenseSession> {
  const poolShortName = params.userPoolId.includes('_')
    ? params.userPoolId.split('_')[1]
    : params.userPoolId;
  const kHex = hashHex(padHex(COGNITO_N_HEX) + padHex('02'));
  const k = BigInt(`0x${kHex}`);

  const aHex = crypto.randomBytes(32).toString('hex');
  const a = BigInt(`0x${aHex}`);
  const A = modPow(COGNITO_G, a, COGNITO_N);
  const AHex = A.toString(16);

  const initRes = await callCognitoAction(params.region, 'InitiateAuth', {
    AuthFlow: 'USER_SRP_AUTH',
    ClientId: params.clientId,
    AuthParameters: {
      USERNAME: params.email,
      SRP_A: AHex,
    },
  });

  if (initRes.ChallengeName !== 'PASSWORD_VERIFIER') {
    throw new Error(
      `Challenge X-Sense inattendu : ${toStr(initRes.ChallengeName) ?? 'inconnu'}. Utilisez un compte X-Sense invité sans MFA.`
    );
  }

  const chParams = asRecord(initRes.ChallengeParameters) ?? {};
  const srpBHex = toStr(chParams.SRP_B);
  const saltHex = toStr(chParams.SALT);
  const secretBlockB64 = toStr(chParams.SECRET_BLOCK);
  const usernameForSrp = toStr(chParams.USER_ID_FOR_SRP) ?? params.email;
  if (!srpBHex || !saltHex || !secretBlockB64) {
    throw new Error('Paramètres Cognito SRP incomplets renvoyés par X-Sense.');
  }

  const B = BigInt(`0x${srpBHex}`);
  if (B % COGNITO_N === 0n) {
    throw new Error('Paramètre SRP B invalide reçu de Cognito.');
  }

  const uHex = hashHex(padHex(AHex) + padHex(srpBHex));
  const u = BigInt(`0x${uHex}`);
  const xHex = hashHex(
    padHex(saltHex) +
      crypto
        .createHash('sha256')
        .update(`${poolShortName}${usernameForSrp}:${params.password}`, 'utf8')
        .digest('hex')
  );
  const x = BigInt(`0x${xHex}`);

  const gx = modPow(COGNITO_G, x, COGNITO_N);
  const base = ((B - k * gx) % COGNITO_N + COGNITO_N) % COGNITO_N;
  const S = modPow(base, a + u * x, COGNITO_N);

  const hkdfKey = hkdfSha25616(
    Buffer.from(padHex(S.toString(16)), 'hex'),
    Buffer.from(padHex(uHex), 'hex'),
    DERIVED_KEY_INFO
  );

  const timestamp = formatCognitoTimestamp(new Date());
  const secretBlockBuf = Buffer.from(secretBlockB64, 'base64');
  const sigMsg = Buffer.concat([
    Buffer.from(poolShortName, 'utf8'),
    Buffer.from(usernameForSrp, 'utf8'),
    secretBlockBuf,
    Buffer.from(timestamp, 'utf8'),
  ]);
  const signature = crypto.createHmac('sha256', hkdfKey).update(sigMsg).digest('base64');

  const respondRes = await callCognitoAction(params.region, 'RespondToAuthChallenge', {
    ChallengeName: 'PASSWORD_VERIFIER',
    ClientId: params.clientId,
    ChallengeResponses: {
      USERNAME: usernameForSrp,
      PASSWORD_CLAIM_SECRET_BLOCK: secretBlockB64,
      PASSWORD_CLAIM_SIGNATURE: signature,
      TIMESTAMP: timestamp,
    },
  });

  const authResult = asRecord(respondRes.AuthenticationResult);
  const idToken = toStr(authResult?.IdToken);
  const accessToken = toStr(authResult?.AccessToken) ?? '';
  const refreshToken = toStr(authResult?.RefreshToken) ?? '';
  const expiresInSec = toNum(authResult?.ExpiresIn) ?? 3600;
  if (!idToken) {
    throw new Error('Aucun IdToken renvoyé par AWS Cognito X-Sense.');
  }

  return {
    idToken,
    accessToken,
    refreshToken,
    expiresAtMs: Date.now() + expiresInSec * 1000,
    userPoolId: params.userPoolId,
    clientId: params.clientId,
    region: params.region,
    clientSecret: params.clientSecret,
  };
}

async function refreshCognitoSession(session: XSenseSession): Promise<XSenseSession> {
  if (!session.refreshToken || !session.clientId || !session.region) {
    throw new Error('RefreshToken Cognito X-Sense indisponible.');
  }
  const res = await callCognitoAction(session.region, 'InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: session.clientId,
    AuthParameters: {
      REFRESH_TOKEN: session.refreshToken,
    },
  });

  const authResult = asRecord(res.AuthenticationResult);
  const idToken = toStr(authResult?.IdToken);
  if (!idToken) {
    throw new Error('Échec de renouvellement de session Cognito X-Sense.');
  }
  const expiresInSec = toNum(authResult?.ExpiresIn) ?? 3600;

  return {
    ...session,
    idToken,
    accessToken: toStr(authResult?.AccessToken) ?? session.accessToken,
    refreshToken: toStr(authResult?.RefreshToken) ?? session.refreshToken,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  };
}

async function callXSenseApi(params: {
  apiUrl: string;
  bizCode: string;
  payload: Record<string, unknown>;
  idToken?: string;
  clientSecret?: string;
}): Promise<unknown> {
  const bodyObj: Record<string, unknown> = {
    ...params.payload,
    bizCode: params.bizCode,
    appVersion: X_SENSE_APP_VERSION,
    appCode: X_SENSE_APP_CODE,
    mac: calculateXSenseMac(params.payload, params.clientSecret),
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (params.idToken) {
    headers.Authorization = params.idToken;
  }

  const res = await fetch(`${params.apiUrl}/app`, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyObj),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Erreur HTTP X-Sense (${res.status}).`);
  }
  const reCode = toNum(json.reCode);
  if (reCode !== null && reCode !== 200 && reCode !== 0) {
    throw new Error(`Erreur API X-Sense (${reCode}) : ${toStr(json.reMsg) ?? 'requête refusée'}`);
  }
  return json.reData ?? json;
}

function convertBatteryLevel(batInfo: unknown, directPct?: unknown): number | null {
  const pct = toNum(directPct);
  if (pct !== null && pct >= 0 && pct <= 100) return Math.round(pct);

  const lvl = toNum(batInfo);
  if (lvl === null) return null;
  if (lvl > 3 && lvl <= 100) return Math.round(lvl);
  if (lvl >= 3) return 100;
  if (lvl === 2) return 75;
  if (lvl === 1) return 35;
  if (lvl === 0) return 10;
  return null;
}

function classifyXSenseUnitType(
  rawType: string | null,
  rawModel: string | null
): 'baseStation' | 'smokeCoDetector' | 'waterLeakSensor' | 'thermoHygrometer' {
  const combined = `${rawType ?? ''} ${rawModel ?? ''}`.toUpperCase();
  if (combined.includes('SBS50') || combined.includes('SBS10') || combined.includes('BASE') || combined.includes('STATION')) {
    return 'baseStation';
  }
  if (combined.includes('STH') || combined.includes('HYGRO') || combined.includes('THERM')) {
    return 'thermoHygrometer';
  }
  if (combined.includes('SWS') || combined.includes('WATER') || combined.includes('LEAK')) {
    return 'waterLeakSensor';
  }
  return 'smokeCoDetector';
}

function parseDeviceStatusBlock(
  rawStatusInput: unknown,
  unitType: 'baseStation' | 'smokeCoDetector' | 'waterLeakSensor' | 'thermoHygrometer'
): {
  tempC: number | null;
  humidityPct: number | null;
  coPpm: number | null;
  smokeDetected: boolean;
  coDetected: boolean;
  waterLeakDetected: boolean;
  isMuted: boolean;
  alarmStatus: 'normal' | 'smoke' | 'co' | 'water_leak' | 'muted' | 'fault';
  rfLevel: number | null;
  wifiRssi: number | null;
  batteryPct: number | null;
  isOnline: boolean;
} {
  const status = asRecord(rawStatusInput) ?? {};

  const tempRaw =
    toNum(status.temperature) ??
    toNum(status.temp) ??
    toNum(status.tempC) ??
    toNum(status.t);
  const tempUnit = toStr(status.tempUnit ?? status.unit)?.toUpperCase();
  let tempC = tempRaw;
  if (tempC !== null && tempUnit === 'F') {
    tempC = Math.round(((tempC - 32) * (5 / 9)) * 10) / 10;
  } else if (tempC !== null) {
    tempC = Math.round(tempC * 10) / 10;
  }

  const humRaw = toNum(status.humidity) ?? toNum(status.hum) ?? toNum(status.h);
  const humidityPct = humRaw !== null ? Math.round(humRaw * 10) / 10 : null;

  const coPpm = toNum(status.coPpm ?? status.co ?? status.ppm);
  const isMuted = toBool(status.isMuted ?? status.muteStatus ?? status.silenced) ?? false;

  const alarmFlag = toBool(status.alarmStatus ?? status.isAlarm ?? status.alarm) ?? false;
  const smokeDetected =
    (toBool(status.smokeAlarm ?? status.smokeDetected ?? status.smoke) ?? false) ||
    (alarmFlag && unitType === 'smokeCoDetector' && !(coPpm !== null && coPpm >= 30));
  const coDetected =
    (toBool(status.coAlarm ?? status.coDetected) ?? false) ||
    (coPpm !== null && coPpm >= 30);
  const waterLeakDetected =
    (toBool(status.waterLeak ?? status.leakStatus ?? status.waterAlarm ?? status.water) ?? false) ||
    (alarmFlag && unitType === 'waterLeakSensor');
  const fault = toBool(status.fault ?? status.isFault ?? status.sensorFault) ?? false;

  let alarmStatus: 'normal' | 'smoke' | 'co' | 'water_leak' | 'muted' | 'fault' = 'normal';
  if (smokeDetected) alarmStatus = 'smoke';
  else if (coDetected) alarmStatus = 'co';
  else if (waterLeakDetected) alarmStatus = 'water_leak';
  else if (isMuted) alarmStatus = 'muted';
  else if (fault) alarmStatus = 'fault';

  const rfLevel = toNum(status.rfLevel ?? status.rf);
  const wifiRssi = toNum(status.wifiRSSI ?? status.wifiRssi ?? status.rssi);
  const batteryPct = convertBatteryLevel(status.batInfo ?? status.batteryLevel, status.batteryPct ?? status.battery);

  const onlineRaw = toBool(status.online ?? status.isOnline);
  const isOnline = onlineRaw !== null ? onlineRaw : true;

  return {
    tempC,
    humidityPct,
    coPpm,
    smokeDetected,
    coDetected,
    waterLeakDetected,
    isMuted,
    alarmStatus,
    rfLevel,
    wifiRssi,
    batteryPct,
    isOnline,
  };
}

/**
 * Normalise la topologie X-Sense Cloud (maisons -> stations SBS50 / appareils Wi-Fi -> capteurs RF)
 * vers les appareils normalisés du cockpit.
 */
export function normalizeXSenseInventory(rawPayload: unknown): NormalizedVendorDevice[] {
  const root = asRecord(rawPayload) ?? {};
  const houses = Array.isArray(root.houses)
    ? root.houses
    : Array.isArray(rawPayload)
      ? rawPayload
      : [root];

  const results: NormalizedVendorDevice[] = [];
  const seenIds = new Set<string>();

  for (const hRaw of houses) {
    const house = asRecord(hRaw);
    if (!house) continue;
    const houseName = toStr(house.houseName ?? house.name);
    const roomsList = Array.isArray(house.rooms) ? house.rooms : [];
    const roomNameById = new Map<string, string>();
    for (const rRaw of roomsList) {
      const rr = asRecord(rRaw);
      const rid = toStr(rr?.roomId ?? rr?.id);
      const rName = toStr(rr?.roomName ?? rr?.name);
      if (rid && rName) roomNameById.set(rid, rName);
    }

    const stations = Array.isArray(house.stations)
      ? house.stations
      : Array.isArray(house.stationList)
        ? house.stationList
        : [];

    const standaloneDevices = Array.isArray(house.devices) ? house.devices : [];

    const processNode = (nodeRaw: unknown, parentStationName: string | null) => {
      const node = asRecord(nodeRaw);
      if (!node) return;
      const extId =
        toStr(node.deviceId ?? node.stationId ?? node.deviceSn ?? node.stationSn ?? node.id);
      if (!extId || seenIds.has(extId)) return;
      seenIds.add(extId);

      const model =
        toStr(node.deviceType ?? node.stationType ?? node.model ?? node.category) ?? 'X-Sense';
      const unitType = classifyXSenseUnitType(
        toStr(node.unitType ?? node.deviceType ?? node.stationType),
        model
      );
      const name =
        toStr(node.deviceName ?? node.stationName ?? node.name) ?? `${model} (${extId.slice(-4)})`;
      const roomIdStr = toStr(node.roomId);
      const roomName =
        toStr(node.roomName) ?? (roomIdStr ? roomNameById.get(roomIdStr) ?? null : null);

      const mergedStatus = {
        ...node,
        ...(asRecord(node.status) ?? {}),
        ...(asRecord(node.shadow) ?? {}),
      };
      const parsed = parseDeviceStatusBlock(mergedStatus, unitType);

      const category: DeviceCategory =
        unitType === 'thermoHygrometer' && (parsed.tempC !== null || parsed.humidityPct !== null)
          ? 'climate'
          : 'other';

      const serialNumber = toStr(node.deviceSn ?? node.stationSn ?? node.sn);
      const firmware = toStr(node.sw ?? node.firmwareVersion ?? node.version);
      const wifiSsid = toStr(node.ssid ?? node.wifiSsid);
      const ipAddress = toStr(node.ip ?? node.ipAddress);
      const macAddress = formatMacAddress(toStr(node.mac ?? node.wifiMac));

      const rawTraits: RawDpStatus[] = [
        { code: 'xsense:unitType', value: unitType },
        { code: 'xsense:model', value: model },
        { code: 'xsense:alarmStatus', value: parsed.alarmStatus },
        { code: 'xsense:smokeDetected', value: parsed.smokeDetected },
        { code: 'xsense:coDetected', value: parsed.coDetected },
        { code: 'xsense:waterLeakDetected', value: parsed.waterLeakDetected },
        { code: 'xsense:isMuted', value: parsed.isMuted },
        ...(parsed.coPpm !== null ? [{ code: 'xsense:coPpm', value: parsed.coPpm }] : []),
        ...(parsed.rfLevel !== null ? [{ code: 'xsense:rfLevel', value: parsed.rfLevel }] : []),
        ...(parsed.wifiRssi !== null ? [{ code: 'xsense:wifiRssi', value: parsed.wifiRssi }] : []),
        ...(parentStationName ? [{ code: 'xsense:stationName', value: parentStationName }] : []),
        ...(houseName ? [{ code: 'xsense:houseName', value: houseName }] : []),
        ...(serialNumber ? [{ code: 'xsense:serialNumber', value: serialNumber }] : []),
        ...(firmware ? [{ code: 'xsense:firmware', value: firmware }] : []),
        ...(wifiSsid ? [{ code: 'xsense:wifiSsid', value: wifiSsid }] : []),
        ...(parsed.tempC !== null ? [{ code: 'xsense:tempC', value: parsed.tempC }] : []),
        ...(parsed.humidityPct !== null
          ? [{ code: 'xsense:humidityPct', value: parsed.humidityPct }]
          : []),
      ];

      results.push({
        externalId: extId,
        name,
        roomName,
        manufacturer: 'X-Sense',
        model,
        deviceType: unitType,
        category,
        isOnline: parsed.isOnline,
        tempC: parsed.tempC,
        humidityPct: parsed.humidityPct,
        batteryPct: parsed.batteryPct,
        contactOpen: null,
        powerW: null,
        voltageV: null,
        addEleKwh: null,
        macAddress,
        ipAddress,
        rawTraits,
      });

      const subDevices = Array.isArray(node.devs)
        ? node.devs
        : Array.isArray(node.devices)
          ? node.devices
          : [];
      for (const childRaw of subDevices) {
        processNode(childRaw, name);
      }
    };

    for (const st of stations) {
      processNode(st, null);
    }
    for (const dev of standaloneDevices) {
      processNode(dev, null);
    }
  }

  return results;
}

/**
 * Récupère l'inventaire complet X-Sense Cloud en mode strictement lecture seule.
 */
export async function fetchXSenseInventoryWithSession(
  cachedSession?: XSenseSession | null
): Promise<{
  inventory: VendorInventoryResult;
  session: XSenseSession;
  sessionRenewed: boolean;
}> {
  const cfg = getXSenseConfig();
  if (!cfg.configured) {
    throw new Error(
      'Identifiants X-Sense manquants dans .env.local (XSENSE_EMAIL / XSENSE_PASSWORD).'
    );
  }

  let session = cachedSession ?? null;
  let sessionRenewed = false;

  const needNewLogin = !session || (!session.idToken && !session.refreshToken);
  if (!needNewLogin && session && session.expiresAtMs - Date.now() < 120_000) {
    try {
      session = await refreshCognitoSession(session);
      sessionRenewed = true;
    } catch {
      session = null;
    }
  }

  if (!session) {
    const appInfo = asRecord(
      await callXSenseApi({
        apiUrl: cfg.apiUrl,
        bizCode: '101001',
        payload: {
          countryCode: 'FR',
          type: '1',
        },
      })
    );

    const region = toStr(appInfo?.cgtRegion) ?? 'eu-central-1';
    const userPoolId = toStr(appInfo?.cgtUserPoolId);
    const clientId = toStr(appInfo?.cgtClientId);
    const clientSecret = toStr(appInfo?.cgtClientSecret) ?? DEFAULT_CLIENT_SECRET;

    if (cfg.refreshToken && clientId) {
      session = await refreshCognitoSession({
        idToken: '',
        accessToken: '',
        refreshToken: cfg.refreshToken,
        expiresAtMs: 0,
        clientId,
        userPoolId: userPoolId ?? undefined,
        region,
        clientSecret,
      });
      sessionRenewed = true;
    } else if (userPoolId && clientId && cfg.email && cfg.password) {
      session = await authenticateCognitoSrp({
        region,
        userPoolId,
        clientId,
        email: cfg.email,
        password: cfg.password,
        clientSecret,
      });
      sessionRenewed = true;
    } else {
      throw new Error(
        'Impossible de récupérer les paramètres Cognito X-Sense ou identifiants incomplets.'
      );
    }
  }

  const secret = session.clientSecret ?? DEFAULT_CLIENT_SECRET;
  const housesData = await callXSenseApi({
    apiUrl: cfg.apiUrl,
    bizCode: '102007',
    payload: {
      utctime: Math.floor(Date.now() / 1000),
    },
    idToken: session.idToken,
    clientSecret: secret,
  });

  const housesArr = Array.isArray(housesData)
    ? housesData
    : Array.isArray(asRecord(housesData)?.houses)
      ? (asRecord(housesData)!.houses as unknown[])
      : [];

  const enrichedHouses: unknown[] = [];
  for (const hRaw of housesArr) {
    const h = asRecord(hRaw);
    if (!h) continue;
    const houseId = toStr(h.houseId ?? h.id);
    if (!houseId) {
      enrichedHouses.push(h);
      continue;
    }
    const stationsData = await callXSenseApi({
      apiUrl: cfg.apiUrl,
      bizCode: '103007',
      payload: {
        houseId,
        utctime: Math.floor(Date.now() / 1000),
      },
      idToken: session.idToken,
      clientSecret: secret,
    }).catch(() => null);

    const stationsArr = Array.isArray(stationsData)
      ? stationsData
      : Array.isArray(asRecord(stationsData)?.stations)
        ? (asRecord(stationsData)!.stations as unknown[])
        : Array.isArray(h.stations)
          ? h.stations
          : [];

    enrichedHouses.push({
      ...h,
      stations: stationsArr,
    });
  }

  const devices = normalizeXSenseInventory({ houses: enrichedHouses });
  const roomNames = Array.from(
    new Set(devices.map((d) => d.roomName).filter((n): n is string => Boolean(n)))
  );

  return {
    inventory: {
      roomNames,
      devices,
    },
    session,
    sessionRenewed,
  };
}
