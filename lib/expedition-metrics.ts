import { checkOrderMinEligibility } from "./route-engine";
import type { ExpeditionItem, ExpeditionParsedWorkbook, FreightType } from "./expedition-parser";

export interface PrecheckConfig {
  enforceMinimum: boolean;
  maxVolume: number;
  maxWeight: number;
}

const DEFAULT_PRECHECK_CONFIG: PrecheckConfig = {
  enforceMinimum: true,
  maxVolume: 30,
  maxWeight: 10000,
};

export type MetricStatus = "AVAILABLE" | "PARTIAL" | "UNKNOWN";

export interface MetricValue {
  status: MetricStatus;
  value: number | null;
  knownValue: number | null;
  unknownCount: number;
  reason: string | null;
}

export type MapStatus = "IN_MAP" | "PARTIALLY_IN_MAP" | "OUT_OF_MAP" | null;

export interface AggregatedOrder {
  id: string;
  items: ExpeditionItem[];
  uf: string | null;
  city: string | null;
  freight: FreightType;
  map: MapStatus;
  amount: MetricValue;
  weight: MetricValue;
  volume: MetricValue;
}

export interface CategoryBreakdown<T = string> {
  category: T;
  count: number;
  amount: MetricValue;
  percentageOfOrders: number | null;
  percentageOfAmount: number | null;
}

export interface FunnelStage {
  id: string;
  label: string;
  status: MetricStatus;
  inputCount: number | null;
  outputCount: number | null;
  excludedCount: number | null;
  unknownCount: number;
  percentageOfPrevious: number | null;
  percentageOfTotal: number | null;
  amount: MetricValue;
  exclusionReasons: Array<{ code: string; count: number }>;
}

export interface DashboardCardMetric {
  status: MetricStatus;
  count: number | null;
  itemCount?: number | null;
  amount: MetricValue;
  percentageOfOrders: number | null;
  reason: string | null;
}

export interface LocationBreakdown {
  key: string;
  uf: string | null;
  city: string | null;
  originalCityNames: string[];
  count: number;
  amount: MetricValue;
  percentageOfOrders: number | null;
  percentageOfAmount: number | null;
  freight: CategoryBreakdown<FreightType>[];
  map: CategoryBreakdown<"IN_MAP" | "PARTIALLY_IN_MAP" | "OUT_OF_MAP">[];
  unknownMapCount: number;
  precheckEligibleCount: number;
  eligibleCount: number | null;
  eligibilityStatus: MetricStatus;
  weightSource: MetricValue;
  volumeSource: MetricValue;
}

export interface DataQualityWarning {
  type: string;
  severity: "WARNING";
  count: number;
  unit: "ITEM" | "ORDER" | "IMPORT" | "INVOICE";
  message: string;
  detailsAvailable: boolean;
}

const unknownMetric = (reason: string, unknownCount = 0): MetricValue => ({
  status: "UNKNOWN",
  value: null,
  knownValue: null,
  unknownCount,
  reason,
});

const pct = (part: number, total: number): number | null => (total ? (part / total) * 100 : null);

export function sumMetric(values: Array<number | null>, integerCents = false): MetricValue {
  let sum = 0;
  let comp = 0;
  let unknown = 0;
  let bigSum = BigInt(0);
  for (const v of values) {
    if (v === null) {
      unknown++;
      continue;
    }
    if (integerCents) {
      bigSum += BigInt(v);
      continue;
    }
    const y = v - comp;
    const t = sum + y;
    comp = t - sum - y;
    sum = t;
  }
  if (integerCents) sum = Number(bigSum);
  if (!Number.isFinite(sum) || (integerCents && !Number.isSafeInteger(sum))) {
    return unknownMetric("METRIC_RANGE_EXCEEDED", values.length);
  }
  return {
    status: unknown ? (unknown === values.length ? "UNKNOWN" : "PARTIAL") : "AVAILABLE",
    value: unknown ? null : sum,
    knownValue: unknown === values.length && unknown > 0 ? null : sum,
    unknownCount: unknown,
    reason: unknown ? "MISSING_SOURCE_VALUES" : null,
  };
}

function uniqueOrNull<T>(vals: T[]): T | null {
  return new Set(vals).size === 1 ? vals[0] : null;
}

export function groupOrders(items: ExpeditionItem[]): AggregatedOrder[] {
  const byOrder = new Map<string, ExpeditionItem[]>();
  for (const item of items) {
    if (item.orderId) {
      const list = byOrder.get(item.orderId) ?? [];
      list.push(item);
      byOrder.set(item.orderId, list);
    }
  }
  return [...byOrder]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([id, orderItems]) => {
      const map: MapStatus = orderItems.some((i) => i.mapped === null)
        ? null
        : orderItems.every((i) => i.mapped)
        ? "IN_MAP"
        : orderItems.some((i) => i.mapped)
        ? "PARTIALLY_IN_MAP"
        : "OUT_OF_MAP";
      return {
        id,
        items: orderItems,
        uf: uniqueOrNull(orderItems.map((i) => i.uf)),
        city: uniqueOrNull(orderItems.map((i) => i.city)),
        freight: uniqueOrNull(orderItems.map((i) => i.freight)) ?? "UNKNOWN",
        map,
        amount: sumMetric(
          orderItems.map((i) => i.amountCents),
          true
        ),
        weight: sumMetric(orderItems.map((i) => i.weight)),
        volume: sumMetric(orderItems.map((i) => i.volume)),
      };
    });
}

export function sumOrdersAmount(orders: AggregatedOrder[]): MetricValue {
  return sumMetric(
    orders.flatMap((o) => o.items.map((i) => i.amountCents)),
    true
  );
}

export function filterToBillOrders(orders: AggregatedOrder[]): AggregatedOrder[] {
  return groupOrders(
    orders.flatMap((o) => o.items.filter((i) => i.billingDateState === "BLANK"))
  );
}

function buildBreakdown<T extends string>(
  orders: AggregatedOrder[],
  categories: T[],
  selector: (o: AggregatedOrder) => T | null
): CategoryBreakdown<T>[] {
  const totalAmount = sumOrdersAmount(orders);
  return categories.map((category) => {
    const subset = orders.filter((o) => selector(o) === category);
    const amount = sumOrdersAmount(subset);
    return {
      category,
      count: subset.length,
      amount,
      percentageOfOrders: pct(subset.length, orders.length),
      percentageOfAmount:
        totalAmount.value !== null && amount.value !== null
          ? pct(amount.value, totalAmount.value)
          : null,
    };
  });
}

function checkMapStockStage(order: AggregatedOrder): { reason: string | null; pending: boolean } {
  if (order.items.some((i) => i.mapped === true)) {
    return {
      reason: order.map === "PARTIALLY_IN_MAP" ? "PARTIAL_MAP" : "ALREADY_IN_MAP",
      pending: false,
    };
  }
  if (order.items.some((i) => i.stock !== null && i.quantity !== null && i.stock < i.quantity)) {
    return { reason: "INSUFFICIENT_STOCK", pending: false };
  }
  const blockedCount = order.items.filter((i) =>
    /cancelad[ao]|entregu?e?|devolvid[ao]|estornad[ao]/i.test(i.operationalStatus)
  ).length;
  if (blockedCount === order.items.length) {
    return { reason: "OPERATIONAL_STATUS_FILTER", pending: false };
  }
  if (blockedCount > 0) {
    return { reason: "MIXED_OPERATIONAL_STATUS", pending: true };
  }
  if (
    order.items.some(
      (i) => i.mapped === null || i.stock === null || i.quantity === null || i.quantity <= 0
    )
  ) {
    return { reason: "UNKNOWN_DATA", pending: true };
  }
  return { reason: null, pending: false };
}

export function computeExpeditionMetrics(
  parsed: ExpeditionParsedWorkbook,
  config: PrecheckConfig = DEFAULT_PRECHECK_CONFIG
) {
  if (
    !Number.isFinite(config.maxVolume) ||
    config.maxVolume <= 0 ||
    !Number.isFinite(config.maxWeight) ||
    config.maxWeight <= 0
  ) {
    throw new Error("DASHBOARD_INVALID_PRECHECK_CONFIG");
  }
  const orders = groupOrders(parsed.items);
  const totalAmount = sumOrdersAmount(orders);
  const freightBreakdown = buildBreakdown(orders, ["CIF", "FOB", "UNKNOWN"], (o) => o.freight);
  const mapBreakdown = buildBreakdown(
    orders,
    ["IN_MAP", "PARTIALLY_IN_MAP", "OUT_OF_MAP"],
    (o) => o.map
  );

  const funnel = (function buildFunnel(allOrders: AggregatedOrder[], cfg: PrecheckConfig) {
    const total = allOrders.length;
    const stages: FunnelStage[] = [
      {
        id: "PORTFOLIO",
        label: "Carteira completa",
        status: "AVAILABLE",
        inputCount: total,
        outputCount: total,
        excludedCount: 0,
        unknownCount: 0,
        percentageOfPrevious: null,
        percentageOfTotal: pct(total, total),
        amount: sumOrdersAmount(allOrders),
        exclusionReasons: [],
      },
    ];
    let current = allOrders;

    function runStage(
      id: string,
      label: string,
      evaluator: (o: AggregatedOrder) => { reason: string | null; pending: boolean }
    ) {
      const prev = current;
      const reasons = new Map<string, number>();
      let unknownCount = 0;
      let excludedCount = 0;
      current = prev.filter((o) => {
        const res = evaluator(o);
        if (!res.reason) return true;
        reasons.set(res.reason, (reasons.get(res.reason) ?? 0) + 1);
        if (res.pending) unknownCount++;
        else excludedCount++;
        return false;
      });
      stages.push({
        id,
        label,
        status: unknownCount ? "PARTIAL" : "AVAILABLE",
        inputCount: prev.length,
        outputCount: current.length,
        excludedCount,
        unknownCount,
        percentageOfPrevious: pct(current.length, prev.length),
        percentageOfTotal: pct(current.length, total),
        amount: sumOrdersAmount(current),
        exclusionReasons: [...reasons]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([code, count]) => ({ code, count })),
      });
    }

    runStage("MAP_STOCK", "Após mapa e saldo", checkMapStockStage);
    runStage("CIF", "Após classificação CIF", (o) => ({
      reason: o.freight === "CIF" ? null : o.freight === "FOB" ? "FOB" : "UNKNOWN_FREIGHT",
      pending: false,
    }));
    runStage("MINIMUM_CAPACITY", "Elegíveis após pré-checks", (o) => {
      if (
        o.volume.value !== null &&
        o.weight.value !== null &&
        o.amount.value !== null &&
        o.uf
      ) {
        if (o.volume.value > cfg.maxVolume || o.weight.value > cfg.maxWeight) {
          return { reason: "CAPACITY_EXCEEDED", pending: false };
        }
        if (
          cfg.enforceMinimum &&
          !checkOrderMinEligibility({ uf: o.uf, totalValue: o.amount.value / 100 }).eligible
        ) {
          return { reason: "MINIMUM_ORDER_NOT_MET", pending: false };
        }
        return { reason: null, pending: false };
      }
      return { reason: "UNKNOWN_DATA", pending: true };
    });

    for (const [id, label] of [
      ["GEOCODING", "Geocodificação não avaliada"],
      ["ALLOCATION", "Alocação não avaliada"],
    ] as const) {
      stages.push({
        id,
        label,
        status: "UNKNOWN",
        inputCount: id === "GEOCODING" ? current.length : null,
        outputCount: null,
        excludedCount: null,
        unknownCount: current.length,
        percentageOfPrevious: null,
        percentageOfTotal: null,
        amount: unknownMetric("NOT_EVALUATED"),
        exclusionReasons: [],
      });
    }
    return { stages, survivors: new Set(current.map((o) => o.id)) };
  })(orders, config);

  function makeCard(subset: AggregatedOrder[]): DashboardCardMetric {
    return {
      status: "AVAILABLE",
      count: subset.length,
      amount: sumOrdersAmount(subset),
      percentageOfOrders: pct(subset.length, orders.length),
      reason: null,
    };
  }

  const billingMetric = (function computeBilling(wb: ExpeditionParsedWorkbook): MetricValue {
    if (!wb.productStatusValidated) {
      return unknownMetric("PRODUCT_STATUS_NOT_VALIDATED", wb.items.length);
    }
    const vals: Array<number | null> = [];
    for (const item of wb.items) {
      if (
        (item.branch === null || item.branch === "281") &&
        item.productStatus !== "INACTIVE" &&
        item.productStatus !== "DISCONTINUED"
      ) {
        vals.push(
          item.branch === "281" && item.productStatus === "ACTIVE" ? item.amountCents : null
        );
      }
    }
    const res = sumMetric(vals, true);
    return res.status === "AVAILABLE" ? res : unknownMetric("BILLING_DATA_UNKNOWN", res.unknownCount);
  })({ ...parsed, items: parsed.items.filter((i) => i.orderId !== null) });

  const toBillOrders = filterToBillOrders(orders);
  const billingDateUnavailable = orders.some((o) =>
    o.items.some((i) => !i.billingDateState || i.billingDateState === "UNKNOWN")
  );

  const cards = {
    billing: {
      status: billingMetric.status,
      count: null,
      amount: billingMetric,
      percentageOfOrders: null,
      reason: billingMetric.reason,
    },
    toBill: billingDateUnavailable
      ? {
          status: "UNKNOWN" as MetricStatus,
          count: null,
          itemCount: null,
          amount: unknownMetric("BILLING_DATE_COLUMN_UNAVAILABLE"),
          percentageOfOrders: null,
          reason: "BILLING_DATE_COLUMN_UNAVAILABLE",
        }
      : {
          ...makeCard(toBillOrders),
          itemCount: toBillOrders.reduce((acc, o) => acc + o.items.length, 0),
        },
    portfolio: makeCard(orders),
    inMap: makeCard(orders.filter((o) => o.map === "IN_MAP")),
    partialMap: makeCard(orders.filter((o) => o.map === "PARTIALLY_IN_MAP")),
    outOfMap: makeCard(orders.filter((o) => o.map === "OUT_OF_MAP")),
    cif: makeCard(orders.filter((o) => o.freight === "CIF")),
    fob: makeCard(orders.filter((o) => o.freight === "FOB")),
    routeEligible: {
      status: "UNKNOWN" as MetricStatus,
      count: null,
      amount: unknownMetric("FULL_ELIGIBILITY_NOT_EVALUATED"),
      percentageOfOrders: null,
      reason: "FULL_ELIGIBILITY_NOT_EVALUATED",
    },
  };

  function groupLocations(
    keyFn: (o: AggregatedOrder) => string,
    includeCity: boolean
  ): LocationBreakdown[] {
    const groups = new Map<string, AggregatedOrder[]>();
    for (const o of orders) {
      const k = keyFn(o);
      const list = groups.get(k) ?? [];
      list.push(o);
      groups.set(k, list);
    }
    return [...groups]
      .map(([key, group]) => {
        const amount = sumOrdersAmount(group);
        return {
          key,
          uf: group[0].uf,
          city: includeCity ? group[0].city : null,
          originalCityNames: includeCity
            ? [...new Set(group.flatMap((o) => o.items.map((i) => i.cityRaw)))].sort()
            : [],
          count: group.length,
          amount,
          percentageOfOrders: pct(group.length, orders.length),
          percentageOfAmount:
            totalAmount.value !== null && amount.value !== null
              ? pct(amount.value, totalAmount.value)
              : null,
          freight: buildBreakdown(group, ["CIF", "FOB", "UNKNOWN"], (o) => o.freight),
          map: buildBreakdown(
            group,
            ["IN_MAP", "PARTIALLY_IN_MAP", "OUT_OF_MAP"],
            (o) => o.map
          ),
          unknownMapCount: group.filter((o) => o.map === null).length,
          precheckEligibleCount: group.filter((o) => funnel.survivors.has(o.id)).length,
          eligibleCount: null,
          eligibilityStatus: "UNKNOWN" as MetricStatus,
          weightSource: sumMetric(group.flatMap((o) => o.items.map((i) => i.weight))),
          volumeSource: sumMetric(group.flatMap((o) => o.items.map((i) => i.volume))),
        };
      })
      .sort(
        (a, b) =>
          (b.amount.knownValue ?? 0) - (a.amount.knownValue ?? 0) ||
          a.key.localeCompare(b.key, "en")
      );
  }

  const dataQuality = (function computeDataQuality(
    wb: ExpeditionParsedWorkbook,
    grouped: AggregatedOrder[]
  ): DataQualityWarning[] {
    const warnings: DataQualityWarning[] = [];
    function warn(
      type: string,
      count: number,
      unit: DataQualityWarning["unit"],
      message: string
    ) {
      if (count > 0) {
        warnings.push({
          type,
          severity: "WARNING",
          count,
          unit,
          message,
          detailsAvailable: false,
        });
      }
    }
    const items = wb.items;
    const fpCounts = new Map<string, number>();
    for (const item of items) {
      fpCounts.set(item.sourceRowFingerprint, (fpCounts.get(item.sourceRowFingerprint) ?? 0) + 1);
    }
    warn(
      "POSSIBLE_DUPLICATE",
      [...fpCounts.values()].reduce((acc, c) => acc + Math.max(0, c - 1), 0),
      "ITEM",
      "Linhas integralmente repetidas; não deduplicadas silenciosamente."
    );
    warn(
      "PRODUCT_STATUS_NOT_VALIDATED",
      +!wb.productStatusValidated,
      "IMPORT",
      "Situação do produto ainda não validada na fonte."
    );
    warn(
      "PRODUCT_STATUS_UNKNOWN",
      wb.productStatusValidated ? items.filter((i) => i.productStatus === "UNKNOWN").length : 0,
      "ITEM",
      "Situação do produto desconhecida; não presumir ATIVO."
    );
    warn(
      "UNKNOWN_FREIGHT",
      grouped.filter((o) => o.freight === "UNKNOWN").length,
      "ORDER",
      "Pedidos com frete não informado, inválido ou conflitante."
    );
    warn(
      "UF_UNKNOWN",
      grouped.filter((o) => !o.uf).length,
      "ORDER",
      "UF ausente, inválida ou conflitante."
    );
    warn(
      "CITY_UNKNOWN",
      grouped.filter((o) => !o.city).length,
      "ORDER",
      "Cidade ausente, inválida ou conflitante."
    );
    warn(
      "MAP_UNKNOWN",
      grouped.filter((o) => o.map === null).length,
      "ORDER",
      "Vínculo de mapa não comprovado."
    );
    warn(
      "ITEM_VALUE_UNKNOWN",
      items.filter((i) => i.amountCents === null).length,
      "ITEM",
      "Valor de item ausente ou inválido."
    );
    warn(
      "ORDER_ID_MISSING",
      items.filter((i) => !i.orderId).length,
      "ITEM",
      "Itens sem identidade de pedido, não associados à carteira."
    );
    warn(
      "BILLING_BRANCH_UNKNOWN",
      items.filter((i) => i.branch === null).length,
      "ITEM",
      "Filial não comprovada."
    );
    warn(
      "ROUTING_DATA_UNKNOWN",
      grouped.filter(
        (o) =>
          o.items.some(
            (i) =>
              i.stock === null || i.quantity === null || i.volume === null || i.weight === null
          ) ||
          !o.uf ||
          !o.city
      ).length,
      "ORDER",
      "Dados necessários aos pré-checks ausentes ou inválidos."
    );
    warn(
      "DIMENSION_ZERO",
      items.filter((i) => i.weight === 0 || i.volume === 0).length,
      "ITEM",
      "Peso ou cubagem informado como zero; valor não estimado."
    );
    warn(
      "STOCK_NEGATIVE",
      items.filter((i) => i.stock !== null && i.stock < 0).length,
      "ITEM",
      "Saldo de estoque negativo na origem."
    );
    warn(
      "UNIT_UNCONFIRMED",
      +Boolean(items.length),
      "IMPORT",
      "Unidades físicas não comprovadas; Quantidade não representa caixas."
    );

    const byInvoice = new Map<string, ExpeditionItem[]>();
    for (const item of items) {
      if (item.invoiceId) {
        const list = byInvoice.get(item.invoiceId) ?? [];
        list.push(item);
        byInvoice.set(item.invoiceId, list);
      }
    }
    let nfMismatch = 0;
    let nfConflict = 0;
    let nfIncomplete = 0;
    for (const invItems of byInvoice.values()) {
      if (new Set(invItems.map((i) => i.invoiceAmountCents)).size > 1) {
        nfConflict++;
        continue;
      }
      const nfTotal = invItems[0].invoiceAmountCents;
      const itemsSum = sumMetric(
        invItems.map((i) => i.amountCents),
        true
      );
      if (nfTotal === null || itemsSum.value === null) {
        nfIncomplete++;
        continue;
      }
      if (itemsSum.value !== nfTotal) nfMismatch++;
    }
    warn(
      "NF_VALUE_MISMATCH",
      nfMismatch,
      "INVOICE",
      "Notas com divergência entre Total NF e soma dos itens; não altera faturamento oficial."
    );
    warn(
      "NF_FIELD_CONFLICT",
      nfConflict,
      "INVOICE",
      "Total NF conflitante entre linhas da mesma nota."
    );
    warn(
      "NF_COMPARISON_INCOMPLETE",
      nfIncomplete,
      "INVOICE",
      "Valores ausentes impedem a conferência da nota."
    );
    warn(
      "NF_IDENTITY_INCOMPLETE",
      items.filter((i) => i.invoiceIdentityIncomplete).length,
      "ITEM",
      "Identidade da NF incompleta para conferência."
    );
    return warnings;
  })(parsed, orders);

  return {
    contractVersion: "1.1",
    monetaryUnit: "BRL_CENTS",
    orderCount: orders.length,
    cards,
    eligibilityFunnel: funnel.stages,
    eligibilityConfig: {
      stockBranch: 281,
      ...config,
      ruleVersion: "V1_PRECHECKS_85fb1e6",
    },
    byState: groupLocations((o) => o.uf ?? "UNKNOWN", false),
    byCity: groupLocations((o) => `${o.uf ?? "UNKNOWN"}|${o.city ?? "UNKNOWN"}`, true),
    freightBreakdown,
    mapBreakdown,
    unknownMapCount: orders.filter((o) => o.map === null).length,
    dataQuality,
    dimensions: {
      weightSource: sumMetric(orders.flatMap((o) => o.items.map((i) => i.weight))),
      volumeSource: sumMetric(orders.flatMap((o) => o.items.map((i) => i.volume))),
      weightUnit: null,
      volumeUnit: null,
      boxesAvailable: false,
    },
  };
}
