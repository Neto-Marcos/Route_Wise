import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { isValidStopReorder } from "@/lib/stop-reorder";
import { hasRouteMinimumException } from "@/lib/routing-security";

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession("dispatcher");
  if (!session) {
    return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await req.json();
  if (
    !Array.isArray(body.stops) ||
    body.stops.length < 2 ||
    !Number.isFinite(body.estimatedKm) ||
    body.estimatedKm < 0
  ) {
    return NextResponse.json({ error: "Sequência ou cálculo inválido" }, { status: 400 });
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const routeRes = await client.query<{ status: string }>(
      "SELECT * FROM routes WHERE id=$1 AND company_id=$2 FOR UPDATE",
      [id, session.companyId]
    );
    if (!routeRes.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Rota não encontrada" }, { status: 404 });
    }
    if (!["draft", "assigned"].includes(routeRes.rows[0].status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Rota já iniciada não pode ser reorganizada" },
        { status: 409 }
      );
    }
    if (await hasRouteMinimumException(client, id, session.companyId!)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            "Rota com exceção auditada: volte ao roteirizador para nova autorização antes de alterar.",
        },
        { status: 409 }
      );
    }
    const existingStops = await client.query<{
      id: string;
      boxes: number | null;
      volume_m3: number | null;
    }>("SELECT * FROM route_stops WHERE route_id=$1 ORDER BY position FOR UPDATE", [id]);
    if (
      !isValidStopReorder(existingStops.rows, body.stops) ||
      !Array.isArray(body.expectedStopIds) ||
      existingStops.rows.some((s, idx) => s.id !== body.expectedStopIds[idx]) ||
      existingStops.rows.length !== body.expectedStopIds.length
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "As paradas mudaram. Reabra a rota antes de reorganizar." },
        { status: 409 }
      );
    }
    await client.query("UPDATE route_stops SET position=-position-1 WHERE route_id=$1", [
      id,
    ]);
    for (let i = 0; i < body.stops.length; i++) {
      const stop = body.stops[i];
      const existing = existingStops.rows.find((s) => s.id === stop.id)!;
      const boxes = stop.boxes === undefined ? existing.boxes : stop.boxes;
      const volume = stop.volume_m3 === undefined ? existing.volume_m3 : stop.volume_m3;
      if (
        (boxes !== null && (!Number.isInteger(Number(boxes)) || Number(boxes) < 0)) ||
        (volume !== null && (!Number.isFinite(Number(volume)) || Number(volume) < 0))
      ) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Volumes inválidos" }, { status: 400 });
      }
      await client.query(
        "UPDATE route_stops SET position=$1,boxes=$4,volume_m3=$5 WHERE route_id=$2 AND id=$3",
        [i, id, stop.id, boxes, volume]
      );
    }
    const optimizeBy = ["distance", "time", "manual"].includes(body.optimizeBy)
      ? body.optimizeBy
      : "manual";
    const updated = await client.query(
      "UPDATE routes SET optimize_by=$3,estimated_km=$1,name=COALESCE($4,name),route_date=COALESCE($5,route_date),circular=COALESCE($6,circular) WHERE id=$2 RETURNING *",
      [
        body.estimatedKm,
        id,
        optimizeBy,
        body.name || null,
        body.routeDate || null,
        typeof body.circular === "boolean" ? body.circular : null,
      ]
    );
    await client.query("COMMIT");
    return NextResponse.json(updated.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[routes/reorder]", err);
    return NextResponse.json(
      { error: "Não foi possível salvar a sequência" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
