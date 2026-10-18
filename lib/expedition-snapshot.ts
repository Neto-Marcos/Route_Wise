import { createHash } from "node:crypto";
import { computeExpeditionMetrics } from "./expedition-metrics";
import { parseExpeditionWorkbook } from "./expedition-parser";
import { parseExpeditionMonthWorkbook } from "./intelligence-metrics";

export const READ_ACTIVE_WORKBOOK_SQL =
  "SELECT w.filename,w.file_data,w.updated_at,w.active_import_id,i.uploaded_at,i.competence FROM routing_workbooks w LEFT JOIN workbook_imports i ON i.company_id=w.company_id AND i.id=w.active_import_id WHERE w.company_id=$1";

export interface ActiveWorkbookRow {
  filename: string;
  file_data: Buffer | Uint8Array | null;
  updated_at?: Date | string | null;
  active_import_id?: string | null;
  uploaded_at?: Date | string | null;
  competence?: string | null;
}

export class DashboardError extends Error {
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.status = status;
  }
}

function toIsoOrNull(val: Date | string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const date = val instanceof Date ? val : new Date(val);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function createExpeditionSnapshotService(deps: {
  getSession: () => Promise<{
    role?: string;
    userRole?: string;
    companyId?: string;
    dispatcherId?: string;
  } | null>;
  readWorkbook: (companyId: string) => Promise<ActiveWorkbookRow | null>;
}) {
  const cache = new Map<
    string,
    Omit<ReturnType<typeof computeExpeditionMetrics>, "orderCount"> & {
      snapshotStatus: "AVAILABLE" | "EMPTY" | "SOURCE_UNAVAILABLE" | "NO_WORKBOOK";
      metadata: Record<string, unknown>;
    }
  >();
  const stats = { parseCount: 0, cacheHits: 0 };

  return {
    async getSnapshot(month?: string) {
      let parsed;
      const session = await deps.getSession();
      if (
        !session ||
        session.role !== "dispatcher" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          session.companyId ?? ""
        )
      ) {
        throw new DashboardError("SESSION_REQUIRED", 401);
      }
      if (session.userRole === "driver") {
        throw new DashboardError("DISPATCHER_REQUIRED", 403);
      }
      const wb = await deps.readWorkbook(session.companyId!);
      const baseMeta = {
        activeImportId: wb?.active_import_id ?? null,
        snapshotFingerprint: null as string | null,
        filename: wb?.filename ?? null,
        competence: wb?.competence ?? null,
        importedAt: toIsoOrNull(wb?.uploaded_at ?? null),
        sourceUpdatedAt: toIsoOrNull(wb?.updated_at ?? null),
        source: "routing_workbooks.file_data",
        sheet: null as string | null,
        itemCount: 0,
        orderCount: 0,
        unassociatedItemCount: 0,
      };
      if (!wb?.file_data) {
        const { orderCount: _, ...empty } = computeExpeditionMetrics({
          items: [],
          sheet: "",
          productStatusValidated: false,
        });
        for (const card of Object.values(empty.cards)) {
          card.status = "UNKNOWN";
          card.count = null;
          card.percentageOfOrders = null;
          card.reason = wb ? "RAW_SOURCE_UNAVAILABLE" : "NO_ACTIVE_WORKBOOK";
          card.amount = {
            status: "UNKNOWN",
            value: null,
            knownValue: null,
            unknownCount: 0,
            reason: card.reason,
          };
        }
        empty.eligibilityFunnel = [];
        if (empty.cards.toBill) empty.cards.toBill.itemCount = null;
        empty.dataQuality = [
          {
            type: wb ? "RAW_SOURCE_UNAVAILABLE" : "NO_ACTIVE_WORKBOOK",
            severity: "WARNING",
            count: 1,
            unit: "IMPORT",
            message: wb
              ? "Arquivo bruto indisponível; parsed_rows filtrado não é uma carteira completa."
              : "Nenhuma carteira ativa importada.",
            detailsAvailable: false,
          },
        ];
        empty.dimensions.weightSource = empty.cards.portfolio.amount;
        empty.dimensions.volumeSource = empty.cards.portfolio.amount;
        return {
          ...empty,
          snapshotStatus: wb ? ("SOURCE_UNAVAILABLE" as const) : ("NO_WORKBOOK" as const),
          metadata: baseMeta,
        };
      }
      const fp = createHash("sha256").update(wb.file_data).digest("hex");
      const cacheKey = `${session.companyId}:${wb.active_import_id ?? "legacy"}:${wb.filename}:${fp}:${month ?? "all"}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        stats.cacheHits++;
        cache.delete(cacheKey);
        cache.set(cacheKey, cached);
        return {
          ...structuredClone(cached),
          metadata: { ...cached.metadata, sourceUpdatedAt: baseMeta.sourceUpdatedAt },
        };
      }
      try {
        stats.parseCount++;
        parsed = month
          ? parseExpeditionMonthWorkbook(wb.file_data, wb.filename, month)
          : parseExpeditionWorkbook(wb.file_data, wb.filename);
      } catch (err) {
        throw new DashboardError(
          err instanceof Error && err.message.startsWith("DASHBOARD_")
            ? err.message.split(":")[0]
            : "DASHBOARD_SOURCE_INVALID",
          422
        );
      }
      const { orderCount, ...metrics } = computeExpeditionMetrics(parsed);
      const snapshot = {
        ...metrics,
        snapshotStatus: orderCount ? ("AVAILABLE" as const) : ("EMPTY" as const),
        metadata: {
          ...baseMeta,
          snapshotFingerprint: fp,
          sheet: parsed.sheet,
          ...(month ? { period: parsed.period } : {}),
          itemCount: parsed.items.length,
          orderCount,
          unassociatedItemCount: parsed.items.filter((i) => i.orderId === null).length,
        },
      };
      if (!baseMeta.competence || !baseMeta.importedAt) {
        snapshot.dataQuality.push({
          type: "IMPORT_METADATA_INCOMPLETE",
          severity: "WARNING",
          count: 1,
          unit: "IMPORT",
          message:
            "Competência ou horário original não comprovados; valores desconhecidos não foram inferidos.",
          detailsAvailable: false,
        });
      }
      for (const k of cache.keys()) {
        if (k.startsWith(session.companyId + ":")) cache.delete(k);
      }
      cache.set(cacheKey, snapshot);
      if (cache.size > 8) cache.delete(cache.keys().next().value!);
      return structuredClone(snapshot);
    },
    stats,
  };
}
