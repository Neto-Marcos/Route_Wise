import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";

const text = (value: unknown) => String(value ?? "").trim();
const header = (value: unknown) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const number = (value: unknown) => {
  const raw = text(value).replace(/[^\d,.-]/g, "");
  if (!raw) return 0;
  const normalized = raw.includes(",") && raw.includes(".")
    ? (raw.lastIndexOf(",") > raw.lastIndexOf(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, ""))
    : raw.replace(",", ".");
  return Number(normalized) || 0;
};
const indexOf = (headers: string[], predicate: (value: string) => boolean) => headers.findIndex(predicate);
const monthKey = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? `${parsed.y}-${String(parsed.m).padStart(2, "0")}` : "";
  }
  const match = text(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}` : "";
};

export async function GET() {
  const session = await getSession("dispatcher");
  if (!session) return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });

  try {
    const result = await query<{ filename: string; file_data: Buffer | null }>(
      "SELECT filename,file_data FROM routing_workbooks WHERE company_id=$1",
      [session.companyId],
    );
    const workbook = result.rows[0];
    if (!workbook?.file_data) return NextResponse.json({ error: "Nenhuma planilha ativa. Envie a carteira no Roteirizador para ver a visão comercial." }, { status: 404 });
    if (/\.(not|edi|txt)$/i.test(workbook.filename)) return NextResponse.json({ error: "A visão comercial exige a planilha XLS/XLSX da carteira." }, { status: 422 });

    const xlsx = XLSX.read(workbook.file_data, { type: "buffer", cellDates: true });
    const sheet = xlsx.Sheets[xlsx.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    const headerRow = rows.findIndex((row) => row.some((cell) => /pedido\s*sabium|numero\s*da\s*nf/i.test(header(cell))));
    if (headerRow < 0) return NextResponse.json({ error: "Não encontrei o cabeçalho da carteira nesta planilha." }, { status: 422 });

    const headers = (rows[headerRow] || []).map(header);
    const orderCol = indexOf(headers, (h) => /pedido\s*sabium|numero\s*pedido|nro\s*pedido/.test(h));
    const inclusionCol = indexOf(headers, (h) => h === "inclusao" || h.includes("data inclusao"));
    const freightCol = indexOf(headers, (h) => h === "tipo frete" || h === "tipo_frete");
    const valueCol = indexOf(headers, (h) => h === "total item" || h === "total_item");
    const qtyCol = indexOf(headers, (h) => h === "quantidade" || h === "qtd");
    const balanceCol = indexOf(headers, (h) => h.includes("saldo disponivel 281"));
    const billedAtCol = indexOf(headers, (h) => h.includes("data/hora faturamento"));
    const invoiceCol = indexOf(headers, (h) => h === "numero da nf" || h === "numero nf");
    const productCol = indexOf(headers, (h) => h === "produto");
    const departmentCol = indexOf(headers, (h) => h === "departamento");

    // Um Pedido Sabium pode ter várias linhas de produto. Cada linha pode ser
    // faturada em momentos distintos, então os valores financeiros precisam ser
    // separados por linha antes de consolidar o pedido.
    type Order = { freight: "CIF" | "FOB" | "OUTRO"; value: number; billedValue: number; pendingValue: number; readyValue: number; blockedValue: number; lines: number };
    const orders = new Map<string, Order>();
    const blockedProducts = new Map<string, { shortage: number; value: number; department: string }>();
    let itemLines = 0, inStockLines = 0, requestedQty = 0, availableQty = 0;
    const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const monthlyRows = rows.slice(headerRow + 1).filter((row) => monthKey(row[inclusionCol]) === currentMonth);
    for (const row of monthlyRows) {
      const orderId = text(row[orderCol]);
      if (!orderId) continue;
      const freightRaw = text(row[freightCol]).toUpperCase();
      const freight = freightRaw.startsWith("CIF") ? "CIF" : freightRaw.startsWith("FOB") ? "FOB" : "OUTRO";
      const value = number(row[valueCol]);
      const qty = Math.max(0, number(row[qtyCol]));
      const balance = Math.max(0, number(row[balanceCol]));
      const billed = Boolean(text(row[billedAtCol])) || number(row[invoiceCol]) > 0;
      const lineInStock = balance >= qty;
      itemLines += 1; requestedQty += qty; availableQty += Math.min(qty, balance); if (lineInStock) inStockLines += 1;
      const current = orders.get(orderId) || { freight, value: 0, billedValue: 0, pendingValue: 0, readyValue: 0, blockedValue: 0, lines: 0 };
      current.value += value;
      if (billed) {
        current.billedValue += value;
      } else {
        current.pendingValue += value;
        if (lineInStock) current.readyValue += value;
        else current.blockedValue += value;
      }
      current.lines += 1;
      if (current.freight === "OUTRO" && freight !== "OUTRO") current.freight = freight;
      orders.set(orderId, current);
      if (!billed && !lineInStock) {
        const product = text(row[productCol]) || "Produto sem descrição";
        const blocked = blockedProducts.get(product) || { shortage: 0, value: 0, department: text(row[departmentCol]) || "Sem departamento" };
        blocked.shortage += Math.max(0, qty - balance); blocked.value += value;
        blockedProducts.set(product, blocked);
      }
    }

    const blank = () => ({ orders: 0, value: 0 });
    const freight = { CIF: blank(), FOB: blank(), OUTRO: blank() };
    const invoiced = blank(), pending = blank(), ready = blank(), blocked = blank();
    for (const order of orders.values()) {
      freight[order.freight].orders += 1; freight[order.freight].value += order.value;
      if (order.billedValue > 0) { invoiced.orders += 1; invoiced.value += order.billedValue; }
      if (order.pendingValue > 0) { pending.orders += 1; pending.value += order.pendingValue; }
      if (order.readyValue > 0) { ready.orders += 1; ready.value += order.readyValue; }
      if (order.blockedValue > 0) { blocked.orders += 1; blocked.value += order.blockedValue; }
    }
    const round = (value: number) => Math.round(value * 100) / 100;
    const normalize = (entry: { orders: number; value: number }) => ({ ...entry, value: round(entry.value) });
    return NextResponse.json({
      filename: workbook.filename,
      period: new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(`${currentMonth}-01T12:00:00`)),
      total: { orders: orders.size, value: round([...orders.values()].reduce((sum, order) => sum + order.value, 0)), itemLines, requestedQty: round(requestedQty), availableQty: round(availableQty) },
      freight: { CIF: normalize(freight.CIF), FOB: normalize(freight.FOB), OUTRO: normalize(freight.OUTRO) },
      invoiced: normalize(invoiced), pending: normalize(pending), ready: normalize(ready), blocked: normalize(blocked),
      stock: { inStockLines, totalLines: itemLines, coveragePct: itemLines ? Math.round(inStockLines / itemLines * 100) : 0 },
      topBlockedProducts: [...blockedProducts.entries()].map(([product, data]) => ({ product, ...data, value: round(data.value) })).sort((a, b) => b.value - a.value).slice(0, 8),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Não foi possível calcular a carteira comercial." }, { status: 500 });
  }
}
