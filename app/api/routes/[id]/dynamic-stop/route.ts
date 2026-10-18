import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { hasRouteMinimumException } from "@/lib/routing-security";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { action, stopId } = await req.json();
    const session = await getSession("dispatcher");
    if (!session) {
      return NextResponse.json(
        { error: "Sessão de operador necessária." },
        { status: 401 }
      );
    }
    const routeRes = await query<{ status: string }>(
      "SELECT status FROM routes WHERE id=$1 AND company_id=$2 LIMIT 1",
      [id, session.companyId]
    );
    if (!routeRes.rows.length) {
      return NextResponse.json({ error: "Rota não encontrada." }, { status: 404 });
    }
    if (await hasRouteMinimumException({ query }, id, session.companyId!)) {
      return NextResponse.json(
        {
          error:
            "Rota com exceção auditada: nova autorização necessária para alterar paradas.",
        },
        { status: 409 }
      );
    }
    if (!["draft", "assigned"].includes(routeRes.rows[0].status)) {
      return NextResponse.json(
        { error: "Esta rota já iniciou e não pode mais ser alterada." },
        { status: 409 }
      );
    }
    if (action === "remove" && stopId) {
      const deleted = await query(
        "DELETE FROM route_stops WHERE id=$1 AND route_id=$2 AND is_origin=false RETURNING id",
        [stopId, id]
      );
      if (!deleted.rows.length) {
        return NextResponse.json(
          { error: "Parada inválida ou origem não pode ser removida." },
          { status: 400 }
        );
      }
      await query(
        `WITH ordered AS (SELECT id, row_number() OVER (ORDER BY position) AS next_position FROM route_stops WHERE route_id=$1)
         UPDATE route_stops s SET position=ordered.next_position-1 FROM ordered WHERE s.id=ordered.id`,
        [id]
      );
      return NextResponse.json({
        success: true,
        message: "Cidade removida. A rota foi reordenada para carregamento.",
      });
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
