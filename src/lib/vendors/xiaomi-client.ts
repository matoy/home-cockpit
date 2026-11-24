import crypto from 'node:crypto';
import { formatMacAddress } from '@/lib/tuya-client';
import { asRecord, toFiniteNumber as toNum, toStr } from '@/lib/utils';
import type { DeviceCategory, RawDpStatus } from '@/types';
import { signXiaomiAuthState, verifyXiaomiAuthState } from './crypto-store';
import type { NormalizedVendorDevice, VendorInventoryResult } from './registry';

export type XiaomiRegion = 'de' | 'cn' | 'us' | 'sg' | 'ru' | 'i2';

const VALID_XIAOMI_REGIONS: ReadonlySet<XiaomiRegion> = new Set([
  'de',
  'cn',
  'us',
  'sg',
  'ru',
  'i2',
]);

const XIAOMI_USER_AGENT =
  'Android-7.1.1-1.0.0-ONEPLUS A3010-136-1111111111111 APP/xiaomi.smarthome APPV/62830';

export interface XiaomiConfig {
  username: string;
  password: string;
  region: XiaomiRegion;
  userId: string | null;
  ssecurity: string | null;
  serviceToken: string | null;
  configured: boolean;
}

export interface XiaomiSession {
  userId: string;
  ssecurity: string;
  serviceToken: string;
  region: XiaomiRegion;
}

export function normalizeXiaomiRegion(raw: unknown): XiaomiRegion {
  const str = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (VALID_XIAOMI_REGIONS.has(str as XiaomiRegion)) {
    return str as XiaomiRegion;
  }
  return 'de';
}

export function getXiaomiApiBaseUrl(region: XiaomiRegion): string {
  if (region === 'cn') return 'https://api.io.mi.com';
  return `https://${region}.api.io.mi.com`;
}

export function getXiaomiConfig(): XiaomiConfig {
  const username = process.env.XIAOMI_USERNAME?.trim() || '';
  const password = process.env.XIAOMI_PASSWORD?.trim() || '';
  const region = normalizeXiaomiRegion(process.env.XIAOMI_REGION);
  const userId = process.env.XIAOMI_USER_ID?.trim() || null;
  const ssecurity = process.env.XIAOMI_SSECURITY?.trim() || null;
  const serviceToken = process.env.XIAOMI_SERVICE_TOKEN?.trim() || null;

  return {
    username,
    password,
    region,
    userId,
    ssecurity,
    serviceToken,
    configured: Boolean((username && password) || (userId && ssecurity && serviceToken)),
  };
}

export function makeXiaomiDeviceId(externalId: string): string {
  const safe = externalId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  return `xiaomi_${safe}`;
}

// ---------- Primitives cryptographiques Mi Cloud (RC4-Drop-1024 + SHA-256) ----------

export function generateXiaomiNonce(): string {
  const rand = crypto.randomBytes(8);
  const timeBuf = Buffer.alloc(4);
  timeBuf.writeUInt32BE(Math.floor(Date.now() / 60000) >>> 0, 0);
  return Buffer.concat([rand, timeBuf]).toString('base64');
}

export function deriveXiaomiSignedNonce(ssecurityBase64: string, nonceBase64: string): string {
  const secBuf = Buffer.from(ssecurityBase64, 'base64');
  const nonceBuf = Buffer.from(nonceBase64, 'base64');
  return crypto.createHash('sha256').update(Buffer.concat([secBuf, nonceBuf])).digest('base64');
}

/**
 * Chiffrement/déchiffrement symétrique RC4-Drop-1024 utilisé par api.io.mi.com.
 */
export function rc4TransformXiaomi(keyBuf: Buffer, dataBuf: Buffer): Buffer {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;

  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + keyBuf[i % keyBuf.length]) & 0xff;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
  }

  let iIdx = 0;
  let jIdx = 0;
  // Drop des 1024 premiers octets du flot de clés (RC4-Drop-1024)
  for (let k = 0; k < 1024; k++) {
    iIdx = (iIdx + 1) & 0xff;
    jIdx = (jIdx + s[iIdx]) & 0xff;
    const tmp = s[iIdx];
    s[iIdx] = s[jIdx];
    s[jIdx] = tmp;
  }

  const out = Buffer.allocUnsafe(dataBuf.length);
  for (let k = 0; k < dataBuf.length; k++) {
    iIdx = (iIdx + 1) & 0xff;
    jIdx = (jIdx + s[iIdx]) & 0xff;
    const tmp = s[iIdx];
    s[iIdx] = s[jIdx];
    s[jIdx] = tmp;
    const rnd = s[(s[iIdx] + s[jIdx]) & 0xff];
    out[k] = dataBuf[k] ^ rnd;
  }
  return out;
}

function generateXiaomiSignature(
  uriPath: string,
  signedNonceBase64: string,
  _nonceBase64: string,
  params: Record<string, string>
): string {
  const parts = ['POST', uriPath];
  for (const [key, value] of Object.entries(params)) {
    parts.push(`${key}=${value}`);
  }
  parts.push(signedNonceBase64);
  const strToSign = parts.join('&');
  return crypto.createHash('sha1').update(strToSign, 'utf8').digest('base64');
}

export function signXiaomiRequestParams(
  uriPath: string,
  rawParams: Record<string, string>,
  ssecurityBase64: string,
  fixedNonceBase64?: string
): { formParams: Record<string, string>; signedNonce: string; nonce: string } {
  const nonce = fixedNonceBase64 ?? generateXiaomiNonce();
  const signedNonce = deriveXiaomiSignedNonce(ssecurityBase64, nonce);
  const keyBuf = Buffer.from(signedNonce, 'base64');

  const workParams: Record<string, string> = { ...rawParams };
  workParams.rc4_hash__ = generateXiaomiSignature(uriPath, signedNonce, nonce, workParams);

  const encryptedParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(workParams)) {
    encryptedParams[k] = rc4TransformXiaomi(keyBuf, Buffer.from(v, 'utf8')).toString('base64');
  }

  const signature = generateXiaomiSignature(uriPath, signedNonce, nonce, encryptedParams);
  encryptedParams.signature = signature;
  encryptedParams._nonce = nonce;
  encryptedParams.ssecurity = ssecurityBase64;

  return { formParams: encryptedParams, signedNonce, nonce };
}

export function decryptXiaomiResponseBody(cipherBase64: string, signedNonceBase64: string): string {
  const keyBuf = Buffer.from(signedNonceBase64, 'base64');
  const dataBuf = Buffer.from(cipherBase64, 'base64');
  return rc4TransformXiaomi(keyBuf, dataBuf).toString('utf8');
}

// ---------- Helpers de parsing ----------

function toBool(val: unknown): boolean | null {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const l = val.trim().toLowerCase();
    if (l === 'true' || l === '1' || l === 'on' || l === 'open') return true;
    if (l === 'false' || l === '0' || l === 'off' || l === 'close' || l === 'closed') return false;
  }
  return null;
}

function parseXiaomiJsonPrefix(rawText: string): Record<string, unknown> {
  const cleaned = rawText.replace(/^&&&START&&&/, '').trim();
  const parsed = JSON.parse(cleaned) as unknown;
  return asRecord(parsed) ?? {};
}

function extractSetCookies(res: Response): Record<string, string> {
  const jar: Record<string, string> = {};
  const headersObj = res.headers as unknown as { getSetCookie?: () => string[] };
  const lines =
    typeof headersObj.getSetCookie === 'function'
      ? headersObj.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie')!]
        : [];
  for (const line of lines) {
    const first = line.split(';')[0];
    const eqIdx = first.indexOf('=');
    if (eqIdx > 0) {
      jar[first.slice(0, eqIdx).trim()] = first.slice(eqIdx + 1).trim();
    }
  }
  return jar;
}

async function exchangeLocationForServiceToken(
  locationUrl: string,
  region: XiaomiRegion
): Promise<{ serviceToken: string; userId?: string }> {
  let currentUrl = locationUrl;
  const collectedCookies: Record<string, string> = {};

  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(currentUrl, {
      method: 'GET',
      headers: {
        'User-Agent': XIAOMI_USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    Object.assign(collectedCookies, extractSetCookies(res));
    if (collectedCookies.serviceToken) {
      return {
        serviceToken: collectedCookies.serviceToken,
        userId: collectedCookies.userId ?? collectedCookies.cUserId,
      };
    }
    const nextLoc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && nextLoc) {
      currentUrl = new URL(nextLoc, currentUrl).toString();
      continue;
    }
    break;
  }

  const serviceToken = collectedCookies.serviceToken;
  if (!serviceToken) {
    throw new Error(
      `Jeton serviceToken introuvable après redirection Xiaomi (${region.toUpperCase()}).`
    );
  }
  return {
    serviceToken,
    userId: collectedCookies.userId ?? collectedCookies.cUserId,
  };
}

// ---------- Authentification Xiaomi Home (QR Code & .env + 2FA) ----------

export async function startXiaomiQrLogin(regionInput?: string): Promise<{
  qrImageUrl: string;
  loginUrl: string;
  qrStateToken: string;
  region: XiaomiRegion;
}> {
  const region = normalizeXiaomiRegion(regionInput ?? getXiaomiConfig().region);
  const qs = new URLSearchParams({
    _qrsize: '240',
    qs: '?sid=xiaomiio&_json=true',
    callback: 'https://sts.api.io.mi.com/sts',
    sid: 'xiaomiio',
    _hasLogo: 'false',
    _json: 'true',
  });

  const res = await fetch(`https://account.xiaomi.com/longPolling/loginUrl?${qs.toString()}`, {
    method: 'GET',
    headers: { 'User-Agent': XIAOMI_USER_AGENT },
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });

  const data = parseXiaomiJsonPrefix(await res.text());
  const qrImageUrl = toStr(data.qr);
  const loginUrl = toStr(data.loginUrl);
  const longPollingUrl = toStr(data.lp);
  if (!qrImageUrl || !longPollingUrl) {
    throw new Error('Impossible d’initialiser le QR Code de connexion Xiaomi Home.');
  }

  const qrStateToken = signXiaomiAuthState({
    nonce: crypto.randomBytes(8).toString('hex'),
    region,
    flow: 'qr',
    longPollingUrl,
    issuedAt: Date.now(),
  });

  return {
    qrImageUrl,
    loginUrl: loginUrl ?? qrImageUrl,
    qrStateToken,
    region,
  };
}

export async function pollXiaomiQrLogin(qrStateToken: string): Promise<
  | { status: 'pending' }
  | { status: 'expired'; message: string }
  | { status: 'connected'; session: XiaomiSession }
> {
  const state = verifyXiaomiAuthState(qrStateToken);
  if (!state || state.flow !== 'qr' || !state.longPollingUrl) {
    return { status: 'expired', message: 'Session QR Code Xiaomi expirée. Générez un nouveau QR.' };
  }

  let res: Response;
  try {
    res = await fetch(state.longPollingUrl, {
      method: 'GET',
      headers: { 'User-Agent': XIAOMI_USER_AGENT },
      cache: 'no-store',
      signal: AbortSignal.timeout(4500),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return { status: 'pending' };
    }
    throw err;
  }

  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = parseXiaomiJsonPrefix(text);
  } catch {
    return { status: 'pending' };
  }

  const code = toNum(data.code);
  if (code === 70016 || code === 2 || !data.location) {
    if (code === 70022 || code === 70002) {
      return { status: 'expired', message: 'QR Code expiré ou annulé.' };
    }
    return { status: 'pending' };
  }

  const location = toStr(data.location);
  const ssecurity = toStr(data.ssecurity);
  const userId = toStr(data.userId ?? data.cUserId);
  if (!location || !ssecurity || !userId) {
    return { status: 'pending' };
  }

  const region = normalizeXiaomiRegion(state.region);
  const { serviceToken } = await exchangeLocationForServiceToken(location, region);

  return {
    status: 'connected',
    session: {
      userId,
      ssecurity,
      serviceToken,
      region,
    },
  };
}

export async function loginXiaomiWithCredentials(input?: {
  username?: string;
  password?: string;
  region?: string;
}): Promise<
  | { status: 'connected'; session: XiaomiSession }
  | { status: 'requires_2fa'; verifyStateToken: string; message: string }
> {
  const cfg = getXiaomiConfig();
  const region = normalizeXiaomiRegion(input?.region ?? cfg.region);
  const username = input?.username?.trim() || cfg.username;
  const password = input?.password || cfg.password;

  if (!username || !password) {
    throw new Error(
      'Identifiants Xiaomi manquants. Utilisez le scan QR Code ou configurez XIAOMI_USERNAME / XIAOMI_PASSWORD.'
    );
  }

  // Étape 1 : récupération _sign via serviceLogin
  const step1Res = await fetch(
    'https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true',
    {
      method: 'GET',
      headers: {
        'User-Agent': XIAOMI_USER_AGENT,
        Cookie: `sdkVersion=accountsdk-18.8.15; deviceId=cockpit_${crypto
          .createHash('md5')
          .update(username)
          .digest('hex')
          .slice(0, 12)}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    }
  );
  const step1Data = parseXiaomiJsonPrefix(await step1Res.text());
  const sign = toStr(step1Data._sign);
  const qs = toStr(step1Data.qs) ?? 'sid=xiaomiio&_json=true';
  const callback = toStr(step1Data.callback) ?? 'https://sts.api.io.mi.com/sts';

  // Étape 2 : soumission hash MD5 du mot de passe
  const hashPwd = crypto.createHash('md5').update(password, 'utf8').digest('hex').toUpperCase();
  const form = new URLSearchParams({
    _json: 'true',
    callback,
    sid: 'xiaomiio',
    qs,
    user: username,
    hash: hashPwd,
    ...(sign ? { _sign: sign } : {}),
  });

  const step2Res = await fetch('https://account.xiaomi.com/pass/serviceLoginAuth2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': XIAOMI_USER_AGENT,
    },
    body: form.toString(),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  const step2Data = parseXiaomiJsonPrefix(await step2Res.text());
  const cookies = extractSetCookies(step2Res);

  const notificationUrl = toStr(step2Data.notificationUrl);
  if (notificationUrl) {
    const verifyStateToken = signXiaomiAuthState({
      nonce: crypto.randomBytes(8).toString('hex'),
      region,
      flow: '2fa',
      notificationUrl,
      identitySessionCookie: cookies.identity_session,
      username,
      issuedAt: Date.now(),
    });
    return {
      status: 'requires_2fa',
      verifyStateToken,
      message:
        'Vérification Xiaomi en 2 étapes requise : saisissez le code reçu par e-mail/SMS ou utilisez la connexion par QR Code.',
    };
  }

  if (toStr(step2Data.captchaUrl)) {
    throw new Error(
      'Xiaomi demande un CAPTCHA de sécurité pour la connexion par mot de passe. Utilisez plutôt la connexion par QR Code Xiaomi Home.'
    );
  }

  const ssecurity = toStr(step2Data.ssecurity);
  const location = toStr(step2Data.location);
  const userId = toStr(step2Data.userId ?? step2Data.cUserId);
  if (!ssecurity || !location || !userId) {
    throw new Error(
      `Échec d’authentification Xiaomi : ${toStr(step2Data.desc) ?? 'identifiants invalides'}`
    );
  }

  const { serviceToken } = await exchangeLocationForServiceToken(location, region);
  return {
    status: 'connected',
    session: {
      userId,
      ssecurity,
      serviceToken,
      region,
    },
  };
}

export async function verifyXiaomi2faCode(params: {
  verifyStateToken: string;
  code: string;
}): Promise<XiaomiSession> {
  const state = verifyXiaomiAuthState(params.verifyStateToken);
  if (!state || state.flow !== '2fa' || !state.notificationUrl) {
    throw new Error('Session 2FA Xiaomi expirée. Relancez la connexion.');
  }

  const cleanCode = params.code.trim();
  if (!cleanCode) {
    throw new Error('Le code de vérification Xiaomi 2FA est requis.');
  }

  const notifUrl = new URL(state.notificationUrl);
  const context = notifUrl.searchParams.get('context') ?? '';
  const verifyRes = await fetch('https://account.xiaomi.com/identity/auth/verifyEmail', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': XIAOMI_USER_AGENT,
      ...(state.identitySessionCookie
        ? { Cookie: `identity_session=${state.identitySessionCookie}` }
        : {}),
    },
    body: new URLSearchParams({
      _json: 'true',
      ticket: cleanCode,
      trust: 'true',
      context,
    }).toString(),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });

  const data = parseXiaomiJsonPrefix(await verifyRes.text());
  const finishUrl = toStr(data.location ?? data.finishUrl);
  if (!finishUrl) {
    throw new Error('Code 2FA Xiaomi invalide ou refusé. Réessayez ou utilisez le QR Code.');
  }

  const finishRes = await fetch(finishUrl, {
    method: 'GET',
    headers: { 'User-Agent': XIAOMI_USER_AGENT },
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  const finishData = parseXiaomiJsonPrefix(await finishRes.text());
  const ssecurity = toStr(finishData.ssecurity);
  const location = toStr(finishData.location);
  const userId = toStr(finishData.userId ?? finishData.cUserId ?? state.username);
  if (!ssecurity || !location || !userId) {
    throw new Error('Jeton ssecurity manquant après validation 2FA Xiaomi.');
  }

  const region = normalizeXiaomiRegion(state.region);
  const { serviceToken } = await exchangeLocationForServiceToken(location, region);
  return {
    userId,
    ssecurity,
    serviceToken,
    region,
  };
}

// ---------- Appels Mi Cloud en lecture seule + normalisation ----------

async function callXiaomiCloudEndpoint(params: {
  session: XiaomiSession;
  uriPath: string;
  dataObj: Record<string, unknown>;
}): Promise<unknown> {
  const baseUrl = getXiaomiApiBaseUrl(params.session.region);
  const fullUrl = `${baseUrl}/app${params.uriPath}`;

  const { formParams, signedNonce } = signXiaomiRequestParams(
    params.uriPath,
    { data: JSON.stringify(params.dataObj) },
    params.session.ssecurity
  );

  const bodyParams = new URLSearchParams({
    data: formParams.data,
    rc4_hash__: formParams.rc4_hash__,
    signature: formParams.signature,
    ssecurity: formParams.ssecurity,
    _nonce: formParams._nonce,
  });

  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Accept-Encoding': 'identity',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': XIAOMI_USER_AGENT,
      'x-xiaomi-protocal-flag-cli': 'PROTOCAL-HTTP2',
      'MIOT-ENCRYPT-ALGORITHM': 'ENCRYPT-RC4',
      Cookie: [
        `userId=${params.session.userId}`,
        `yetAnotherServiceToken=${params.session.serviceToken}`,
        `serviceToken=${params.session.serviceToken}`,
        'locale=en_GB',
        'timezone=GMT+02:00',
        'is_daylight=1',
        'dst_offset=3600000',
        'channel=MI_APP_STORE',
      ].join('; '),
    },
    body: bodyParams.toString(),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });

  const rawText = await res.text();
  if (!res.ok) {
    const snippet = rawText.trim().slice(0, 140);
    throw new Error(
      `Erreur Mi Cloud (${res.status}) sur ${params.uriPath}${snippet ? ` : ${snippet}` : '.'}`
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    const decrypted = decryptXiaomiResponseBody(rawText.trim(), signedNonce);
    parsedJson = JSON.parse(decrypted);
  }

  const root = asRecord(parsedJson) ?? {};
  const code = toNum(root.code);
  if (code !== null && code !== 0) {
    throw new Error(`Erreur API Xiaomi (${code}) : ${toStr(root.message) ?? 'session expirée'}`);
  }
  return root.result ?? root;
}

export type XiaomiUnitType =
  | 'climateSensor'
  | 'smartPlug'
  | 'contactSensor'
  | 'smokeSensor'
  | 'gasSensor'
  | 'waterLeakSensor'
  | 'motionSensor'
  | 'airPurifier'
  | 'robotVacuum'
  | 'otherDevice';

function classifyXiaomiUnitType(modelRaw: string | null, nameRaw: string | null): XiaomiUnitType {
  const m = `${modelRaw ?? ''} ${nameRaw ?? ''}`.toLowerCase();
  if (
    m.includes('lywsd') ||
    m.includes('sensor_ht') ||
    m.includes('miaomiaoce') ||
    m.includes('cgllc') ||
    m.includes('therm') ||
    m.includes('hygro')
  ) {
    return 'climateSensor';
  }
  if (m.includes('plug') || m.includes('powerstrip') || m.includes('prise')) {
    return 'smartPlug';
  }
  if (m.includes('magnet') || m.includes('mccgq') || m.includes('door') || m.includes('window')) {
    return 'contactSensor';
  }
  if (m.includes('smoke') || m.includes('fumee')) return 'smokeSensor';
  if (m.includes('natgas') || m.includes('gas')) return 'gasSensor';
  if (m.includes('wleak') || m.includes('flood') || m.includes('water') || m.includes('fuite')) {
    return 'waterLeakSensor';
  }
  if (m.includes('motion') || m.includes('pir')) return 'motionSensor';
  if (m.includes('airpurifier') || m.includes('airfresh') || m.includes('purifier') || m.includes('humidifier')) {
    return 'airPurifier';
  }
  if (m.includes('vacuum') || m.includes('roborock') || m.includes('dreame') || m.includes('robot')) {
    return 'robotVacuum';
  }
  return 'otherDevice';
}

/**
 * Normalise la réponse Mi Cloud (`homeroom/gethome` + `home/device_list`)
 * en appareils normalisés Home Cockpit.
 */
export function normalizeXiaomiCloudPayload(params: {
  homesResult?: unknown;
  devicesResult?: unknown;
}): VendorInventoryResult {
  const homesRoot = asRecord(params.homesResult) ?? {};
  const homesList = Array.isArray(homesRoot.homelist)
    ? homesRoot.homelist
    : Array.isArray(params.homesResult)
      ? params.homesResult
      : [];

  const roomNameSet = new Set<string>();
  const roomByDid = new Map<string, string>();

  for (const hRaw of homesList) {
    const h = asRecord(hRaw);
    if (!h) continue;
    const roomList = Array.isArray(h.roomlist) ? h.roomlist : [];
    for (const rRaw of roomList) {
      const r = asRecord(rRaw);
      const rName = toStr(r?.name);
      if (!rName) continue;
      roomNameSet.add(rName);
      const dids = Array.isArray(r?.dids) ? r.dids : [];
      for (const didRaw of dids) {
        const did = toStr(didRaw);
        if (did) roomByDid.set(did, rName);
      }
    }
  }

  const devRoot = asRecord(params.devicesResult) ?? {};
  const devList = Array.isArray(devRoot.device_info)
    ? devRoot.device_info
    : Array.isArray(devRoot.list)
      ? devRoot.list
      : Array.isArray(params.devicesResult)
        ? params.devicesResult
        : [];

  const devices: NormalizedVendorDevice[] = [];
  for (const dRaw of devList) {
    const d = asRecord(dRaw);
    if (!d) continue;
    const did = toStr(d.did);
    if (!did) continue;

    const name = toStr(d.name) ?? `Xiaomi ${did.slice(-4)}`;
    const model = toStr(d.model);
    const unitType = classifyXiaomiUnitType(model, name);
    const roomName = roomByDid.get(did) ?? toStr(d.roomName);
    if (roomName) roomNameSet.add(roomName);

    const extra = asRecord(d.extra) ?? {};
    const props = {
      ...(asRecord(d.prop) ?? {}),
      ...(asRecord(d.props) ?? {}),
    };

    const tempRaw =
      toNum(props.temperature) ?? toNum(props['prop.temperature']) ?? toNum(props.temp);
    const tempC =
      tempRaw !== null
        ? Math.round((tempRaw > 120 ? tempRaw / 100 : tempRaw) * 10) / 10
        : null;

    const humRaw =
      toNum(props.humidity) ?? toNum(props['prop.humidity']) ?? toNum(props.rh);
    const humidityPct =
      humRaw !== null
        ? Math.round((humRaw > 100 ? humRaw / 100 : humRaw) * 10) / 10
        : null;

    const powerW =
      toNum(props.power_consume_rate) ?? toNum(props.electric_power) ?? toNum(props.power);
    const addEleRaw = toNum(props.power_consumption) ?? toNum(props.elec_kwh);
    const addEleKwh = addEleRaw !== null ? Math.round(addEleRaw * 1000) / 1000 : null;

    const contactVal = toBool(props.contact_state ?? props.status ?? props.open);
    const contactOpen = unitType === 'contactSensor' ? contactVal : null;

    const batteryRaw = toNum(props.battery ?? props.battery_level);
    const batteryPct =
      batteryRaw !== null && batteryRaw >= 0 && batteryRaw <= 100
        ? Math.round(batteryRaw)
        : null;

    const pm25 = toNum(props.aqi ?? props.pm25);
    const filterLifePct = toNum(props.f1_hour_used) !== null ? null : toNum(props.filter1_life);
    const purifierMode = toStr(props.mode);
    const vacuumState = toStr(props.state ?? props.vacuum_state);
    const smokeAlert = unitType === 'smokeSensor' && toBool(props.alarm ?? props.smoke) === true;
    const gasAlert = unitType === 'gasSensor' && toBool(props.alarm ?? props.gas) === true;
    const leakAlert =
      unitType === 'waterLeakSensor' &&
      (toBool(props.water_leak ?? props.alarm ?? props.status) ?? false);

    let category: DeviceCategory = 'other';
    if (unitType === 'contactSensor') category = 'contact';
    else if (unitType === 'smartPlug') category = 'power';
    else if (
      unitType === 'climateSensor' ||
      (unitType === 'airPurifier' && (tempC !== null || humidityPct !== null))
    ) {
      category = powerW !== null ? 'hybrid' : 'climate';
    }

    const rssi = toNum(d.rssi);
    const ipAddress = toStr(d.localip);
    const macAddress = formatMacAddress(toStr(d.mac));
    const firmware = toStr(extra.fw_version ?? d.fw_version);
    const isOnline = toBool(d.isOnline) ?? true;

    const rawTraits: RawDpStatus[] = [
      { code: 'xiaomi:unitType', value: unitType },
      ...(model ? [{ code: 'xiaomi:model', value: model }] : []),
      ...(firmware ? [{ code: 'xiaomi:firmware', value: firmware }] : []),
      ...(rssi !== null ? [{ code: 'xiaomi:rssi', value: rssi }] : []),
      ...(pm25 !== null ? [{ code: 'xiaomi:pm25', value: pm25 }] : []),
      ...(filterLifePct !== null ? [{ code: 'xiaomi:filterLifePct', value: filterLifePct }] : []),
      ...(purifierMode ? [{ code: 'xiaomi:mode', value: purifierMode }] : []),
      ...(vacuumState ? [{ code: 'xiaomi:vacuumState', value: vacuumState }] : []),
      ...(smokeAlert ? [{ code: 'xiaomi:smokeAlert', value: true }] : []),
      ...(gasAlert ? [{ code: 'xiaomi:gasAlert', value: true }] : []),
      ...(unitType === 'waterLeakSensor'
        ? [{ code: 'xiaomi:waterLeak', value: leakAlert }]
        : []),
    ];

    devices.push({
      externalId: did,
      name,
      roomName,
      manufacturer: 'Xiaomi',
      model,
      deviceType: unitType,
      category,
      isOnline,
      tempC,
      humidityPct,
      batteryPct,
      contactOpen,
      powerW,
      voltageV: null,
      addEleKwh,
      macAddress,
      ipAddress,
      rawTraits,
    });
  }

  return {
    roomNames: Array.from(roomNameSet),
    devices,
  };
}

/**
 * Synchronise l'inventaire et les pièces depuis Mi Cloud en mode 100 % lecture seule.
 */
export async function fetchXiaomiInventory(
  session: XiaomiSession
): Promise<VendorInventoryResult> {
  const [homesResult, devCntResult] = await Promise.all([
    callXiaomiCloudEndpoint({
      session,
      uriPath: '/v2/homeroom/gethome',
      dataObj: { fg: true, fetch_share: true, fetch_share_dev: true, limit: 300, app_ver: 7 },
    }),
    callXiaomiCloudEndpoint({
      session,
      uriPath: '/v2/user/get_device_cnt',
      dataObj: { fetch_own: true, fetch_share: true },
    }).catch(() => null),
  ]);

  const homesRoot = asRecord(homesResult) ?? {};
  const homesList = Array.isArray(homesRoot.homelist) ? homesRoot.homelist : [];

  const homeTargets: Array<{ homeId: string; ownerId: string }> = [];
  const seenHomeKeys = new Set<string>();

  for (const hRaw of homesList) {
    const h = asRecord(hRaw);
    const homeId = toStr(h?.id);
    if (!homeId) continue;
    const ownerId = toStr(h?.uid) ?? session.userId;
    const key = `${homeId}:${ownerId}`;
    if (!seenHomeKeys.has(key)) {
      seenHomeKeys.add(key);
      homeTargets.push({ homeId, ownerId });
    }
  }

  const shareFamily = asRecord(asRecord(devCntResult)?.share)?.share_family;
  if (Array.isArray(shareFamily)) {
    for (const shRaw of shareFamily) {
      const sh = asRecord(shRaw);
      const homeId = toStr(sh?.home_id);
      const ownerId = toStr(sh?.home_owner);
      if (!homeId || !ownerId) continue;
      const key = `${homeId}:${ownerId}`;
      if (!seenHomeKeys.has(key)) {
        seenHomeKeys.add(key);
        homeTargets.push({ homeId, ownerId });
      }
    }
  }

  const allRawDevices: unknown[] = [];
  const seenDids = new Set<string>();

  if (homeTargets.length > 0) {
    for (const target of homeTargets) {
      const numericHomeId = Number(target.homeId);
      const numericOwnerId = Number(target.ownerId);
      const homeRes = await callXiaomiCloudEndpoint({
        session,
        uriPath: '/v2/home/home_device_list',
        dataObj: {
          home_owner: Number.isFinite(numericOwnerId) ? numericOwnerId : target.ownerId,
          home_id: Number.isFinite(numericHomeId) ? numericHomeId : target.homeId,
          limit: 200,
          get_split_device: true,
          support_smart_home: true,
        },
      });
      const homeObj = asRecord(homeRes) ?? {};
      const items = Array.isArray(homeObj.device_info)
        ? homeObj.device_info
        : Array.isArray(homeObj.list)
          ? homeObj.list
          : [];
      for (const item of items) {
        const rec = asRecord(item);
        const did = toStr(rec?.did);
        if (did && !seenDids.has(did)) {
          seenDids.add(did);
          allRawDevices.push(item);
        }
      }
    }
  } else {
    const legacyRes = await callXiaomiCloudEndpoint({
      session,
      uriPath: '/home/device_list',
      dataObj: {
        getVirtualModel: false,
        getHuamiDevices: 0,
        get_split_device: true,
        support_smart_home: true,
      },
    });
    const legacyObj = asRecord(legacyRes) ?? {};
    const items = Array.isArray(legacyObj.list)
      ? legacyObj.list
      : Array.isArray(legacyObj.device_info)
        ? legacyObj.device_info
        : [];
    allRawDevices.push(...items);
  }

  return normalizeXiaomiCloudPayload({
    homesResult,
    devicesResult: { device_info: allRawDevices },
  });
}
