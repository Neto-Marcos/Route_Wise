import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";

/**
 * POST /api/routes/[id]/dynamic-stop
 * Dia 14: Re-roteirização Dinâmica com viagem em andamento
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { action, stopId, newStop } = body;

    if (action === "cancel" && stopId) {
      // Cancela parada em tempo real
      await query(
        `UPDATE route_stops SET status = 'cancelled' WHERE id = $1 AND route_id = $2`,
        [stopId, id]
      );
      return NextResponse.json({ success: true, message: "Parada cancelada na rota ativa." });
    }

    if (action === "add" && newStop) {
      // Adiciona nova parada urgente na rota ativa
      const maxPos = await query(
        `SELECT COALESCE(MAX(position), 0) as max_pos FROM route_stops WHERE route_id = $1`,
        [id]
      );
      const nextPos = (maxPos.rows[0]?.max_pos || 0) + 1;

      await query(
        `INSERT INTO route_stops (route_id, position, name, address, lat, lng, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
        [id, nextPos, newStop.name, newStop.address, newStop.lat, newStop.lng]
      );

      return NextResponse.json({ success: true, message: "Nova parada urgente inserida na viagem." });
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
