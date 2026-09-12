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
  /** Qualquer campo extra da planilha */
  extra: Record<string, string>;
}

// ─── Sinônimos de coluna ────────────────────────────────────────────────────
const COL_CITY     = /cidade|munic[íi]pio|localidade|destino/i;
const COL_CLIENT   = /cliente|destinat[áa]rio|raz[aã]o\s*social|nome/i;
const COL_ORDER    = /pedido|nota\s*fiscal|n[°º]?\s*nf|nf|n[uú]mero/i;
const COL_VOLUME   = /cubagem|volume|m3|m[³]/i;
const COL_WEIGHT   = /peso/i;
const COL_BOXES    = /caixas|volumes|qtd|quantidade/i;
const COL_ADDRESS  = /endere[cç]o|logradouro|rua/i;
const COL_STATUS   = /situa[cç][aã]o|status|situacao/i;

// Situações elegíveis para roteirização
const ELIGIBLE_STATUS = /rota\s*filial|aguardando|pendente|a\s*entregar/i;

function matchCol(headers: string[], pattern: RegExp): number {
  return headers.findIndex(h => pattern.test(h.trim()));
}

function toFloat(val: unknown): number {
  if (val == null) return 0;
  const s = String(val).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function toStr(val: unknown): string {
  if (val == null) return '';
  return String(val).trim();
}

/**
 * Parseia uma planilha a partir de um ArrayBuffer (xlxs ou csv).
 * Usa SheetJS (xlsx) que suporta ambos os formatos.
 */
export async function parseSpreadsheet(buffer: ArrayBuffer, filename?: string): Promise<OrderRow[]> {
  // Importação dinâmica para evitar bundle desnecessário no servidor
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = (typeof window !== 'undefined')
    ? (window as unknown as { XLSX: typeof import('xlsx') }).XLSX ?? await import('xlsx')
    : await import('xlsx');

  const uint8 = new Uint8Array(buffer);
  const workbook = XLSX.read(uint8, { type: 'array', cellDates: true });

  // Tenta encontrar a aba mais relevante
  const sheetName = pickSheet(workbook.SheetNames, filename);
  const sheet = workbook.Sheets[sheetName];

  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (raw.length < 2) return [];

  // Linha de cabeçalho
  const headers = (raw[0] as unknown[]).map(h => toStr(h).toLowerCase());

  const iCity    = matchCol(headers, COL_CITY);
  const iClient  = matchCol(headers, COL_CLIENT);
  const iOrder   = matchCol(headers, COL_ORDER);
  const iVolume  = matchCol(headers, COL_VOLUME);
  const iWeight  = matchCol(headers, COL_WEIGHT);
  const iBoxes   = matchCol(headers, COL_BOXES);
  const iAddress = matchCol(headers, COL_ADDRESS);
  const iStatus  = matchCol(headers, COL_STATUS);

  const rows: OrderRow[] = [];

  for (let r = 1; r < raw.length; r++) {
    const row = raw[r] as unknown[];
    if (row.every(c => !toStr(c))) continue; // linha vazia

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

    if (!city && !client) continue; // linha sem dados úteis

    // Coleta campos extras
    const extra: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (![iCity, iClient, iOrder, iVolume, iWeight, iBoxes, iAddress, iStatus].includes(i)) {
        const v = toStr(row[i]);
        if (v) extra[headers[i]] = v;
      }
    });

    rows.push({ city, client, orderId: order, volumeM3: vol, weightKg: wt, boxes: Math.round(bx), address: addr, extra });
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
