/**
 * lib/spreadsheet-parser.ts
 * Parser universal para planilhas de carteira de pedidos (.xlsx / .csv)
 * Funciona tanto no servidor (Node.js) quanto no cliente (browser).
 *
 * Colunas esperadas (case-insensitive, aceita variações pt-BR):
 *  - Cidade / Municipio / Localidade
 *  - Cliente / Destinatário / Razão Social
 *  - Pedido / NF / Nota Fiscal / Número do Pedido
 *  - Cubagem / Volume (m³) / M3
 *  - Peso (kg) / Peso Bruto / Peso
 *  - Caixas / Volumes / Qtd Volumes
 *  - Situação / Status (filtrado para "ROTA FILIAL AGUARDANDO" ou similar)
 */

export interface OrderRow {
  /** Cidade de entrega */
  city: string;
  /** Nome do cliente / destinatário */
  client: string;
  /** Nome do cliente / destinatário (alias compatível com testes E2E) */
  clientName?: string;
  /** Número do pedido / NF */
  orderId: string;
  /** Volume em m³ */
  volumeM3: number;
  /** Peso em kg */
  weightKg: number;
  /** Quantidade de caixas / volumes */
  boxes: number;
  /** Endereço livre (opcional) */
  address?: string;
  /** Sigla UF (opcional) */
  uf?: string;
  /** Descrição de mercadorias / produtos (opcional) */
  products?: string;
  /** Qualquer campo extra da planilha */
  extra: Record<string, string>;
}

// ─── Sinônimos de coluna ────────────────────────────────────────────────────
const COL_CITY     = /cidade|munic[íi]pio|localidade|destino/i;
const COL_CLIENT   = /cliente|destinat[áa]rio|raz[aã]o\s*social|nome/i;
const COL_ORDER    = /pedido|nota\s*fiscal|n[°º]?\s*nf|nf|n[uú]mero/i;
const COL_VOLUME   = /cubagem|volume|m3|m[³]|cbm/i;
const COL_WEIGHT   = /peso/i;
const COL_BOXES    = /caixas|volumes|qtd|quantidade/i;
const COL_ADDRESS  = /endere[cç]o|logradouro|rua/i;
const COL_UF       = /^(uf|sigla\s*uf|estado)$/i;
const COL_PRODUCTS = /produto|mercadoria|itens/i;
const COL_STATUS   = /situa[cç][aã]o|status|situacao/i;

// Situações elegíveis para roteirização
const ELIGIBLE_STATUS = /rota\s*filial|aguardando|pendente|a\s*entregar/i;

function matchCol(headers: string[], pattern: RegExp): number {
  return headers.findIndex(h => pattern.test(h.trim()));
}

function toFloat(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  let s = String(val).trim();
  // Remove unidades comuns de medida
  s = s.replace(/(m[³3]|cbm|kgs?|cxs?|vols?)/gi, '').trim();

  // Tratamento de formato brasileiro vs americano
  if (s.includes('.') && s.includes(',')) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot < lastComma) {
      // Ex: 1.250,50 -> 1250.50
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // Ex: 1,250.50 -> 1250.50
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    // Ex: 3,50 -> 3.50
    s = s.replace(',', '.');
  }

  // Remove caracteres residuais inválidos
  s = s.replace(/[^\d.-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function toStr(val: unknown): string {
  if (val == null) return '';
  return String(val).trim();
}

/**
 * Normaliza linhas de CSV que contenham vírgulas não escapadas em decimais
 */
function normalizeCsvRow(
  row: unknown[],
  headers: string[],
  iVolume: number,
  iWeight: number,
): unknown[] {
  if (row.length === headers.length + 2 && iVolume >= 0 && iWeight >= 0 && iWeight === iVolume + 1) {
    const norm = [...row.slice(0, iVolume)];
    norm.push(`${toStr(row[iVolume])},${toStr(row[iVolume + 1])}`);
    norm.push(`${toStr(row[iVolume + 2])},${toStr(row[iVolume + 3])}`);
    norm.push(...row.slice(iVolume + 4));
    return norm;
  }
  if (row.length === headers.length + 1 && iVolume >= 0) {
    const nextVal = toStr(row[iVolume + 1]);
    if (/^\d+$/.test(nextVal)) {
      const norm = [...row.slice(0, iVolume)];
      norm.push(`${toStr(row[iVolume])},${nextVal}`);
      norm.push(...row.slice(iVolume + 2));
      return norm;
    }
  }
  return row;
}

/**
 * Parseia uma planilha a partir de um ArrayBuffer (xlxs ou csv).
 * Usa SheetJS (xlsx) com preservação estrita de UTF-8 e decodificação automática.
 */
export async function parseSpreadsheet(buffer: ArrayBuffer, filename?: string): Promise<OrderRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = (typeof window !== 'undefined')
    ? (window as unknown as { XLSX: typeof import('xlsx') }).XLSX ?? await import('xlsx')
    : await import('xlsx');

  const uint8 = new Uint8Array(buffer);
  const isZip = uint8.length >= 4 && uint8[0] === 0x50 && uint8[1] === 0x4B;

  let workbook: import('xlsx').WorkBook;
  if (isZip) {
    workbook = XLSX.read(uint8, { type: 'array', cellDates: true });
  } else {
    // Arquivo de texto (.csv, .tsv, etc.): decodifica como UTF-8 estrito
    let text = new TextDecoder("utf-8").decode(uint8);
    // Remove BOM se presente
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }

    // Trata CSVs brasileiros sem aspas onde vírgulas decimais geram colunas extras
    const lines = text.split(/\r?\n/);
    if (lines.length > 1) {
      const headerLine = lines[0];
      if (headerLine.includes(",") && !headerLine.includes(";")) {
        const headerCols = headerLine.split(",");
        const hLower = headerCols.map(c => toStr(c).toLowerCase());
        const iVol = matchCol(hLower, COL_VOLUME);
        const iWt = matchCol(hLower, COL_WEIGHT);

        if (iVol >= 0 && iWt >= 0 && iWt === iVol + 1) {
          const fixedLines = lines.map((l, idx) => {
            if (idx === 0 || !l.trim()) return l;
            const parts = l.split(",");
            if (parts.length === headerCols.length + 2) {
              const before = parts.slice(0, iVol);
              const volCombined = `"${parts[iVol]},${parts[iVol + 1]}"`;
              const wtCombined = `"${parts[iVol + 2]},${parts[iVol + 3]}"`;
              const after = parts.slice(iVol + 4);
              return [...before, volCombined, wtCombined, ...after].join(",");
            }
            return l;
          });
          text = fixedLines.join("\n");
        }
      }
    }

    workbook = XLSX.read(text, { type: 'string', cellDates: true, raw: true });
  }

  // Tenta encontrar a aba mais relevante
  const sheetName = pickSheet(workbook.SheetNames, filename);
  const sheet = workbook.Sheets[sheetName];

  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (raw.length < 2) return [];

  // Linha de cabeçalho
  const headers = (raw[0] as unknown[]).map(h => toStr(h).toLowerCase());

  const iCity     = matchCol(headers, COL_CITY);
  const iClient   = matchCol(headers, COL_CLIENT);
  const iOrder    = matchCol(headers, COL_ORDER);
  const iVolume   = matchCol(headers, COL_VOLUME);
  const iWeight   = matchCol(headers, COL_WEIGHT);
  const iBoxes    = matchCol(headers, COL_BOXES);
  const iAddress  = matchCol(headers, COL_ADDRESS);
  const iUf       = matchCol(headers, COL_UF);
  const iProducts = matchCol(headers, COL_PRODUCTS);
  const iStatus   = matchCol(headers, COL_STATUS);

  const rows: OrderRow[] = [];

  for (let r = 1; r < raw.length; r++) {
    let row = raw[r] as unknown[];
    if (row.every(c => !toStr(c))) continue; // linha vazia

    if (row.length > headers.length) {
      row = normalizeCsvRow(row, headers, iVolume, iWeight);
    }

    // Filtro de situação: só inclui pedidos elegíveis para roteirização
    if (iStatus >= 0) {
      const status = toStr(row[iStatus]);
      if (status && !ELIGIBLE_STATUS.test(status)) continue;
    }

    const city   = iCity   >= 0 ? toStr(row[iCity])   : '';
    const client = iClient >= 0 ? toStr(row[iClient]) : '';
    const order  = iOrder  >= 0 ? toStr(row[iOrder])  : `L${r}`;
    const vol    = iVolume >= 0 ? toFloat(row[iVolume]) : 0;
    const wt     = iWeight >= 0 ? toFloat(row[iWeight]) : 0;
    const bx     = iBoxes  >= 0 ? toFloat(row[iBoxes])  : 0;
    const addr   = iAddress >= 0 ? toStr(row[iAddress]) : undefined;
    const uf     = iUf     >= 0 ? toStr(row[iUf])     : undefined;
    const prod   = iProducts >= 0 ? toStr(row[iProducts]) : undefined;

    if (!city && !client) continue; // linha sem dados úteis

    // Coleta campos extras
    const extra: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (![iCity, iClient, iOrder, iVolume, iWeight, iBoxes, iAddress, iUf, iProducts, iStatus].includes(i)) {
        const v = toStr(row[i]);
        if (v) extra[headers[i]] = v;
      }
    });

    const safeBoxes = bx >= 1 ? Math.round(bx) : 1;
    const safeVol = vol > 0 ? vol : 0.5;
    const safeWt = wt > 0 ? wt : 50;

    rows.push({
      city,
      client,
      clientName: client,
      orderId: order,
      volumeM3: safeVol,
      weightKg: safeWt,
      boxes: safeBoxes,
      address: addr,
      uf,
      products: prod,
      extra,
    });
  }

  return rows;
}

/** Escolhe a aba mais relevante baseado no nome */
function pickSheet(names: string[], filename?: string): string {
  // Prefere abas com nomes relacionados a rota/carteira
  const preferred = /rota|carteira|pedido|entrega/i;
  const match = names.find(n => preferred.test(n));
  return match ?? names[0];
}

/** Agrupa OrderRow por cidade para exibição resumida */
export function summarizeByCity(orders: OrderRow[]): Map<string, {
  orders: OrderRow[];
  totalVolumeM3: number;
  totalWeightKg: number;
  totalBoxes: number;
}> {
  const map = new Map<string, ReturnType<typeof summarizeByCity> extends Map<string, infer V> ? V : never>();
  for (const o of orders) {
    const key = normCity(o.city);
    if (!map.has(key)) map.set(key, { orders: [], totalVolumeM3: 0, totalWeightKg: 0, totalBoxes: 0 });
    const entry = map.get(key)!;
    entry.orders.push(o);
    entry.totalVolumeM3 += o.volumeM3;
    entry.totalWeightKg += o.weightKg;
    entry.totalBoxes += o.boxes;
  }
  return map;
}

export function normCity(city: string): string {
  return city.trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/\s+/g, ' ');
}
