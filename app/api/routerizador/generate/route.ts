import { NextRequest, NextResponse } from "next/server";
import { generateRoutes, type EngineConfig } from "@/lib/route-engine";
import { geocodeOrders } from "@/lib/city-geocoder";
import { getSession } from "@/lib/auth";
import { audit, query } from "@/lib/db";
import { randomUUID } from "node:crypto";
import {
  hashRoute,
  loadActiveRoutingWorkbook,
  requireRoutingDispatcher,
  RoutingError,
  signRoutingProof,
  validateMinimumExceptions,
  verifyAndSelectRoutingOrders,
} from "@/lib/routing-security";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const session = await requireRoutingDispatcher(
      { query },
      await getSession("dispatcher")
    );
    const body = await req.json();
    if (
      !Array.isArray(body.rows) ||
      body.rows.length === 0 ||
      body.rows.some((r: any) => !r || typeof r.orderId !== "string")
    ) {
      return NextResponse.json({ error: "Nenhum pedido fornecido." }, { status: 400 });
    }
    if (body.config?.enforceMinOrderValue === false) {
      throw new RoutingError(
        "Use a seleção e confirmação de exceções; o mínimo global permanece ativo.",
        428
      );
    }
    const wb = await loadActiveRoutingWorkbook({ query }, session.companyId);
    const orders = await verifyAndSelectRoutingOrders(
      { query },
      session.companyId,
      wb,
      body.rows.map((r: any) => r.orderId)
    );
    const exceptions = validateMinimumExceptions(orders, body.minimumException);
    if (orders.length === 0) {
      return NextResponse.json(
        { error: "Não há pedidos CIF elegíveis para a frota própria." },
        { status: 422 }
      );
    }
    const config: EngineConfig = {
      maxVolumeM3: body.config?.maxVolumeM3 ?? 30,
      maxWeightKg: body.config?.maxWeightKg ?? 10000,
      clusterRadiusKm: body.config?.clusterRadiusKm ?? 80,
      routeDate: body.config?.routeDate ?? new Date().toISOString().slice(0, 10),
      originName: body.config?.originName ?? "Filial",
      originLat: body.config?.originLat ?? -7.2306,
      originLng: body.config?.originLng ?? -35.8811,
      minVolumeM3: body.config?.minVolumeM3 ?? 10,
      corridorAngle: body.config?.corridorAngle ?? 60,
      prioritizeAging: body.config?.prioritizeAging ?? true,
      returnToOrigin: body.config?.returnToOrigin ?? false,
      roadFactor: body.config?.roadFactor ?? 1.22,
      averageSpeed: body.config?.averageSpeed ?? 55,
      serviceMinutes: body.config?.serviceMinutes ?? 40,
      maxHours: body.config?.maxHours ?? 72,
      enforceMinOrderValue: true,
      minimumExceptions: { confirmed: true, orderIds: exceptions },
    };
    if (![config.maxVolumeM3, config.maxWeightKg].every((v) => Number.isFinite(v) && v > 0)) {
      throw new RoutingError("Capacidade inválida.");
    }
    if (
      !Number.isFinite(config.originLat) ||
      !Number.isFinite(config.originLng) ||
      Math.abs(config.originLat) > 90 ||
      Math.abs(config.originLng) > 180 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(config.routeDate)
    ) {
      throw new RoutingError("Origem ou data inválida.");
    }
    await geocodeOrders(orders);
    const result = generateRoutes(orders, config);
    const authorizationId = exceptions.length ? randomUUID() : null;
    if (authorizationId) {
      await audit(
        "dispatcher",
        session.dispatcherId,
        "authorize_minimum_exception",
        "routing_selection",
        authorizationId,
        {
          companyId: session.companyId,
          sourceHash: wb.hash,
          importId: wb.importId,
          orderIds: exceptions,
          authorizedAt: new Date().toISOString(),
          selection: orders
            .filter((o) => exceptions.includes(o.orderId))
            .map((o) => ({ orderId: o.orderId, uf: o.uf, value: o.totalValue })),
        }
      );
    }
    result.routingProof = await signRoutingProof({
      companyId: session.companyId,
      actor: session.dispatcherId,
      sourceHash: wb.hash,
      importId: wb.importId,
      config,
      exceptions,
      routeHashes: result.routes.map(hashRoute),
      authorizationId,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RoutingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[routerizador/generate]", err);
    return NextResponse.json({ error: "Erro ao gerar rotas." }, { status: 500 });
  }
}
