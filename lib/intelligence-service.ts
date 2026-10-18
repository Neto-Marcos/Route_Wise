import { createHash } from "node:crypto";
import { DashboardError, type ActiveWorkbookRow } from "./expedition-snapshot";
import {
  computeIntelligenceIndicators,
  computeItemShortage,
  countDistinctOrders,
  filterIntelligenceItems,
  parseIntelligenceWorkbook,
  sumIntelligenceAmount,
  type IntelligenceFilters,
  type IntelligenceItem,
  type IntelligenceParsedWorkbook,
} from "./intelligence-metrics";

export function createIntelligenceService(
  deps: {
    getSession: () => Promise<{
      role?: string;
      userRole?: string;
      companyId?: string;
      dispatcherId?: string;
    } | null>;
    readWorkbook: (companyId: string) => Promise<ActiveWorkbookRow | null>;
  },
  nowFn: () => Date = () => new Date()
) {
  const cache = new Map<string, IntelligenceParsedWorkbook>();

  return {
    async get(params: URLSearchParams) {
      let filtered: IntelligenceItem[];
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
      const allowedParams = [
        "view",
        "freight",
        "department",
        "seller",
        "status",
        "from",
        "to",
        "month",
        "map",
        "fingerprint",
        "importId",
        "page",
        "pageSize",
        "orderKey",
        "shortage",
      ];
      for (const k of params.keys()) {
        if (!allowedParams.includes(k) || params.getAll(k).length !== 1) {
          throw new DashboardError("INTELLIGENCE_INVALID_FILTER", 400);
        }
      }
      const view = params.get("view") ?? "summary";
      if (!["summary", "orders", "items"].includes(view)) {
        throw new DashboardError("INTELLIGENCE_INVALID_VIEW", 400);
      }
      const filters: IntelligenceFilters = {};
      for (const k of ["freight", "department", "seller", "status", "from", "to", "map"] as const) {
        const val = params.get(k);
        if (val !== null) {
          if (!val.trim() || val.length > 160) {
            throw new DashboardError("INTELLIGENCE_INVALID_FILTER", 400);
          }
          Object.assign(filters, { [k]: val });
        }
      }
      if (
        (params.has("month") && (filters.from || filters.to)) ||
        Boolean(filters.from) !== Boolean(filters.to)
      ) {
        throw new DashboardError("INTELLIGENCE_INVALID_PERIOD", 400);
      }
      if (!filters.from && !filters.to) {
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Sao_Paulo",
          year: "numeric",
          month: "2-digit",
        }).formatToParts(nowFn());
        const month =
          params.get("month") ??
          `${parts.find((p) => p.type === "year")!.value}-${
            parts.find((p) => p.type === "month")!.value
          }`;
        if (!/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(month)) {
          throw new DashboardError("INTELLIGENCE_INVALID_PERIOD", 400);
        }
        filters.from = `${month}-01`;
        filters.to = `${month}-${String(
          new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()
        ).padStart(2, "0")}`;
      }
      const shortage = params.get("shortage");
      if (shortage !== null && shortage !== "true") {
        throw new DashboardError("INTELLIGENCE_INVALID_FILTER", 400);
      }
      const wb = await deps.readWorkbook(session.companyId!);
      if (!wb?.file_data) {
        throw new DashboardError(wb ? "RAW_SOURCE_UNAVAILABLE" : "NO_ACTIVE_WORKBOOK", 404);
      }
      const fp = createHash("sha256").update(wb.file_data).digest("hex");
      if (view !== "summary" && !params.get("fingerprint")) {
        throw new DashboardError("INTELLIGENCE_SOURCE_PROOF_REQUIRED", 400);
      }
      if (
        (params.has("fingerprint") && params.get("fingerprint") !== fp) ||
        (params.has("importId") &&
          params.get("importId") !== (wb.active_import_id ?? "legacy"))
      ) {
        throw new DashboardError("INTELLIGENCE_SOURCE_CHANGED", 409);
      }
      const cacheKey = `${session.companyId}:${wb.active_import_id ?? "legacy"}:${wb.filename}:${fp}`;
      let parsed = cache.get(cacheKey);
      if (!parsed) {
        try {
          parsed = parseIntelligenceWorkbook(wb.file_data, wb.filename);
        } catch {
          throw new DashboardError("INTELLIGENCE_SOURCE_INVALID", 422);
        }
        for (const k of cache.keys()) {
          if (k.startsWith(session.companyId + ":")) cache.delete(k);
        }
        cache.set(cacheKey, parsed);
        if (cache.size > 2) cache.delete(cache.keys().next().value!);
      }
      if (!parsed.columns.includes("DATA/HORA FATURAMENTO")) {
        throw new DashboardError("INTELLIGENCE_PERIOD_SOURCE_UNAVAILABLE", 422);
      }
      const branchItems = parsed.items.filter(
        (i) => i.branch === "281" && i.orderKey !== null
      );
      const dateIssues = {
        blank: branchItems.filter((i) => i.billingDateState === "BLANK").length,
        invalid: branchItems.filter(
          (i) => i.billingDateState === "PRESENT" && i.billingDate === null
        ).length,
      };
      if (dateIssues.invalid) {
        throw new DashboardError("INTELLIGENCE_INVALID_BILLING_DATES", 422);
      }
      const uploadedAt = wb.uploaded_at ? new Date(wb.uploaded_at) : null;
      const metadata = {
        source: "routing_workbooks.file_data",
        activeImportId: wb.active_import_id ?? null,
        fingerprint: fp,
        filename: wb.filename,
        importedAt:
          uploadedAt && Number.isFinite(uploadedAt.getTime())
            ? uploadedAt.toISOString()
            : null,
        competence: wb.competence ?? null,
        sheet: parsed.sheet,
        period: {
          column: "Data/Hora Faturamento",
          from: filters.from,
          to: filters.to,
          timeZone: "America/Sao_Paulo",
          excludedBlankDates: dateIssues.blank,
        },
      };
      try {
        filtered = filterIntelligenceItems(parsed, filters);
      } catch {
        throw new DashboardError("INTELLIGENCE_INVALID_FILTER", 400);
      }
      if (view === "summary") {
        if (shortage || params.has("orderKey")) {
          throw new DashboardError("INTELLIGENCE_INVALID_FILTER", 400);
        }
        return {
          metadata,
          indicators: computeIntelligenceIndicators(parsed, filters),
        };
      }
      if (shortage) {
        filtered = filtered.filter((i) => (computeItemShortage(i) ?? 0) > 0);
      }
      const orderKey = params.get("orderKey");
      if (orderKey) {
        filtered = filtered.filter((i) => i.orderKey === orderKey);
      }
      const parsePageParam = (name: string, def: number, max: number) => {
        const raw = params.get(name);
        if (raw !== null && !/^[1-9]\d{0,6}$/.test(raw)) {
          throw new DashboardError("INTELLIGENCE_INVALID_PAGE", 400);
        }
        const val = raw === null ? def : Number(raw);
        if (val > max) throw new DashboardError("INTELLIGENCE_INVALID_PAGE", 400);
        return val;
      };
      const page = parsePageParam("page", 1, 1000000);
      const pageSize = parsePageParam("pageSize", 50, 100);
      const byOrder = new Map<string, IntelligenceItem[]>();
      for (const item of filtered) {
        const k = item.orderKey!;
        const list = byOrder.get(k) ?? [];
        list.push(item);
        byOrder.set(k, list);
      }
      const entries =
        view === "items"
          ? filtered.map((i) => ({
              row: i.row,
              sourceRowFingerprint: i.sourceRowFingerprint,
              orderKey: i.orderKey,
              client: i.clientName,
              productId: i.productId,
              product: i.productName,
              uf: i.uf,
              city: i.city,
              freight: i.freight,
              status: i.operationalStatus,
              department: i.department,
              sellerId: i.sellerId,
              billingDate: i.billingDate,
              amountCents: i.amountCents,
              quantity: i.quantity,
              stock281: i.stock,
              shortage: computeItemShortage(i),
            }))
          : [...byOrder].map(([key, group]) => ({
              orderKey: key,
              orderId: group[0].orderId,
              clientNames: [...new Set(group.map((i) => i.clientName).filter(Boolean))],
              lines: group.length,
              amount: sumIntelligenceAmount(group),
              freight: [...new Set(group.map((i) => i.freight))],
              statuses: [...new Set(group.map((i) => i.operationalStatus))],
              cities: [...new Set(group.map((i) => i.city))],
              states: [...new Set(group.map((i) => i.uf))],
            }));

      return {
        metadata,
        filters,
        population: "SOURCE_RECORDS",
        totalLines: filtered.length,
        totalOrders: countDistinctOrders(filtered),
        amount: sumIntelligenceAmount(filtered),
        stockSelectionComplete:
          !shortage ||
          filterIntelligenceItems(parsed, filters).every(
            (i) => computeItemShortage(i) !== null
          ),
        page,
        pageSize,
        total: entries.length,
        entries: entries.slice((page - 1) * pageSize, page * pageSize),
      };
    },
  };
}
