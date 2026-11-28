import { NextResponse } from 'next/server';
import { createTariff, deleteTariff, updateTariff } from '@/lib/data-service';
import { apiErrorResponse, requireApiAuth } from '@/lib/http-utils';
import { asRecord } from '@/lib/utils';
import type { HcSlot, TariffMode, TempoConfig, TempoDayColor } from '@/types';

const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_HHMM_REGEX = /^\d{2}:\d{2}$/;
const VALID_TARIFF_MODES = new Set<TariffMode>(['BASE', 'HP_HC', 'TEMPO']);
const VALID_TEMPO_COLORS = new Set<TempoDayColor>(['BLUE', 'WHITE', 'RED']);

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseTempoConfig(raw: unknown): TempoConfig | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const fields = [
    'blueHpRateEur',
    'blueHcRateEur',
    'whiteHpRateEur',
    'whiteHcRateEur',
    'redHpRateEur',
    'redHcRateEur',
  ] as const;
  for (const key of fields) {
    if (!isNonNegativeFiniteNumber(rec[key])) return null;
  }

  let dayColors: Record<string, TempoDayColor> | undefined;
  if (rec.dayColors !== undefined) {
    const dcRec = asRecord(rec.dayColors);
    if (!dcRec) return null;
    dayColors = {};
    for (const [k, v] of Object.entries(dcRec)) {
      if (!DATE_ISO_REGEX.test(k) || typeof v !== 'string' || !VALID_TEMPO_COLORS.has(v as TempoDayColor)) {
        return null;
      }
      dayColors[k] = v as TempoDayColor;
    }
  }

  return {
    blueHpRateEur: rec.blueHpRateEur as number,
    blueHcRateEur: rec.blueHcRateEur as number,
    whiteHpRateEur: rec.whiteHpRateEur as number,
    whiteHcRateEur: rec.whiteHcRateEur as number,
    redHpRateEur: rec.redHpRateEur as number,
    redHcRateEur: rec.redHcRateEur as number,
    ...(dayColors ? { dayColors } : {}),
  };
}

function isNonNegativeNullableNumber(value: unknown): value is number | null {
  if (value === null) return true;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseHcSlots(raw: unknown): HcSlot[] | null {
  if (!Array.isArray(raw)) return null;
  const slots: HcSlot[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) return null;
    const start = typeof rec.start === 'string' ? rec.start.trim() : '';
    const end = typeof rec.end === 'string' ? rec.end.trim() : '';
    if (!TIME_HHMM_REGEX.test(start) || !TIME_HHMM_REGEX.test(end)) {
      return null;
    }
    slots.push({ start, end });
  }
  return slots;
}

export async function POST(request: Request) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const rawBody = await request.json();
    const body = asRecord(rawBody);
    if (!body) {
      return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
    }

    const label = typeof body.label === 'string' ? body.label.trim() : '';
    const startDate = typeof body.startDate === 'string' ? body.startDate.trim() : '';
    if (!label || label.length > 120 || !DATE_ISO_REGEX.test(startDate)) {
      return NextResponse.json(
        { error: 'Libellé (<= 120 car.) et date de début (YYYY-MM-DD) requis.' },
        { status: 400 }
      );
    }

    let endDate: string | null = null;
    if (body.endDate !== undefined && body.endDate !== null && body.endDate !== '') {
      if (typeof body.endDate !== 'string' || !DATE_ISO_REGEX.test(body.endDate.trim())) {
        return NextResponse.json({ error: 'Date de fin invalide (YYYY-MM-DD).' }, { status: 400 });
      }
      endDate = body.endDate.trim();
    }

    const mode: TariffMode =
      body.mode === undefined
        ? 'BASE'
        : VALID_TARIFF_MODES.has(body.mode as TariffMode)
          ? (body.mode as TariffMode)
          : (() => {
              throw new Error('INVALID_MODE');
            })();

    const baseRateEur = body.baseRateEur === undefined ? null : body.baseRateEur;
    const hpRateEur = body.hpRateEur === undefined ? null : body.hpRateEur;
    const hcRateEur = body.hcRateEur === undefined ? null : body.hcRateEur;
    const monthlySubscriptionEur =
      body.monthlySubscriptionEur === undefined ? 0 : body.monthlySubscriptionEur;
    const vatRatePct = body.vatRatePct === undefined ? 20 : body.vatRatePct;
    const subscriptionVatRatePct =
      body.subscriptionVatRatePct === undefined ? 20 : body.subscriptionVatRatePct;
    const exciseRateEur = body.exciseRateEur === undefined ? 0 : body.exciseRateEur;

    if (
      !isNonNegativeNullableNumber(baseRateEur) ||
      !isNonNegativeNullableNumber(hpRateEur) ||
      !isNonNegativeNullableNumber(hcRateEur) ||
      typeof monthlySubscriptionEur !== 'number' ||
      !Number.isFinite(monthlySubscriptionEur) ||
      monthlySubscriptionEur < 0 ||
      typeof vatRatePct !== 'number' ||
      !Number.isFinite(vatRatePct) ||
      vatRatePct < 0 ||
      vatRatePct > 100 ||
      typeof subscriptionVatRatePct !== 'number' ||
      !Number.isFinite(subscriptionVatRatePct) ||
      subscriptionVatRatePct < 0 ||
      subscriptionVatRatePct > 100 ||
      typeof exciseRateEur !== 'number' ||
      !Number.isFinite(exciseRateEur) ||
      exciseRateEur < 0 ||
      exciseRateEur > 5
    ) {
      return NextResponse.json({ error: 'Tarifs, taxes ou abonnement invalides.' }, { status: 400 });
    }

    const hcSlots = body.hcSlots === undefined ? [] : parseHcSlots(body.hcSlots);
    if (!hcSlots) {
      return NextResponse.json(
        { error: 'Créneaux heures creuses invalides (format HH:MM attendu).' },
        { status: 400 }
      );
    }

    let tempoConfig: TempoConfig | null = null;
    if (body.tempoConfig !== undefined && body.tempoConfig !== null) {
      const parsedTempo = parseTempoConfig(body.tempoConfig);
      if (!parsedTempo) {
        return NextResponse.json({ error: 'Configuration Tempo invalide.' }, { status: 400 });
      }
      tempoConfig = parsedTempo;
    }

    const tariffs = await createTariff({
      label,
      startDate,
      endDate,
      mode,
      baseRateEur,
      hpRateEur,
      hcRateEur,
      hcSlots,
      tempoConfig,
      monthlySubscriptionEur,
      vatRatePct,
      subscriptionVatRatePct,
      exciseRateEur,
    });
    return NextResponse.json({ tariffs }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_MODE') {
      return NextResponse.json({ error: 'Mode tarifaire invalide (BASE, HP_HC ou TEMPO).' }, { status: 400 });
    }
    return apiErrorResponse('api/tariffs POST', err, 'Erreur création tarif');
  }
}

export async function PATCH(request: Request) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const rawBody = await request.json();
    const body = asRecord(rawBody);
    if (!body) {
      return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
    }

    const id = typeof body.id === 'number' ? body.id : Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'ID tarif valide requis' }, { status: 400 });
    }

    const updates: Parameters<typeof updateTariff>[1] = {};

    if (body.label !== undefined) {
      const trimmed = typeof body.label === 'string' ? body.label.trim() : '';
      if (!trimmed || trimmed.length > 120) {
        return NextResponse.json({ error: 'Libellé tarif invalide.' }, { status: 400 });
      }
      updates.label = trimmed;
    }

    if (body.startDate !== undefined) {
      if (typeof body.startDate !== 'string' || !DATE_ISO_REGEX.test(body.startDate.trim())) {
        return NextResponse.json({ error: 'Date de début invalide (YYYY-MM-DD).' }, { status: 400 });
      }
      updates.startDate = body.startDate.trim();
    }

    if (body.endDate !== undefined) {
      if (body.endDate === null || body.endDate === '') {
        updates.endDate = null;
      } else if (typeof body.endDate === 'string' && DATE_ISO_REGEX.test(body.endDate.trim())) {
        updates.endDate = body.endDate.trim();
      } else {
        return NextResponse.json({ error: 'Date de fin invalide (YYYY-MM-DD).' }, { status: 400 });
      }
    }

    if (body.mode !== undefined) {
      if (typeof body.mode !== 'string' || !VALID_TARIFF_MODES.has(body.mode as TariffMode)) {
        return NextResponse.json({ error: 'Mode tarifaire invalide.' }, { status: 400 });
      }
      updates.mode = body.mode as TariffMode;
    }

    if (body.baseRateEur !== undefined) {
      if (!isNonNegativeNullableNumber(body.baseRateEur)) {
        return NextResponse.json({ error: 'Tarif base invalide.' }, { status: 400 });
      }
      updates.baseRateEur = body.baseRateEur;
    }

    if (body.hpRateEur !== undefined) {
      if (!isNonNegativeNullableNumber(body.hpRateEur)) {
        return NextResponse.json({ error: 'Tarif HP invalide.' }, { status: 400 });
      }
      updates.hpRateEur = body.hpRateEur;
    }

    if (body.hcRateEur !== undefined) {
      if (!isNonNegativeNullableNumber(body.hcRateEur)) {
        return NextResponse.json({ error: 'Tarif HC invalide.' }, { status: 400 });
      }
      updates.hcRateEur = body.hcRateEur;
    }

    if (body.monthlySubscriptionEur !== undefined) {
      if (
        typeof body.monthlySubscriptionEur !== 'number' ||
        !Number.isFinite(body.monthlySubscriptionEur) ||
        body.monthlySubscriptionEur < 0
      ) {
        return NextResponse.json({ error: 'Abonnement mensuel invalide.' }, { status: 400 });
      }
      updates.monthlySubscriptionEur = body.monthlySubscriptionEur;
    }

    if (body.vatRatePct !== undefined) {
      if (
        typeof body.vatRatePct !== 'number' ||
        !Number.isFinite(body.vatRatePct) ||
        body.vatRatePct < 0 ||
        body.vatRatePct > 100
      ) {
        return NextResponse.json({ error: 'Taux de TVA invalide (0 à 100 %).' }, { status: 400 });
      }
      updates.vatRatePct = body.vatRatePct;
    }

    if (body.subscriptionVatRatePct !== undefined) {
      if (
        typeof body.subscriptionVatRatePct !== 'number' ||
        !Number.isFinite(body.subscriptionVatRatePct) ||
        body.subscriptionVatRatePct < 0 ||
        body.subscriptionVatRatePct > 100
      ) {
        return NextResponse.json({ error: 'Taux de TVA abonnement invalide (0 à 100 %).' }, { status: 400 });
      }
      updates.subscriptionVatRatePct = body.subscriptionVatRatePct;
    }

    if (body.exciseRateEur !== undefined) {
      if (
        typeof body.exciseRateEur !== 'number' ||
        !Number.isFinite(body.exciseRateEur) ||
        body.exciseRateEur < 0 ||
        body.exciseRateEur > 5
      ) {
        return NextResponse.json({ error: 'Accise / taxe par kWh invalide (0 à 5 €).' }, { status: 400 });
      }
      updates.exciseRateEur = body.exciseRateEur;
    }

    if (body.hcSlots !== undefined) {
      const slots = parseHcSlots(body.hcSlots);
      if (!slots) {
        return NextResponse.json({ error: 'Créneaux heures creuses invalides.' }, { status: 400 });
      }
      updates.hcSlots = slots;
    }

    if (body.tempoConfig !== undefined) {
      if (body.tempoConfig === null) {
        updates.tempoConfig = null;
      } else {
        const parsedTempo = parseTempoConfig(body.tempoConfig);
        if (!parsedTempo) {
          return NextResponse.json({ error: 'Configuration Tempo invalide.' }, { status: 400 });
        }
        updates.tempoConfig = parsedTempo;
      }
    }

    const tariffs = await updateTariff(id, updates);
    return NextResponse.json({ tariffs });
  } catch (err) {
    return apiErrorResponse('api/tariffs PATCH', err, 'Erreur mise à jour tarif');
  }
}

export async function DELETE(request: Request) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get('id');
    const id = idParam ? Number(idParam) : NaN;
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'ID tarif invalide' }, { status: 400 });
    }

    const tariffs = await deleteTariff(id);
    return NextResponse.json({ tariffs });
  } catch (err) {
    return apiErrorResponse('api/tariffs DELETE', err, 'Erreur suppression tarif');
  }
}
