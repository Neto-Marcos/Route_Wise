import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";

/**
 * POST /api/notifications/dispatch
 * Dia 9: Notificações em Tempo Real (Webhooks & WhatsApp/SMS Stubs)
 * Envia notificação de atualização de entrega para cliente e operador.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { routeId, stopId, clientPhone, clientName, status, trackingUrl, title, recipientType } = body;

    if (!routeId || !status) {
      return NextResponse.json({ error: "Parâmetros obrigatórios ausentes" }, { status: 400 });
    }

    const session = await getSession("dispatcher") ?? await getSession("driver");
    if (!session) return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
    const messageText = `Olá ${clientName || "Cliente"}! Seu pedido (Parada #${stopId || "1"}) foi atualizado para: ${status}. Acompanhe em tempo real: ${trackingUrl || "https://criarrota.com.br/rastreio"}`;
    const notificationTitle = title || "Criar Rota · Atualização operacional";
    const event = await query<{ id: string }>(
      `INSERT INTO notification_events(company_id,event_type,recipient_type,title,body,payload,status)
       VALUES($1,$2,$3,$4,$5,$6,'queued') RETURNING id`,
      [session.companyId, status, recipientType || "all", notificationTitle, messageText, JSON.stringify({ routeId, stopId, trackingUrl })],
    );
    const subscriptions = await query<{ endpoint: string; p256dh: string; auth: string }>(
      `SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE company_id=$1 ${recipientType ? "AND user_type=$2" : ""}`,
      recipientType ? [session.companyId, recipientType] : [session.companyId],
    );
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      await query("UPDATE notification_events SET status='pending_config',error='VAPID não configurado' WHERE id=$1", [event.rows[0].id]);
      return NextResponse.json({ success: false, delivered: false, reason: "VAPID não configurado" }, { status: 503 });
    }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contato@criarrota.com.br", publicKey, privateKey);
    let delivered = 0;
    await Promise.all(subscriptions.rows.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title: notificationTitle, body: messageText, url: trackingUrl || "/" }));
        delivered += 1;
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) await query("DELETE FROM push_subscriptions WHERE endpoint=$1", [sub.endpoint]);
      }
    }));
    await query("UPDATE notification_events SET status=$2,sent_at=now() WHERE id=$1", [event.rows[0].id, delivered ? "sent" : "no_subscribers"]);

    return NextResponse.json({
      success: true,
      delivered: delivered > 0,
      channel: "web_push",
      recipient: clientPhone || "dispositivos inscritos",
      message: messageText,
      sentAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[api/notifications/dispatch]", err);
    return NextResponse.json({ error: "Erro ao enviar notificação" }, { status: 500 });
  }
}
