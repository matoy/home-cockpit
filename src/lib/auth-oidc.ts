import crypto from 'node:crypto';
import { fetchWithTimeout, safeEqualString } from '@/lib/http-utils';

const OIDC_TX_TTL_SECONDS = 600; // 10 minutes
const OIDC_CLOCK_SKEW_SECONDS = 60;
const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

export interface OidcConfig {
  configured: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  providerName: string;
  scopes: string;
  redirectUri: string | null;
  allowedEmails: string[];
  allowedDomains: string[];
  allowAnyAuthenticated: boolean;
}

export interface OidcDiscoveryDoc {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}

export interface OidcJwk extends Record<string, unknown> {
  kid?: string;
  kty?: string;
  use?: string;
  alg?: string;
}

export interface OidcLoginStatePayload {
  nonce: string;
  returnTo: string;
}

export interface OidcTxCookiePayload {
  nonce: string;
  oidcNonce: string;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
}

export interface VerifiedOidcIdentity {
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
}

const discoveryCache = new Map<string, { doc: OidcDiscoveryDoc; expiresAt: number }>();
const jwksCache = new Map<string, { keys: OidcJwk[]; expiresAt: number }>();

export function clearOidcCaches(): void {
  discoveryCache.clear();
  jwksCache.clear();
}

function parseCsvList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeIssuerUrl(rawIssuer: string): string | null {
  const trimmed = rawIssuer.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol === 'https:') return trimmed;
    if (parsed.protocol === 'http:' && isLocal && process.env.NODE_ENV !== 'production') {
      return trimmed;
    }
    return null;
  } catch {
    return null;
  }
}

export function getOidcConfig(): OidcConfig {
  const rawIssuer = process.env.AUTH_OIDC_ISSUER?.trim() ?? '';
  const issuer = normalizeIssuerUrl(rawIssuer) ?? '';
  const clientId = process.env.AUTH_OIDC_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.AUTH_OIDC_CLIENT_SECRET?.trim() ?? '';
  const redirectUri = process.env.AUTH_OIDC_REDIRECT_URI?.trim() || null;
  const scopes = process.env.AUTH_OIDC_SCOPES?.trim() || 'openid email profile';
  const allowedEmails = parseCsvList(process.env.AUTH_ALLOWED_EMAILS);
  const allowedDomains = parseCsvList(process.env.AUTH_ALLOWED_DOMAINS).map((d) =>
    d.replace(/^@+/, '')
  );
  const allowAnyAuthenticated =
    process.env.AUTH_ALLOW_ANY_AUTHENTICATED?.trim().toLowerCase() === 'true';

  let providerName = process.env.AUTH_OIDC_PROVIDER_NAME?.trim() ?? '';
  if (!providerName && issuer) {
    try {
      const host = new URL(issuer).hostname.toLowerCase();
      providerName = host === 'accounts.google.com' ? 'Google' : 'SSO';
    } catch {
      providerName = 'SSO';
    }
  }
  if (!providerName) providerName = 'SSO';

  return {
    configured: Boolean(issuer && clientId),
    issuer,
    clientId,
    clientSecret,
    providerName,
    scopes,
    redirectUri,
    allowedEmails,
    allowedDomains,
    allowAnyAuthenticated,
  };
}

export function sanitizeReturnTo(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '/';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return '/';
  if (trimmed.startsWith('//') || trimmed.includes('\\')) return '/';
  return trimmed;
}

function getOidcSigningKey(): Buffer {
  const rawSecret =
    process.env.AUTH_SESSION_SECRET?.trim() ||
    process.env.TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.APP_PASSWORD?.trim() ||
    process.env.SCHEDULE_SECRET?.trim() ||
    process.env.TUYA_ACCESS_SECRET?.trim();

  if (!rawSecret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Aucun secret configuré pour signer les transactions OIDC en production (AUTH_SESSION_SECRET requis).'
      );
    }
    return crypto.createHash('sha256').update('oidc-auth-v1:cockpit-dev-oidc-key').digest();
  }

  return crypto.createHash('sha256').update(`oidc-auth-v1:${rawSecret}`).digest();
}

function signOidcHmac(payload: object, nowSec = Math.floor(Date.now() / 1000)): string {
  const key = getOidcSigningKey();
  const iat = Math.floor(nowSec);
  const envelope = {
    ...payload,
    iat,
    exp: iat + OIDC_TX_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyOidcHmac(
  token: string | null | undefined,
  nowSec = Math.floor(Date.now() / 1000)
): Record<string, unknown> | null {
  if (!token) return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;

  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!encoded || !sig) return null;

  const key = getOidcSigningKey();
  const expectedSig = crypto.createHmac('sha256', key).update(encoded).digest('base64url');
  if (!safeEqualString(sig, expectedSig)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    if (
      typeof rec.iat !== 'number' ||
      typeof rec.exp !== 'number' ||
      !Number.isFinite(rec.iat) ||
      !Number.isFinite(rec.exp) ||
      rec.exp < rec.iat ||
      rec.iat > nowSec + OIDC_CLOCK_SKEW_SECONDS ||
      nowSec > rec.exp
    ) {
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function signOidcLoginState(payload: OidcLoginStatePayload, nowSec?: number): string {
  return signOidcHmac(payload, nowSec);
}

export function verifyOidcLoginState(
  token: string | null | undefined,
  nowSec?: number
): OidcLoginStatePayload | null {
  const rec = verifyOidcHmac(token, nowSec);
  if (!rec || typeof rec.nonce !== 'string' || rec.nonce.length < 8) return null;
  return {
    nonce: rec.nonce,
    returnTo: sanitizeReturnTo(typeof rec.returnTo === 'string' ? rec.returnTo : '/'),
  };
}

export function signOidcTransaction(payload: OidcTxCookiePayload, nowSec?: number): string {
  return signOidcHmac(payload, nowSec);
}

export function verifyOidcTransaction(
  token: string | null | undefined,
  nowSec?: number
): OidcTxCookiePayload | null {
  const rec = verifyOidcHmac(token, nowSec);
  if (
    !rec ||
    typeof rec.nonce !== 'string' ||
    typeof rec.oidcNonce !== 'string' ||
    typeof rec.codeVerifier !== 'string' ||
    typeof rec.redirectUri !== 'string'
  ) {
    return null;
  }
  return {
    nonce: rec.nonce,
    oidcNonce: rec.oidcNonce,
    codeVerifier: rec.codeVerifier,
    redirectUri: rec.redirectUri,
    returnTo: sanitizeReturnTo(typeof rec.returnTo === 'string' ? rec.returnTo : '/'),
  };
}

export async function discoverOidcProvider(issuer: string): Promise<OidcDiscoveryDoc> {
  const normalized = normalizeIssuerUrl(issuer);
  if (!normalized) {
    throw new Error('URL AUTH_OIDC_ISSUER invalide.');
  }

  const cached = discoveryCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.doc;
  }

  const discoveryUrl = `${normalized}/.well-known/openid-configuration`;
  const res = await fetchWithTimeout(discoveryUrl, { cache: 'no-store' }, 10_000);
  if (!res.ok) {
    throw new Error(`Échec découverte OIDC (${res.status})`);
  }

  const json = (await res.json()) as Partial<OidcDiscoveryDoc>;
  if (
    !json ||
    typeof json.issuer !== 'string' ||
    typeof json.authorization_endpoint !== 'string' ||
    typeof json.token_endpoint !== 'string' ||
    typeof json.jwks_uri !== 'string'
  ) {
    throw new Error('Document de découverte OIDC incomplet.');
  }

  const doc: OidcDiscoveryDoc = {
    issuer: json.issuer,
    authorization_endpoint: json.authorization_endpoint,
    token_endpoint: json.token_endpoint,
    jwks_uri: json.jwks_uri,
    userinfo_endpoint: typeof json.userinfo_endpoint === 'string' ? json.userinfo_endpoint : undefined,
  };

  discoveryCache.set(normalized, { doc, expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS });
  return doc;
}

async function fetchJwksKeys(jwksUri: string, forceRefresh = false): Promise<OidcJwk[]> {
  if (!forceRefresh) {
    const cached = jwksCache.get(jwksUri);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.keys;
    }
  }

  const res = await fetchWithTimeout(jwksUri, { cache: 'no-store' }, 10_000);
  if (!res.ok) {
    throw new Error(`Impossible de récupérer les clés JWKS (${res.status}).`);
  }
  const body = (await res.json()) as { keys?: unknown };
  const keys = Array.isArray(body?.keys) ? (body.keys as OidcJwk[]) : [];
  if (keys.length === 0) {
    throw new Error('Jeu de clés JWKS vide.');
  }

  jwksCache.set(jwksUri, { keys, expiresAt: Date.now() + JWKS_CACHE_TTL_MS });
  return keys;
}

function getHashAlgorithmForJwtAlg(alg: string): {
  hashAlg: string;
  isEcdsa: boolean;
  isPss: boolean;
} | null {
  switch (alg) {
    case 'RS256':
      return { hashAlg: 'RSA-SHA256', isEcdsa: false, isPss: false };
    case 'RS384':
      return { hashAlg: 'RSA-SHA384', isEcdsa: false, isPss: false };
    case 'RS512':
      return { hashAlg: 'RSA-SHA512', isEcdsa: false, isPss: false };
    case 'PS256':
      return { hashAlg: 'RSA-SHA256', isEcdsa: false, isPss: true };
    case 'ES256':
      return { hashAlg: 'SHA256', isEcdsa: true, isPss: false };
    case 'ES384':
      return { hashAlg: 'SHA384', isEcdsa: true, isPss: false };
    case 'ES512':
      return { hashAlg: 'SHA512', isEcdsa: true, isPss: false };
    default:
      return null;
  }
}

export async function verifyIdTokenJwt(params: {
  idToken: string;
  expectedIssuer: string;
  expectedAudience: string;
  expectedNonce: string;
  jwksUri: string;
  nowSec?: number;
}): Promise<Record<string, unknown>> {
  const nowSec = params.nowSec ?? Math.floor(Date.now() / 1000);
  const parts = params.idToken.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('id_token JWT malformé.');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(
    Buffer.from(payloadB64, 'base64url').toString('utf8')
  ) as Record<string, unknown>;

  if (!header || typeof header.alg !== 'string') {
    throw new Error('En-tête JWT invalide.');
  }

  const algSpec = getHashAlgorithmForJwtAlg(header.alg);
  if (!algSpec) {
    throw new Error(`Algorithme JWT non supporté : ${header.alg}`);
  }

  let keys = await fetchJwksKeys(params.jwksUri, false);
  const findCandidateKeys = (list: OidcJwk[]) =>
    list.filter((k) => {
      if (k.use && k.use !== 'sig') return false;
      if (header.kid) return k.kid === header.kid;
      return true;
    });

  let candidates = findCandidateKeys(keys);
  if (candidates.length === 0 && header.kid) {
    keys = await fetchJwksKeys(params.jwksUri, true);
    candidates = findCandidateKeys(keys);
  }

  if (candidates.length === 0) {
    throw new Error('Clé publique JWKS correspondante introuvable.');
  }

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const signature = Buffer.from(sigB64, 'base64url');
  let signatureValid = false;

  for (const jwk of candidates) {
    try {
      const publicKey = crypto.createPublicKey({
        key: jwk as crypto.JsonWebKeyInput['key'],
        format: 'jwk',
      });
      const verifyKey = algSpec.isEcdsa
        ? { key: publicKey, dsaEncoding: 'ieee-p1363' as const }
        : algSpec.isPss
          ? {
              key: publicKey,
              padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
              saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
            }
          : publicKey;

      if (crypto.verify(algSpec.hashAlg, signingInput, verifyKey, signature)) {
        signatureValid = true;
        break;
      }
    } catch {
      // Essaie la clé suivante si le format JWK ne correspond pas
    }
  }

  if (!signatureValid) {
    throw new Error('Signature id_token invalide.');
  }

  const iss = typeof payload.iss === 'string' ? payload.iss.replace(/\/+$/, '') : '';
  const expectedIss = params.expectedIssuer.replace(/\/+$/, '');
  if (!iss || iss !== expectedIss) {
    throw new Error('Émetteur (iss) id_token invalide.');
  }

  const audClaim = payload.aud;
  const audValid =
    typeof audClaim === 'string'
      ? audClaim === params.expectedAudience
      : Array.isArray(audClaim) &&
        audClaim.includes(params.expectedAudience) &&
        (audClaim.length === 1 || payload.azp === params.expectedAudience);

  if (!audValid) {
    throw new Error('Audience (aud) id_token invalide.');
  }

  if (typeof payload.exp !== 'number' || nowSec > payload.exp + OIDC_CLOCK_SKEW_SECONDS) {
    throw new Error('Jeton id_token expiré.');
  }

  if (typeof payload.iat === 'number' && payload.iat > nowSec + OIDC_CLOCK_SKEW_SECONDS) {
    throw new Error('Horodatage iat id_token invalide.');
  }

  if (
    typeof payload.nonce !== 'string' ||
    !safeEqualString(payload.nonce, params.expectedNonce)
  ) {
    throw new Error('Nonce OIDC id_token invalide.');
  }

  return payload;
}

export async function exchangeOidcCodeAndVerify(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  expectedNonce: string;
}): Promise<VerifiedOidcIdentity> {
  const cfg = getOidcConfig();
  if (!cfg.configured) {
    throw new Error('OIDC non configuré.');
  }

  const discovery = await discoverOidcProvider(cfg.issuer);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: cfg.clientId,
    code_verifier: params.codeVerifier,
  });
  if (cfg.clientSecret) {
    body.set('client_secret', cfg.clientSecret);
  }

  const tokenRes = await fetchWithTimeout(
    discovery.token_endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
      cache: 'no-store',
    },
    15_000
  );

  const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
    id_token?: string;
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || typeof tokenJson.id_token !== 'string') {
    throw new Error(
      tokenJson.error_description || tokenJson.error || `Échec échange code OIDC (${tokenRes.status}).`
    );
  }

  const claims = await verifyIdTokenJwt({
    idToken: tokenJson.id_token,
    expectedIssuer: discovery.issuer,
    expectedAudience: cfg.clientId,
    expectedNonce: params.expectedNonce,
    jwksUri: discovery.jwks_uri,
  });

  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  let email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : undefined;
  let emailVerified = claims.email_verified === true;
  let name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : undefined;

  if (!email && discovery.userinfo_endpoint && typeof tokenJson.access_token === 'string') {
    try {
      const uiRes = await fetchWithTimeout(
        discovery.userinfo_endpoint,
        {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
          cache: 'no-store',
        },
        10_000
      );
      if (uiRes.ok) {
        const ui = (await uiRes.json()) as Record<string, unknown>;
        if (typeof ui.email === 'string' && ui.email.trim()) {
          email = ui.email.trim().toLowerCase();
          emailVerified = ui.email_verified === true;
        }
        if (!name && typeof ui.name === 'string' && ui.name.trim()) {
          name = ui.name.trim();
        }
      }
    } catch {
      // Userinfo optionnel : on s'appuie sur les claims vérifiés de l'id_token si indisponible
    }
  }

  if (!sub) {
    throw new Error('Identifiant utilisateur (sub) absent du jeton OIDC.');
  }

  return { sub, email, emailVerified, name };
}

export function authorizeOidcIdentity(
  identity: VerifiedOidcIdentity,
  cfg: OidcConfig
): { allowed: true } | { allowed: false; reason: 'oidc_unauthorized' | 'oidc_config' } {
  const hasAllowList = cfg.allowedEmails.length > 0 || cfg.allowedDomains.length > 0;

  if (hasAllowList) {
    if (!identity.email || !identity.emailVerified) {
      return { allowed: false, reason: 'oidc_unauthorized' };
    }
    const email = identity.email.toLowerCase();
    const domain = email.split('@')[1] ?? '';

    if (cfg.allowedEmails.includes(email)) {
      return { allowed: true };
    }
    if (domain && cfg.allowedDomains.includes(domain)) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'oidc_unauthorized' };
  }

  if (cfg.allowAnyAuthenticated) {
    return { allowed: true };
  }

  if (process.env.NODE_ENV === 'production') {
    return { allowed: false, reason: 'oidc_config' };
  }

  return { allowed: true };
}
