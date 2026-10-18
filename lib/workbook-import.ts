import { createHash } from "node:crypto";
import type { QueryExecutor } from "./routing-security";

export const hashWorkbookBytes = (bytes: Uint8Array | Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

export class WorkbookImportConflictError extends Error {}

export interface ConfirmWorkbookImportInput {
  id: string;
  companyId: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
  rows: unknown[];
  uploadedAt: string;
  uploadedBy: string | null;
  itemCount: number | null;
  orderCount: number;
  competence: string | null;
  baseHash: unknown;
}

export async function confirmWorkbookImport(
  client: QueryExecutor,
  input: ConfirmWorkbookImportInput
): Promise<{ id: string; active: boolean; repeated: boolean }> {
  await client.query("BEGIN");
  try {
    if (
      !(
        await client.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
          input.companyId,
        ])
      ).rows.length
    ) {
      throw new WorkbookImportConflictError("Empresa indisponível");
    }
    const hash = hashWorkbookBytes(input.bytes);
    const existing = await client.query<{ id: string; file_hash: string }>(
      "SELECT id,file_hash FROM workbook_imports WHERE company_id=$1 AND id=$2",
      [input.companyId, input.id]
    );
    if (existing.rows.length) {
      if (existing.rows[0].file_hash !== hash) {
        throw new WorkbookImportConflictError("Identificador reutilizado com outro arquivo");
      }
      const activeRow = await client.query<{ active_import_id: string | null }>(
        "SELECT active_import_id FROM routing_workbooks WHERE company_id=$1",
        [input.companyId]
      );
      await client.query("COMMIT");
      return {
        id: input.id,
        active: activeRow.rows[0]?.active_import_id === input.id,
        repeated: true,
      };
    }
    const current = (
      await client.query<{
        filename: string;
        content_type: string | null;
        file_data: Buffer | null;
        parsed_rows: unknown;
        uploaded_by: string | null;
        active_import_id: string | null;
      }>("SELECT * FROM routing_workbooks WHERE company_id=$1 FOR UPDATE", [input.companyId])
    ).rows[0];
    if ((current?.file_data ? hashWorkbookBytes(current.file_data) : null) !== input.baseHash) {
      throw new WorkbookImportConflictError(
        "A carteira mudou desde a prévia. Gere uma nova prévia."
      );
    }
    if (current && !current.active_import_id) {
      await client.query(
        `INSERT INTO workbook_imports(company_id,filename,content_type,file_data,parsed_rows,uploaded_by,file_hash,legacy)
        VALUES($1,$2,$3,$4,$5,$6,$7,true)`,
        [
          input.companyId,
          current.filename,
          current.content_type,
          current.file_data,
          JSON.stringify(current.parsed_rows),
          current.uploaded_by,
          current.file_data ? hashWorkbookBytes(current.file_data) : null,
        ]
      );
    }
    await client.query(
      `INSERT INTO workbook_imports(id,company_id,filename,content_type,file_data,parsed_rows,uploaded_at,uploaded_by,file_hash,item_count,order_count,competence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        input.id,
        input.companyId,
        input.filename,
        input.contentType,
        input.bytes,
        JSON.stringify(input.rows),
        input.uploadedAt,
        input.uploadedBy,
        hash,
        input.itemCount,
        input.orderCount,
        input.competence,
      ]
    );
    await client.query(
      `INSERT INTO routing_workbooks(company_id,filename,content_type,file_data,parsed_rows,updated_at,uploaded_by,active_import_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(company_id) DO UPDATE SET filename=EXCLUDED.filename,content_type=EXCLUDED.content_type,
      file_data=EXCLUDED.file_data,parsed_rows=EXCLUDED.parsed_rows,updated_at=EXCLUDED.updated_at,uploaded_by=EXCLUDED.uploaded_by,active_import_id=EXCLUDED.active_import_id`,
      [
        input.companyId,
        input.filename,
        input.contentType,
        input.bytes,
        JSON.stringify(input.rows),
        input.uploadedAt,
        input.uploadedBy,
        input.id,
      ]
    );
    await client.query("COMMIT");
    return { id: input.id, active: true, repeated: false };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
