import * as XLSX from "xlsx";
import {
  cleanString,
  normalizeHeader,
  normalizeId,
  parseExpeditionRows,
  type ExpeditionItem,
  type ExpeditionParsedWorkbook,
} from "./expedition-parser";
import { sumMetric, type MetricValue } from "./expedition-metrics";

const unknownMetric = (reason: string, unknownCount = 0): MetricValue => ({
  status: "UNKNOWN",
  value: null,
  knownValue: null,
  unknownCount,
  reason,
});

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseSpreadsheetDate(val: unknown): string | null {
  if (typeof val === "number") {
    if (!Number.isFinite(val) || val < 1 || Math.floor(val) === 60 || val >= 2958466) {
      return null;
    }
    const utcMs =
      Date.UTC(1899, 11, 31) + (Math.floor(val) - Number(val >= 61)) * 86_400_000;
    return new Date(utcMs).toISOString().slice(0, 10);
  }
  const raw = cleanString(val);
  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s.*)?$/);
  const isoMatch = raw.match(
    /^(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/
  );
  const iso = brMatch ? `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}` : isoMatch?.[1] ?? raw;
  const date = new Date(iso + "T00:00:00Z");
  return ISO_DATE_RE.test(iso) &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === iso
    ? iso
    : null;
}

export interface IntelligenceItem extends ExpeditionItem {
  orderKey: string | null;
  clientId: string | null;
  clientName: string | null;
  productId: string | null;
  productName: string | null;
  department: string | null;
  sellerId: string | null;
  sellerName: string | null;
  inclusionDate: string | null;
  billingDate: string | null;
  maps: Array<{ key: string; status: string | null }>;
}

export interface IntelligenceParsedWorkbook {
  items: IntelligenceItem[];
  sheet: string;
  columns: string[];
}

export interface IntelligenceFilters {
  freight?: string;
  department?: string;
  seller?: string;
  status?: string;
  map?: string;
  from?: string;
  to?: string;
}

export interface IntelligenceOptions {
  statusPolicy?: {
    reference: string;
    classes: Record<string, string>;
  };
  weightKg?: string;
  volumeM3?: string;
}

export function parseIntelligenceWorkbook(
  data: Uint8Array | Buffer | ArrayBuffer,
  filename: string
): IntelligenceParsedWorkbook {
  if (!/\.(xls|xlsx|csv|tsv)$/i.test(filename)) {
    throw new Error("INTELLIGENCE_UNSUPPORTED_SOURCE");
  }
  const wb = XLSX.read(data, { type: "array", cellDates: false, raw: true });
  const candidates = wb.SheetNames.map((sheet) => ({
    sheet,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, defval: "" }),
  })).filter((s) =>
    s.rows.some((row) =>
      row.some((c) => ["PEDIDO SABIUM", "NUMERO PEDIDO", "PEDIDO"].includes(normalizeHeader(c)))
    )
  );
  if (candidates.length !== 1) {
    throw new Error("INTELLIGENCE_AMBIGUOUS_OR_MISSING_SHEET");
  }
  return (function buildFromRows(rows: unknown[][], sheet = "Planilha"): IntelligenceParsedWorkbook {
    const base = parseExpeditionRows(rows, sheet);
    const headerIdx = rows.findIndex((row) =>
      row.some((c) => ["PEDIDO SABIUM", "NUMERO PEDIDO", "PEDIDO"].includes(normalizeHeader(c)))
    );
    const columns = rows[headerIdx].map(normalizeHeader);
    const extraCols = Object.fromEntries(
      [
        "CPF/CNPJ",
        "Nome",
        "Código",
        "Produto",
        "Departamento",
        "Vendedor",
        "Nome do Vendedor",
        "Inclusão",
        "Data/Hora Faturamento",
        "Filial Mapa de Carga Cliente",
        "Mapa de Carga Cliente",
        "Situação Mapa de Carga Cliente",
      ].map((name) => [
        name,
        ((target: string) => {
          const matches = columns.flatMap((col, idx) =>
            col === normalizeHeader(target) ? [idx] : []
          );
          if (matches.length > 1) throw new Error("INTELLIGENCE_AMBIGUOUS_COLUMN");
          return matches[0] ?? -1;
        })(name),
      ])
    );

    return {
      items: base.items.map((item) => {
        const row = rows[item.row - 1];
        const cell = (name: string) => (extraCols[name] < 0 ? null : row[extraCols[name]]);
        const rawDoc = cleanString(cell("CPF/CNPJ")).replace(/[.\-/\s]/g, "");
        const clientId = /^(?:\d{11}|\d{14})$/.test(rawDoc) ? rawDoc : null;
        const mapId = normalizeId(cell("Mapa de Carga Cliente"));
        const mapBranch = normalizeId(cell("Filial Mapa de Carga Cliente"));
        return {
          ...item,
          orderKey: item.branch && item.orderId ? `${item.branch}|${item.orderId}` : null,
          clientId,
          clientName: cleanString(cell("Nome")) || null,
          productId: normalizeId(cell("Código")),
          productName: cleanString(cell("Produto")) || null,
          department: cleanString(cell("Departamento")) || null,
          sellerId: normalizeId(cell("Vendedor")),
          sellerName: cleanString(cell("Nome do Vendedor")) || null,
          inclusionDate: parseSpreadsheetDate(cell("Inclusão")),
          billingDate: parseSpreadsheetDate(cell("Data/Hora Faturamento")),
          maps:
            mapId && mapId !== "0" && mapBranch
              ? [
                  {
                    key: `CLIENTE|${mapBranch}|${mapId}`,
                    status: cleanString(cell("Situação Mapa de Carga Cliente")) || null,
                  },
                ]
              : [],
        };
      }),
      sheet,
      columns,
    };
  })(candidates[0].rows, candidates[0].sheet);
}

export function filterIntelligenceItems(
  wb: IntelligenceParsedWorkbook,
  filters: IntelligenceFilters = {}
): IntelligenceItem[] {
  if (filters.freight && !["CIF", "FOB", "UNKNOWN"].includes(filters.freight)) {
    throw new Error("INTELLIGENCE_INVALID_FILTER");
  }
  if (
    (filters.from && (!ISO_DATE_RE.test(filters.from) || !parseSpreadsheetDate(filters.from))) ||
    (filters.to && (!ISO_DATE_RE.test(filters.to) || !parseSpreadsheetDate(filters.to))) ||
    (filters.from && filters.to && filters.from > filters.to)
  ) {
    throw new Error("INTELLIGENCE_INVALID_PERIOD");
  }
  return wb.items
    .filter((i) => i.branch === "281" && i.orderKey !== null)
    .filter((i) => !filters.freight || i.freight === filters.freight)
    .filter(
      (i) =>
        !filters.department ||
        normalizeHeader(i.department) === normalizeHeader(filters.department)
    )
    .filter((i) => !filters.seller || i.sellerId === filters.seller)
    .filter(
      (i) =>
        !filters.status ||
        normalizeHeader(i.operationalStatus) === normalizeHeader(filters.status)
    )
    .filter((i) => !filters.map || i.maps.some((m) => m.key === filters.map))
    .filter(
      (i) =>
        (!filters.from || (Boolean(i.billingDate) && i.billingDate! >= filters.from)) &&
        (!filters.to || (Boolean(i.billingDate) && i.billingDate! <= filters.to))
    );
}

export const countDistinctOrders = (items: IntelligenceItem[]): number =>
  new Set(items.map((i) => i.orderKey)).size;

function countDistinctEntities(
  items: IntelligenceItem[],
  selector: (i: IntelligenceItem) => string | null
): MetricValue {
  const missing = items.filter((i) => selector(i) === null).length;
  const distinct = new Set(items.map(selector).filter((v) => v !== null)).size;
  return {
    status: missing ? "PARTIAL" : "AVAILABLE",
    value: missing ? null : distinct,
    knownValue: distinct,
    unknownCount: missing,
    reason: missing ? "MISSING_IDENTIFIERS" : null,
  };
}

export function computeItemShortage(item: IntelligenceItem): number | null {
  return item.quantity === null ||
    item.stock === null ||
    item.quantity < 0 ||
    item.stock < 0
    ? null
    : Math.max(0, item.quantity - item.stock);
}

export function sumIntelligenceAmount(items: IntelligenceItem[]): MetricValue {
  const base = sumMetric(
    items.map((i) => i.amountCents),
    true
  );
  const duplicates = items.length - new Set(items.map((i) => i.sourceRowFingerprint)).size;
  return duplicates
    ? {
        ...base,
        status: "UNKNOWN",
        value: null,
        knownValue: null,
        unknownCount: Math.max(base.unknownCount, duplicates),
        reason: "DUPLICATE_SOURCE_ROWS_AMBIGUOUS",
      }
    : base;
}

function groupDimension(
  items: IntelligenceItem[],
  selector: (i: IntelligenceItem) => string | null,
  totalAmount: MetricValue
) {
  const groups = new Map<string, IntelligenceItem[]>();
  for (const item of items) {
    const k = selector(item) ?? "UNKNOWN";
    const list = groups.get(k) ?? [];
    list.push(item);
    groups.set(k, list);
  }
  return [...groups]
    .map(([key, group]) => {
      const amount = sumIntelligenceAmount(group);
      return {
        key,
        lines: group.length,
        orders: countDistinctOrders(group),
        clients: countDistinctEntities(group, (i) => i.clientId),
        amount,
        percentage:
          amount.value !== null && totalAmount.value !== null && totalAmount.value !== 0
            ? (amount.value / totalAmount.value) * 100
            : null,
      };
    })
    .sort(
      (a, b) =>
        (b.amount.value ?? -Infinity) - (a.amount.value ?? -Infinity) ||
        a.key.localeCompare(b.key)
    );
}

export function computeIntelligenceIndicators(
  wb: IntelligenceParsedWorkbook,
  filters: IntelligenceFilters = {},
  options: IntelligenceOptions = {}
) {
  const filtered = filterIntelligenceItems(wb, filters);
  const totalAmount = sumIntelligenceAmount(filtered);
  const orderCount = countDistinctOrders(filtered);
  const shortageItems = filtered.filter((i) => {
    const s = computeItemShortage(i);
    return s !== null && s > 0;
  });
  const unknownShortageCount = filtered.filter((i) => computeItemShortage(i) === null).length;
  const shortageAmount = sumIntelligenceAmount(shortageItems);
  const byFreight = groupDimension(filtered, (i) => i.freight, totalAmount);

  const classifyStatus = (item: IntelligenceItem) =>
    options.statusPolicy?.reference.trim()
      ? options.statusPolicy.classes[normalizeHeader(item.operationalStatus)] ?? "UNKNOWN"
      : "UNKNOWN";
  const operationalItems = filtered.filter((i) => classifyStatus(i) === "OPERATIONAL");
  const unknownStatusCount = filtered.filter((i) => classifyStatus(i) === "UNKNOWN").length;
  const statuses = groupDimension(
    filtered,
    (i) => i.operationalStatus || null,
    totalAmount
  ).map((s) => ({
    ...s,
    classification: options.statusPolicy?.reference.trim()
      ? options.statusPolicy.classes[normalizeHeader(s.key)] ?? "UNKNOWN"
      : "UNKNOWN",
  }));

  const mapGroups = new Map<string, IntelligenceItem[]>();
  for (const item of filtered) {
    for (const m of item.maps) {
      const list = mapGroups.get(m.key) ?? [];
      list.push(item);
      mapGroups.set(m.key, list);
    }
  }

  const sellers = groupDimension(filtered, (i) => i.sellerId, totalAmount).map((s) => ({
    ...s,
    names: [
      ...new Set(
        filtered
          .filter((i) => (i.sellerId ?? "UNKNOWN") === s.key)
          .map((i) => i.sellerName)
          .filter(Boolean)
      ),
    ],
  }));

  return {
    contractVersion: "operational-1",
    branch: 281,
    population: "SOURCE_RECORDS",
    filters,
    periodColumn: "Data/Hora Faturamento",
    lineCount: filtered.length,
    orderCount,
    clients: countDistinctEntities(filtered, (i) => i.clientId),
    products: countDistinctEntities(filtered, (i) => i.productId),
    quantitySource: sumMetric(filtered.map((i) => i.quantity)),
    quantityUnit: null,
    sourceAmount: totalAmount,
    ticketCents: (function computeTicket(amount: MetricValue, count: number): MetricValue {
      if (!count) return unknownMetric("NO_ORDERS");
      if (amount.value === null) {
        return unknownMetric(amount.reason ?? "AMOUNT_UNAVAILABLE", amount.unknownCount);
      }
      const totalBig = BigInt(amount.value);
      const countBig = BigInt(count);
      const sign = totalBig < BigInt(0) ? BigInt(-1) : BigInt(1);
      const avg = Number(sign * ((sign * totalBig + countBig / BigInt(2)) / countBig));
      return { ...amount, value: avg, knownValue: avg };
    })(totalAmount, orderCount),
    operationalPortfolio:
      !options.statusPolicy?.reference.trim() || unknownStatusCount
        ? unknownMetric("ERP_STATUS_CLASSIFICATION_NOT_VALIDATED", unknownStatusCount)
        : sumIntelligenceAmount(operationalItems),
    weightKg: options.weightKg?.trim()
      ? sumMetric(filtered.map((i) => i.weight))
      : unknownMetric("WEIGHT_UNIT_NOT_VALIDATED"),
    weightSource: sumMetric(filtered.map((i) => i.weight)),
    volumeM3: options.volumeM3?.trim()
      ? sumMetric(filtered.map((i) => i.volume))
      : unknownMetric("VOLUME_UNIT_NOT_VALIDATED"),
    volumeSource: sumMetric(filtered.map((i) => i.volume)),
    stock: {
      branch: 281,
      evaluation: "PER_SOURCE_LINE_SNAPSHOT",
      affectedLines: unknownShortageCount ? null : shortageItems.length,
      knownAffectedLines: shortageItems.length,
      affectedOrders: unknownShortageCount ? null : countDistinctOrders(shortageItems),
      knownAffectedOrders: countDistinctOrders(shortageItems),
      unknownLines: unknownShortageCount,
      zeroStockLines: unknownShortageCount
        ? null
        : filtered.filter((i) => i.stock === 0).length,
      knownZeroStockLines: filtered.filter((i) => i.stock === 0).length,
      affectedAmount: unknownShortageCount
        ? {
            ...shortageAmount,
            status: "PARTIAL" as const,
            value: null,
            unknownCount: unknownShortageCount,
            reason: "STOCK_OR_QUANTITY_UNAVAILABLE",
          }
        : shortageAmount,
    },
    freight: ["CIF", "FOB", "UNKNOWN"].map(
      (k) =>
        byFreight.find((f) => f.key === k) ?? {
          key: k,
          lines: 0,
          orders: 0,
          clients: countDistinctEntities([], (i) => i.clientId),
          amount: sumIntelligenceAmount([]),
          percentage: totalAmount.value ? 0 : null,
        }
    ),
    departments: groupDimension(filtered, (i) => i.department, totalAmount),
    sellers,
    topSellers: sellers.filter((s) => s.key !== "UNKNOWN").slice(0, 8),
    statuses,
    maps: {
      count: mapGroups.size,
      groups: [...mapGroups].map(([key, group]) => ({
        key,
        statuses: [
          ...new Set(
            group.flatMap((i) => i.maps.filter((m) => m.key === key).map((m) => m.status))
          ),
        ],
        orders: countDistinctOrders(group),
        amount: sumIntelligenceAmount(group),
        weightSource: sumMetric(group.map((i) => i.weight)),
        volumeSource: sumMetric(group.map((i) => i.volume)),
      })),
    },
    warnings: [
      ...(options.statusPolicy?.reference.trim()
        ? []
        : ["ERP_STATUS_CLASSIFICATION_NOT_VALIDATED"]),
      ...(options.weightKg?.trim() ? [] : ["WEIGHT_UNIT_NOT_VALIDATED"]),
      ...(options.volumeM3?.trim() ? [] : ["VOLUME_UNIT_NOT_VALIDATED"]),
      ...(totalAmount.reason === "DUPLICATE_SOURCE_ROWS_AMBIGUOUS"
        ? [totalAmount.reason]
        : []),
    ],
  };
}

export function parseExpeditionMonthWorkbook(
  data: Uint8Array | Buffer | ArrayBuffer,
  filename: string,
  month: string
): ExpeditionParsedWorkbook {
  if (!/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("DASHBOARD_INVALID_MONTH");
  }
  const wb = parseIntelligenceWorkbook(data, filename);
  if (!wb.columns.includes("DATA/HORA FATURAMENTO")) {
    throw new Error("DASHBOARD_BILLING_DATE_UNAVAILABLE");
  }
  if (
    wb.items.some(
      (i) =>
        i.branch === "281" &&
        i.orderKey &&
        i.billingDateState === "PRESENT" &&
        !i.billingDate
    )
  ) {
    throw new Error("DASHBOARD_INVALID_BILLING_DATE");
  }
  const from = `${month}-01`;
  const to = `${month}-${new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)
  ).getUTCDate()}`;
  return {
    items: filterIntelligenceItems(wb, { from, to }),
    sheet: wb.sheet,
    productStatusValidated: false,
    period: { month, from, to, column: "Data/Hora Faturamento" },
  };
}
