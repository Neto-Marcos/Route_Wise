import { NextRequest, NextResponse } from 'next/server';
import { db, query, audit } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { SuggestedRoute } from '@/lib/route-engine';

export const runtime = 'nodejs';

interface DispatchBody {
  routes: Array<{
    suggested: SuggestedRoute;
    driverId: string;
    vehicleId: string;
  }>;
  routeDate: string;
  importFilename?: string;
}

/**
 * POST /api/routerizador/dispatch
 * Salva as rotas sugeridas no banco de dados e as atribui aos motoristas.
 */
export async function POST(req: NextRequest) {
  const session = await getSession('dispatcher');
  if (!session) {
    return NextResponse.json({ error: 'Sessão necessária' }, { status: 401 });
  }

  try {
    const body = (await req.json()) as DispatchBody;

    if (!Array.isArray(body.routes) || body.routes.length === 0) {
      return NextResponse.json({ error: 'Nenhuma rota para salvar.' }, { status: 400 });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // 1. Cria registro de importação
      const importRes = await client.query<{ id: string }>(
        `INSERT INTO route_imports (company_id, source_filename, total_orders, total_routes, raw_config)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          session.companyId,
          body.importFilename ?? 'planilha.xlsx',
          body.routes.reduce((s, r) => s + r.suggested.totalOrders, 0),
          body.routes.length,
          JSON.stringify({ routeDate: body.routeDate }),
        ]
      );
      const importId = importRes.rows[0].id;

      const created: string[] = [];

      for (const { suggested, driverId, vehicleId } of body.routes) {
        // 2. Cria a rota
        const routeRes = await client.query<{ id: string }>(
          `INSERT INTO routes (
            company_id, name, route_date, status, driver_id, vehicle_id,
            total_volume_m3, total_weight_kg, total_boxes, import_id, lifo_loading_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [
            session.companyId,
            suggested.name,
            body.routeDate,
            'assigned',
            driverId || null,
            vehicleId || null,
            suggested.totalVolumeM3,
            suggested.totalWeightKg,
            suggested.totalBoxes,
            importId,
            JSON.stringify(suggested.cityPath),
          ]
        );
        const routeId = routeRes.rows[0].id;
        created.push(routeId);

        // 3. Cria parada de origem (posição 0)
        await client.query(
          `INSERT INTO route_stops (route_id, position, name, address, lat, lng, is_origin)
           VALUES ($1, 0, 'Origem / Filial', 'Base', -7.2306, -35.8811, true)`,
          [routeId]
        );

        // 4. Cria as paradas de entrega
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
              stop.orders.map((o) => `Pedido ${o.orderId}`).join(', '),
            ]
          );
        }

        // 5. Auditoria
        await audit('dispatcher', session.dispatcherId || null, 'dispatch_route', 'route', routeId, {
          name: suggested.name,
          stops: suggested.stops.length,
          volume: suggested.totalVolumeM3,
          importId,
        });
      }

      await client.query('COMMIT');
      return NextResponse.json({ ok: true, routeIds: created, importId });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[routerizador/dispatch]', err);
    return NextResponse.json({ error: 'Erro ao salvar as rotas.' }, { status: 500 });
  }
}
