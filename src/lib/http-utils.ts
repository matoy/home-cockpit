import type { OAuthReturnTab } from '@/lib/vendors/crypto-store';

/**
 * Résout l'origine publique d'une requête HTTP (compatible Vercel / reverse proxies).
 */
export function getPublicOrigin(request: Request): string {
  const fwdHost = request.headers.get('x-forwarded-host');
  const fwdProto = request.headers.get('x-forwarded-proto') || 'https';
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  return new URL(request.url).origin;
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
