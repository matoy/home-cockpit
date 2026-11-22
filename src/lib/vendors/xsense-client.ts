import crypto from 'node:crypto';
import { formatMacAddress } from '@/lib/tuya-client';
import type { DeviceCategory, RawDpStatus } from '@/types';
import type { NormalizedVendorDevice, VendorInventoryResult } from './registry';

const DEFAULT_XSENSE_API_URL = 'https://api.x-sense-iot.com';
const DEFAULT_CLIENT_SECRET = '3412567890abcdef1234567890abcdef';
const X_SENSE_APP_VERSION = 'v1.22.0_20240914.1';
const X_SENSE_APP_CODE = '1220';
const X_SENSE_CLIENT_TYPE = '1';

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
  email?: string;
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
 * Décode le clientSecret Base64 renvoyé par l'endpoint X-Sense `101001` (`value[4:-1]`).
 */
export function decodeXSenseClientSecret(encoded: string): string {
  const raw = Buffer.from(encoded.trim(), 'base64');
  if (raw.length > 5) {
    return raw.subarray(4, raw.length - 1).toString('utf8');
  }
  return raw.toString('utf8');
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
    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === 'string') {
        acc += value.join('');
      } else {
        acc += JSON.stringify(value);
      }
    } else if (typeof value === 'object') {
      acc += JSON.stringify(value);
    } else {
      acc += String(value);
    }
  }
  return crypto
    .createHash('md5')
    .update(Buffer.concat([Buffer.from(acc, 'utf8'), Buffer.from(clientSecret, 'utf8')]))
    .digest('hex');
}

function computeCognitoSecretHash(
  username: string,
  clientId: string,
  clientSecret: string
): string {
  return crypto
    .createHmac('sha256', Buffer.from(clientSecret, 'utf8'))
    .update(`${username}${clientId}`, 'utf8')
    .digest('base64');
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

  const authParameters: Record<string, string> = {
    USERNAME: params.email,
    SRP_A: AHex,
  };
  if (params.clientSecret) {
    authParameters.SECRET_HASH = computeCognitoSecretHash(
      params.email,
      params.clientId,
      params.clientSecret
    );
  }

  const initRes = await callCognitoAction(params.region, 'InitiateAuth', {
    AuthFlow: 'USER_SRP_AUTH',
    ClientId: params.clientId,
    AuthParameters: authParameters,
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
  const cognitoUsername = toStr(chParams.USERNAME) ?? params.email;
  const usernameForSrp = toStr(chParams.USER_ID_FOR_SRP) ?? cognitoUsername;
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

  const challengeResponses: Record<string, string> = {
    USERNAME: cognitoUsername,
    PASSWORD_CLAIM_SECRET_BLOCK: secretBlockB64,
    PASSWORD_CLAIM_SIGNATURE: signature,
    TIMESTAMP: timestamp,
  };
  if (params.clientSecret) {
    challengeResponses.SECRET_HASH = computeCognitoSecretHash(
      cognitoUsername,
      params.clientId,
      params.clientSecret
    );
  }

  const respondRes = await callCognitoAction(params.region, 'RespondToAuthChallenge', {
    ChallengeName: 'PASSWORD_VERIFIER',
    ClientId: params.clientId,
    ChallengeResponses: challengeResponses,
  });

  const authResult = asRecord(respondRes.AuthenticationResult);
  const idToken = toStr(authResult?.IdToken) ?? '';
  const accessToken = toStr(authResult?.AccessToken);
  const refreshToken = toStr(authResult?.RefreshToken) ?? '';
  const expiresInSec = toNum(authResult?.ExpiresIn) ?? 3600;
  if (!accessToken) {
    throw new Error('Aucun AccessToken renvoyé par AWS Cognito X-Sense.');
  }

  return {
    idToken,
    accessToken,
    refreshToken,
    expiresAtMs: Date.now() + expiresInSec * 1000,
    userId: cognitoUsername,
    email: params.email,
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
  const authParams: Record<string, string> = {
    REFRESH_TOKEN: session.refreshToken,
  };
  if (session.clientSecret) {
    const hashUser = session.userId ?? session.email ?? '';
    authParams.SECRET_HASH = hashUser
      ? computeCognitoSecretHash(hashUser, session.clientId, session.clientSecret)
      : session.clientSecret;
  }

  const res = await callCognitoAction(session.region, 'InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: session.clientId,
    AuthParameters: authParams,
  });

  const authResult = asRecord(res.AuthenticationResult);
  const accessToken = toStr(authResult?.AccessToken);
  if (!accessToken) {
    throw new Error('Échec de renouvellement de session Cognito X-Sense.');
  }
  const expiresInSec = toNum(authResult?.ExpiresIn) ?? 3600;

  return {
    ...session,
    accessToken,
    idToken: toStr(authResult?.IdToken) ?? session.idToken,
    refreshToken: toStr(authResult?.RefreshToken) ?? session.refreshToken,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  };
}

async function callXSenseApi(params: {
  apiUrl: string;
  bizCode: string;
  payload: Record<string, unknown>;
  accessToken?: string;
  clientSecret?: string;
  unauth?: boolean;
}): Promise<unknown> {
  const mac = params.unauth
    ? 'abcdefg'
    : calculateXSenseMac(params.payload, params.clientSecret);

  const bodyObj: Record<string, unknown> = {
    ...params.payload,
    clientType: X_SENSE_CLIENT_TYPE,
    mac,
    appVersion: X_SENSE_APP_VERSION,
    bizCode: params.bizCode,
    appCode: X_SENSE_APP_CODE,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (!params.unauth && params.accessToken) {
    headers.Authorization = params.accessToken;
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
    throw new Error(`Erreur HTTP X-Sense (${res.status}) : ${toStr(json.message ?? json.reMsg) ?? 'requête refusée'}`);
  }
  const reCode = toNum(json.reCode);
  if (reCode !== null && reCode !== 200 && reCode !== 0) {
    const errCode = toStr(json.errCode);
    const reMsg = toStr(json.reMsg) ?? 'requête refusée';
    const isSessionError =
      errCode === '10000008' ||
      errCode === '10000020' ||
      /another device is logged in|session|expired|token/i.test(reMsg);
    if (isSessionError) {
      throw new XSenseSessionExpiredError(
        `Erreur API X-Sense (${reCode}) : ${reMsg} — X-Sense n’autorise qu’une session active par compte (utilisez un compte invité/partagé dédié dans l’app X-Sense).`
      );
    }
    throw new Error(`Erreur API X-Sense (${reCode}) : ${reMsg}`);
  }
  return json.reData ?? json;
}

class XSenseSessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XSenseSessionExpiredError';
  }
}

// ---------- AWS IoT SigV4 GET (Lecture seule des Shadows X-Sense) ----------

function hmacSha256Raw(key: Buffer | string, msg: string): Buffer {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}

function sha256Hex(msg: string): string {
  return crypto.createHash('sha256').update(msg, 'utf8').digest('hex');
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

async function fetchAwsIotShadowGet(params: {
  url: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}): Promise<Record<string, unknown> | null> {
  const parsed = new URL(params.url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 'iotdata';
  const scope = `${dateStamp}/${params.region}/${service}/aws4_request`;

  const queryPairs: Array<[string, string]> = [];
  parsed.searchParams.forEach((v, k) => {
    queryPairs.push([k, v]);
  });
  queryPairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const canonicalQuery = queryPairs
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join('&');

  const rawHeaders: Record<string, string> = {
    'content-type': 'application/x-amz-json-1.0',
    host: parsed.host,
    'user-agent': 'aws-sdk-iOS/2.26.5 iOS/17.3',
    'x-amz-date': amzDate,
    'x-amz-security-token': params.sessionToken,
  };
  const headerKeys = Object.keys(rawHeaders).sort();
  const canonicalHeaders = headerKeys.map((k) => `${k}:${rawHeaders[k]}\n`).join('');
  const signedHeaders = headerKeys.join(';');
  const payloadHash = sha256Hex('');

  const canonicalRequest = [
    'GET',
    parsed.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256Raw(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256Raw(kDate, params.region);
  const kService = hmacSha256Raw(kRegion, service);
  const kSigning = hmacSha256Raw(kService, 'aws4_request');
  const signature = crypto
    .createHmac('sha256', kSigning)
    .update(stringToSign, 'utf8')
    .digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(params.url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/x-amz-json-1.0',
      'User-Agent': 'aws-sdk-iOS/2.26.5 iOS/17.3',
      'X-Amz-Date': amzDate,
      'X-Amz-Security-Token': params.sessionToken,
      Authorization: authorization,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);

  if (!res || !res.ok) return null;
  const json = (await res.json().catch(() => null)) as unknown;
  const root = asRecord(json);
  const state = asRecord(root?.state);
  return asRecord(state?.reported);
}

// ---------- Normalisation des appareils ----------

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
  const raw = asRecord(rawStatusInput) ?? {};
  // Les Shadows X-Sense STH51 / STH0A encodent les propriétés sous a/b/c/d
  const status: Record<string, unknown> = { ...raw };
  if (unitType === 'thermoHygrometer') {
    if (status.a !== undefined && status.alarmStatus === undefined) status.alarmStatus = status.a;
    if (status.b !== undefined && status.temperature === undefined) status.temperature = status.b;
    if (status.c !== undefined && status.humidity === undefined) status.humidity = status.c;
    if (status.d !== undefined && status.tempUnit === undefined) status.tempUnit = status.d;
  }

  const tempRaw =
    toNum(status.temperature) ??
    toNum(status.temp) ??
    toNum(status.tempC) ??
    toNum(status.t);
  const tempUnitRaw = toStr(status.tempUnit ?? status.temperatureUnit ?? status.unit)?.toUpperCase();
  let tempC = tempRaw;
  if (tempC !== null && (tempUnitRaw === 'F' || tempUnitRaw === '0')) {
    // Sous X-Sense STH, temperatureUnit === "0" ou "F" peut indiquer Fahrenheit uniquement si unit explicitement F
    if (tempUnitRaw === 'F') {
      tempC = Math.round(((tempC - 32) * (5 / 9)) * 10) / 10;
    } else {
      tempC = Math.round(tempC * 10) / 10;
    }
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
  const batteryPct = convertBatteryLevel(
    status.batInfo ?? status.batteryLevel,
    status.batteryPct ?? status.battery
  );

  const onlineRaw = toBool(status.online ?? status.onLine ?? status.isOnline);
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
    const roomNameById = new Map<string, string>();
    const roomsList = Array.isArray(house.rooms) ? house.rooms : [];
    for (const rRaw of roomsList) {
      const rr = asRecord(rRaw);
      const rid = toStr(rr?.roomId ?? rr?.id);
      const rName = toStr(rr?.roomName ?? rr?.name);
      if (rid && rName) roomNameById.set(rid, rName);
    }
    const houseRoomsObj = asRecord(house.houseRooms);
    if (houseRoomsObj) {
      for (const [rid, rVal] of Object.entries(houseRoomsObj)) {
        const rName = toStr(asRecord(rVal)?.roomName ?? asRecord(rVal)?.name ?? rVal);
        if (rid && rName) roomNameById.set(rid, rName);
      }
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
        toStr(node.deviceType ?? node.stationType ?? node.category ?? node.model) ?? 'X-Sense';
      const unitType = classifyXSenseUnitType(
        toStr(node.unitType ?? node.deviceType ?? node.stationType ?? node.category),
        model
      );
      const name =
        toStr(node.deviceName ?? node.stationName ?? node.name) ?? `${model} (${extId.slice(-4)})`;
      const roomIdStr = toStr(node.roomId);
      const roomName =
        toStr(node.roomName) ?? (roomIdStr ? roomNameById.get(roomIdStr) ?? null : null);

      const mergedStatus = {
        ...node,
        ...(asRecord(node.shadow) ?? {}),
        ...(asRecord(node.status) ?? {}),
        ...(asRecord(asRecord(node.shadow)?.status) ?? {}),
      };
      const parsed = parseDeviceStatusBlock(mergedStatus, unitType);

      const category: DeviceCategory =
        unitType === 'thermoHygrometer' && (parsed.tempC !== null || parsed.humidityPct !== null)
          ? 'climate'
          : 'other';

      const serialNumber = toStr(node.deviceSn ?? node.stationSn ?? node.sn);
      const firmware = toStr(mergedStatus.swMain ?? mergedStatus.sw ?? node.firmwareVersion ?? node.version);
      const wifiSsid = toStr(mergedStatus.ssid ?? mergedStatus.wifiSsid ?? node.ssid);
      const ipAddress = toStr(mergedStatus.ip ?? mergedStatus.ipAddress ?? node.ip);
      const macAddress = formatMacAddress(
        toStr(mergedStatus.mac ?? mergedStatus.wifiMac ?? node.mac ?? node.wifiMac)
      );

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
 * Récupère l'inventaire complet X-Sense Cloud (REST + Shadows AWS IoT en GET uniquement)
 * en mode strictement lecture seule.
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

  async function createFreshSession(): Promise<XSenseSession> {
    const appInfo = asRecord(
      await callXSenseApi({
        apiUrl: cfg.apiUrl,
        bizCode: '101001',
        payload: {},
        unauth: true,
      })
    );

    const region = toStr(appInfo?.cgtRegion ?? appInfo?.region) ?? 'us-east-1';
    const userPoolId = toStr(appInfo?.userPoolId ?? appInfo?.cgtUserPoolId);
    const clientId = toStr(appInfo?.clientId ?? appInfo?.cgtClientId);
    const rawEncodedSecret = toStr(appInfo?.clientSecret ?? appInfo?.cgtClientSecret);
    const clientSecret = rawEncodedSecret
      ? decodeXSenseClientSecret(rawEncodedSecret)
      : DEFAULT_CLIENT_SECRET;

    if (cfg.refreshToken && clientId) {
      return refreshCognitoSession({
        idToken: '',
        accessToken: '',
        refreshToken: cfg.refreshToken,
        expiresAtMs: 0,
        email: cfg.email || undefined,
        clientId,
        userPoolId: userPoolId ?? undefined,
        region,
        clientSecret,
      });
    }
    if (userPoolId && clientId && cfg.email && cfg.password) {
      return authenticateCognitoSrp({
        region,
        userPoolId,
        clientId,
        email: cfg.email,
        password: cfg.password,
        clientSecret,
      });
    }
    throw new Error(
      'Impossible de récupérer les paramètres Cognito X-Sense ou identifiants incomplets.'
    );
  }

  let session = cachedSession ?? null;
  let sessionRenewed = false;
  const usedCachedSession = Boolean(session && (session.accessToken || session.refreshToken));

  const needNewLogin = !session || (!session.accessToken && !session.refreshToken);
  if (!needNewLogin && session && session.expiresAtMs - Date.now() < 120_000) {
    try {
      session = await refreshCognitoSession(session);
      sessionRenewed = true;
    } catch {
      session = null;
    }
  }

  if (!session) {
    session = await createFreshSession();
    sessionRenewed = true;
  }

  let secret = session.clientSecret ?? DEFAULT_CLIENT_SECRET;
  let housesData: unknown;
  try {
    housesData = await callXSenseApi({
      apiUrl: cfg.apiUrl,
      bizCode: '102007',
      payload: {
        utctimestamp: '0',
      },
      accessToken: session.accessToken,
      clientSecret: secret,
    });
  } catch (err) {
    if (usedCachedSession && err instanceof XSenseSessionExpiredError) {
      session = await createFreshSession();
      sessionRenewed = true;
      secret = session.clientSecret ?? DEFAULT_CLIENT_SECRET;
      housesData = await callXSenseApi({
        apiUrl: cfg.apiUrl,
        bizCode: '102007',
        payload: {
          utctimestamp: '0',
        },
        accessToken: session.accessToken,
        clientSecret: secret,
      });
    } else {
      throw err;
    }
  }

  const housesArr = Array.isArray(housesData)
    ? housesData
    : Array.isArray(asRecord(housesData)?.houses)
      ? (asRecord(housesData)!.houses as unknown[])
      : [];

  // Récupération optionnelle des credentials AWS STS temporaires pour lire les shadows GET (lecture seule)
  const stsUserName = session.email ?? cfg.email ?? session.userId;
  const awsCreds = stsUserName
    ? asRecord(
        await callXSenseApi({
          apiUrl: cfg.apiUrl,
          bizCode: '101003',
          payload: { userName: stsUserName },
          accessToken: session.accessToken,
          clientSecret: secret,
        }).catch(() => null)
      )
    : null;
  const awsAccessKey = toStr(awsCreds?.accessKeyId);
  const awsSecretKey = toStr(awsCreds?.secretAccessKey);
  const awsSessionToken = toStr(awsCreds?.sessionToken);

  const enrichedHouses: unknown[] = [];
  for (const hRaw of housesArr) {
    const h = asRecord(hRaw);
    if (!h) continue;
    const houseId = toStr(h.houseId ?? h.id);
    if (!houseId) {
      enrichedHouses.push(h);
      continue;
    }

    const [roomsData, stationsData] = await Promise.all([
      callXSenseApi({
        apiUrl: cfg.apiUrl,
        bizCode: '102008',
        payload: { houseId, utctimestamp: '0' },
        accessToken: session.accessToken,
        clientSecret: secret,
      }).catch(() => null),
      callXSenseApi({
        apiUrl: cfg.apiUrl,
        bizCode: '103007',
        payload: { houseId, utctimestamp: '0' },
        accessToken: session.accessToken,
        clientSecret: secret,
      }).catch(() => null),
    ]);

    const roomsObj = asRecord(roomsData);
    const houseRooms = roomsObj?.houseRooms ?? h.houseRooms;
    const rawStations = Array.isArray(stationsData)
      ? stationsData
      : Array.isArray(asRecord(stationsData)?.stations)
        ? (asRecord(stationsData)!.stations as unknown[])
        : Array.isArray(h.stations)
          ? h.stations
          : [];

    const mqttRegion = toStr(h.mqttRegion) ?? toStr(h.houseRegion);
    const houseShadowBySn: Record<string, Record<string, unknown>> = {};

    if (mqttRegion && awsAccessKey && awsSecretKey && awsSessionToken) {
      for (const page of ['mainpage', '2nd_mainpage']) {
        const rep = await fetchAwsIotShadowGet({
          url: `https://${mqttRegion}.x-sense-iot.com/things/${houseId}/shadow?name=${page}`,
          region: mqttRegion,
          accessKeyId: awsAccessKey,
          secretAccessKey: awsSecretKey,
          sessionToken: awsSessionToken,
        });
        if (rep) {
          for (const [snKey, snVal] of Object.entries(rep)) {
            const rec = asRecord(snVal);
            if (rec) houseShadowBySn[snKey] = { ...(houseShadowBySn[snKey] ?? {}), ...rec };
          }
        }
      }
    }

    const stationsWithShadows = await Promise.all(
      rawStations.map(async (stRaw) => {
        const st = asRecord(stRaw);
        if (!st) return stRaw;
        const stSn = toStr(st.stationSn ?? st.sn);
        const stType = toStr(st.category ?? st.stationType) ?? '';
        let stShadow: Record<string, unknown> = stSn ? { ...(houseShadowBySn[stSn] ?? {}) } : {};

        if (stSn && mqttRegion && awsAccessKey && awsSecretKey && awsSessionToken) {
          const prefix =
            stType === 'SBS10'
              ? ''
              : stType === 'XC04-WX' || stType === 'SC07-WX' || stType === 'SC06-WX'
                ? `${stType}-`
                : stType;

          const shadowPages = [
            `info_${stSn}`,
            `2nd_info_${stSn}`,
            '2nd_mainpage',
            'mainpage',
          ];
          const shadowResults = await Promise.all(
            shadowPages.map((pg) =>
              fetchAwsIotShadowGet({
                url: `https://${mqttRegion}.x-sense-iot.com/things/${encodeURIComponent(`${prefix}${stSn}`)}/shadow?name=${encodeURIComponent(pg)}`,
                region: mqttRegion,
                accessKeyId: awsAccessKey,
                secretAccessKey: awsSecretKey,
                sessionToken: awsSessionToken,
              })
            )
          );
          for (const sr of shadowResults) {
            if (!sr) continue;
            stShadow = { ...stShadow, ...sr };
          }
        }

        const shadowDevsMap = asRecord(stShadow.devs) ?? {};
        const childArr = Array.isArray(st.devs)
          ? st.devs
          : Array.isArray(st.devices)
            ? st.devices
            : [];
        const updatedChildren = childArr.map((childRaw) => {
          const child = asRecord(childRaw);
          if (!child) return childRaw;
          const childSn = toStr(child.deviceSn ?? child.sn);
          const childShadow = childSn ? asRecord(shadowDevsMap[childSn]) : null;
          return childShadow ? { ...child, shadow: childShadow } : child;
        });

        const stShadowWithoutDevs = { ...stShadow };
        delete stShadowWithoutDevs.devs;

        return {
          ...st,
          ...(Object.keys(stShadowWithoutDevs).length > 0 ? { shadow: stShadowWithoutDevs } : {}),
          ...(st.devices ? { devices: updatedChildren } : { devs: updatedChildren }),
        };
      })
    );

    enrichedHouses.push({
      ...h,
      ...(houseRooms ? { houseRooms } : {}),
      stations: stationsWithShadows,
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
