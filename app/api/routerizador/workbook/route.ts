import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { parseSpreadsheet } from "@/lib/spreadsheet-parser";
import { parseNotfis } from "@/lib/notfis-parser";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const session = await getSession("dispatcher");
  if (!session) return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
  const result = await query<{ filename: string; file_data: Buffer | null; parsed_rows: unknown[]; updated_at: string }>(
    "SELECT filename,file_data,parsed_rows,updated_at FROM routing_workbooks WHERE company_id=$1", [session.companyId],
  );
  const workbook = result.rows[0];
  if (!workbook) return NextResponse.json({ workbook: null });
  // Reprocessa o arquivo bruto quando disponível, para que regras novas de
  // elegibilidade (saldo da filial 281 e mapa de carga) também valham para a
  // carteira que já estava salva antes da atualização.
  let rows = workbook.parsed_rows;
  if (workbook.file_data && !/\.(not|edi|txt)$/i.test(workbook.filename)) {
    const buf = Buffer.from(workbook.file_data);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    rows = await parseSpreadsheet(ab, workbook.filename);
    await query("UPDATE routing_workbooks SET parsed_rows=$2,updated_at=now() WHERE company_id=$1", [session.companyId, JSON.stringify(rows)]);
  }
  return NextResponse.json({ workbook: { filename: workbook.filename, rows, updatedAt: workbook.updated_at } });
}

export async function POST(req: NextRequest) {
  const session = await getSession("dispatcher");
  if (!session) return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Selecione uma planilha." }, { status: 400 });
  const buffer = await file.arrayBuffer();
  let rows = await parseSpreadsheet(buffer, file.name);
  if (!rows.length && /\.(not|edi|txt)$/i.test(file.name)) rows = parseNotfis(await file.text()).orders;
  if (!rows.length) return NextResponse.json({ error: "Nenhum pedido elegível encontrado." }, { status: 422 });
  await query(
    `INSERT INTO routing_workbooks(company_id,filename,content_type,file_data,parsed_rows,updated_at,uploaded_by)
     VALUES($1,$2,$3,$4,$5,now(),$6)
     ON CONFLICT(company_id) DO UPDATE SET filename=EXCLUDED.filename,content_type=EXCLUDED.content_type,file_data=EXCLUDED.file_data,parsed_rows=EXCLUDED.parsed_rows,updated_at=now(),uploaded_by=EXCLUDED.uploaded_by`,
    [session.companyId, file.name, file.type || "application/octet-stream", Buffer.from(buffer), JSON.stringify(rows), session.dispatcherId ?? null],
  );
  return NextResponse.json({ filename: file.name, rows, total: rows.length });
}
