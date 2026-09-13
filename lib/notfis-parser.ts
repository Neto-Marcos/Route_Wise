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
  const lines = text.split(/\r?\n/);
  const invoices: NotfisInvoice[] = [];
  const headerInfo: NotfisParseResult["header"] = {};

  let currentInvoice: Partial<NotfisInvoice> | null = null;

  for (const line of lines) {
    if (line.length < 3) continue;
    const recordType = line.substring(0, 3);

    switch (recordType) {
      // 000: Cabeçalho de Arquivo
      case "000": {
        headerInfo.senderName = parseStr(line.substring(3, 38));
        headerInfo.fileDate = parseStr(line.substring(38, 50));
        headerInfo.fileId = parseStr(line.substring(50, 64));
        break;
      }

      // 312: Dados da Nota Fiscal
      case "312": {
        if (currentInvoice && currentInvoice.invoiceNumber) {
          invoices.push(finalizeInvoice(currentInvoice));
        }

        // Padrão Proceda NOTFIS (Layout posicional padrão)
        const invoiceNum = parseStr(line.substring(3, 13)) || parseStr(line.substring(3, 12));
        const weightRaw = line.substring(63, 72) || line.substring(55, 64);
        const volumeRaw = line.substring(72, 81) || line.substring(64, 73);
        const boxesRaw = line.substring(81, 86) || line.substring(73, 78);
        const valueRaw = line.substring(86, 101) || line.substring(78, 93);
        const city = parseStr(line.substring(130, 165)) || parseStr(line.substring(110, 140)) || parseStr(line.substring(140, 175));
        const recipient = parseStr(line.substring(165, 205)) || parseStr(line.substring(140, 180));
        const danfeKey = parseStr(line.substring(line.length - 44)) || undefined;

        currentInvoice = {
          invoiceNumber: invoiceNum,
          weightKg: parseNum(weightRaw, 2),
          volumeM3: parseNum(volumeRaw, 3),
          boxes: Math.round(parseNum(boxesRaw, 0)),
          totalValue: parseNum(valueRaw, 2),
          city: city || "Campina Grande",
          recipientName: recipient || `Cliente NF ${invoiceNum}`,
          danfeKey: danfeKey && danfeKey.length === 44 ? danfeKey : undefined,
        };
        break;
      }

      // 313: Dados de Entrega / Endereço Completo
      case "313": {
        if (currentInvoice) {
          const address = parseStr(line.substring(3, 43));
          const neighborhood = parseStr(line.substring(43, 73));
          const city = parseStr(line.substring(73, 108));
          const state = parseStr(line.substring(108, 110));
          const zipCode = parseStr(line.substring(110, 119));

          if (address) currentInvoice.address = address;
          if (neighborhood) currentInvoice.neighborhood = neighborhood;
          if (city) currentInvoice.city = city;
          if (state) currentInvoice.state = state;
          if (zipCode) currentInvoice.zipCode = zipCode;
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
    orderId: inv.invoiceNumber,
    volumeM3: inv.volumeM3 > 0 ? inv.volumeM3 : 0.5, // Fallback default se zerado
    weightKg: inv.weightKg > 0 ? inv.weightKg : 50,
    boxes: inv.boxes > 0 ? inv.boxes : 1,
    address: inv.address ? `${inv.address}, ${inv.neighborhood || ""} - ${inv.city}/${inv.state || ""}` : inv.city,
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
      totalVolumeM3: parseFloat(totalVol.toFixed(2)),
      totalWeightKg: parseFloat(totalWt.toFixed(2)),
      totalValue: parseFloat(totalVal.toFixed(2)),
    },
  };
}

function finalizeInvoice(inv: Partial<NotfisInvoice>): NotfisInvoice {
  return {
    invoiceNumber: inv.invoiceNumber || "0",
    city: inv.city || "Campina Grande",
    recipientName: inv.recipientName || "Cliente",
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
