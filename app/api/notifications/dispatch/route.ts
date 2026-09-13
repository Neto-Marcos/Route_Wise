import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/notifications/dispatch
 * Dia 9: Notificações em Tempo Real (Webhooks & WhatsApp/SMS Stubs)
 * Envia notificação de atualização de entrega para cliente e operador.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { routeId, stopId, clientPhone, clientName, status, trackingUrl } = body;

    if (!routeId || !status) {
      return NextResponse.json({ error: "Parâmetros obrigatórios ausentes" }, { status: 400 });
    }

    const messageText = `Olá ${clientName || "Cliente"}! Seu pedido (Parada #${stopId || "1"}) foi atualizado para: *${status}*. Acompanhe em tempo real: ${trackingUrl || "https://criarrota.com.br/rastreio"}`;

    // Stub de integração com gateway WhatsApp/SMS (ex: Z-API / Evolution API / Twilio)
    console.log(`[Notification Dispatch] WhatsApp/SMS enviado para ${clientPhone || "Cliente"}: ${messageText}`);

    return NextResponse.json({
      success: true,
      delivered: true,
      channel: "whatsapp_stub",
      recipient: clientPhone || "5583999999999",
      message: messageText,
      sentAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[api/notifications/dispatch]", err);
    return NextResponse.json({ error: "Erro ao enviar notificação" }, { status: 500 });
  }
}
