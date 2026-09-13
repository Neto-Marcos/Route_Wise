/**
 * lib/notfis-parser.ts
 * Parser para arquivos NOTFIS (Padrão EDI Proceda 3.1 / 5.0 / 3.0a)
 *
 * Registros NOTFIS suportados:
 *  - 000: Cabeçalho do Arquivo
 *  - 310: Cabeçalho do Documento (Transportadora)
 *  - 311: Dados do Embarcador
 *  - 312: Dados da Nota Fiscal (DANFE 44 dígitos, Valor, Peso, Volume, Cidade Destino)
 *  - 313: Dados das Mercadorias / Volumes
 */

import type { OrderRow } from "./spreadsheet-parser";

export interface NotfisInvoice {
  /** Chave de Acesso DANFE de 44 dígitos */
  danfeKey?: string;
  /** Número da Nota Fiscal */
  invoiceNumber: string;
  /** Serie da Nota Fiscal */
  series?: string;
  /** CNPJ do Remetente */
  senderCnpj?: string;
  /** Nome do Destinatário */
  recipientName: string;
  /** CNPJ / CPF do Destinatário */
  recipientCnpj?: string;
  /** Endereço do Destinatário */
  address?: string;
  /** Bairro */
  neighborhood?: string;
  /** Cidade do Destinatário */
  city: string;
  /** UF do Destinatário */
  state?: string;
  /** CEP */
  zipCode?: string;
  /** Peso Bruto (kg) */
  weightKg: number;
  /** Volume / Cubagem (m³) */
  volumeM3: number;
  /** Quantidade de Volumes / Caixas */
  boxes: number;
  /** Valor Total da Nota Fiscal (R$) */
  totalValue: number;
}

export interface NotfisParseResult {
  invoices: NotfisInvoice[];
  orders: OrderRow[];
  header: {
    senderName?: string;
    fileDate?: string;
    fileId?: string;
  };
  stats: {
    totalInvoices: number;
    totalVolumeM3: number;
    totalWeightKg: number;
    totalValue: number;
  };
}

function parseNum(str: string, decimals = 2): number {
  if (!str) return 0;
  const trimmed = str.trim();
  if (trimmed.includes(".") && trimmed.includes(",")) {
    const lastDot = trimmed.lastIndexOf(".");
    const lastComma = trimmed.lastIndexOf(",");
    const norm = lastDot < lastComma
      ? trimmed.replace(/\./g, "").replace(",", ".")
      : trimmed.replace(/,/g, "");
    const parsed = parseFloat(norm);
    if (!isNaN(parsed)) return parsed;
  } else if (trimmed.includes(",")) {
    const norm = trimmed.replace(",", ".");
    const parsed = parseFloat(norm);
    if (!isNaN(parsed)) return parsed;
  } else if (trimmed.includes(".")) {
    const dots = (trimmed.match(/\./g) || []).length;
    // Único ponto é separador decimal (ex: 123.45 ou 3.50); múltiplos pontos são milhares (ex: 1.000.000)
    const norm = dots === 1 ? trimmed : trimmed.replace(/\./g, "");
    const parsed = parseFloat(norm);
    if (!isNaN(parsed)) return parsed;
  }
  const clean = str.replace(/[^\d]/g, "");
  if (!clean) return 0;
  const val = parseInt(clean, 10);
  return val / Math.pow(10, decimals);
}

function parseStr(str: string): string {
  return (str || "").trim();
}

/**
 * Converte o texto de um arquivo NOTFIS em notas fiscais e registros de pedido elegíveis para roteirização.
 */
export function parseNotfis(text: string): NotfisParseResult {
  if (!text) {
    return {
      invoices: [],
      orders: [],
      header: {},
      stats: { totalInvoices: 0, totalVolumeM3: 0, totalWeightKg: 0, totalValue: 0 },
    };
  }

  // Remove BOM se presente
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  const lines = text.split(/\r\n|\r|\n/);
  const invoices: NotfisInvoice[] = [];
  const headerInfo: NotfisParseResult["header"] = {};

  let currentInvoice: Partial<NotfisInvoice> | null = null;

  for (let rawLine of lines) {
    const line = rawLine.trimStart();
    if (line.length < 3) continue;
    const recordType = line.substring(0, 3);

    switch (recordType) {
      // 000: Cabeçalho de Arquivo
      case "000": {
        if (currentInvoice && currentInvoice.invoiceNumber) {
          invoices.push(finalizeInvoice(currentInvoice));
          currentInvoice = null;
        }
        headerInfo.senderName = parseStr(line.substring(3, 38)) || headerInfo.senderName;
        headerInfo.fileDate = parseStr(line.substring(38, 50)) || headerInfo.fileDate;
        headerInfo.fileId = parseStr(line.substring(50, 64)) || headerInfo.fileId;
        break;
      }

      // 311: Dados do Embarcador
      case "311": {
        if (currentInvoice && currentInvoice.invoiceNumber) {
          invoices.push(finalizeInvoice(currentInvoice));
          currentInvoice = null;
        }
        const sender = parseStr(line.substring(3, 43));
        const cnpjMatch = line.match(/\d{14}/);
        if (cnpjMatch) (headerInfo as any).senderCnpj = cnpjMatch[0];
        if (sender) headerInfo.senderName = sender.replace(/\d{14}/g, "").trim() || headerInfo.senderName;
        break;
      }

      // 312: Dados da Nota Fiscal
      case "312": {
        if (currentInvoice && currentInvoice.invoiceNumber) {
          invoices.push(finalizeInvoice(currentInvoice));
        }

        // 1. Extração da Chave DANFE de 44 dígitos (regex com boundary)
        const danfeMatch = line.match(/(?<!\d)\d{44}(?!\d)/);
        const rawTail = parseStr(line.slice(-44));
        const danfeKey = danfeMatch
          ? danfeMatch[0]
          : (rawTail.length === 44 && /^\d{44}$/.test(rawTail) ? rawTail : undefined);

        // 2. Remove a chave DANFE da linha para evitar colisões com campos numéricos
        const cleanLine = (danfeKey ? line.replace(danfeKey, "") : line).trimEnd();

        // 3. Extrai Número da Nota Fiscal (Proceda 3.1 vs 5.0 vs DANFE)
        const p5Nf = parseStr(cleanLine.substring(3, 12));
        const p3Romaneio = parseStr(cleanLine.substring(3, 11));
        const p3Nf = parseStr(cleanLine.substring(11, 20));

        let invoiceNum = "";
        if (p3Romaneio && p3Nf && /^\d+$/.test(p3Nf)) {
          invoiceNum = p3Nf;
        } else if (!p3Romaneio && p3Nf && /^\d+$/.test(p3Nf)) {
          invoiceNum = p3Nf;
        } else if (p5Nf && /^\d+$/.test(p5Nf)) {
          invoiceNum = p5Nf;
        } else if (danfeKey) {
          invoiceNum = danfeKey.substring(25, 34);
        } else {
          invoiceNum = p5Nf || p3Nf || "0";
        }

        // 4. Extração de Campos Numéricos (Peso kg, Volume m³, Caixas, Valor R$)
        let weightRaw = "";
        let volumeRaw = "";
        let boxesRaw = "";
        let valueRaw = "";
        let numEndIdx = 82;
        let city = "";
        let cleanRecipient = "";

        const bodyAfterHeader = cleanLine.substring(20);

        // Estratégia 1: 4 números seguidos diretamente pelo texto de destino (cidade/destinatário)
        // Isso evita categoricamente confundir CFOP numérico (ex: 5102) ou datas com métricas de entrega
        const tokenSeqWithTextMatch = bodyAfterHeader.match(
          /(\d+[\d.,]*)\s+(\d+[\d.,]*)\s+(\d+[\d.,]*)\s+(\d+[\d.,]*)\s+([A-Za-zÀ-ÿ].*)/
        );

        if (tokenSeqWithTextMatch) {
          weightRaw = tokenSeqWithTextMatch[1];
          volumeRaw = tokenSeqWithTextMatch[2];
          boxesRaw = tokenSeqWithTextMatch[3];
          valueRaw = tokenSeqWithTextMatch[4];
          const textSection = tokenSeqWithTextMatch[5];
          numEndIdx = 20 + bodyAfterHeader.indexOf(tokenSeqWithTextMatch[0]) + tokenSeqWithTextMatch[0].length;

          const textBlocks = textSection.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
          if (textBlocks.length >= 2) {
            city = textBlocks[0];
            cleanRecipient = textBlocks.slice(1).join(" ");
          } else if (textBlocks.length === 1) {
            city = textBlocks[0];
            cleanRecipient = textBlocks[0];
          }
        } else {
          // Estratégia 2: Sequência de 4 números tokenizados sem texto imediatamente subsequente
          const tokenSeqMatch = bodyAfterHeader.match(
            /(\d+[\d.,]*)\s+(\d+[\d.,]*)\s+(\d+[\d.,]*)\s+(\d+[\d.,]*)/
          );

          if (tokenSeqMatch) {
            weightRaw = tokenSeqMatch[1];
            volumeRaw = tokenSeqMatch[2];
            boxesRaw = tokenSeqMatch[3];
            valueRaw = tokenSeqMatch[4];
            numEndIdx = 20 + bodyAfterHeader.indexOf(tokenSeqMatch[0]) + tokenSeqMatch[0].length;
          } else {
            // Estratégia 3: Dígitos contíguos posicionais
            const posMatch = bodyAfterHeader.match(/(\d{7,9})(\d{7,9})(\d{4,6})(\d{10,15})/);
            if (posMatch) {
              weightRaw = posMatch[1];
              volumeRaw = posMatch[2];
              boxesRaw = posMatch[3];
              valueRaw = posMatch[4];
              numEndIdx = 20 + bodyAfterHeader.indexOf(posMatch[0]) + posMatch[0].length;
            } else {
              // Estratégia 4: Fatiamento por posições fixas padrão Proceda
              weightRaw = parseStr(cleanLine.substring(44, 53)) || parseStr(cleanLine.substring(63, 72)) || parseStr(cleanLine.substring(55, 64));
              volumeRaw = parseStr(cleanLine.substring(53, 62)) || parseStr(cleanLine.substring(72, 81)) || parseStr(cleanLine.substring(64, 73));
              boxesRaw = parseStr(cleanLine.substring(62, 67)) || parseStr(cleanLine.substring(81, 86)) || parseStr(cleanLine.substring(73, 78));
              valueRaw = parseStr(cleanLine.substring(67, 82)) || parseStr(cleanLine.substring(86, 101)) || parseStr(cleanLine.substring(78, 93));
            }
          }

          // Extração de Cidade e Destinatário para estratégias 2, 3 e 4
          const textSection = cleanLine.substring(numEndIdx);
          const textBlocks = textSection.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);

          if (textBlocks.length >= 2) {
            city = textBlocks[0];
            cleanRecipient = textBlocks.slice(1).join(" ");
          } else if (textBlocks.length === 1) {
            cleanRecipient = textBlocks[0];
          }
        }

        // Positional Proceda fallback se cidade ou destinatário não foram separados por blocos
        if (!city) {
          const posCity = parseStr(cleanLine.substring(82, 117));
          if (posCity && !/\d{6,}/.test(posCity)) city = posCity;
        }
        if (!cleanRecipient) {
          const posRecipient = parseStr(cleanLine.substring(117, 167)) || parseStr(cleanLine.substring(130, 180));
          if (posRecipient) cleanRecipient = posRecipient;
        }

        currentInvoice = {
          invoiceNumber: invoiceNum,
          weightKg: parseNum(weightRaw, 2),
          volumeM3: parseNum(volumeRaw, 3),
          boxes: Math.round(parseNum(boxesRaw, 0)),
          totalValue: parseNum(valueRaw, 2),
          city: city || "",
          recipientName: cleanRecipient || "",
          danfeKey,
        };
        break;
      }

      // 313: Dados de Entrega / Endereço Completo
      case "313": {
        if (currentInvoice) {
          const danfeMatch313 = line.match(/(?<!\d)\d{44}(?!\d)/);
          if (danfeMatch313 && !currentInvoice.danfeKey) {
            currentInvoice.danfeKey = danfeMatch313[0];
          }

          const clean313 = (danfeMatch313 ? line.replace(danfeMatch313[0], "") : (currentInvoice.danfeKey ? line.replace(currentInvoice.danfeKey, "") : line)).trimEnd();

          const address = parseStr(clean313.substring(3, 43));
          const neighborhood = parseStr(clean313.substring(43, 73));
          let city = parseStr(clean313.substring(73, 108));

          // UF brasileira (2 letras)
          const stateMatch = clean313.substring(73).match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/);
          const state = stateMatch ? stateMatch[1] : parseStr(clean313.substring(108, 110));

          // Limpa UF e CEP do final da cidade se foi capturado junto
          if (stateMatch) {
            city = city.replace(new RegExp(`\\b${stateMatch[1]}\\b.*$`), "").trim();
          }

          // CEP
          const zipMatch = clean313.substring(73).match(/\d{8}|\d{5}-?\d{3}/);
          const zipCode = zipMatch ? zipMatch[0] : parseStr(clean313.substring(110, 119));
          if (zipMatch) {
            city = city.replace(new RegExp(`\\b${zipMatch[0]}\\b.*$`), "").trim();
          }

          if (address) currentInvoice.address = address;
          if (neighborhood) currentInvoice.neighborhood = neighborhood;
          if (city) currentInvoice.city = city;
          if (state && /^[A-Z]{2}$/.test(state)) currentInvoice.state = state;
          if (zipCode) currentInvoice.zipCode = zipCode;
        }
        break;
      }

      // 319: Totalizador / Fim da Nota Fiscal
      case "319": {
        if (currentInvoice && currentInvoice.invoiceNumber) {
          invoices.push(finalizeInvoice(currentInvoice));
          currentInvoice = null;
        }
        break;
      }
    }
  }

  if (currentInvoice && currentInvoice.invoiceNumber) {
    invoices.push(finalizeInvoice(currentInvoice));
  }

  // Converte notas em OrderRow para o Roteirizador
  const orders: OrderRow[] = invoices.map((inv) => ({
    city: inv.city,
    client: inv.recipientName,
    clientName: inv.recipientName,
    orderId: inv.invoiceNumber,
    volumeM3: inv.volumeM3 > 0 ? inv.volumeM3 : 0.5, // Fallback default se zerado
    weightKg: inv.weightKg > 0 ? inv.weightKg : 50,
    boxes: inv.boxes > 0 ? inv.boxes : 1,
    address: inv.address
      ? `${[inv.address, inv.neighborhood].filter(Boolean).join(", ")} - ${inv.city}${inv.state ? `/${inv.state}` : ""}`
      : (inv.city ? `${inv.city}${inv.state ? `/${inv.state}` : ""}` : "Campina Grande"),
    uf: inv.state,
    products: "Mercadorias Gerais (NOTFIS)",
    extra: {
      danfeKey: inv.danfeKey || "",
      valorTotal: inv.totalValue.toFixed(2),
      formato: "NOTFIS EDI",
    },
  }));

  const totalVol = invoices.reduce((s, i) => s + i.volumeM3, 0);
  const totalWt = invoices.reduce((s, i) => s + i.weightKg, 0);
  const totalVal = invoices.reduce((s, i) => s + i.totalValue, 0);

  return {
    invoices,
    orders,
    header: headerInfo,
    stats: {
      totalInvoices: invoices.length,
      totalVolumeM3: parseFloat(totalVol.toFixed(3)),
      totalWeightKg: parseFloat(totalWt.toFixed(2)),
      totalValue: parseFloat(totalVal.toFixed(2)),
    },
  };
}

function finalizeInvoice(inv: Partial<NotfisInvoice>): NotfisInvoice {
  return {
    invoiceNumber: inv.invoiceNumber || "0",
    city: inv.city || "Campina Grande",
    recipientName: inv.recipientName || (inv.invoiceNumber ? `Cliente NF ${inv.invoiceNumber}` : "Cliente"),
    weightKg: inv.weightKg || 0,
    volumeM3: inv.volumeM3 || 0,
    boxes: inv.boxes || 1,
    totalValue: inv.totalValue || 0,
    address: inv.address,
    neighborhood: inv.neighborhood,
    state: inv.state,
    zipCode: inv.zipCode,
    danfeKey: inv.danfeKey,
  };
}
