import { NextRequest, NextResponse } from "next/server";
import { parseSpreadsheet } from "@/lib/spreadsheet-parser";
import { parseNotfis } from "@/lib/notfis-parser";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/routerizador/parse
 * Body: multipart/form-data com campo "file" (.xlsx, .csv, .txt ou .not)
 * Retorna: { rows: OrderRow[], total: number, cities: string[], isNotfis?: boolean }
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
    }

    const isNotfisFile = file.name.match(/\.(txt|not|edi)$/i) || file.type.includes("text/plain");

    if (isNotfisFile) {
      const text = await file.text();
      const notfisResult = parseNotfis(text);

      if (notfisResult.orders.length === 0) {
        return NextResponse.json(
          { error: "Nenhum documento/nota fiscal válida encontrada no arquivo NOTFIS." },
          { status: 422 }
        );
      }

      const cities = [...new Set(notfisResult.orders.map((r) => r.city).filter(Boolean))].sort();

      return NextResponse.json({
        rows: notfisResult.orders,
        total: notfisResult.orders.length,
        cities,
        filename: file.name,
        isNotfis: true,
        notfisHeader: notfisResult.header,
        stats: notfisResult.stats,
      });
    }

    // Processamento de Planilhas (XLSX / CSV)
    const buffer = await file.arrayBuffer();
    const rows = await parseSpreadsheet(buffer, file.name);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Nenhum pedido elegível encontrado na planilha." }, { status: 422 });
    }

    const cities = [...new Set(rows.map((r) => r.city).filter(Boolean))].sort();

    return NextResponse.json({
      rows,
      total: rows.length,
      cities,
      filename: file.name,
      isNotfis: false,
    });
  } catch (err) {
    console.error("[routerizador/parse]", err);
    return NextResponse.json({ error: "Erro ao processar arquivo enviado." }, { status: 500 });
  }
}
