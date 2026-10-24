export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const dns = await import("node:dns");
      dns.setDefaultResultOrder?.("ipv4first");
    } catch (e) {
      console.warn("Could not set dns result order to ipv4first:", e);
    }
  }
}

export async function onRequestError(_error: unknown, request: { path: string; method: string }, context: { routePath: string }) {
  // Keep URLs, payloads, exception messages and tokens out of telemetry.
  const path = (context.routePath || request.path.split(/[?#]/)[0]).slice(0,160);
  console.error(JSON.stringify({event:"server_error",path,method:request.method}));
  if(process.env.DATABASE_URL) {
    try {const {audit}=await import("./lib/db");await audit("system",null,"server_error","technical_event",null,{path});}catch{}
  }
}
