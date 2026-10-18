import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export function GET() {
  const sha = process.env.APP_GIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || "unknown";
  return NextResponse.json(
    {
      appVersion: APP_VERSION,
      gitSha: /^[a-f0-9]{40}$/i.test(sha) ? sha : "unknown",
      environment: process.env.APP_ENV || process.env.RAILWAY_ENVIRONMENT_NAME || "local",
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
