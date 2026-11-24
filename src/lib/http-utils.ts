import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { isRequestAuthenticated } from '@/lib/auth';
import type { OAuthReturnTab } from '@/lib/vendors/crypto-store';

const VALID_HOST_REGEX = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/**
 * Résout l'origine publique d'une requête HTTP de façon sûre (anti-spoofing Host / reverse proxies).
 */
export function getPublicOrigin(request: Request): string {
  const requestUrl = new URL(request.url);
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      const isLocalDev =
        process.env.NODE_ENV !== 'production' &&
        (requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1');
      if (!isLocalDev && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
        return parsed.origin;
      }
    } catch {
      // Ignore une URL NEXT_PUBLIC_APP_URL invalide
    }
  }

  const rawFwdHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ?? '';
  const rawFwdProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  const safeProto = rawFwdProto === 'http' || rawFwdProto === 'https' ? rawFwdProto : 'https';

  if (rawFwdHost && VALID_HOST_REGEX.test(rawFwdHost) && !rawFwdHost.includes('..')) {
    return `${safeProto}://${rawFwdHost}`;
  }

  return requestUrl.origin;
}

/**
 * Construit une URL de redirection vers le dashboard avec onglet cible et paramètres de statut.
 */
export function buildOAuthRedirectUrl(
  origin: string,
  returnTab: OAuthReturnTab,
  params: Record<string, string | undefined>
): URL {
  const url = new URL('/', origin);
  url.searchParams.set('tab', returnTab);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

/**
 * Compare deux chaînes en temps constant pour prévenir les attaques temporelles.
 */
export function safeEqualString(aStr: string, bStr: string): boolean {
  const a = Buffer.from(aStr, 'utf8');
  const b = Buffer.from(bStr, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Défense en profondeur API : rejette les requêtes non authentifiées en HTTP 401.
 */
export async function requireApiAuth(): Promise<NextResponse | null> {
  if (await isRequestAuthenticated()) {
    return null;
  }
  return NextResponse.json(
    { error: 'Non authentifié' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * Retourne une réponse d'erreur JSON en masquant les détails internes en production sur 5xx.
 */
export function apiErrorResponse(
  scope: string,
  err: unknown,
  fallbackMessage: string,
  status = 500
): NextResponse {
  console.error(`[${scope}]`, err);
  const exposeDetails = status < 500 || process.env.NODE_ENV !== 'production';
  const message = exposeDetails && err instanceof Error ? err.message : fallbackMessage;
  return NextResponse.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * Exécute fetch() avec un timeout strict via AbortSignal.timeout pour éviter les connexions suspendues.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 15_000
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return fetch(input, { ...init, signal });
}
