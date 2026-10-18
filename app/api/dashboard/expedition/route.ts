import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  createExpeditionSnapshotService,
  DashboardError,
  READ_ACTIVE_WORKBOOK_SQL,
  type ActiveWorkbookRow,
} from "@/lib/expedition-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const service = createExpeditionSnapshotService({
  getSession: () => getSession("dispatcher"),
  readWorkbook: async (companyId) =>
    (await query<ActiveWorkbookRow>(READ_ACTIVE_WORKBOOK_SQL, [companyId])).rows[0] ?? null,
});

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(
      await service.getSnapshot(req.nextUrl.searchParams.get("month") ?? undefined),
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    const status = err instanceof DashboardError ? err.status : 503;
    const code = err instanceof DashboardError ? err.message : "DASHBOARD_UNAVAILABLE";
    return NextResponse.json(
      { error: { code } },
      { status, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
