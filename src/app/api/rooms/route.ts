import { NextResponse } from 'next/server';
import { createRoom, deleteRoom, updateRoom } from '@/lib/data-service';

type RoomMutationFields = {
  name?: string;
  icon?: string;
  color?: string;
  targetTempMin?: number;
  targetTempMax?: number;
  targetHumidityMin?: number;
  targetHumidityMax?: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateRoomThresholds(fields: {
  tempMin?: number;
  tempMax?: number;
  humMin?: number;
  humMax?: number;
}): string | null {
  const { tempMin, tempMax, humMin, humMax } = fields;
  if (tempMin !== undefined && tempMax !== undefined && tempMin > tempMax) {
    return 'La température min doit être inférieure ou égale à la température max.';
  }
  if (humMin !== undefined && (humMin < 0 || humMin > 100)) {
    return "L'humidité min doit être comprise entre 0 et 100 %.";
  }
  if (humMax !== undefined && (humMax < 0 || humMax > 100)) {
    return "L'humidité max doit être comprise entre 0 et 100 %.";
  }
  if (humMin !== undefined && humMax !== undefined && humMin > humMax) {
    return "L'humidité min doit être inférieure ou égale à l'humidité max.";
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Nom de pièce requis' }, { status: 400 });
    }

    const numericKeys = [
      'targetTempMin',
      'targetTempMax',
      'targetHumidityMin',
      'targetHumidityMax',
    ] as const;

    for (const key of numericKeys) {
      if (body[key] !== undefined && !isFiniteNumber(body[key])) {
        return NextResponse.json({ error: `Valeur numérique invalide pour ${key}` }, { status: 400 });
      }
    }

    const targetTempMin = isFiniteNumber(body.targetTempMin) ? body.targetTempMin : undefined;
    const targetTempMax = isFiniteNumber(body.targetTempMax) ? body.targetTempMax : undefined;
    const targetHumidityMin = isFiniteNumber(body.targetHumidityMin) ? body.targetHumidityMin : undefined;
    const targetHumidityMax = isFiniteNumber(body.targetHumidityMax) ? body.targetHumidityMax : undefined;

    const thresholdErr = validateRoomThresholds({
      tempMin: targetTempMin ?? 19,
      tempMax: targetTempMax ?? 22,
      humMin: targetHumidityMin ?? 40,
      humMax: targetHumidityMax ?? 60,
    });
    if (thresholdErr) {
      return NextResponse.json({ error: thresholdErr }, { status: 400 });
    }

    const icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim() : undefined;
    const color = typeof body.color === 'string' && body.color.trim() ? body.color.trim() : undefined;

    const room = await createRoom({
      name,
      icon,
      color,
      targetTempMin,
      targetTempMax,
      targetHumidityMin,
      targetHumidityMax,
    });
    return NextResponse.json({ room }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur création pièce';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const id = typeof body.id === 'number' ? body.id : Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'ID pièce requis' }, { status: 400 });
    }

    const updates: RoomMutationFields = {};

    if (body.name !== undefined) {
      const trimmed = typeof body.name === 'string' ? body.name.trim() : '';
      if (!trimmed) {
        return NextResponse.json({ error: 'Nom de pièce requis' }, { status: 400 });
      }
      updates.name = trimmed;
    }

    if (body.icon !== undefined) {
      if (typeof body.icon !== 'string' || !body.icon.trim()) {
        return NextResponse.json({ error: 'Icône invalide' }, { status: 400 });
      }
      updates.icon = body.icon.trim();
    }

    if (body.color !== undefined) {
      if (typeof body.color !== 'string' || !body.color.trim()) {
        return NextResponse.json({ error: 'Couleur invalide' }, { status: 400 });
      }
      updates.color = body.color.trim();
    }

    const numericKeys = [
      'targetTempMin',
      'targetTempMax',
      'targetHumidityMin',
      'targetHumidityMax',
    ] as const;

    for (const key of numericKeys) {
      if (body[key] !== undefined) {
        if (!isFiniteNumber(body[key])) {
          return NextResponse.json({ error: `Valeur numérique invalide pour ${key}` }, { status: 400 });
        }
        updates[key] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Aucune modification fournie' }, { status: 400 });
    }

    const thresholdErr = validateRoomThresholds({
      tempMin: updates.targetTempMin,
      tempMax: updates.targetTempMax,
      humMin: updates.targetHumidityMin,
      humMax: updates.targetHumidityMax,
    });
    if (thresholdErr) {
      return NextResponse.json({ error: thresholdErr }, { status: 400 });
    }

    const room = await updateRoom(id, updates);
    if (!room) {
      return NextResponse.json({ error: 'Pièce introuvable' }, { status: 404 });
    }
    return NextResponse.json({ room });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur mise à jour pièce';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get('id');
    const id = idParam ? Number(idParam) : NaN;
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: 'ID pièce invalide' }, { status: 400 });
    }

    await deleteRoom(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur suppression pièce';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
