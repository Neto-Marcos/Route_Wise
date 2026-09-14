import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

// Salva inscrição Push no PWA do usuário
export async function POST(request: Request) {
  const session = await getSession("dispatcher");
  const driverSession = await getSession("driver");

  if (!session && !driverSession) {
    return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
  }

  const companyId = session?.companyId || driverSession?.companyId;
  const userType = session ? "dispatcher" : "driver";
  const userId = session?.dispatcherId || driverSession?.driverId || "unknown";

  try {
    const body = await request.json();
    const { endpoint, keys } = body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: "Inscrição push inválida" }, { status: 400 });
    }

    await query(
      `INSERT INTO push_subscriptions (company_id, user_type, user_id, endpoint, p256dh, auth, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (endpoint) DO UPDATE
       SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, updated_at = now()`,
      [companyId, userType, userId, endpoint, keys.p256dh, keys.auth]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
