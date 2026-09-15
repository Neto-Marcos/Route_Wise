import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null, enabled: Boolean(process.env.VAPID_PRIVATE_KEY) });
}

export async function POST(request: NextRequest) {
  const dispatcher = await getSession("dispatcher");
  const driver = await getSession("driver");
  const session = dispatcher ?? driver;
  if (!session) return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
  const subscription = await request.json();

  // Diagnóstico de ponta a ponta: não depende de atualizar a tela nem envia
  // para a operação inteira. Serve para confirmar o aparelho atual.
  if (subscription?.action === "test") {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return NextResponse.json({ error: "VAPID não configurado no Railway." }, { status: 503 });
    const userId = session.driverId ?? session.dispatcherId ?? "";
    const subscriptions = await query<{ endpoint: string; p256dh: string; auth: string }>(
      "SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE company_id=$1 AND user_type=$2 AND user_id=$3",
      [session.companyId, session.role, userId],
    );
    if (!subscriptions.rows.length) return NextResponse.json({ error: "Este dispositivo ainda não está inscrito para receber Push." }, { status: 404 });
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contato@criarrota.com.br", publicKey, privateKey);
    let delivered = 0;
    await Promise.all(subscriptions.rows.map(async (item) => {
      try {
        await webpush.sendNotification({ endpoint: item.endpoint, keys: { p256dh: item.p256dh, auth: item.auth } }, JSON.stringify({ title: "Teste de alerta", body: "As notificações do Criar Rota estão funcionando neste dispositivo.", url: "/" }), { TTL: 60 });
        delivered += 1;
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) await query("DELETE FROM push_subscriptions WHERE endpoint=$1", [item.endpoint]);
      }
    }));
    if (!delivered) return NextResponse.json({ error: "A inscrição deste dispositivo expirou. Ative os alertas novamente." }, { status: 410 });
    return NextResponse.json({ ok: true, delivered });
  }

  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: "Inscrição Push inválida" }, { status: 400 });
  }
  await query(
    `INSERT INTO push_subscriptions(company_id,user_type,user_id,endpoint,p256dh,auth,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT(endpoint) DO UPDATE SET company_id=EXCLUDED.company_id,user_type=EXCLUDED.user_type,user_id=EXCLUDED.user_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,updated_at=now()`,
    [session.companyId, session.role, session.driverId ?? session.dispatcherId ?? "", subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth],
  );
  return NextResponse.json({ ok: true });
}
