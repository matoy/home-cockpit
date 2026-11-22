import type { DeviceRecord, DuplicateCandidate, RoomRecord, VendorId } from '@/types';
import { normalizeSystems } from './registry';

const STOP_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', 'the']);

/**
 * Normalise un libellé pour la détection de doublons multi-vendors.
 */
export function normalizeMatchText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTokens(input: string): string[] {
  const normalized = normalizeMatchText(input);
  if (!normalized) return [];
  const rawTokens = normalized.split(' ').filter(Boolean);
  const significant = rawTokens.filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
  return significant.length > 0 ? significant : rawTokens;
}

/**
 * Calcule une similarité [0..1] entre deux noms d'appareils normalisés.
 */
export function tokenSimilarity(a: string, b: string): number {
  const normA = normalizeMatchText(a);
  const normB = normalizeMatchText(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const tokensA = Array.from(new Set(extractTokens(normA)));
  const tokensB = Array.from(new Set(extractTokens(normB)));
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setB = new Set(tokensB);
  let intersection = 0;
  for (const t of tokensA) {
    if (setB.has(t)) intersection += 1;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = union > 0 ? intersection / union : 0;
  const minLen = Math.min(tokensA.length, tokensB.length);

  if (minLen >= 2 && intersection === minLen) {
    return Math.max(jaccard, 0.8);
  }

  return jaccard;
}

/**
 * Fusionne sans doublon un système ajouté dans la liste `systems` d'un appareil.
 */
export function mergeDeviceSystems(
  existingSystems: VendorId[],
  addedVendor: VendorId,
  primaryVendor: VendorId = 'tuya'
): VendorId[] {
  return normalizeSystems([...existingSystems, addedVendor], primaryVendor);
}

/**
 * Détecte les appareils Google Home autonomes qui correspondent probablement déjà à un appareil principal (Tuya ou Kasa)
 * afin de proposer une fusion en 1 clic sans créer de faux positifs silencieux.
 */
export function findDuplicateCandidates(
  devices: DeviceRecord[],
  rooms: RoomRecord[]
): DuplicateCandidate[] {
  const roomMap = new Map<number, RoomRecord>(rooms.map((r) => [r.id, r]));

  const standaloneGoogle = devices.filter(
    (d) =>
      d.primaryVendor === 'google_home' &&
      normalizeSystems(d.systems, d.primaryVendor).length === 1
  );

  const linkablePrimary = devices.filter(
    (d) =>
      (d.primaryVendor === 'tuya' ||
        d.primaryVendor === 'kasa' ||
        d.primaryVendor === 'home_connect' ||
        d.primaryVendor === 'somfy' ||
        d.primaryVendor === 'daikin') &&
      !normalizeSystems(d.systems, d.primaryVendor).includes('google_home')
  );

  const candidates: DuplicateCandidate[] = [];

  for (const gh of standaloneGoogle) {
    const ghNames = [gh.name, gh.customName].filter(
      (n): n is string => Boolean(n && n.trim())
    );

    let bestMatch: {
      target: DeviceRecord;
      confidence: 'high' | 'medium';
      score: number;
      reason: string;
    } | null = null;

    for (const target of linkablePrimary) {
      const targetNames = [target.name, target.customName].filter(
        (n): n is string => Boolean(n && n.trim())
      );

      let maxSim = 0;
      for (const gn of ghNames) {
        for (const tn of targetNames) {
          const sim = tokenSimilarity(gn, tn);
          if (sim > maxSim) maxSim = sim;
        }
      }

      const sameRoom =
        gh.roomId !== null && target.roomId !== null && gh.roomId === target.roomId;

      let confidence: 'high' | 'medium' | null = null;
      let reason = '';

      if (maxSim === 1) {
        confidence = 'high';
        reason = sameRoom ? 'Nom identique dans la même pièce' : 'Nom identique';
      } else if (sameRoom && maxSim >= 0.65) {
        confidence = 'high';
        reason = 'Nom très proche dans la même pièce';
      } else if (maxSim >= 0.75) {
        confidence = 'medium';
        reason = 'Nom similaire détecté';
      }

      if (!confidence) continue;

      const rankScore = (confidence === 'high' ? 2 : 1) + maxSim + (sameRoom ? 0.2 : 0);
      if (!bestMatch || rankScore > bestMatch.score) {
        bestMatch = {
          target,
          confidence,
          score: rankScore,
          reason,
        };
      }
    }

    if (bestMatch) {
      const room =
        bestMatch.target.roomId !== null
          ? roomMap.get(bestMatch.target.roomId) ?? null
          : gh.roomId !== null
            ? roomMap.get(gh.roomId) ?? null
            : null;

      candidates.push({
        sourceDeviceId: gh.id,
        sourceName: gh.customName || gh.name,
        sourceVendor: 'google_home',
        targetDeviceId: bestMatch.target.id,
        targetName: bestMatch.target.customName || bestMatch.target.name,
        targetVendor: bestMatch.target.primaryVendor,
        roomName: room?.name ?? null,
        confidence: bestMatch.confidence,
        reason: bestMatch.reason,
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.confidence !== b.confidence) {
      return a.confidence === 'high' ? -1 : 1;
    }
    return a.targetName.localeCompare(b.targetName);
  });

  return candidates;
}
