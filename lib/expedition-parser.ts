import * as XLSX from "xlsx";
import { createHash } from "node:crypto";

const VALID_UFS = new Set(
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ")
);

export const cleanString = (val: unknown): string => String(val ?? "").trim();

export const normalizeHeader = (val: unknown): string =>
  cleanString(val)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ");

export const normalizeId = (val: unknown): string | null =>
  cleanString(val).replace(/\.0+$/, "") || null;

function normalizeNumericString(val: unknown): string | null {
  if (typeof val === "number") return Number.isFinite(val) ? String(val) : null;
  if (typeof val !== "string") return null;
  let str = val.trim().replace(/^R\$\s*/, "").replace(/\s/g, "");
  if (!str) return null;
  if (str.includes(",")) {
    if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(str)) return null;
    str = str.replace(/\./g, "").replace(",", ".");
  } else if (/^[+-]?\d{1,3}(?:\.\d{3})+$/.test(str)) {
    str = str.replace(/\./g, "");
  }
  return /^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(str) ? str : null;
}

function parseNumber(val: unknown): number | null {
  const norm = normalizeNumericString(val);
  if (norm === null) return null;
  const num = Number(norm);
  return Number.isFinite(num) ? num : null;
}

function parseCents(val: unknown): number | null {
  const norm = normalizeNumericString(val);
  if (norm === null) return null;
  const match = norm.match(/^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) return null;
  const exp = Number(match[4] || 0);
  if (Math.abs(exp) > 100) return null;
  const frac = match[3] || "";
  let digits = match[2] + frac;
  const shift = 2 - (frac.length - exp);
  let cents: bigint;
  if (shift >= 0) {
    cents = BigInt(digits + "0".repeat(shift));
  } else {
    digits = digits.padStart(-shift + 1, "0");
    const cut = digits.length + shift;
    cents = BigInt(digits.slice(0, cut) || "0") + (digits[cut] >= "5" ? BigInt(1) : BigInt(0));
  }
  if (match[1] === "-") cents = -cents;
  const num = Number(cents);
  return Number.isSafeInteger(num) ? num : null;
}

const COLUMN_ALIASES = {
  order: ["PEDIDO SABIUM", "NUMERO PEDIDO", "PEDIDO"],
  branch: ["FILIAL"],
  city: ["CIDADE", "MUNICIPIO"],
  uf: ["UF", "ESTADO"],
  freight: ["TIPO FRETE"],
  value: ["TOTAL ITEM"],
  quantity: ["QUANTIDADE"],
  stock: ["SALDO DISPONIVEL 281"],
  weight: ["PESO BRUTO TOTAL"],
  volume: ["VOLUME CUBICO"],
  clientMap: ["MAPA DE CARGA CLIENTE"],
  storeMap: ["MAPA DE CARGA LOJA"],
  status: ["SITUACAO PRODUTO - PEDIDO VENDA"],
  billingDate: ["DATA/HORA FATURAMENTO"],
  invoice: ["NUMERO DA NF"],
  invoiceBranch: ["FILIAL A FATURAR - PRODUTO"],
  totalNF: ["TOTAL NF"],
} as const;

type ColumnKey = keyof typeof COLUMN_ALIASES;

export type FreightType = "CIF" | "FOB" | "UNKNOWN";
export type FreightIssue = "INVALID" | "NOT_INFORMED" | null;
export type ProductStatus = "ACTIVE" | "INACTIVE" | "DISCONTINUED" | "UNKNOWN";
export type BillingDateState = "UNKNOWN" | "BLANK" | "PRESENT";

export interface ExpeditionItem {
  row: number;
  sourceRowFingerprint: string;
  orderId: string | null;
  uf: string | null;
  city: string | null;
  cityRaw: string;
  freight: FreightType;
  freightIssue: FreightIssue;
  amountCents: number | null;
  branch: string | null;
  productStatus: ProductStatus;
  mapped: boolean | null;
  stock: number | null;
  quantity: number | null;
  weight: number | null;
  volume: number | null;
  operationalStatus: string;
  billingDateState: BillingDateState;
  invoiceId: string | null;
  invoiceAmountCents: number | null;
  invoiceIdentityIncomplete: boolean;
}

export interface ExpeditionParseOptions {
  validatedProductStatus?: {
    header: string;
    evidenceReference: string;
  };
}

export interface ExpeditionParsedWorkbook {
  items: ExpeditionItem[];
  sheet: string;
  productStatusValidated: boolean;
  period?: {
    month: string;
    from: string;
    to: string;
    column: string;
  };
}

function parseMapFlag(val: unknown): boolean | null {
  if (!cleanString(val) || cleanString(val) === "0") return false;
  const num = parseNumber(val);
  return (num !== null && Number.isInteger(num) && num > 0) || null;
}

export function parseExpeditionRows(
  rows: unknown[][],
  sheet = "Planilha",
  options: ExpeditionParseOptions = {}
): ExpeditionParsedWorkbook {
  const headerIdx = rows.findIndex((row) =>
    row.some((cell) => (COLUMN_ALIASES.order as readonly string[]).includes(normalizeHeader(cell)))
  );
  if (headerIdx < 0) throw new Error("DASHBOARD_HEADER_NOT_FOUND");
  const headers = rows[headerIdx].map(normalizeHeader);
  const cols = {} as Record<ColumnKey, number>;
  for (const key of Object.keys(COLUMN_ALIASES) as ColumnKey[]) {
    const matches = headers.flatMap((h, i) =>
      (COLUMN_ALIASES[key] as readonly string[]).includes(h) ? [i] : []
    );
    if (matches.length > 1) throw new Error("DASHBOARD_AMBIGUOUS_COLUMN:" + key);
    cols[key] = matches[0] ?? -1;
  }
  if (cols.order < 0) throw new Error("DASHBOARD_ORDER_COLUMN_REQUIRED");

  const vps = options.validatedProductStatus;
  const psHeader = vps?.evidenceReference.trim() ? normalizeHeader(vps.header) : null;
  if (psHeader === normalizeHeader("Situação Produto - Pedido Venda")) {
    throw new Error("DASHBOARD_OPERATIONAL_STATUS_IS_NOT_PRODUCT_STATUS");
  }
  const psMatches = psHeader ? headers.flatMap((h, i) => (h === psHeader ? [i] : [])) : [];
  if (psMatches.length > 1) throw new Error("DASHBOARD_AMBIGUOUS_PRODUCT_STATUS");
  const psCol = psMatches[0] ?? -1;

  const items: ExpeditionItem[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.some((cell) => cleanString(cell))) continue;
    const cell = (k: ColumnKey) => (cols[k] < 0 ? undefined : row[cols[k]]);
    const rawUf = normalizeHeader(cell("uf"));
    let uf = VALID_UFS.has(rawUf) ? rawUf : null;
    let city = normalizeHeader(cell("city")) || null;
    const suffixMatch = city?.match(/(?:\s+-\s*|\/)([A-Z]{2})$/);
    if (suffixMatch && VALID_UFS.has(suffixMatch[1])) {
      if (rawUf && rawUf !== suffixMatch[1]) {
        city = null;
        uf = VALID_UFS.has(rawUf) ? rawUf : null;
      } else {
        uf = suffixMatch[1];
        city = city!.replace(/(?:\s+-\s*|\/)[A-Z]{2}$/, "").trim() || null;
      }
    }
    const rawFreight = normalizeHeader(cell("freight"));
    const clientMap = cols.clientMap < 0 ? null : parseMapFlag(cell("clientMap"));
    const storeMap = cols.storeMap < 0 ? null : parseMapFlag(cell("storeMap"));
    const mapped =
      clientMap === true || storeMap === true
        ? true
        : clientMap === false && storeMap === false
        ? false
        : null;
    const inv = normalizeId(cell("invoice"));
    const invBranch = normalizeId(cell("invoiceBranch"));
    const psRaw = psCol >= 0 ? normalizeHeader(row[psCol]) : "";

    items.push({
      row: i + 1,
      sourceRowFingerprint: createHash("sha256").update(JSON.stringify(row)).digest("hex"),
      orderId: normalizeId(cell("order")),
      uf,
      city,
      cityRaw: cleanString(cell("city")),
      freight: rawFreight === "CIF" || rawFreight === "FOB" ? rawFreight : "UNKNOWN",
      freightIssue:
        rawFreight === "CIF" || rawFreight === "FOB"
          ? null
          : rawFreight
          ? "INVALID"
          : "NOT_INFORMED",
      amountCents: parseCents(cell("value")),
      branch: normalizeId(cell("branch")),
      productStatus:
        psRaw === "ATIVO"
          ? "ACTIVE"
          : psRaw === "INATIVO"
          ? "INACTIVE"
          : psRaw === "FORA DE LINHA"
          ? "DISCONTINUED"
          : "UNKNOWN",
      mapped,
      stock: parseNumber(cell("stock")),
      quantity: parseNumber(cell("quantity")),
      weight: parseNumber(cell("weight")),
      volume: parseNumber(cell("volume")),
      operationalStatus: cleanString(cell("status")),
      billingDateState:
        cols.billingDate < 0
          ? "UNKNOWN"
          : cleanString(cell("billingDate")) === ""
          ? "BLANK"
          : "PRESENT",
      invoiceId: inv && inv !== "0" && invBranch ? `${invBranch}|${inv}` : null,
      invoiceAmountCents: parseCents(cell("totalNF")),
      invoiceIdentityIncomplete: Boolean(inv && inv !== "0" && !invBranch),
    });
  }
  return { items, sheet, productStatusValidated: psCol >= 0 };
}

export function parseExpeditionWorkbook(
  data: Uint8Array | Buffer | ArrayBuffer,
  filename: string,
  options: ExpeditionParseOptions = {}
): ExpeditionParsedWorkbook {
  if (!/\.(xls|xlsx|csv|tsv)$/i.test(filename)) throw new Error("DASHBOARD_UNSUPPORTED_SOURCE");
  const wb = XLSX.read(data, { type: "array", cellDates: false, raw: true });
  const candidates = wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: "" }),
  })).filter((s) =>
    s.rows.some((row) =>
      row.some((cell) => (COLUMN_ALIASES.order as readonly string[]).includes(normalizeHeader(cell)))
    )
  );
  if (candidates.length !== 1) {
    throw new Error(candidates.length ? "DASHBOARD_AMBIGUOUS_SHEET" : "DASHBOARD_HEADER_NOT_FOUND");
  }
  return parseExpeditionRows(candidates[0].rows, candidates[0].name, options);
}
