import { NextResponse, NextRequest } from "next/server";
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

const dateToMonthKey = (value: unknown): string => {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? `${parsed.y}-${String(parsed.m).padStart(2, "0")}` : "";
  }
  const str = text(value);
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}`;
  const isoMatch = str.match(/^(\d{4})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
  return "";
};

const formatDateStr = (value: unknown): string => {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}/${value.getFullYear()}`;
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? `${String(parsed.d).padStart(2, "0")}/${String(parsed.m).padStart(2, "0")}/${parsed.y}` : "";
  }
  return text(value);
};

export interface InvoicedNoteSummary {
  invoiceNumber: string;
  orderId: string;
  issueDate: string;
  client: string;
  city: string;
  uf: string;
  freightType: "CIF" | "FOB" | "OUTRO";
  totalValue: number;
  weightKg: number;
  itemsCount: number;
}

export async function GET(request: NextRequest) {
  const session = await getSession("dispatcher");
  if (!session) return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });

  try {
    const result = await query<{ filename: string; file_data: Buffer | null }>(
      "SELECT filename,file_data FROM routing_workbooks WHERE company_id=$1",
      [session.companyId],
    );
    const workbook = result.rows[0];
    if (!workbook?.file_data) {
      return NextResponse.json(
        { error: "Nenhuma planilha ativa. Envie a carteira no Roteirizador para ver a visão comercial." },
        { status: 404 },
      );
    }
    if (/\.(not|edi|txt)$/i.test(workbook.filename)) {
      return NextResponse.json({ error: "A visão comercial exige a planilha XLS/XLSX da carteira." }, { status: 422 });
    }

    const xlsx = XLSX.read(workbook.file_data, { type: "buffer", cellDates: true });
    const sheet = xlsx.Sheets[xlsx.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    const headerRow = rows.findIndex((row) =>
      row.some((cell) => /pedido\s*sabium|numero\s*da\s*nf/i.test(header(cell))),
    );
    if (headerRow < 0) {
      return NextResponse.json({ error: "Não encontrei o cabeçalho da carteira nesta planilha." }, { status: 422 });
    }

    const headers = (rows[headerRow] || []).map(header);
    const orderCol = indexOf(headers, (h) => /pedido\s*sabium|numero\s*pedido|nro\s*pedido/.test(h));
    const inclusionCol = indexOf(headers, (h) => h === "inclusao" || h.includes("data inclusao"));
    const freightCol = indexOf(headers, (h) => h === "tipo frete" || h === "tipo_frete");
    const valueCol = indexOf(headers, (h) => h === "total item" || h === "total_item");
    const totalNfCol = indexOf(headers, (h) => h === "total nf" || h === "valor total nf" || h === "total nota");
    const qtyCol = indexOf(headers, (h) => h === "quantidade" || h === "qtd");
    const balanceCol = indexOf(headers, (h) => h.includes("saldo disponivel 281"));
    const billedAtCol = indexOf(headers, (h) => h.includes("data/hora faturamento") || h.includes("faturamento"));
    const issueDateCol = indexOf(headers, (h) => h.includes("data emissao nf") || h.includes("emissao nf"));
    const invoiceCol = indexOf(headers, (h) => h === "numero da nf" || h === "numero nf" || h === "nf");
    const clientCol = indexOf(headers, (h) => h === "nome" || h === "cliente" || h === "destinatario");
    const cityCol = indexOf(headers, (h) => h === "cidade" || h === "municipio");
    const ufCol = indexOf(headers, (h) => h === "uf" || h === "estado");
    const weightCol = indexOf(headers, (h) => h.includes("peso bruto total") || h.includes("peso bruto") || h === "peso");
    const productCol = indexOf(headers, (h) => h === "produto");
    const departmentCol = indexOf(headers, (h) => h === "departamento");

    const dataRows = rows.slice(headerRow + 1);

    // Mapear todos os meses disponíveis na planilha
    const monthsSet = new Set<string>();
    for (const row of dataRows) {
      const issueM = issueDateCol >= 0 ? dateToMonthKey(row[issueDateCol]) : "";
      const billedM = billedAtCol >= 0 ? dateToMonthKey(row[billedAtCol]) : "";
      const incM = inclusionCol >= 0 ? dateToMonthKey(row[inclusionCol]) : "";
      if (issueM) monthsSet.add(issueM);
      if (billedM) monthsSet.add(billedM);
      if (incM) monthsSet.add(incM);
    }
    const availableMonths = Array.from(monthsSet).sort().reverse();

    // Determina o mês selecionado via query param (?month=YYYY-MM) ou fallback inteligente
    const { searchParams } = new URL(request.url);
    const requestedMonth = searchParams.get("month");
    const nowMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const targetMonth = requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth)
      ? requestedMonth
      : (availableMonths.includes(nowMonth) ? nowMonth : (availableMonths[0] || nowMonth));

    type Order = {
      freight: "CIF" | "FOB" | "OUTRO";
      value: number;
      billedValue: number;
      pendingValue: number;
      readyValue: number;
      blockedValue: number;
      lines: number;
    };

    const orders = new Map<string, Order>();
    const blockedProducts = new Map<string, { shortage: number; value: number; department: string }>();
    const invoicedNotesMap = new Map<string, InvoicedNoteSummary>();

    let itemLines = 0;
    let inStockLines = 0;
    let requestedQty = 0;
    let availableQty = 0;

    for (const row of dataRows) {
      const orderId = text(row[orderCol]);
      if (!orderId) continue;

      const incMonth = inclusionCol >= 0 ? dateToMonthKey(row[inclusionCol]) : "";
      const issueMonth = issueDateCol >= 0 ? dateToMonthKey(row[issueDateCol]) : "";
      const billedMonth = billedAtCol >= 0 ? dateToMonthKey(row[billedAtCol]) : "";

      // Verifica se a linha foi faturada
      const invoiceNumber = invoiceCol >= 0 ? text(row[invoiceCol]).replace(/\.0+$/, "") : "";
      const hasInvoiceNumber = Boolean(invoiceNumber && invoiceNumber !== "0");
      const hasBilledDate = Boolean(text(row[billedAtCol]));
      const isBilled = hasInvoiceNumber || hasBilledDate;

      // O mês de referência da nota faturada é a data de emissão ou data de faturamento;
      // Para pedidos em carteira/pendentes, o mês de referência é a inclusão.
      const rowEffectiveMonth = isBilled
        ? (issueMonth || billedMonth || incMonth)
        : incMonth;

      // Se a linha não pertencer ao mês analisado, ignora
      if (rowEffectiveMonth !== targetMonth) continue;

      const freightRaw = text(row[freightCol]).toUpperCase();
      const freight: "CIF" | "FOB" | "OUTRO" = freightRaw.startsWith("CIF")
        ? "CIF"
        : freightRaw.startsWith("FOB")
          ? "FOB"
          : "OUTRO";

      const value = number(row[valueCol]);
      const qty = Math.max(0, number(row[qtyCol]));
      const balance = Math.max(0, number(row[balanceCol]));
      const lineInStock = balance >= qty;

      itemLines += 1;
      requestedQty += qty;
      availableQty += Math.min(qty, balance);
      if (lineInStock) inStockLines += 1;

      const current = orders.get(orderId) || {
        freight,
        value: 0,
        billedValue: 0,
        pendingValue: 0,
        readyValue: 0,
        blockedValue: 0,
        lines: 0,
      };

      current.value += value;
      if (isBilled) {
        current.billedValue += value;
      } else {
        current.pendingValue += value;
        if (lineInStock) current.readyValue += value;
        else current.blockedValue += value;
      }
      current.lines += 1;
      if (current.freight === "OUTRO" && freight !== "OUTRO") current.freight = freight;
      orders.set(orderId, current);

      // Agregação de Notas Fiscais Faturadas
      if (isBilled) {
        const nfKey = hasInvoiceNumber ? `NF_${invoiceNumber}` : `PED_${orderId}`;
        const issueDate = formatDateStr(row[issueDateCol] || row[billedAtCol] || row[inclusionCol]);
        const clientName = text(row[clientCol]) || "Cliente";
        const city = text(row[cityCol]);
        const uf = text(row[ufCol]).toUpperCase();
        const weight = number(row[weightCol]);
        const totalNfVal = totalNfCol >= 0 ? number(row[totalNfCol]) : 0;

        if (!invoicedNotesMap.has(nfKey)) {
          invoicedNotesMap.set(nfKey, {
            invoiceNumber: hasInvoiceNumber ? invoiceNumber : `Ped. ${orderId}`,
            orderId,
            issueDate,
            client: clientName,
            city,
            uf,
            freightType: freight,
            totalValue: totalNfVal > 0 ? totalNfVal : value,
            weightKg: weight,
            itemsCount: 1,
          });
        } else {
          const existingNf = invoicedNotesMap.get(nfKey)!;
          // Se não usava total NF explicitamente, acumula os totais dos itens
          if (totalNfVal <= 0) {
            existingNf.totalValue = Math.round((existingNf.totalValue + value) * 100) / 100;
          }
          existingNf.itemsCount += 1;
          if (!existingNf.weightKg && weight > 0) existingNf.weightKg = weight;
        }
      }

      if (!isBilled && !lineInStock) {
        const product = text(row[productCol]) || "Produto sem descrição";
        const blocked = blockedProducts.get(product) || {
          shortage: 0,
          value: 0,
          department: text(row[departmentCol]) || "Sem departamento",
        };
        blocked.shortage += Math.max(0, qty - balance);
        blocked.value += value;
        blockedProducts.set(product, blocked);
      }
    }

    const blank = () => ({ orders: 0, value: 0 });
    const freight = { CIF: blank(), FOB: blank(), OUTRO: blank() };
    const invoiced = blank(), pending = blank(), ready = blank(), blocked = blank();

    for (const order of orders.values()) {
      freight[order.freight].orders += 1;
      freight[order.freight].value += order.value;
      if (order.billedValue > 0) { invoiced.orders += 1; invoiced.value += order.billedValue; }
      if (order.pendingValue > 0) { pending.orders += 1; pending.value += order.pendingValue; }
      if (order.readyValue > 0) { ready.orders += 1; ready.value += order.readyValue; }
      if (order.blockedValue > 0) { blocked.orders += 1; blocked.value += order.blockedValue; }
    }

    const round = (val: number) => Math.round(val * 100) / 100;
    const normalize = (entry: { orders: number; value: number }) => ({ ...entry, value: round(entry.value) });

    const invoicedNotes = Array.from(invoicedNotesMap.values()).sort((a, b) => {
      // Ordena decrescente por valor
      return b.totalValue - a.totalValue;
    });

    const totalInvoicedNfValue = round(invoicedNotes.reduce((sum, n) => sum + n.totalValue, 0));
    const totalInvoicedWeight = round(invoicedNotes.reduce((sum, n) => sum + n.weightKg, 0));

    // Se as NFs tiverem Total NF consolidado, ajustamos o invoiced.value para refletir com exatidão contábil
    if (totalInvoicedNfValue > 0 && Math.abs(totalInvoicedNfValue - invoiced.value) > 1) {
      invoiced.value = totalInvoicedNfValue;
    }

    const periodDate = new Date(`${targetMonth}-01T12:00:00`);
    const periodLabel = !Number.isNaN(periodDate.getTime())
      ? new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(periodDate)
      : targetMonth;

    return NextResponse.json({
      filename: workbook.filename,
      period: periodLabel,
      selectedMonth: targetMonth,
      availableMonths,
      total: {
        orders: orders.size,
        value: round([...orders.values()].reduce((sum, order) => sum + order.value, 0)),
        itemLines,
        requestedQty: round(requestedQty),
        availableQty: round(availableQty),
      },
      freight: {
        CIF: normalize(freight.CIF),
        FOB: normalize(freight.FOB),
        OUTRO: normalize(freight.OUTRO),
      },
      invoiced: normalize(invoiced),
      pending: normalize(pending),
      ready: normalize(ready),
      blocked: normalize(blocked),
      stock: {
        inStockLines,
        totalLines: itemLines,
        coveragePct: itemLines ? Math.round((inStockLines / itemLines) * 100) : 0,
      },
      topBlockedProducts: [...blockedProducts.entries()]
        .map(([product, data]) => ({ product, ...data, value: round(data.value) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
      invoicedNotesSummary: {
        count: invoicedNotes.length,
        totalValue: totalInvoicedNfValue || invoiced.value,
        totalWeightKg: totalInvoicedWeight,
      },
      invoicedNotes,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Não foi possível calcular a carteira comercial." },
      { status: 500 },
    );
  }
}
