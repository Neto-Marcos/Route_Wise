import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

// GET: Mensagens de uma rota
export async function GET(request: Request) {
  const session = await getSession("dispatcher");
  const driverSession = await getSession("driver");

  if (!session && !driverSession) {
    return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const routeId = searchParams.get("routeId");

  if (!routeId) {
    return NextResponse.json({ error: "routeId é obrigatório" }, { status: 400 });
  }

  const companyId = session?.companyId || driverSession?.companyId;

  try {
    const res = await query(
      `SELECT * FROM route_messages
       WHERE route_id = $1 AND company_id = $2
       ORDER BY created_at ASC
       LIMIT 100`,
      [routeId, companyId]
    );

    return NextResponse.json(res.rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: Envia mensagem rápida
export async function POST(request: Request) {
  const session = await getSession("dispatcher");
  const driverSession = await getSession("driver");

  if (!session && !driverSession) {
    return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
  }

  const companyId = session?.companyId || driverSession?.companyId;

  try {
    const body = await request.json();
    const { route_id, message, quick_tag } = body;

    if (!route_id || !message) {
      return NextResponse.json({ error: "route_id e message são obrigatórios" }, { status: 400 });
    }

    let senderType = session ? "dispatcher" : "driver";
    let senderName = "Central";
    let senderId = session?.dispatcherId || "dispatcher";

    if (driverSession) {
      senderType = "driver";
      senderId = driverSession.driverId || "driver";
      const d = await query(`SELECT name FROM drivers WHERE id = $1 LIMIT 1`, [senderId]);
      senderName = d.rows[0]?.name || "Motorista";
    }

    const res = await query(
      `INSERT INTO route_messages (company_id, route_id, sender_type, sender_name, sender_id, message, quick_tag)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        companyId,
        route_id,
        senderType,
        senderName,
        senderId,
        message.trim(),
        quick_tag || null,
      ]
    );

    return NextResponse.json(res.rows[0]);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
