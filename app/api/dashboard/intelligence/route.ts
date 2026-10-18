import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  DashboardError,
  READ_ACTIVE_WORKBOOK_SQL,
  type ActiveWorkbookRow,
} from "@/lib/expedition-snapshot";
import { createIntelligenceService } from "@/lib/intelligence-service";
import { requireRoutingDispatcher, RoutingError } from "@/lib/routing-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const service = createIntelligenceService({
  getSession: async () =>
    requireRoutingDispatcher({ query }, await getSession("dispatcher")),
  readWorkbook: async (companyId) =>
    (await query<ActiveWorkbookRow>(READ_ACTIVE_WORKBOOK_SQL, [companyId])).rows[0] ?? null,
});

export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    return NextResponse.json(await service.get(req.nextUrl.searchParams), { headers });
  } catch (err) {
    const status =
      err instanceof DashboardError || err instanceof RoutingError ? err.status : 503;
    return NextResponse.json(
      {
        error: {
          code:
            err instanceof DashboardError
              ? err.message
              : err instanceof RoutingError
              ? "INTELLIGENCE_ACCESS_DENIED"
              : "INTELLIGENCE_UNAVAILABLE",
        },
      },
      { status, headers }
    );
  }
}
