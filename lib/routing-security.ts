import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { parseSpreadsheet, type OrderRow } from "./spreadsheet-parser";
import { parseExpeditionWorkbook, type ExpeditionItem } from "./expedition-parser";
import { checkOrderMinEligibility, type EngineConfig, type SuggestedRoute } from "./route-engine";

export class RoutingError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

export const hashRoute = (route: unknown): string =>
  createHash("sha256").update(JSON.stringify(route)).digest("hex");

export function validateMinimumExceptions(
  orders: OrderRow[],
  exceptionInput?: { confirmed?: boolean; orderIds?: unknown }
): string[] {
  if (
    exceptionInput &&
    (!Array.isArray(exceptionInput.orderIds) ||
      exceptionInput.orderIds.some((id) => typeof id !== "string"))
  ) {
    throw new RoutingError("Seleção de exceções inválida.");
  }
  if (!Array.isArray(exceptionInput?.orderIds) || !exceptionInput.orderIds.length) return [];
  if (exceptionInput.confirmed !== true) {
    throw new RoutingError("Confirme explicitamente a inclusão abaixo do mínimo.", 428);
  }
  const orderIds = exceptionInput.orderIds as string[];
  if (new Set(orderIds).size !== orderIds.length) {
    throw new RoutingError("Pedido duplicado na exceção.");
  }
  const byId = new Map(orders.map((o) => [o.orderId, o]));
  for (const id of orderIds) {
    const order = byId.get(id);
    if (!order || checkOrderMinEligibility(order).eligible) {
      throw new RoutingError(
        "Exceção não corresponde aos pedidos abaixo do mínimo desta seleção."
      );
    }
  }
  return [...orderIds];
}

import type { QueryResultRow } from "pg";

export interface QueryExecutor {
  query: <T extends QueryResultRow = any>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
}

export interface DispatcherSession {
  role?: string;
  userRole?: string;
  companyId: string;
  dispatcherId: string;
}

export async function requireRoutingDispatcher(
  db: QueryExecutor,
  session: { role?: string; userRole?: string; companyId?: string; dispatcherId?: string } | null
): Promise<DispatcherSession> {
  if (!session || session.role !== "dispatcher" || !session.dispatcherId || !session.companyId) {
    throw new RoutingError("Sessão identificada necessária.", 401);
  }
  const { rows } = await db.query<{ role: string }>(
    "SELECT d.role FROM dispatchers d JOIN companies c ON c.id=$2 AND c.active WHERE d.id=$1 AND d.active AND (d.company_id=$2 OR d.role='superadmin')",
    [session.dispatcherId, session.companyId]
  );
  if (!rows[0] || !["admin", "route_creator", "superadmin"].includes(rows[0].role)) {
    throw new RoutingError("Sem permissão para roteirizar.", 403);
  }
  return session as DispatcherSession;
}

export interface ActiveRoutingWorkbook {
  filename: string;
  importId: string | null;
  hash: string;
  parsed: OrderRow[];
  items: ExpeditionItem[];
}

export async function loadActiveRoutingWorkbook(
  db: QueryExecutor,
  companyId: string,
  lock = false
): Promise<ActiveRoutingWorkbook> {
  const { rows } = await db.query<{
    filename: string;
    file_data: Buffer | Uint8Array | null;
    active_import_id: string | null;
  }>(
    `SELECT filename,file_data,active_import_id FROM routing_workbooks WHERE company_id=$1${
      lock ? " FOR SHARE" : ""
    }`,
    [companyId]
  );
  const row = rows[0];
  if (!row?.file_data || /\.(not|edi|txt)$/i.test(row.filename)) {
    throw new RoutingError("Carteira com evidências de estoque e mapa necessária.", 409);
  }
  const buf = Buffer.from(row.file_data);
  const parsed = await parseSpreadsheet(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    row.filename
  );
  const exp = parseExpeditionWorkbook(buf, row.filename);
  return {
    filename: row.filename,
    importId: row.active_import_id,
    hash: createHash("sha256").update(buf).digest("hex"),
    parsed,
    items: exp.items,
  };
}

export async function verifyAndSelectRoutingOrders(
  db: QueryExecutor,
  companyId: string,
  wb: ActiveRoutingWorkbook,
  orderIds: unknown[]
): Promise<OrderRow[]> {
  if (
    !orderIds.length ||
    orderIds.length > 20000 ||
    orderIds.some((id) => typeof id !== "string" || !id)
  ) {
    throw new RoutingError("Seleção de pedidos inválida.");
  }
  const ids = orderIds as string[];
  if (new Set(ids).size !== ids.length) {
    throw new RoutingError("Pedido duplicado na seleção.", 409);
  }
  const allocated = new Set(
    (
      await db.query<{ order_ids: unknown }>(
        "SELECT s.order_ids FROM route_stops s JOIN routes r ON r.id=s.route_id WHERE r.company_id=$1 AND r.status<>'cancelled' AND NOT s.is_origin",
        [companyId]
      )
    ).rows.flatMap((r) => (Array.isArray(r.order_ids) ? r.order_ids : []))
  );
  const parsedById = new Map(wb.parsed.map((o) => [o.orderId, o]));
  const itemsByOrder = new Map<string, ExpeditionItem[]>();
  for (const item of wb.items) {
    if (item.orderId) {
      const list = itemsByOrder.get(item.orderId) ?? [];
      list.push(item);
      itemsByOrder.set(item.orderId, list);
    }
  }
  return ids.map((id) => {
    if (allocated.has(id)) {
      throw new RoutingError(`Pedido ${id} já alocado.`, 409);
    }
    const items = itemsByOrder.get(id);
    if (!items?.length) {
      throw new RoutingError("Pedido não pertence à carteira ativa desta empresa.", 409);
    }
    if (items.some((i) => i.mapped !== false)) {
      throw new RoutingError(`Pedido ${id}: mapa alocado ou não comprovado.`);
    }
    if (
      items.some(
        (i) =>
          i.stock === null || i.quantity === null || i.quantity <= 0 || i.stock < i.quantity
      )
    ) {
      throw new RoutingError(`Pedido ${id}: estoque insuficiente ou não comprovado.`);
    }
    if (
      items.some((i) =>
        /cancelad[ao]|entregu?e?|devolvid[ao]|estornad[ao]/i.test(i.operationalStatus)
      )
    ) {
      throw new RoutingError(`Pedido ${id}: situação operacional bloqueada.`);
    }
    const order = parsedById.get(id);
    if (
      !order ||
      items.some((i) => i.freight !== "CIF" || i.amountCents === null || !i.uf || !i.city)
    ) {
      throw new RoutingError(`Pedido ${id}: dados obrigatórios ou CIF não comprovados.`);
    }
    if (
      new Set(items.map((i) => i.uf)).size !== 1 ||
      new Set(items.map((i) => i.city)).size !== 1
    ) {
      throw new RoutingError(`Pedido ${id}: destino ambíguo.`);
    }
    if (
      items.some(
        (i) => i.volume === null || i.weight === null || i.volume <= 0 || i.weight <= 0
      ) ||
      ![order.volumeM3, order.weightKg, order.totalValue].every(
        (v) => typeof v === "number" && Number.isFinite(v) && v >= 0
      ) ||
      order.volumeM3 <= 0 ||
      order.weightKg <= 0
    ) {
      throw new RoutingError(`Pedido ${id}: dimensões inválidas ou não comprovadas.`);
    }
    return structuredClone(order);
  });
}

const getRoutingSecret = () => {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET_REQUIRED");
  return new TextEncoder().encode(
    process.env.SESSION_SECRET || "routewise-dev-secret-change-me"
  );
};

export async function hasRouteMinimumException(
  db: QueryExecutor,
  routeId: string,
  companyId: string
): Promise<boolean> {
  return Boolean(
    (
      await db.query(
        "SELECT 1 FROM routes r JOIN route_imports i ON i.id=r.import_id WHERE r.id=$1 AND r.company_id=$2 AND jsonb_array_length(COALESCE(i.raw_config->'minimumExceptions','[]'::jsonb))>0",
        [routeId, companyId]
      )
    ).rows.length
  );
}

export interface RoutingProofPayload {
  companyId: string;
  actor: string;
  sourceHash: string;
  importId: string | null;
  config: EngineConfig;
  exceptions: string[];
  routeHashes: string[];
  authorizationId: string | null;
  planner?: {
    originalHash: string;
    authorizedAt: string;
    authorizationDetails: unknown;
    reconfirmedAt: string | null;
    orderChanged: boolean;
    estimatedKm: number;
  };
}

export async function signRoutingProof(payload: RoutingProofPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("criarrota")
    .setAudience("routing-selection")
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(getRoutingSecret());
}

export async function verifyRoutingProof(
  token: unknown,
  session: { companyId?: string; dispatcherId?: string }
): Promise<RoutingProofPayload> {
  try {
    if (!token || typeof token !== "string") throw new Error("Missing");
    const { payload } = await jwtVerify(token, getRoutingSecret(), {
      issuer: "criarrota",
      audience: "routing-selection",
      algorithms: ["HS256"],
    });
    if (payload.companyId !== session.companyId || payload.actor !== session.dispatcherId) {
      throw new Error("Scope");
    }
    return payload as unknown as RoutingProofPayload;
  } catch {
    throw new RoutingError("Seleção inválida ou expirada; gere as rotas novamente.", 409);
  }
}
