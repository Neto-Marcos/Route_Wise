import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { audit, query } from "@/lib/db";

async function sessionForOperation() {
  const dispatcher = await getSession("dispatcher");
  const driver = await getSession("driver");
  return dispatcher ?? driver;
}

export async function GET(request: NextRequest) {
  const session = await sessionForOperation();
  if (!session) return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
  const resource = request.nextUrl.searchParams.get("resource") ?? "messages";
  const month = request.nextUrl.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);

  try {
    if (resource === "messages") {
      const rows = await query(
        `SELECT m.*, EXISTS(SELECT 1 FROM message_reads mr WHERE mr.message_id=m.id AND mr.user_type=$2 AND mr.user_id=$3) AS read
         FROM operation_messages m WHERE m.company_id=$1 ORDER BY m.created_at DESC LIMIT 100`,
        [session.companyId, session.role, session.dispatcherId ?? session.driverId ?? ""],
      );
      return NextResponse.json(rows.rows.reverse());
    }
    if (resource === "goals") {
      const rows = await query(
        `SELECT g.*, d.name AS driver_name,
          COALESCE(SUM(r.actual_km), 0) AS realized_km,
          COUNT(s.id) FILTER (WHERE s.status='delivered') AS realized_deliveries
         FROM driver_goals g JOIN drivers d ON d.id=g.driver_id
         LEFT JOIN routes r ON r.driver_id=g.driver_id AND r.company_id=g.company_id AND to_char(r.route_date,'YYYY-MM')=g.month
         LEFT JOIN route_stops s ON s.route_id=r.id AND s.is_origin=false
         WHERE g.company_id=$1 AND g.month=$2
         GROUP BY g.id,d.name ORDER BY d.name`, [session.companyId, month],
      );
      return NextResponse.json(rows.rows);
    }
    if (resource === "receipts") {
      const kind = request.nextUrl.searchParams.get("kind") ?? "delivery";
      if (kind === "expense") {
        const rows = await query(
          `SELECT p.*,d.name AS driver_name,r.name AS route_name FROM payment_requests p
           LEFT JOIN drivers d ON d.id=p.driver_id LEFT JOIN routes r ON r.id=p.route_id
           WHERE p.company_id=$1 AND p.receipt_url IS NOT NULL ORDER BY p.created_at DESC LIMIT 200`, [session.companyId],
        );
        return NextResponse.json(rows.rows);
      }
      const rows = await query(
        `SELECT e.*,d.name AS driver_name,r.name AS route_name,s.name AS stop_name,s.status AS stop_status
         FROM delivery_events e JOIN routes r ON r.id=e.route_id
         LEFT JOIN drivers d ON d.id=r.driver_id JOIN route_stops s ON s.id=e.stop_id
         WHERE r.company_id=$1 ORDER BY e.delivered_at DESC LIMIT 200`, [session.companyId],
      );
      return NextResponse.json(rows.rows);
    }
    return NextResponse.json({ error: "Recurso inválido" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro operacional" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await sessionForOperation();
  if (!session) return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
  try {
    const body = await request.json();
    if (body.action === "message") {
      const text = String(body.message ?? "").trim();
      if (!text) return NextResponse.json({ error: "Mensagem obrigatória" }, { status: 400 });
      const isDriver = session.role === "driver";
      let senderName = isDriver ? "Motorista" : "Central";
      if (isDriver && session.driverId) {
        const driver = await query<{ name: string }>("SELECT name FROM drivers WHERE id=$1", [session.driverId]);
        senderName = driver.rows[0]?.name ?? senderName;
      }
      const result = await query(
        `INSERT INTO operation_messages(company_id,sender_type,sender_id,sender_name,message,quick_tag)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [session.companyId, isDriver ? "driver" : "dispatcher", session.driverId ?? session.dispatcherId ?? "", senderName, text, body.quick_tag ?? null],
      );
      await audit(session.role, session.driverId ?? session.dispatcherId ?? null, "send", "operation_message", result.rows[0].id, null);
      return NextResponse.json(result.rows[0]);
    }
    if (body.action === "read") {
      await query(`INSERT INTO message_reads(message_id,user_type,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [body.message_id, session.role, session.driverId ?? session.dispatcherId ?? ""]);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "driver_goal") {
      if (session.role !== "dispatcher" || !["admin", "superadmin"].includes(session.userRole ?? "")) return NextResponse.json({ error: "Apenas ADM pode definir metas" }, { status: 403 });
      const { driver_id, month, target_km, target_deliveries, target_sla } = body;
      if (!driver_id || !month) return NextResponse.json({ error: "Motorista e mês são obrigatórios" }, { status: 400 });
      const result = await query(
        `INSERT INTO driver_goals(company_id,driver_id,month,target_km,target_deliveries,target_sla)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(company_id,driver_id,month) DO UPDATE SET target_km=EXCLUDED.target_km,target_deliveries=EXCLUDED.target_deliveries,target_sla=EXCLUDED.target_sla,updated_at=now() RETURNING *`,
        [session.companyId, driver_id, month, Number(target_km) || 0, Number(target_deliveries) || 0, Number(target_sla) || 95],
      );
      return NextResponse.json(result.rows[0]);
    }
    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro operacional" }, { status: 500 });
  }
}
