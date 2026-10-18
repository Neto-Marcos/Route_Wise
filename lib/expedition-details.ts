import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import {
  filterToBillOrders,
  groupOrders,
  sumOrdersAmount,
  type AggregatedOrder,
} from "./expedition-metrics";
import {
  cleanString,
  normalizeHeader,
  parseExpeditionWorkbook,
} from "./expedition-parser";
import { DashboardError, type ActiveWorkbookRow } from "./expedition-snapshot";
import { parseExpeditionMonthWorkbook } from "./intelligence-metrics";

export function createExpeditionDetailService(deps: {
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
    {
      orders: AggregatedOrder[];
      labels: Map<number, { client: string | null; product: string | null }>;
      itemCount: number;
      orderCount: number;
    }
  >();

  return {
    async getDetail(params: URLSearchParams) {
      const session = await deps.getSession();
      if (!session || session.role !== "dispatcher") {
        throw new DashboardError("SESSION_REQUIRED", 401);
      }
      if (session.userRole === "driver" || session.userRole === "office") {
        throw new DashboardError("DISPATCHER_REQUIRED", 403);
      }
      const metric = params.get("metric");
      const selection = { metric, key: params.get("key") ?? undefined };
      if (
        ![
          "portfolio",
          "cif",
          "fob",
          "unknown",
          "inMap",
          "partialMap",
          "outOfMap",
          "state",
          "city",
          "toBill",
        ].includes(metric ?? "") ||
        (["state", "city"].includes(metric ?? "") && !selection.key)
      ) {
        throw new DashboardError("TRACE_FILTER_INVALID", 400);
      }
      const page = Number(params.get("page") ?? 1);
      const pageSize = Number(params.get("pageSize") ?? 25);
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        page > 100000 ||
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 50
      ) {
        throw new DashboardError("TRACE_PAGE_INVALID", 400);
      }
      const fingerprint = params.get("fingerprint");
      const importId = params.get("importId");
      if (!fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint) || importId === null) {
        throw new DashboardError("TRACE_VERSION_REQUIRED", 400);
      }
      const wb = await deps.readWorkbook(session.companyId!);
      if (!wb?.file_data) {
        throw new DashboardError("TRACE_SOURCE_UNAVAILABLE", 409);
      }
      const actualFp = createHash("sha256").update(wb.file_data).digest("hex");
      if (actualFp !== fingerprint || (wb.active_import_id ?? "") !== importId) {
        throw new DashboardError("ACTIVE_WORKBOOK_CHANGED", 409);
      }
      const month = params.get("month") ?? undefined;
      const cacheKey = `${session.companyId}:${importId}:${wb.filename}:${actualFp}:${month ?? "all"}`;
      let entry = cache.get(cacheKey);
      if (!entry) {
        let parsed;
        try {
          parsed = month
            ? parseExpeditionMonthWorkbook(wb.file_data, wb.filename, month)
            : parseExpeditionWorkbook(wb.file_data, wb.filename);
        } catch {
          throw new DashboardError("TRACE_MONTH_UNAVAILABLE", 422);
        }
        const orders = groupOrders(parsed.items);
        const rawWb = XLSX.read(wb.file_data, { type: "array" });
        const rows = XLSX.utils.sheet_to_json<unknown[]>(rawWb.Sheets[parsed.sheet], {
          header: 1,
          defval: "",
        });
        const headerRow =
          rows.find((r) =>
            r.some((c) =>
              ["PEDIDO SABIUM", "NUMERO PEDIDO", "PEDIDO"].includes(normalizeHeader(c))
            )
          ) ?? [];
        const findCol = (aliases: string[]) => {
          const matches = headerRow.flatMap((h, i) =>
            aliases.includes(normalizeHeader(h)) ? [i] : []
          );
          return matches.length === 1 ? matches[0] : -1;
        };
        const clientCol = findCol([
          "CLIENTE",
          "NOME",
          "NOME CLIENTE",
          "NOME DO CLIENTE",
          "RAZAO SOCIAL",
          "RAZAO SOCIAL CLIENTE",
        ]);
        const prodCol = findCol([
          "PRODUTO",
          "DESCRICAO PRODUTO",
          "DESCRICAO DO PRODUTO",
          "NOME PRODUTO",
        ]);
        entry = {
          orders,
          labels: new Map(
            parsed.items.map((item) => [
              item.row,
              {
                client:
                  (clientCol >= 0 && cleanString(rows[item.row - 1]?.[clientCol])) || null,
                product:
                  (prodCol >= 0 && cleanString(rows[item.row - 1]?.[prodCol])) || null,
              },
            ])
          ),
          itemCount: parsed.items.length,
          orderCount: orders.length,
        };
        for (const k of cache.keys()) {
          if (k.startsWith(session.companyId + ":")) cache.delete(k);
        }
        cache.set(cacheKey, entry);
        if (cache.size > 2) cache.delete(cache.keys().next().value!);
      }

      const filteredOrders = (function selectOrders(
        orders: AggregatedOrder[],
        sel: { metric: string | null; key?: string }
      ): AggregatedOrder[] {
        switch (sel.metric) {
          case "portfolio":
            return orders;
          case "toBill":
            if (
              orders.some((o) =>
                o.items.some(
                  (i) => !i.billingDateState || i.billingDateState === "UNKNOWN"
                )
              )
            ) {
              throw new DashboardError("BILLING_DATE_COLUMN_UNAVAILABLE", 409);
            }
            return filterToBillOrders(orders);
          case "cif":
            return orders.filter((o) => o.freight === "CIF");
          case "fob":
            return orders.filter((o) => o.freight === "FOB");
          case "unknown":
            return orders.filter((o) => o.freight === "UNKNOWN");
          case "inMap":
            return orders.filter((o) => o.map === "IN_MAP");
          case "partialMap":
            return orders.filter((o) => o.map === "PARTIALLY_IN_MAP");
          case "outOfMap":
            return orders.filter((o) => o.map === "OUT_OF_MAP");
          case "state":
            return orders.filter((o) => (o.uf ?? "UNKNOWN") === sel.key);
          case "city":
            return orders.filter(
              (o) => `${o.uf ?? "UNKNOWN"}|${o.city ?? "UNKNOWN"}` === sel.key
            );
          default:
            throw new DashboardError("TRACE_FILTER_INVALID", 400);
        }
      })(entry.orders, selection);

      const total = sumOrdersAmount(filteredOrders);
      const orderId = params.get("orderId");
      const targetOrder = orderId ? filteredOrders.find((o) => o.id === orderId) : undefined;
      if (orderId && !targetOrder) {
        throw new DashboardError("TRACE_ORDER_NOT_FOUND", 404);
      }

      const formatOrder = (o: AggregatedOrder) => ({
        orderId: o.id,
        clients: [
          ...new Set(
            o.items
              .map((i) => entry!.labels.get(i.row)?.client)
              .filter((c): c is string => Boolean(c))
          ),
        ],
        uf: o.uf,
        city: o.city,
        freight: o.freight,
        map: o.map,
        amount: o.amount,
        itemCount: o.items.length,
      });

      return {
        selection,
        source: {
          importId: wb.active_import_id ?? null,
          fingerprint: actualFp,
          filename: wb.filename,
          itemCount: entry.itemCount,
          orderCount: entry.orderCount,
        },
        total,
        totalOrders: filteredOrders.length,
        page,
        pageSize,
        totalPages: Math.ceil(
          (targetOrder ? targetOrder.items.length : filteredOrders.length) / pageSize
        ),
        orders: targetOrder
          ? []
          : filteredOrders.slice((page - 1) * pageSize, page * pageSize).map(formatOrder),
        order: targetOrder ? formatOrder(targetOrder) : null,
        items: targetOrder
          ? targetOrder.items.slice((page - 1) * pageSize, page * pageSize).map((i) => ({
              row: i.row,
              fingerprint: i.sourceRowFingerprint,
              product: entry!.labels.get(i.row)?.product ?? null,
              client: entry!.labels.get(i.row)?.client ?? null,
              uf: i.uf,
              city: i.city,
              freight: i.freight,
              mapped: i.mapped,
              amountCents: i.amountCents,
              operationalStatus: i.operationalStatus,
            }))
          : [],
        allocatedAmount: null,
        remainingAmount: null,
        allocationReason: "ALLOCATION_AMOUNTS_NOT_PROVEN",
      };
    },
  };
}
