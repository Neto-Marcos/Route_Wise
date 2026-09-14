import { NextRequest, NextResponse } from "next/server";
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
