import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

let lastHealthOkAt = 0;

export async function GET() {
  const now = Date.now();
  // Cache de 5s para evitar que enxurradas de healthcheck saturem o pool do PostgreSQL
  if (now - lastHealthOkAt < 5000) {
    return NextResponse.json(
      { status: "ok", version: APP_VERSION },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    await query("SELECT 1 FROM routes LIMIT 0");
    await query("SELECT file_data FROM upload_objects LIMIT 0");
    lastHealthOkAt = Date.now();
    return NextResponse.json(
      { status: "ok", version: APP_VERSION },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable", version: APP_VERSION },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
