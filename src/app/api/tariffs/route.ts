import { NextResponse } from 'next/server';
import { createTariff, deleteTariff, updateTariff } from '@/lib/data-service';
import type { HcSlot, TariffMode } from '@/types';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      label?: string;
      startDate?: string;
      endDate?: string | null;
      mode?: TariffMode;
      baseRateEur?: number | null;
      hpRateEur?: number | null;
      hcRateEur?: number | null;
      hcSlots?: HcSlot[];
      monthlySubscriptionEur?: number;
    };

    if (!body.label?.trim() || !body.startDate) {
      return NextResponse.json({ error: 'Libellé et date de début requis' }, { status: 400 });
    }

    const tariffs = await createTariff({
      label: body.label.trim(),
      startDate: body.startDate,
      endDate: body.endDate || null,
      mode: body.mode ?? 'BASE',
      baseRateEur: body.baseRateEur ?? null,
      hpRateEur: body.hpRateEur ?? null,
      hcRateEur: body.hcRateEur ?? null,
      hcSlots: body.hcSlots ?? [],
      monthlySubscriptionEur: body.monthlySubscriptionEur ?? 0,
    });
    return NextResponse.json({ tariffs }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur création tarif';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: number;
      label?: string;
      startDate?: string;
      endDate?: string | null;
      mode?: TariffMode;
      baseRateEur?: number | null;
      hpRateEur?: number | null;
      hcRateEur?: number | null;
      hcSlots?: HcSlot[];
      monthlySubscriptionEur?: number;
    };

    if (!body.id) {
      return NextResponse.json({ error: 'ID tarif requis' }, { status: 400 });
    }

    const { id, ...rest } = body;
    const tariffs = await updateTariff(id, rest);
    return NextResponse.json({ tariffs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur mise à jour tarif';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get('id');
    const id = idParam ? Number(idParam) : NaN;
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: 'ID tarif invalide' }, { status: 400 });
    }

    const tariffs = await deleteTariff(id);
    return NextResponse.json({ tariffs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur suppression tarif';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
