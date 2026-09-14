import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

// GET: Recupera meta do mês corrente ou especificado
export async function GET(request: Request) {
  const session = await getSession("dispatcher");
  if (!session) {
    return NextResponse.json({ error: "Sessão expirada" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const month = searchParams.get("month") || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  try {
    const res = await query(
      `SELECT * FROM company_goals WHERE company_id = $1 AND month = $2 LIMIT 1`,
      [session.companyId, month]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({
        month,
        target_km: 5000,
        target_deliveries: 200,
        budget_fuel: 0,
        is_default: true,
      });
    }

    return NextResponse.json(res.rows[0]);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: Salva / atualiza meta do mês (Apenas Admin ou Superadmin)
export async function POST(request: Request) {
  const session = await getSession("dispatcher");
  if (!session || (session.userRole !== "admin" && session.userRole !== "superadmin")) {
    return NextResponse.json({ error: "Apenas administradores podem definir metas" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { month, target_km, target_deliveries, budget_fuel } = body;

    if (!month || !target_km) {
      return NextResponse.json({ error: "Mês e meta de KM são obrigatórios" }, { status: 400 });
    }

    const res = await query(
      `INSERT INTO company_goals (company_id, month, target_km, target_deliveries, budget_fuel, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (company_id, month) DO UPDATE 
       SET target_km = EXCLUDED.target_km,
           target_deliveries = EXCLUDED.target_deliveries,
           budget_fuel = EXCLUDED.budget_fuel,
           updated_at = now()
       RETURNING *`,
      [
        session.companyId,
        month,
        Number(target_km) || 5000,
        Number(target_deliveries) || 200,
        Number(budget_fuel) || 0,
      ]
    );

    return NextResponse.json(res.rows[0]);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
