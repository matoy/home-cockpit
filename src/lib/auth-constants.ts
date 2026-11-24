/**
 * Constantes d'authentification partagées entre le runtime Node et le middleware Edge.
 * Ne doit importer aucun module `node:*`.
 */
export const SESSION_COOKIE_NAME = 'hc_session';
export const SESSION_FALLBACK_SALT = 'home-cockpit-salt';
export const SESSION_TOKEN_PAYLOAD = 'authenticated-v1';
export const SESSION_TOKEN_VERSION = 'v2';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 jours
export const SESSION_CLOCK_SKEW_SECONDS = 60;
