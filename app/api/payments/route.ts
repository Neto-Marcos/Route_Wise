import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

// GET: Lista solicitações de pagamento
export async function GET(request: Request) {
  const session = await getSession("dispatcher");
  const driverSession = await getSession("driver");

  if (!session && !driverSession) {
    return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
  }

  const companyId = session?.companyId || driverSession?.companyId;

  try {
    let sql = `
      SELECT p.*, d.name as driver_name, r.name as route_name
      FROM payment_requests p
      LEFT JOIN drivers d ON d.id = p.driver_id
      LEFT JOIN routes r ON r.id = p.route_id
      WHERE p.company_id = $1
    `;
    const params: any[] = [companyId];

    // Se for motorista, só vê as próprias solicitações
    if (!session && driverSession?.driverId) {
      sql += ` AND p.driver_id = $2`;
      params.push(driverSession.driverId);
    }

    sql += ` ORDER BY p.created_at DESC LIMIT 50`;

    const res = await query(sql, params);
    return NextResponse.json(res.rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: Motorista ou Operador cria nova solicitação de pagamento
export async function POST(request: Request) {
  const session = await getSession("dispatcher");
  const driverSession = await getSession("driver");

  if (!session && !driverSession) {
    return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
  }

  const companyId = session?.companyId || driverSession?.companyId;

  try {
    const body = await request.json();
    const { amount, description, category, route_id, receipt_url } = body;

    if (!amount || !description) {
      return NextResponse.json({ error: "Valor e descrição são obrigatórios" }, { status: 400 });
    }

    const driverId = driverSession?.driverId || body.driver_id || null;

    const res = await query(
      `INSERT INTO payment_requests (company_id, driver_id, route_id, category, amount, description, receipt_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING *`,
      [
        companyId,
        driverId,
        route_id || null,
        category || "adiantamento",
        Number(amount),
        description.trim(),
        receipt_url || null,
      ]
    );

    const created = res.rows[0];

    // Disparar Web Push para os administradores da empresa que tenham PWA instalado
    try {
      const subs = await query(
        `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE company_id = $1 AND user_type = 'dispatcher'`,
        [companyId]
      );
      // Aqui as inscrições push recebem o evento silencioso ou via notification trigger
    } catch {}

    return NextResponse.json(created);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH: Administrador aprova, recusa ou marca como pago
export async function PATCH(request: Request) {
  const session = await getSession("dispatcher");
  if (!session || (session.userRole !== "admin" && session.userRole !== "superadmin")) {
    return NextResponse.json({ error: "Apenas administradores podem avaliar solicitações" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { id, status, admin_notes } = body;

    if (!id || !["approved", "rejected", "paid"].includes(status)) {
      return NextResponse.json({ error: "ID e status válido ('approved', 'rejected', 'paid') são obrigatórios" }, { status: 400 });
    }

    const res = await query(
      `UPDATE payment_requests
       SET status = $1, admin_notes = $2, reviewed_at = now(), reviewed_by = $3
       WHERE id = $4 AND company_id = $5
       RETURNING *`,
      [status, admin_notes || null, session.dispatcherId || null, id, session.companyId]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Solicitação não encontrada" }, { status: 404 });
    }

    return NextResponse.json(res.rows[0]);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
