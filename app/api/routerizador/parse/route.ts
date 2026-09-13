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

    const filename = file.name || "arquivo";
    const isSpreadsheetExt = Boolean(filename.match(/\.(xlsx|xls|csv)$/i));
    const isNotfisExt = Boolean(filename.match(/\.(not|edi)$/i));
    let isNotfisContent = false;

    // Se NÃO for extensão típica de planilha (ou se for .not/.edi/.txt/sem extensão), tenta NOTFIS
    if (!isSpreadsheetExt || isNotfisExt) {
      try {
        const text = await file.text();
        isNotfisContent = /^(000|310|311|312)/m.test(text) || Boolean(filename.match(/notfis/i));
        const notfisResult = parseNotfis(text);

        if (notfisResult.orders.length > 0) {
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
      } catch (notfisErr) {
        console.warn("[routerizador/parse] Tentativa NOTFIS falhou:", notfisErr);
      }

      // Se a extensão ou o conteúdo era explicitamente NOTFIS e não encontrou notas válidas
      if (isNotfisExt || isNotfisContent) {
        return NextResponse.json(
          { error: "Nenhum documento/nota fiscal válida encontrada no arquivo NOTFIS." },
          { status: 422 }
        );
      }
    }

    // Processamento de Planilhas (XLSX / CSV / arquivos de texto tabulares)
    const buffer = await file.arrayBuffer();
    const rows = await parseSpreadsheet(buffer, file.name);

    if (rows.length === 0) {
      // Fallback bidirecional: se a planilha falhou, tenta verificar se era NOTFIS mascarado
      try {
        const text = Buffer.from(buffer).toString("utf8");
        if (/^(000|310|311|312)/m.test(text) || Boolean(filename.match(/notfis/i))) {
          const notfisResult = parseNotfis(text);
          if (notfisResult.orders.length > 0) {
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
        }
      } catch {}

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
