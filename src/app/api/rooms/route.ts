import { NextResponse } from 'next/server';
import { createRoom, deleteRoom, updateRoom } from '@/lib/data-service';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      icon?: string;
      color?: string;
      targetTempMin?: number;
      targetTempMax?: number;
      targetHumidityMin?: number;
      targetHumidityMax?: number;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'Nom de pièce requis' }, { status: 400 });
    }

    const room = await createRoom({
      name: body.name,
      icon: body.icon,
      color: body.color,
      targetTempMin: body.targetTempMin,
      targetTempMax: body.targetTempMax,
      targetHumidityMin: body.targetHumidityMin,
      targetHumidityMax: body.targetHumidityMax,
    });
    return NextResponse.json({ room }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur création pièce';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: number;
      name?: string;
      icon?: string;
      color?: string;
      targetTempMin?: number;
      targetTempMax?: number;
      targetHumidityMin?: number;
      targetHumidityMax?: number;
    };

    if (!body.id) {
      return NextResponse.json({ error: 'ID pièce requis' }, { status: 400 });
    }

    const { id, ...rest } = body;
    const room = await updateRoom(id, rest);
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
