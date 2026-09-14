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

// ─── Sinônimos de coluna expandidos ──────────────────────────────────────────
const COL_CITY     = /cidade|munic[íi]pio|localidade|destino|praca|pra[çc]a|mun\b/i;
const COL_CLIENT   = /cliente|destinat[áa]rio|raz[aã]o\s*social|nome\s*(do\s*cliente)?|dest\b/i;
const COL_ORDER    = /pedido|nota\s*fiscal|n[°º]?\s*nf|nf|n[uú]mero|chave|doc/i;
const COL_VOLUME   = /cubagem|volume|m3|m[³]|cbm|m\^3/i;
const COL_WEIGHT   = /peso|peso\s*bruto|kg\b/i;
const COL_BOXES    = /caixas|volumes|qtd|quantidade|pecas|pe[çc]as|volume\s*total/i;
const COL_ADDRESS  = /endere[cç]o|logradouro|rua|bairro/i;
const COL_UF       = /^(uf|sigla\s*uf|estado|sigla)$/i;
const COL_PRODUCTS = /produto|mercadoria|itens|item|descri[cç][aã]o/i;
const COL_STATUS   = /situa[cç][aã]o|status|situacao|fase/i;

// Situações que devem ser EXCLUÍDAS se houver coluna de status
const INELIGIBLE_STATUS = /cancelad[ao]|entregu?e?|devolvid[ao]|estornad[ao]/i;

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
 * Tenta parsear os dados de uma única planilha/aba (sheet)
 */
function parseSheetData(raw: unknown[][]): OrderRow[] {
  if (!raw || raw.length < 2) return [];

  // Encontra a linha de cabeçalho (pode não ser a linha 0 se houver títulos no topo)
  let headerRowIdx = -1;
  let headers: string[] = [];
  let iCity = -1;
  let iClient = -1;
  let iOrder = -1;

  for (let r = 0; r < Math.min(raw.length, 12); r++) {
    const candidateRow = (raw[r] as unknown[] || []).map(h => toStr(h).toLowerCase());
    const cCity = matchCol(candidateRow, COL_CITY);
    const cClient = matchCol(candidateRow, COL_CLIENT);
    const cOrder = matchCol(candidateRow, COL_ORDER);

    // Consideramos cabeçalho se encontrar ao menos (cidade E cliente) ou (cidade E pedido) ou (cliente E pedido)
    const matches = [cCity >= 0, cClient >= 0, cOrder >= 0].filter(Boolean).length;
    if (matches >= 2 || (cCity >= 0 && candidateRow.length >= 3)) {
      headerRowIdx = r;
      headers = candidateRow;
      iCity = cCity;
      iClient = cClient;
      iOrder = cOrder;
      break;
    }
  }

  // Fallback: usa primeira linha não-vazia como cabeçalho se não encontrou cabeçalho óbvio
  if (headerRowIdx === -1) {
    for (let r = 0; r < Math.min(raw.length, 5); r++) {
      const candidateRow = (raw[r] as unknown[] || []).map(h => toStr(h).toLowerCase());
      if (candidateRow.filter(Boolean).length >= 2) {
        headerRowIdx = r;
        headers = candidateRow;
        iCity = matchCol(headers, COL_CITY);
        iClient = matchCol(headers, COL_CLIENT);
        iOrder = matchCol(headers, COL_ORDER);
        break;
      }
    }
  }

  if (headerRowIdx === -1) return [];

  const iVolume   = matchCol(headers, COL_VOLUME);
  const iWeight   = matchCol(headers, COL_WEIGHT);
  const iBoxes    = matchCol(headers, COL_BOXES);
  const iAddress  = matchCol(headers, COL_ADDRESS);
  const iUf       = matchCol(headers, COL_UF);
  const iProducts = matchCol(headers, COL_PRODUCTS);
  const iStatus   = matchCol(headers, COL_STATUS);

  const rows: OrderRow[] = [];

  for (let r = headerRowIdx + 1; r < raw.length; r++) {
    let row = raw[r] as unknown[];
    if (!row || row.every(c => !toStr(c))) continue; // linha vazia

    if (row.length > headers.length) {
      row = normalizeCsvRow(row, headers, iVolume, iWeight);
    }

    // Filtro de status não-bloqueante: só exclui se for explicitamente cancelado ou entregue
    if (iStatus >= 0) {
      const status = toStr(row[iStatus]);
      if (status && INELIGIBLE_STATUS.test(status)) continue;
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

    // Precisa ter pelo menos algum dado mínimo (cidade OU cliente OU pedido)
    if (!city && !client && (!order || order.startsWith("L"))) continue;

    // Se não tiver cidade, mas tiver UF ou endereço ou cliente, usa cliente como ponto de parada
    const safeCity = city || (uf ? `Destino ${uf}` : (client || "Cidade a definir"));

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
      city: safeCity,
      client: client || "Cliente Geral",
      clientName: client || "Cliente Geral",
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

/**
 * Parseia uma planilha a partir de um ArrayBuffer (xlxs ou csv).
 * Usa SheetJS (xlsx) com preservação estrita de UTF-8 e decodificação automática.
 * Escaneia a melhor aba ou faz fallback para as demais abas se vazia.
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

  // Ordena as abas preferindo abas com nomes de carteira/rota
  const preferredRegex = /rota|carteira|pedido|entrega|nf|dados/i;
  const sortedSheetNames = [...workbook.SheetNames].sort((a, b) => {
    const aPref = preferredRegex.test(a) ? 1 : 0;
    const bPref = preferredRegex.test(b) ? 1 : 0;
    return bPref - aPref;
  });

  // Tenta extrair pedidos da aba preferida, e se der vazio, tenta as outras
  for (const name of sortedSheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const orders = parseSheetData(raw);
    if (orders.length > 0) {
      return orders;
    }
  }

  return [];
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
