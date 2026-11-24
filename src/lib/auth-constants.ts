/**
 * Constantes d'authentification partagées entre le runtime Node et le middleware Edge.
 * Ne doit importer aucun module `node:*`.
 */
export const SESSION_COOKIE_NAME = 'hc_session';
export const SESSION_FALLBACK_SALT = 'home-cockpit-salt';
export const SESSION_TOKEN_PAYLOAD = 'authenticated-v1';
