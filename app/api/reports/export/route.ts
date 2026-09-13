import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/reports/export?format=csv
 * Dia 17: Exportação de Relatórios Gerenciais de Viagens e Fechamento
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") || "csv";

    const res = await query(`
      SELECT 
        r.public_id,
        r.name as rota,
        r.route_date as data,
        r.status,
        d.name as motorista,
        v.plate as placa,
        r.estimated_km as km_estimado,
        COUNT(s.id) as total_paradas,
        SUM(CASE WHEN s.status = 'delivered' THEN 1 ELSE 0 END) as entregas_feitas
      FROM routes r
      LEFT JOIN drivers d ON r.driver_id = d.id
      LEFT JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN route_stops s ON s.route_id = r.id
      GROUP BY r.id, d.name, v.plate
      ORDER BY r.route_date DESC
      LIMIT 100
    `);

    if (format === "json") {
      return NextResponse.json({ report: res.rows });
    }

    // Exportação em formato CSV limpo compatível com Excel
    let csv = "ID Rota;Nome da Rota;Data;Status;Motorista;Placa;KM Estimado;Total Paradas;Entregas Concluídas\n";
    for (const row of res.rows) {
      csv += `${row.public_id || ""};${row.rota || ""};${row.data || ""};${row.status || ""};${row.motorista || "Não atribuído"};${row.placa || ""};${row.km_estimado || 0};${row.total_paradas || 0};${row.entregas_feitas || 0}\n`;
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="relatorio_rotas_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
