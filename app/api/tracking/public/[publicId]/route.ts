import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/tracking/public/[publicId]
 * Dia 16: Portal de Rastreio Público com visualização de trajeto e status
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ publicId: string }> }
) {
  try {
    const { publicId } = await params;

    const routeRes = await query(
      `SELECT r.id, r.public_id, r.name, r.status, r.route_date, d.name as driver_name, v.name as vehicle_name
       FROM routes r
       LEFT JOIN drivers d ON r.driver_id = d.id
       LEFT JOIN vehicles v ON r.vehicle_id = v.id
       WHERE r.public_id = $1`,
      [publicId]
    );

    if (!routeRes.rows.length) {
      return NextResponse.json({ error: "Rota não encontrada" }, { status: 404 });
    }

    const route = routeRes.rows[0];

    const stopsRes = await query(
      `SELECT id, position, name, address, lat, lng, status
       FROM route_stops
       WHERE route_id = $1
       ORDER BY position ASC`,
      [route.id]
    );

    const locRes = await query(
      `SELECT lat, lng, recorded_at
       FROM driver_locations
       WHERE route_id = $1
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [route.id]
    );

    return NextResponse.json({
      publicId: route.public_id,
      name: route.name,
      status: route.status,
      date: route.route_date,
      driver: route.driver_name ? `${route.driver_name.split(" ")[0]}` : "Em trânsito",
      lastPosition: locRes.rows[0] || null,
      stopsCount: stopsRes.rows.length,
      completedStops: stopsRes.rows.filter((s) => s.status === "delivered").length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
