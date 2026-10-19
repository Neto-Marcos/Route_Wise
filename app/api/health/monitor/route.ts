import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { query } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const token = process.env.MONITOR_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!token || token.length < 32 || !timingSafeEqual(createHash("sha256").update(token).digest(), createHash("sha256").update(supplied).digest())) {
    return NextResponse.json({ error: "Acesso necessário" }, {status:401,headers:{"Cache-Control":"no-store"}});
  }
  try {
    const result = await query<{count:string}>("SELECT count(*)::text AS count FROM (SELECT id FROM audit_log WHERE entity_type='technical_event' AND created_at > now()-interval '5 minutes' ORDER BY id DESC LIMIT 5) recent");
    const failures = Number(result.rows[0].count);
    return NextResponse.json({status:failures>=5?"degraded":"ok",recentFailures:failures},{status:failures>=5?503:200,headers:{"Cache-Control":"no-store"}});
  } catch { return NextResponse.json({status:"unavailable"},{status:503,headers:{"Cache-Control":"no-store"}}); }
}
