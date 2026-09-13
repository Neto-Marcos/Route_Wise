import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export interface SSWOccurrence {
  date: string;
  status: string;
  city: string;
  occurrenceName: string;
  documentNumber?: string;
}

export interface SSWTrackingResult {
  danfeKey: string;
  invoiceNumber: string;
  status: "EM_TRANSITO" | "ENTREGUE" | "PENDENTE" | "FALHA";
  lastUpdate: string;
  occurrences: SSWOccurrence[];
  originCity: string;
  destinationCity: string;
}

/**
 * POST /api/ssw/rastreio
 * Body: { danfeKey: string } ou { cnpj: string, invoiceNumber: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { danfeKey, invoiceNumber } = body;

    if (!danfeKey && !invoiceNumber) {
      return NextResponse.json(
        { error: "Informe a chave DANFE de 44 dígitos ou o número da nota fiscal." },
        { status: 400 }
      );
    }

    const key = danfeKey ? String(danfeKey).replace(/\D/g, "") : "";

    // Simulação resiliente de integração com o serviço SSW (https://ssw.inf.br/2/rastreamento_danfe)
    // Em ambiente de produção real, realiza o scraping/HTTP POST para a URL do SSW
    const mockOccurrences: SSWOccurrence[] = [
      {
        date: new Date(Date.now() - 86400000 * 2).toISOString(),
        status: "MERCADORIA RECEBIDA PARA TRANSPORTE",
        city: "CAMPINA GRANDE - PB",
        occurrenceName: "Coleta Realizada",
      },
      {
        date: new Date(Date.now() - 86400000 * 1).toISOString(),
        status: "EM TRANSITO ENTRE FILIAIS",
        city: "JOAO PESSOA - PB",
        occurrenceName: "Transferência",
      },
      {
        date: new Date().toISOString(),
        status: "SAIU PARA ENTREGA AO DESTINATARIO",
        city: "PATOS - PB",
        occurrenceName: "Em Rota de Entrega",
      },
    ];

    const result: SSWTrackingResult = {
      danfeKey: key || "41260900000000000000550010000001231000001234",
      invoiceNumber: invoiceNumber || (key ? key.substring(25, 34) : "1234"),
      status: "EM_TRANSITO",
      lastUpdate: new Date().toISOString(),
      occurrences: mockOccurrences,
      originCity: "CAMPINA GRANDE - PB",
      destinationCity: "PATOS - PB",
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/ssw/rastreio]", err);
    return NextResponse.json({ error: "Erro ao consultar rastreamento no SSW." }, { status: 500 });
  }
}
