import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { getSession } from "@/lib/auth";
import { db, query } from "@/lib/db";
import { parseSpreadsheet } from "@/lib/spreadsheet-parser";
import { parseNotfis } from "@/lib/notfis-parser";
import { parseExpeditionWorkbook } from "@/lib/expedition-parser";
import { computeExpeditionMetrics } from "@/lib/expedition-metrics";
import {
  confirmWorkbookImport,
  hashWorkbookBytes,
  WorkbookImportConflictError,
} from "@/lib/workbook-import";

export const runtime = "nodejs";
export const maxDuration = 60;

const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

const getSecret = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SECRET_REQUIRED");
  return new TextEncoder().encode(secret || "routewise-dev-secret-change-me");
};

async function requireDispatcher() {
  const session = await getSession("dispatcher");
  return session?.role === "dispatcher" && session.userRole !== "driver"
    ? session
    : null;
}

export async function GET(req: NextRequest) {
  const session = await requireDispatcher();
  if (!session) return json({ error: "Sessão necessária" }, 401);

  if (req.nextUrl.searchParams.has("history")) {
    const res = await query(
      `SELECT i.id,i.filename,i.uploaded_at,i.confirmed_at,i.uploaded_by,i.file_hash,i.item_count,i.order_count,i.competence,i.legacy,
      (w.active_import_id=i.id) IS TRUE AS active FROM workbook_imports i LEFT JOIN routing_workbooks w ON w.company_id=i.company_id
      WHERE i.company_id=$1 ORDER BY i.confirmed_at DESC`,
      [session.companyId]
    );
    return json({ imports: res.rows });
  }

  const downloadId = req.nextUrl.searchParams.get("download");
  if (downloadId) {
    if (!/^[a-f0-9-]{36}$/i.test(downloadId)) {
      return json({ error: "Versão inválida" }, 400);
    }
    const res = await query<{ file_data: Buffer | null; filename: string }>(
      "SELECT file_data,filename FROM workbook_imports WHERE company_id=$1 AND id=$2",
      [session.companyId, downloadId]
    );
    return res.rows[0]?.file_data
      ? new NextResponse(new Uint8Array(res.rows[0].file_data), {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
              res.rows[0].filename
            ).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`,
            "Cache-Control": "private, no-store",
          },
        })
      : json({ error: "Arquivo indisponível" }, 404);
  }

  const row = (
    await query<{
      filename: string;
      file_data: Buffer | null;
      parsed_rows: unknown;
      uploaded_at: Date | string | null;
      active_import_id: string | null;
    }>(
      "SELECT w.*,i.uploaded_at FROM routing_workbooks w LEFT JOIN workbook_imports i ON i.company_id=w.company_id AND i.id=w.active_import_id WHERE w.company_id=$1",
      [session.companyId]
    )
  ).rows[0];

  if (!row) return json({ workbook: null });

  let rows = row.parsed_rows;
  if (row.file_data && !/\.(not|edi|txt)$/i.test(row.filename)) {
    const buf = Buffer.from(row.file_data);
    rows = await parseSpreadsheet(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      row.filename
    );
  }
  return json({
    workbook: {
      filename: row.filename,
      rows,
      updatedAt: row.uploaded_at ?? null,
      importId: row.active_import_id,
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await requireDispatcher();
  if (!session) return json({ error: "Sessão necessária" }, 401);
  try {
    let rows: unknown[];
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 50 * 1024 * 1024) {
      return json({ error: "Selecione um arquivo de até 50 MB." }, 400);
    }
    if (!/\.(xls|xlsx|csv|tsv|not|edi|txt)$/i.test(file.name)) {
      return json({ error: "Formato não suportado." }, 422);
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const hash = hashWorkbookBytes(bytes);
    const confirmation = form.get("confirmation");
    let confirmedPayload: Record<string, unknown> | null = null;
    if (confirmation) {
      try {
        confirmedPayload = (
          await jwtVerify(String(confirmation), getSecret(), {
            audience: "workbook-confirm",
            issuer: "criarrota",
          })
        ).payload as Record<string, unknown>;
      } catch {
        return json(
          { error: "Prévia expirada ou inválida. Gere uma nova prévia." },
          409
        );
      }
      if (
        confirmedPayload.companyId !== session.companyId ||
        confirmedPayload.hash !== hash ||
        confirmedPayload.filename !== file.name ||
        confirmedPayload.actor !== (session.dispatcherId ?? null)
      ) {
        return json({ error: "Arquivo ou sessão diferente da prévia." }, 409);
      }
    } else if (form.get("action") !== "preview") {
      return json({ error: "Prévia e confirmação explícita são obrigatórias." }, 428);
    }

    let itemCount: number | null = null;
    let orderCount = 0;
    let warnings: string[] = [];
    if (/\.(not|edi|txt)$/i.test(file.name)) {
      rows = parseNotfis(bytes.toString("utf8")).orders;
      orderCount = rows.length;
      warnings = [
        "NOTFIS: contagem de itens e indicadores da planilha indisponíveis.",
      ];
    } else {
      const exp = parseExpeditionWorkbook(bytes, file.name);
      const metrics = computeExpeditionMetrics(exp);
      itemCount = exp.items.length;
      orderCount = metrics.orderCount;
      warnings = metrics.dataQuality.map((w) => `${w.message} (${w.count})`);
      rows = await parseSpreadsheet(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        file.name
      );
    }
    if (!orderCount) {
      return json({ error: "Nenhum pedido válido encontrado." }, 422);
    }
    if (!confirmedPayload) {
      const current = await query<{ file_data: Buffer | null }>(
        "SELECT file_data FROM routing_workbooks WHERE company_id=$1",
        [session.companyId]
      );
      const id = randomUUID();
      const uploadedAt = new Date().toISOString();
      const token = await new SignJWT({
        id,
        companyId: session.companyId,
        actor: session.dispatcherId ?? null,
        hash,
        filename: file.name,
        uploadedAt,
        baseHash: current.rows[0]?.file_data
          ? hashWorkbookBytes(current.rows[0].file_data)
          : null,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("criarrota")
        .setAudience("workbook-confirm")
        .setIssuedAt()
        .setExpirationTime("30m")
        .sign(getSecret());

      return json({
        preview: {
          token,
          id,
          filename: file.name,
          itemCount,
          orderCount,
          competence: null,
          warnings,
          uploadedAt,
        },
      });
    }

    const client = await db.connect();
    try {
      const res = await confirmWorkbookImport(client, {
        id: String(confirmedPayload.id),
        companyId: session.companyId!,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        bytes,
        rows,
        uploadedAt: String(confirmedPayload.uploadedAt),
        uploadedBy: session.dispatcherId ?? null,
        itemCount,
        orderCount,
        competence: null,
        baseHash: confirmedPayload.baseHash,
      });
      if (!res.active) {
        return json(
          {
            error:
              "Esta importação já foi confirmada e tornou-se histórica. A carteira atual foi preservada.",
          },
          409
        );
      }
      return json({
        filename: file.name,
        rows,
        total: rows.length,
        importId: res.id,
        uploadedAt: confirmedPayload.uploadedAt,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof WorkbookImportConflictError) {
      return json({ error: err.message }, 409);
    }
    if (err instanceof Error && err.message.startsWith("DASHBOARD_")) {
      return json({ error: "Estrutura da planilha inválida ou ambígua." }, 422);
    }
    return json(
      {
        error:
          "Não foi possível confirmar a importação. Confira a carteira salva antes de tentar novamente.",
      },
      503
    );
  }
}
