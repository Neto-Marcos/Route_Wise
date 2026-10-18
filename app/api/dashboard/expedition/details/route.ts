import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  DashboardError,
  READ_ACTIVE_WORKBOOK_SQL,
  type ActiveWorkbookRow,
} from "@/lib/expedition-snapshot";
import { createExpeditionDetailService } from "@/lib/expedition-details";
import { requireRoutingDispatcher, RoutingError } from "@/lib/routing-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const service = createExpeditionDetailService({
  getSession: async () =>
    requireRoutingDispatcher({ query }, await getSession("dispatcher")),
  readWorkbook: async (companyId) =>
    (await query<ActiveWorkbookRow>(READ_ACTIVE_WORKBOOK_SQL, [companyId])).rows[0] ?? null,
});

export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    return NextResponse.json(await service.getDetail(req.nextUrl.searchParams), {
      headers,
    });
  } catch (err) {
    const status =
      err instanceof DashboardError || err instanceof RoutingError ? err.status : 503;
    const code =
      err instanceof DashboardError
        ? err.message
        : err instanceof RoutingError
        ? "TRACE_ACCESS_DENIED"
        : "TRACE_UNAVAILABLE";
    return NextResponse.json({ error: { code } }, { status, headers });
  }
}
