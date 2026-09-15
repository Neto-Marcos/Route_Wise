import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/auth";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

/**
 * GET /api/reports/export?format=xlsx|csv|json
 * Exportação de Relatórios Gerenciais em Excel (.xlsx) e CSV
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession("dispatcher");
    if (!session) {
      return NextResponse.json({ error: "Sessão expirada ou não autorizada." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") || "xlsx";

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
      WHERE r.company_id = $1
      GROUP BY r.id, d.name, v.plate
      ORDER BY r.route_date DESC
      LIMIT 500
    `, [session.companyId]);

    if (format === "json") {
      return NextResponse.json({ report: res.rows });
    }

    const dateStr = new Date().toISOString().slice(0, 10);

    if (format === "xlsx") {
      const rowsFormatted = res.rows.map((r) => ({
        "ID Rota": r.public_id || "",
        "Nome da Rota": r.rota || "",
        "Data": r.data ? String(r.data).slice(0, 10) : "",
        "Status": r.status || "",
        "Motorista": r.motorista || "Não atribuído",
        "Placa": r.placa || "--",
        "KM Estimado": Number(r.km_estimado || 0),
        "Total Paradas": Number(r.total_paradas || 0),
        "Entregas Concluídas": Number(r.entregas_feitas || 0),
      }));

      const worksheet = XLSX.utils.json_to_sheet(rowsFormatted);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Relatório de Rotas");

      const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="relatorio_rotas_${dateStr}.xlsx"`,
        },
      });
    }

    // Exportação em formato CSV limpo (separador ponto e vírgula)
    let csv = "ID Rota;Nome da Rota;Data;Status;Motorista;Placa;KM Estimado;Total Paradas;Entregas Concluídas\n";
    for (const row of res.rows) {
      csv += `${row.public_id || ""};${row.rota || ""};${row.data || ""};${row.status || ""};${row.motorista || "Não atribuído"};${row.placa || ""};${row.km_estimado || 0};${row.total_paradas || 0};${row.entregas_feitas || 0}\n`;
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="relatorio_rotas_${dateStr}.csv"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
