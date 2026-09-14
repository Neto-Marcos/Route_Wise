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
  /** Campos normalizados quando a origem os disponibiliza. */
  freightType?: "CIF" | "FOB" | "";
  closedAt?: string;
  totalValue?: number;
  /** Qualquer campo extra da planilha */
  extra: Record<string, string>;
}

// ─── Sinônimos de coluna expandidos (compatível com Sabium, ERPs e carteiras) ─
const COL_CITY     = /cidade|munic[íi]pio|localidade|destino|praca|pra[çc]a|mun\b|cidade\s*entrega/i;
const COL_CLIENT   = /^nome$|cliente|destinat[áa]rio|raz[aã]o\s*social|nome\s*(do\s*cliente)?|dest\b|comprador/i;
const COL_ORDER    = /pedido\s*sabium|n[°º]?\s*pedido|num\s*pedido|numero\s*pedido|nro\s*pedido|cod\s*pedido|pedido|nota\s*fiscal|n[°º]?\s*nf|nf|n[uú]mero\s*(do\s*pedido)?|chave|doc/i;
const COL_VOLUME   = /volume\s*c[uú]bico|volume\s*cubico|cubagem|volume|m3|m[³]|cbm|m\^3/i;
const COL_WEIGHT   = /peso|peso\s*bruto|kg\b|peso\s*total/i;
const COL_BOXES    = /quantidade|qtd|qtde|pecas|pe[çc]as|caixas|volumes|volume\s*total|total\s*item/i;
const COL_ADDRESS  = /endere[cç]o|logradouro|rua|bairro/i;
const COL_UF       = /^(uf|sigla\s*uf|estado|sigla)$/i;
const COL_PRODUCTS = /c[oó]digo|cod\s*produto|c[oó]d\s*produto|produto|mercadoria|itens|item|descri[cç][aã]o/i;
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

  // Encontra a linha de cabeçalho por pontuação (score) ponderada
  let headerRowIdx = -1;
  let headers: string[] = [];
  let bestScore = -1;

  for (let r = 0; r < Math.min(raw.length, 35); r++) {
    const candidateRow = (raw[r] as unknown[] || []).map(h => toStr(h));
    const lowerCols = candidateRow.map(c => c.toLowerCase());
    const cCity = matchCol(lowerCols, COL_CITY);
    const cClient = matchCol(lowerCols, COL_CLIENT);
    const cOrder = matchCol(lowerCols, COL_ORDER);
    const cVol = matchCol(lowerCols, COL_VOLUME);
    const cProd = matchCol(lowerCols, COL_PRODUCTS);
    const cBoxes = matchCol(lowerCols, COL_BOXES);
    const cStatus = matchCol(lowerCols, COL_STATUS);
    const cUf = matchCol(lowerCols, COL_UF);

    let score = 0;
    if (cOrder >= 0) score += 4;
    if (cCity >= 0) score += 4;
    if (cClient >= 0) score += 3;
    if (cVol >= 0) score += 3;
    if (cProd >= 0) score += 3;
    if (cBoxes >= 0) score += 2;
    if (cStatus >= 0) score += 2;
    if (cUf >= 0) score += 2;

    if (score > bestScore && score >= 4) {
      bestScore = score;
      headerRowIdx = r;
      headers = lowerCols;
    }
  }

  // Fallback se score ponderado não atingiu 4: procura linha com ao menos 1 coluna chave
  if (headerRowIdx === -1) {
    for (let r = 0; r < Math.min(raw.length, 15); r++) {
      const candidateRow = (raw[r] as unknown[] || []).map(h => toStr(h).toLowerCase());
      const cCity = matchCol(candidateRow, COL_CITY);
      const cClient = matchCol(candidateRow, COL_CLIENT);
      const cOrder = matchCol(candidateRow, COL_ORDER);
      if (cCity >= 0 || cOrder >= 0 || cClient >= 0) {
        headerRowIdx = r;
        headers = candidateRow;
        break;
      }
    }
  }

  // Fallback 2: usa primeira linha não-vazia como cabeçalho
  if (headerRowIdx === -1) {
    for (let r = 0; r < Math.min(raw.length, 5); r++) {
      const candidateRow = (raw[r] as unknown[] || []).map(h => toStr(h).toLowerCase());
      if (candidateRow.filter(Boolean).length >= 2) {
        headerRowIdx = r;
        headers = candidateRow;
        break;
      }
    }
  }

  if (headerRowIdx === -1) return [];

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

  const rawLines: OrderRow[] = [];

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
    let order    = iOrder  >= 0 ? toStr(row[iOrder])  : '';
    const vol    = iVolume >= 0 ? toFloat(row[iVolume]) : 0;
    const wt     = iWeight >= 0 ? toFloat(row[iWeight]) : 0;
    const bx     = iBoxes  >= 0 ? toFloat(row[iBoxes])  : 0;
    const addr   = iAddress >= 0 ? toStr(row[iAddress]) : undefined;
    const uf     = iUf     >= 0 ? toStr(row[iUf])     : undefined;
    const prod   = iProducts >= 0 ? toStr(row[iProducts]) : undefined;

    // Normalização de número de pedido (ex: 219667.0 -> 219667)
    if (order) {
      order = order.replace(/\.0+$/, '').trim();
    } else {
      order = `L${r}`;
    }

    // Precisa ter pelo menos algum dado mínimo (cidade OU cliente OU pedido com valor/volume)
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
    const safeWt = wt > 0 ? wt : (safeVol > 0 ? safeVol * 150 : 50);
    const freightRaw = extra["tipo frete"] ?? extra["tipo_frete"] ?? extra["frete"] ?? "";
    const freightNormalized = freightRaw.trim().toUpperCase();
    const freightType = freightNormalized.startsWith("CIF")
      ? "CIF"
      : freightNormalized.startsWith("FOB")
        ? "FOB"
        : "";
    const closedAt = extra["fechado"] ?? extra["data fechado"] ?? "";
    const totalValue = toFloat(extra["total item"] ?? extra["total_item"] ?? extra["valor"] ?? 0);

    rawLines.push({
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
      freightType,
      closedAt,
      totalValue,
      extra,
    });
  }

  // ─── Consolidação / Agregação por Pedido (ERP Sabium / Linhas de Produto) ───
  // Em planilhas de carteira Sabium, cada linha é um produto do mesmo pedido.
  // Consolidamos os volumes, caixas, peso e lista de produtos por orderId.
  const aggregatedOrders = new Map<string, OrderRow>();
  const productDedupeByOrder = new Map<string, Set<string>>();

  for (const line of rawLines) {
    // Se o pedido for gerado por fallback (L1, L2, etc.), não agrupa com outros
    const isFallbackId = line.orderId.startsWith("L");
    const groupKey = isFallbackId ? `LINE_${line.orderId}_${Math.random()}` : line.orderId;

    if (!aggregatedOrders.has(groupKey)) {
      aggregatedOrders.set(groupKey, {
        ...line,
        products: line.products || "",
        extra: { ...line.extra },
      });
      productDedupeByOrder.set(groupKey, new Set(line.products ? [line.products] : []));
    } else {
      const existing = aggregatedOrders.get(groupKey)!;
      // Soma métricas operacionais
      existing.volumeM3 = Math.round((existing.volumeM3 + line.volumeM3) * 1000) / 1000;
      existing.weightKg = Math.round((existing.weightKg + line.weightKg) * 100) / 100;
      existing.boxes += line.boxes;

      // Completa dados ausentes
      if ((!existing.client || existing.client === "Cliente Geral") && line.client && line.client !== "Cliente Geral") {
        existing.client = line.client;
        existing.clientName = line.client;
      }
      if ((!existing.city || existing.city === "Cidade a definir") && line.city && line.city !== "Cidade a definir") {
        existing.city = line.city;
      }
      if (!existing.uf && line.uf) existing.uf = line.uf;
      if (!existing.address && line.address) existing.address = line.address;

      // Agrega produtos distintos
      if (line.products) {
        const prodSet = productDedupeByOrder.get(groupKey)!;
        if (!prodSet.has(line.products)) {
          prodSet.add(line.products);
          existing.products = existing.products ? `${existing.products}, ${line.products}` : line.products;
        }
      }
    }
  }

  return Array.from(aggregatedOrders.values());
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
  // .xlsx / .xlsm são ZIP (PK = 0x50 0x4B)
  const isZip = uint8.length >= 4 && uint8[0] === 0x50 && uint8[1] === 0x4B;
  // .xls BIFF8 são Compound File Binary (CFB = 0xD0 0xCF 0x11 0xE0)
  const isCfb = uint8.length >= 4 && uint8[0] === 0xD0 && uint8[1] === 0xCF;
  // .xlsb (Binary Workbook) também detectado como ZIP
  const isBinary = isZip || isCfb ||
    (!!filename && /\.(xlsx|xls|xlsm|xlsb|xlam)$/i.test(filename));

  let workbook: import('xlsx').WorkBook;
  if (isBinary) {
    // SheetJS lida nativamente com XLS, XLSX, XLSB via type:'array'
    try {
      workbook = XLSX.read(uint8, { type: 'array', cellDates: true });
    } catch {
      // Último recurso: tenta como base64
      const b64 = btoa(uint8.reduce((d, b) => d + String.fromCharCode(b), ''));
      workbook = XLSX.read(b64, { type: 'base64', cellDates: true });
    }
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
