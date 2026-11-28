import { asc, eq } from 'drizzle-orm';
import { getDb, type AppDatabase } from '@/db';
import { tariffPeriods } from '@/db/schema';
import { getDemoState } from '@/lib/demo-store';
import { ensureSchemaInitialized, mapDbTariff } from '@/lib/services/shared';
import { normalizeTariffTimeline } from '@/lib/tariff-engine';
import type {
  HcSlot,
  TariffContribution,
  TariffMode,
  TariffPeriodRecord,
  TempoConfig,
} from '@/types';

export interface TariffInput {
  label: string;
  startDate: string;
  endDate: string | null;
  mode: TariffMode;
  baseRateEur: number | null;
  hpRateEur: number | null;
  hcRateEur: number | null;
  hcSlots: HcSlot[];
  tempoConfig?: TempoConfig | null;
  monthlySubscriptionEur: number;
  vatRatePct?: number;
  subscriptionVatRatePct?: number;
  exciseRateEur?: number;
  contributions?: TariffContribution[];
}

async function syncTariffTimelineInDb(db: AppDatabase): Promise<TariffPeriodRecord[]> {
  const rows = await db.select().from(tariffPeriods).orderBy(asc(tariffPeriods.startDate));
  const mapped = rows.map(mapDbTariff);
  const normalized = normalizeTariffTimeline(mapped);

  for (let i = 0; i < mapped.length; i++) {
    const orig = mapped.find((m) => m.id === normalized[i].id);
    if (orig && orig.endDate !== normalized[i].endDate) {
      await db
        .update(tariffPeriods)
        .set({ endDate: normalized[i].endDate })
        .where(eq(tariffPeriods.id, normalized[i].id));
    }
  }
  return normalized;
}

export async function createTariff(input: TariffInput): Promise<TariffPeriodRecord[]> {
  const normalizedInput: TariffInput = {
    ...input,
    vatRatePct: input.vatRatePct ?? 20,
    subscriptionVatRatePct: input.subscriptionVatRatePct ?? 20,
    exciseRateEur: input.exciseRateEur ?? 0,
    contributions: input.contributions ?? [],
  };

  const db = getDb();
  if (!db) {
    const state = getDemoState();
    const created: TariffPeriodRecord = {
      id: state.nextTariffId++,
      ...normalizedInput,
      tempoConfig: normalizedInput.tempoConfig ?? null,
      createdAt: new Date().toISOString(),
    };
    state.tariffs = normalizeTariffTimeline([...state.tariffs, created]);
    return state.tariffs;
  }

  await ensureSchemaInitialized(db);
  await db.insert(tariffPeriods).values(normalizedInput);
  return syncTariffTimelineInDb(db);
}

export async function updateTariff(
  id: number,
  input: Partial<TariffInput>
): Promise<TariffPeriodRecord[]> {
  const db = getDb();
  if (!db) {
    const state = getDemoState();
    const idx = state.tariffs.findIndex((t) => t.id === id);
    if (idx !== -1) {
      state.tariffs[idx] = { ...state.tariffs[idx], ...input };
      state.tariffs = normalizeTariffTimeline(state.tariffs);
    }
    return state.tariffs;
  }

  await ensureSchemaInitialized(db);
  await db.update(tariffPeriods).set(input).where(eq(tariffPeriods.id, id));
  return syncTariffTimelineInDb(db);
}

export async function deleteTariff(id: number): Promise<TariffPeriodRecord[]> {
  const db = getDb();
  if (!db) {
    const state = getDemoState();
    state.tariffs = normalizeTariffTimeline(state.tariffs.filter((t) => t.id !== id));
    return state.tariffs;
  }

  await ensureSchemaInitialized(db);
  await db.delete(tariffPeriods).where(eq(tariffPeriods.id, id));
  return syncTariffTimelineInDb(db);
}
