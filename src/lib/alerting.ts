import { eq } from 'drizzle-orm';
import type { AppDatabase } from '@/db';
import { alertEvents, devices, vendorConnections } from '@/db/schema';
import { getDemoState } from '@/lib/demo-store';
import { isBenignVendorNotice } from '@/lib/home-health';
import { mapDbDevice } from '@/lib/services/shared';
import { VENDOR_REGISTRY } from '@/lib/vendors/registry';
import { extractXiaomiSummary, isXiaomiSecurityOrHomeDevice } from '@/lib/vendors/xiaomi-display';
import { extractXSenseSummary, isXSenseSecurityDevice } from '@/lib/vendors/xsense-display';
import type { DeviceRecord, VendorId } from '@/types';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertCandidate {
  dedupKey: string;
  severity: AlertSeverity;
  title: string;
  message: string;
}

export interface AlertChannelConfig {
  webhookUrl: string | null;
  webhookSecret: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  discordWebhookUrl: string | null;
  ntfyUrl: string | null;
  ntfyToken: string | null;
  cooldownMinutes: number;
  lowBatteryPct: number;
  powerPeakW: number | null;
}

const demoAlertSentMap = new Map<string, Date>();

function sanitizeHttpUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function getAlertingConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): AlertChannelConfig {
  const rawCooldown = Number(env.ALERT_COOLDOWN_MINUTES ?? 180);
  const cooldownMinutes =
    Number.isFinite(rawCooldown) && rawCooldown >= 5 ? Math.round(rawCooldown) : 180;

  const rawBatt = Number(env.ALERT_LOW_BATTERY_PCT ?? 15);
  const lowBatteryPct = Number.isFinite(rawBatt)
    ? Math.min(50, Math.max(1, Math.round(rawBatt)))
    : 15;

  const rawPeak = env.ALERT_POWER_PEAK_W ? Number(env.ALERT_POWER_PEAK_W) : NaN;
  const powerPeakW = Number.isFinite(rawPeak) && rawPeak > 0 ? rawPeak : null;

  const telegramBotToken = env.ALERT_TELEGRAM_BOT_TOKEN?.trim() || null;
  const telegramChatId = env.ALERT_TELEGRAM_CHAT_ID?.trim() || null;

  return {
    webhookUrl: sanitizeHttpUrl(env.ALERT_WEBHOOK_URL),
    webhookSecret: env.ALERT_WEBHOOK_SECRET?.trim() || null,
    telegramBotToken: telegramBotToken && telegramChatId ? telegramBotToken : null,
    telegramChatId: telegramBotToken && telegramChatId ? telegramChatId : null,
    discordWebhookUrl: sanitizeHttpUrl(env.ALERT_DISCORD_WEBHOOK_URL),
    ntfyUrl: sanitizeHttpUrl(env.ALERT_NTFY_URL),
    ntfyToken: env.ALERT_NTFY_TOKEN?.trim() || null,
    cooldownMinutes,
    lowBatteryPct,
    powerPeakW,
  };
}

export function hasConfiguredAlertChannel(config: AlertChannelConfig): boolean {
  return Boolean(
    config.webhookUrl ||
      (config.telegramBotToken && config.telegramChatId) ||
      config.discordWebhookUrl ||
      config.ntfyUrl
  );
}

/**
 * Évalue les alertes sortantes à déclencher depuis l'état courant des appareils et systèmes.
 */
export function evaluateAlertCandidates(params: {
  devices: DeviceRecord[];
  vendors: Array<{ vendor: VendorId; label: string; lastError: string | null }>;
  now: Date;
  lowBatteryPct: number;
  powerPeakW: number | null;
  offlineHoursThreshold?: number;
}): AlertCandidate[] {
  const {
    devices: deviceList,
    vendors,
    now,
    lowBatteryPct,
    powerPeakW,
    offlineHoursThreshold = 24,
  } = params;

  const candidates: AlertCandidate[] = [];
  const offlineCutoffMs = now.getTime() - offlineHoursThreshold * 3_600_000;
  let totalPowerW = 0;

  for (const d of deviceList) {
    const name = d.customName || d.name;

    if (isXSenseSecurityDevice(d) || isXiaomiSecurityOrHomeDevice(d)) {
      const xs = extractXSenseSummary(d.lastRawStatus, 'fr');
      const mi = extractXiaomiSummary(d.lastRawStatus, 'fr');
      if (xs?.isAlert || mi?.isAlert) {
        const label = xs?.alarmLabel ?? mi?.alertLabel ?? 'Alerte sécurité';
        candidates.push({
          dedupKey: `safety:${d.id}`,
          severity: 'critical',
          title: `Alerte sécurité : ${name}`,
          message: `${name} signale : ${label}`,
        });
      }
    }

    if (!d.isMonitored) continue;

    if (
      d.lastBatteryPct !== null &&
      Number.isFinite(d.lastBatteryPct) &&
      d.lastBatteryPct <= lowBatteryPct
    ) {
      candidates.push({
        dedupKey: `battery:${d.id}`,
        severity: 'warning',
        title: `Batterie faible : ${name}`,
        message: `${name} est à ${Math.round(d.lastBatteryPct)} % (seuil ≤ ${lowBatteryPct} %)`,
      });
    }

    if (!d.isOnline && !d.ignoreOfflineAlert && d.lastSeenAt) {
      const seenMs = new Date(d.lastSeenAt).getTime();
      if (!Number.isNaN(seenMs) && seenMs < offlineCutoffMs) {
        const hoursOffline = Math.round((now.getTime() - seenMs) / 3_600_000);
        candidates.push({
          dedupKey: `offline:${d.id}`,
          severity: 'warning',
          title: `Appareil hors ligne : ${name}`,
          message: `${name} est hors ligne depuis ${hoursOffline}h`,
        });
      }
    }

    if (!d.excludeFromTotals && d.lastPowerW !== null && Number.isFinite(d.lastPowerW)) {
      totalPowerW += d.lastPowerW;
    }
  }

  if (powerPeakW !== null && powerPeakW > 0 && totalPowerW > powerPeakW) {
    candidates.push({
      dedupKey: 'power_peak',
      severity: 'warning',
      title: 'Pic de puissance détecté',
      message: `Puissance totale ${Math.round(totalPowerW)} W (seuil ${Math.round(powerPeakW)} W)`,
    });
  }

  for (const v of vendors) {
    if (v.lastError && v.lastError.trim().length > 0 && !isBenignVendorNotice(v.lastError)) {
      candidates.push({
        dedupKey: `vendor_error:${v.vendor}`,
        severity: 'warning',
        title: `Erreur connecteur ${v.label}`,
        message: `${v.label} : ${v.lastError}`,
      });
    }
  }

  return candidates;
}

function formatPlainAlertText(candidates: AlertCandidate[]): string {
  return candidates
    .map((c) => `[${c.severity.toUpperCase()}] ${c.title} — ${c.message}`)
    .join('\n');
}

/**
 * Envoie les alertes éligibles (hors cooldown) vers tous les canaux configurés.
 */
export async function dispatchAlerts(params: {
  candidates: AlertCandidate[];
  config: AlertChannelConfig;
  cooldownLookup: (key: string) => Promise<Date | null>;
  markSent: (candidate: AlertCandidate, sentAt: Date) => Promise<void>;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<{ sent: number; skippedCooldown: number; failedChannels: number }> {
  const {
    candidates,
    config,
    cooldownLookup,
    markSent,
    now = new Date(),
    fetchImpl = fetch,
  } = params;

  if (candidates.length === 0 || !hasConfiguredAlertChannel(config)) {
    return { sent: 0, skippedCooldown: 0, failedChannels: 0 };
  }

  const cooldownMs = config.cooldownMinutes * 60_000;
  const due: AlertCandidate[] = [];
  let skippedCooldown = 0;

  for (const c of candidates) {
    const lastSent = await cooldownLookup(c.dedupKey);
    if (lastSent && now.getTime() - lastSent.getTime() < cooldownMs) {
      skippedCooldown += 1;
    } else {
      due.push(c);
    }
  }

  if (due.length === 0) {
    return { sent: 0, skippedCooldown, failedChannels: 0 };
  }

  const text = formatPlainAlertText(due);
  const requests: Array<Promise<Response>> = [];

  if (config.webhookUrl) {
    requests.push(
      fetchImpl(config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.webhookSecret ? { 'X-Home-Cockpit-Secret': config.webhookSecret } : {}),
        },
        body: JSON.stringify({
          source: 'home-cockpit',
          timestamp: now.toISOString(),
          alerts: due,
        }),
        signal: AbortSignal.timeout(8000),
      })
    );
  }

  if (config.telegramBotToken && config.telegramChatId) {
    requests.push(
      fetchImpl(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegramChatId,
          text: `Home Cockpit\n${text}`,
        }),
        signal: AbortSignal.timeout(8000),
      })
    );
  }

  if (config.discordWebhookUrl) {
    requests.push(
      fetchImpl(config.discordWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `**Home Cockpit**\n${text}`.slice(0, 1950),
        }),
        signal: AbortSignal.timeout(8000),
      })
    );
  }

  if (config.ntfyUrl) {
    const hasCritical = due.some((c) => c.severity === 'critical');
    requests.push(
      fetchImpl(config.ntfyUrl, {
        method: 'POST',
        headers: {
          Title: hasCritical ? 'Home Cockpit Critical Alert' : 'Home Cockpit Alert',
          Priority: hasCritical ? 'high' : 'default',
          ...(config.ntfyToken ? { Authorization: `Bearer ${config.ntfyToken}` } : {}),
        },
        body: text,
        signal: AbortSignal.timeout(8000),
      })
    );
  }

  const settled = await Promise.allSettled(requests);
  let successChannels = 0;
  let failedChannels = 0;
  for (const res of settled) {
    if (res.status === 'fulfilled' && res.value.ok) {
      successChannels += 1;
    } else {
      failedChannels += 1;
    }
  }

  if (successChannels > 0) {
    for (const c of due) {
      await markSent(c, now);
    }
    return { sent: due.length, skippedCooldown, failedChannels };
  }

  return { sent: 0, skippedCooldown, failedChannels };
}

/**
 * Exécute l'évaluation et l'envoi d'alertes après une collecte (non bloquant).
 */
export async function runPostCollectionAlerting(
  db: AppDatabase | null,
  now: Date = new Date()
): Promise<{ sent: number; skippedCooldown: number; failedChannels: number }> {
  const config = getAlertingConfigFromEnv();
  if (!hasConfiguredAlertChannel(config)) {
    return { sent: 0, skippedCooldown: 0, failedChannels: 0 };
  }

  let deviceList: DeviceRecord[] = [];
  let vendorList: Array<{ vendor: VendorId; label: string; lastError: string | null }> = [];

  if (!db) {
    const state = getDemoState();
    deviceList = state.devices;
    vendorList = Object.entries(state.vendorConnections).map(([vendor, conn]) => ({
      vendor: vendor as VendorId,
      label: VENDOR_REGISTRY[vendor as VendorId]?.label ?? vendor,
      lastError: conn.lastError,
    }));
  } else {
    const [devRows, connRows] = await Promise.all([
      db.select().from(devices),
      db.select().from(vendorConnections),
    ]);
    deviceList = devRows.map((row) => mapDbDevice(row, []));
    vendorList = connRows.map((row) => ({
      vendor: row.vendor as VendorId,
      label: VENDOR_REGISTRY[row.vendor as VendorId]?.label ?? row.vendor,
      lastError: row.lastError,
    }));
  }

  const candidates = evaluateAlertCandidates({
    devices: deviceList,
    vendors: vendorList,
    now,
    lowBatteryPct: config.lowBatteryPct,
    powerPeakW: config.powerPeakW,
  });

  if (candidates.length === 0) {
    return { sent: 0, skippedCooldown: 0, failedChannels: 0 };
  }

  return dispatchAlerts({
    candidates,
    config,
    now,
    cooldownLookup: async (key) => {
      if (!db) return demoAlertSentMap.get(key) ?? null;
      const [row] = await db
        .select({ lastSentAt: alertEvents.lastSentAt })
        .from(alertEvents)
        .where(eq(alertEvents.dedupKey, key));
      return row?.lastSentAt ?? null;
    },
    markSent: async (candidate, sentAt) => {
      if (!db) {
        demoAlertSentMap.set(candidate.dedupKey, sentAt);
        return;
      }
      await db
        .insert(alertEvents)
        .values({
          dedupKey: candidate.dedupKey,
          severity: candidate.severity,
          message: candidate.message,
          lastSentAt: sentAt,
        })
        .onConflictDoUpdate({
          target: alertEvents.dedupKey,
          set: {
            severity: candidate.severity,
            message: candidate.message,
            lastSentAt: sentAt,
          },
        });
    },
  });
}
