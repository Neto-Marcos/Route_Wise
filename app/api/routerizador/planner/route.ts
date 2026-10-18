import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  hashRoute,
  requireRoutingDispatcher,
  RoutingError,
  signRoutingProof,
  verifyRoutingProof,
} from "@/lib/routing-security";
import { matchPlannerStops } from "@/lib/planner-matcher";
import { POST as dispatchPOST } from "../dispatch/route";
import type { SuggestedRoute } from "@/lib/route-engine";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const session = await requireRoutingDispatcher(
      { query },
      await getSession("dispatcher")
    );
    const body = await req.json();
    const proof = await verifyRoutingProof(body.routingProof, session);
    const originalHash = hashRoute(body.suggested);
    if (
      proof.planner ||
      !proof.routeHashes.includes(originalHash) ||
      !proof.authorizationId
    ) {
      throw new RoutingError("Transferência sem autorização original válida.", 409);
    }
    const authLog = await query<{
      actor_id: string;
      created_at: Date;
      details: unknown;
    }>(
      "SELECT actor_id,created_at,details FROM audit_log WHERE entity_id=$1 AND action='authorize_minimum_exception' AND actor_id=$2 AND details->>'companyId'=$3",
      [proof.authorizationId, session.dispatcherId, session.companyId]
    );
    if (!authLog.rows[0]) {
      throw new RoutingError("Autorização auditável não encontrada.", 409);
    }
    const permutation = matchPlannerStops(body.suggested, proof.config, body.stops);
    if (
      !permutation ||
      body.routeDate !== proof.config.routeDate ||
      body.circular !== false
    ) {
      throw new RoutingError(
        "Pedidos, destinos, origem ou data mudaram. Volte ao roteirizador para nova autorização.",
        409
      );
    }
    const orderChanged = permutation.some((idx, pos) => idx !== pos);
    if (orderChanged && body.confirmedChange !== true) {
      throw new RoutingError(
        "Confirme novamente a autorização para esta sequência manual.",
        428
      );
    }
    if (!Number.isFinite(body.estimatedKm) || body.estimatedKm < 0) {
      throw new RoutingError("Calcule o trajeto antes de salvar.");
    }
    const suggested: SuggestedRoute = structuredClone(body.suggested);
    suggested.stops = permutation.map((idx, pos) => ({
      ...suggested.stops[idx],
      position: pos + 1,
      loadingSequence: permutation.length - pos,
    }));
    suggested.cityPath = suggested.stops.map((s) => s.city);
    suggested.name = String(body.name || suggested.name).trim();
    suggested.estimatedKm = body.estimatedKm;
    delete suggested.estimatedDurationMin;
    delete suggested.costEstimateMin;
    delete suggested.costEstimateMax;

    const orderIds = suggested.stops.flatMap((s) => s.orders.map((o) => o.orderId));
    const exceptions = proof.exceptions.filter((id) => orderIds.includes(id));
    const nextProof = await signRoutingProof({
      ...proof,
      exceptions,
      routeHashes: [hashRoute(suggested)],
      planner: {
        originalHash,
        authorizedAt: authLog.rows[0].created_at.toISOString(),
        authorizationDetails: authLog.rows[0].details,
        reconfirmedAt: orderChanged ? new Date().toISOString() : null,
        orderChanged,
        estimatedKm: body.estimatedKm,
      },
    });
    return dispatchPOST(
      new NextRequest(req.url, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify({
          routingProof: nextProof,
          routeDate: body.routeDate,
          routes: [
            {
              suggested,
              driverId: body.driverId,
              vehicleId: body.vehicleId,
            },
          ],
        }),
      })
    );
  } catch (err) {
    if (err instanceof RoutingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[routerizador/planner]", err);
    return NextResponse.json(
      { error: "Não foi possível transferir a rota autorizada." },
      { status: 500 }
    );
  }
}
