import { NextResponse } from "next/server";
import pg from "pg";
import { APP_VERSION } from "@/lib/version";
export const dynamic = "force-dynamic";
export async function GET() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000, query_timeout: 2000 });
  try {
    if (!process.env.DATABASE_URL) throw new Error("Production database is not configured");
    await client.connect();
    await client.query("SELECT 1 FROM routes LIMIT 0");
    await client.query("SELECT file_data FROM upload_objects LIMIT 0");
    return NextResponse.json({ status: "ok", version: APP_VERSION }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable", version: APP_VERSION }, { status: 503, headers: { "Cache-Control": "no-store" } });
  } finally { await client.end().catch(() => {}); }
}
