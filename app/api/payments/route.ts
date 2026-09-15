import { NextResponse } from "next/server";
import webpush from "web-push";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";

async function notifyAdministratorsOfPaymentRequest({
  companyId,
  driverId,
  amount,
  category,
  description,
}: {
  companyId: string | undefined;
  driverId: string | null;
  amount: number;
  category: string;
  description: string;
}) {
  if (!companyId) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return;

  const [subscriptions, driver] = await Promise.all([
    query<{ endpoint: string; p256dh: string; auth: string }>(
      "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE company_id=$1 AND user_type='dispatcher'",
      [companyId],
    ),
    driverId
      ? query<{ name: string }>("SELECT name FROM drivers WHERE id=$1", [driverId])
      : Promise.resolve({ rows: [] as Array<{ name: string }> }),
  ]);
  if (!subscriptions.rows.length) return;

  const driverName = driver.rows[0]?.name ?? "Motorista";
  const formattedAmount = Number(amount).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const payload = JSON.stringify({
    title: "Nova solicitação de pagamento",
    body: `${driverName} solicitou ${formattedAmount} para ${category}: ${description}`.slice(0, 220),
    url: "/",
  });

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:contato@criarrota.com.br",
    publicKey,
    privateKey,
  );
  await Promise.all(
    subscriptions.rows.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
        );
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await query("DELETE FROM push_subscriptions WHERE endpoint=$1", [subscription.endpoint]);
        }
        console.error("[payments] Não foi possível enviar push ao administrador", error);
      }
    }),
  );
}

async function notifyDriverOfPaymentStatus(request: any) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!request.driver_id || !publicKey || !privateKey) return;
  const subscriptions = await query<{ endpoint: string; p256dh: string; auth: string }>(
    "SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE company_id=$1 AND user_type='driver' AND user_id=$2",
    [request.company_id, request.driver_id],
  );
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contato@criarrota.com.br", publicKey, privateKey);
  const labels: Record<string, string> = { approved: "aprovada", rejected: "recusada", paid: "marcada como paga" };
  await Promise.all(subscriptions.rows.map((sub) => webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title: "Pagamento atualizado", body: `Sua solicitação de R$ ${Number(request.amount).toFixed(2).replace('.', ',')} foi ${labels[request.status] || "atualizada"}.`, url: "/" })).catch(() => {})));
}

// GET: Lista solicitações de pagamento
export async function GET(request: Request) {
  const session = await getSession("dispatcher");
  const driverSession = await getSession("driver");

  if (!session && !driverSession) {
    return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
  }

  const companyId = session?.companyId || driverSession?.companyId;

  try {
    let sql = `
      SELECT p.*, d.name as driver_name, r.name as route_name
      FROM payment_requests p
      LEFT JOIN drivers d ON d.id = p.driver_id
      LEFT JOIN routes r ON r.id = p.route_id
      WHERE p.company_id = $1
    `;
    const params: any[] = [companyId];

    // Se for motorista, só vê as próprias solicitações
    if (!session && driverSession?.driverId) {
      sql += ` AND p.driver_id = $2`;
      params.push(driverSession.driverId);
    }

    sql += ` ORDER BY p.created_at DESC LIMIT 50`;

    const res = await query(sql, params);
    return NextResponse.json(res.rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: Motorista ou Operador cria nova solicitação de pagamento
export async function POST(request: Request) {
  const session = await getSession("dispatcher");
  const driverSession = await getSession("driver");

  if (!session && !driverSession) {
    return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
  }

  const companyId = session?.companyId || driverSession?.companyId;

  try {
    const body = await request.json();
    const { amount, description, category, route_id, receipt_url, pix_key, pix_qr_url } = body;

    if (!amount || !description) {
      return NextResponse.json({ error: "Valor e descrição são obrigatórios" }, { status: 400 });
    }

    const driverId = driverSession?.driverId || body.driver_id || null;

    const res = await query(
      `INSERT INTO payment_requests (company_id, driver_id, route_id, category, amount, description, receipt_url, pix_key, pix_qr_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
       RETURNING *`,
      [
        companyId,
        driverId,
        route_id || null,
        category || "adiantamento",
        Number(amount),
        description.trim(),
        receipt_url || null,
        String(pix_key || "").trim().slice(0, 255) || null,
        pix_qr_url || null,
      ]
    );

    const created = res.rows[0];

    // Avisar administradores que ativaram alertas push no PWA.
    try {
      await notifyAdministratorsOfPaymentRequest({
        companyId,
        driverId,
        amount: Number(amount),
        category: category || "adiantamento",
        description: description.trim(),
      });
    } catch (notificationError) {
      console.error("[payments] A solicitação foi salva, mas o alerta não foi enviado", notificationError);
    }

    return NextResponse.json(created);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH: Administrador aprova, recusa ou marca como pago
export async function PATCH(request: Request) {
  const session = await getSession("dispatcher");
  if (!session || (session.userRole !== "admin" && session.userRole !== "superadmin")) {
    return NextResponse.json({ error: "Apenas administradores podem avaliar solicitações" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { id, status, admin_notes, payment_receipt_url } = body;

    if (!id || !["approved", "rejected", "paid"].includes(status)) {
      return NextResponse.json({ error: "ID e status válido ('approved', 'rejected', 'paid') são obrigatórios" }, { status: 400 });
    }
    if (status === "paid" && !payment_receipt_url) {
      return NextResponse.json({ error: "Anexe o comprovante Pix antes de marcar como pago" }, { status: 400 });
    }

    const res = await query(
      `UPDATE payment_requests
       SET status = $1,
           admin_notes = $2,
           payment_receipt_url = COALESCE($3, payment_receipt_url),
           reviewed_at = now(),
           reviewed_by = $4,
           paid_at = CASE WHEN $1 = 'paid' THEN now() ELSE paid_at END,
           paid_by = CASE WHEN $1 = 'paid' THEN $4 ELSE paid_by END
       WHERE id = $5 AND company_id = $6
       RETURNING *`,
      [status, admin_notes || null, payment_receipt_url || null, session.dispatcherId || null, id, session.companyId]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Solicitação não encontrada" }, { status: 404 });
    }

    try { await notifyDriverOfPaymentStatus(res.rows[0]); } catch (error) { console.error("[payments] Push ao motorista falhou", error); }
    return NextResponse.json(res.rows[0]);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
