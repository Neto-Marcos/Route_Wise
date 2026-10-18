import { NextRequest, NextResponse } from "next/server";
import { db, query } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { checkOrderMinEligibility, type SuggestedRoute } from "@/lib/route-engine";
import {
  hashRoute,
  loadActiveRoutingWorkbook,
  requireRoutingDispatcher,
  RoutingError,
  verifyAndSelectRoutingOrders,
  verifyRoutingProof,
} from "@/lib/routing-security";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const rawSession = await getSession("dispatcher");
  if (!rawSession) {
    return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
  }
  try {
    const session = await requireRoutingDispatcher({ query }, rawSession);
    const body = await req.json();
    const proof = await verifyRoutingProof(body.routingProof, session);
    if (!Array.isArray(body.routes) || body.routes.length === 0) {
      return NextResponse.json({ error: "Nenhuma rota para salvar." }, { status: 400 });
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        session.companyId,
      ]);
      if (proof.planner && body.routes.length !== 1) {
        throw new RoutingError("Autorização manual restrita a uma rota.", 409);
      }
      if (proof.authorizationId) {
        const origHashes = proof.planner
          ? [proof.planner.originalHash]
          : body.routes.map(({ suggested }: { suggested: SuggestedRoute }) =>
              hashRoute(suggested)
            );
        if (
          (
            await client.query(
              "SELECT 1 FROM route_imports WHERE raw_config->>'companyId'=$1 AND raw_config->>'authorizationId'=$2 AND raw_config->'planner'->>'originalHash'=ANY($3::text[])",
              [session.companyId, proof.authorizationId, origHashes]
            )
          ).rows.length
        ) {
          throw new RoutingError(
            "Esta transferência já foi utilizada. Gere nova autorização.",
            409
          );
        }
      }
      const wb = await loadActiveRoutingWorkbook(client, session.companyId, true);
      if (
        proof.sourceHash !== wb.hash ||
        proof.importId !== wb.importId ||
        body.routeDate !== proof.config.routeDate
      ) {
        throw new RoutingError("Carteira ou data mudou. Gere as rotas novamente.", 409);
      }
      if (
        body.routes.some(
          ({ suggested }: { suggested: SuggestedRoute }) =>
            !proof.routeHashes.includes(hashRoute(suggested))
        )
      ) {
        throw new RoutingError("A rota foi alterada após a validação.", 409);
      }
      const allOrderIds = body.routes.flatMap(
        ({ suggested }: { suggested: SuggestedRoute }) =>
          suggested.stops.flatMap((s) => s.orders.map((o) => o.orderId))
      );
      if (
        (
          await verifyAndSelectRoutingOrders(
            client,
            session.companyId,
            wb,
            allOrderIds
          )
        ).some(
          (o) =>
            !checkOrderMinEligibility(o).eligible &&
            !proof.exceptions.includes(o.orderId)
        )
      ) {
        throw new RoutingError("Pedido abaixo do mínimo sem autorização.", 428);
      }

      for (const { suggested, driverId, vehicleId } of body.routes as Array<{
        suggested: SuggestedRoute;
        driverId?: string;
        vehicleId?: string;
      }>) {
        const drv = await client.query(
          "SELECT id FROM drivers WHERE id=$1 AND company_id=$2 AND active FOR SHARE",
          [driverId || null, session.companyId]
        );
        const veh = await client.query<{
          capacity_m3: number | string;
          capacity_kg: number | string;
        }>(
          "SELECT capacity_m3,capacity_kg FROM vehicles WHERE id=$1 AND company_id=$2 AND active FOR SHARE",
          [vehicleId || null, session.companyId]
        );
        if (!drv.rows.length || !veh.rows.length) {
          throw new RoutingError(
            "Selecione motorista e veículo ativos da mesma empresa."
          );
        }
        const vRow = veh.rows[0];
        if (
          !(Number(vRow.capacity_m3) > 0) ||
          !(Number(vRow.capacity_kg) > 0) ||
          suggested.totalVolumeM3 > Number(vRow.capacity_m3) ||
          suggested.totalWeightKg > Number(vRow.capacity_kg)
        ) {
          throw new RoutingError(
            "Capacidade do veículo insuficiente ou não comprovada."
          );
        }
      }

      const importId = (
        await client.query<{ id: string }>(
          `INSERT INTO route_imports (imported_by, source_filename, total_orders, total_routes, raw_config)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            session.dispatcherId,
            wb.filename,
            body.routes.reduce(
              (acc: number, r: { suggested: SuggestedRoute }) =>
                acc + r.suggested.totalOrders,
              0
            ),
            body.routes.length,
            JSON.stringify({
              routeDate: body.routeDate,
              companyId: session.companyId,
              sourceHash: wb.hash,
              workbookImportId: wb.importId,
              minimumExceptions: proof.exceptions,
              authorizationId: proof.authorizationId,
              authorizedBy: session.dispatcherId,
              engineConfig: proof.config,
              planner: proof.planner,
            }),
          ]
        )
      ).rows[0].id;

      const routeIds: string[] = [];
      for (const { suggested, driverId, vehicleId } of body.routes as Array<{
        suggested: SuggestedRoute;
        driverId?: string;
        vehicleId?: string;
      }>) {
        const routeId = (
          await client.query<{ id: string }>(
            `INSERT INTO routes (
            company_id, name, route_date, status, driver_id, vehicle_id,
            total_volume_m3, total_weight_kg, total_boxes, import_id, lifo_loading_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [
              session.companyId,
              suggested.name,
              body.routeDate,
              "assigned",
              driverId || null,
              vehicleId || null,
              suggested.totalVolumeM3,
              suggested.totalWeightKg,
              suggested.totalBoxes,
              importId,
              JSON.stringify(suggested.cityPath),
            ]
          )
        ).rows[0].id;
        routeIds.push(routeId);
        if (proof.planner) {
          await client.query(
            "UPDATE routes SET optimize_by='manual',estimated_km=$2 WHERE id=$1",
            [routeId, proof.planner.estimatedKm]
          );
        }
        await client.query(
          `INSERT INTO route_stops (route_id, position, name, address, lat, lng, is_origin)
           VALUES ($1, 0, 'Origem / Filial', 'Base', $2, $3, true)`,
          [routeId, proof.config.originLat, proof.config.originLng]
        );
        for (const stop of suggested.stops) {
          await client.query(
            `INSERT INTO route_stops (
              route_id, position, name, address, lat, lng,
              client_name, order_ids, volume_m3, weight_kg, boxes,
              loading_sequence, notes
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              routeId,
              stop.position,
              stop.city,
              stop.address || stop.city,
              stop.lat,
              stop.lng,
              stop.clientName,
              JSON.stringify(stop.orders.map((o) => o.orderId)),
              stop.volumeM3,
              stop.weightKg,
              stop.boxes,
              stop.loadingSequence,
              stop.orders.map((o) => `Pedido ${o.orderId}`).join(", "),
            ]
          );
        }
        const auditBase = {
          name: suggested.name,
          stops: suggested.stops.length,
          volume: suggested.totalVolumeM3,
          importId,
          companyId: session.companyId,
          sourceHash: wb.hash,
        };
        await client.query(
          "INSERT INTO audit_log(actor_type,actor_id,action,entity_type,entity_id,details) VALUES('dispatcher',$1,'dispatch_route','route',$2,$3)",
          [session.dispatcherId, routeId, JSON.stringify(auditBase)]
        );
        const routeExceptions = suggested.stops
          .flatMap((s) => s.orders.map((o) => o.orderId))
          .filter((id) => proof.exceptions.includes(id));
        if (routeExceptions.length) {
          await client.query(
            "INSERT INTO audit_log(actor_type,actor_id,action,entity_type,entity_id,details) VALUES('dispatcher',$1,'minimum_exception_applied','route',$2,$3)",
            [
              session.dispatcherId,
              routeId,
              JSON.stringify({
                ...auditBase,
                orderIds: routeExceptions,
                authorizationId: proof.authorizationId,
              }),
            ]
          );
        }
        if (proof.planner) {
          await client.query(
            "INSERT INTO audit_log(actor_type,actor_id,action,entity_type,entity_id,details) VALUES('dispatcher',$1,'planner_minimum_transfer','route',$2,$3)",
            [
              session.dispatcherId,
              routeId,
              JSON.stringify({
                ...auditBase,
                authorizationId: proof.authorizationId,
                orderIds: routeExceptions,
                ...proof.planner,
              }),
            ]
          );
        }
      }
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, routeIds, importId });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof RoutingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[routerizador/dispatch]", err);
    return NextResponse.json({ error: "Erro ao salvar as rotas." }, { status: 500 });
  }
}
