import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Fusionne proprement des classes Tailwind CSS conditionnelles sans conflit.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Retourne `value` sous forme d'objet indexable ou `null` si ce n'est pas un objet non-tableau.
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Convertit une valeur inconnue en nombre fini (`number`), ou retourne `null`.
 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Convertit une valeur inconnue en chaîne non vide nettoyée, ou retourne `null`.
 */
export function toStr(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/**
 * Convertit une valeur inconnue en booléen strict, ou retourne `null`.
 */
export function toBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  return null;
}

/**
 * Normalise une chaîne pour une recherche textuelle insensible aux accents et à la casse.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Formate un horodatage ISO en heure courte localisée (`HH:mm`), ou retourne `'—'`.
 */
export function formatTimeShort(iso: string | null | undefined, intlLocale = 'fr-FR'): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' });
}
