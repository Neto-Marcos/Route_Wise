import { NextRequest, NextResponse } from "next/server";

type RateBucket = {
  count: number;
  resetAt: number;
};

const MAX_TRACKED_KEYS = 5000;
const rateBuckets = new Map<string, RateBucket>();

const BLOCKED_USER_AGENTS = [
  "sqlmap",
  "nikto",
  "nmap",
  "masscan",
  "zgrab",
  "nuclei",
  "dirbuster",
  "gobuster",
  "acunetix",
  "nessus",
  "hydra",
  "havij",
  "wfuzz",
  "ffuf",
];

const BLOCKED_PATH_PREFIXES = [
  "/.env",
  "/.git",
  "/wp-admin",
  "/wp-login",
  "/wp-content",
  "/wp-includes",
  "/xmlrpc.php",
  "/phpmyadmin",
  "/pma",
  "/actuator",
  "/cgi-bin",
  "/vendor/phpunit",
  "/.aws",
  "/.ssh",
];

function getClientIp(req: NextRequest): string {
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "127.0.0.1";
}

function checkRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();

  if (rateBuckets.size >= MAX_TRACKED_KEYS) {
    for (const [k, v] of rateBuckets) {
      if (now >= v.resetAt) {
        rateBuckets.delete(k);
      }
      if (rateBuckets.size < MAX_TRACKED_KEYS * 0.8) break;
    }
    if (rateBuckets.size >= MAX_TRACKED_KEYS) {
      const oldestKey = rateBuckets.keys().next().value;
      if (oldestKey) rateBuckets.delete(oldestKey);
    }
  }

  const existing = rateBuckets.get(key);
  if (!existing || now >= existing.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true, retryAfterSec: 0 };
}

function applySecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(self), geolocation=(self), microphone=()");
  return res;
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const pathLower = pathname.toLowerCase();

  // 1. Bloqueio imediato de sondagens de exploit e arquivos ocultos
  if (BLOCKED_PATH_PREFIXES.some((prefix) => pathLower.startsWith(prefix))) {
    return NextResponse.json(
      { error: "Acesso bloqueado pela política de segurança." },
      { status: 403 }
    );
  }

  // 2. Bloqueio de scanners de vulnerabilidade automatizados
  const ua = (req.headers.get("user-agent") || "").toLowerCase();
  if (ua && BLOCKED_USER_AGENTS.some((bot) => ua.includes(bot))) {
    return NextResponse.json(
      { error: "Cliente automatizado não autorizado." },
      { status: 403 }
    );
  }

  // 3. Rate Limiting em camadas para rotas /api/*
  if (pathLower.startsWith("/api/")) {
    const ip = getClientIp(req);

    // Camada A: Autenticação e Login (máx 12 tentativas/min por IP)
    const isAuthRoute =
      pathLower === "/api/session/dispatcher" ||
      pathLower === "/api/session/driver" ||
      pathLower === "/api/session/change-password" ||
      pathLower === "/api/companies/register";

    if (isAuthRoute && req.method === "POST") {
      const check = checkRateLimit(`auth:${ip}`, 12, 60_000);
      if (!check.allowed) {
        return NextResponse.json(
          { error: "Muitas tentativas de autenticação. Aguarde 1 minuto antes de tentar novamente." },
          { status: 429, headers: { "Retry-After": String(check.retryAfterSec) } }
        );
      }
    }

    // Camada B: Rotas de Proxy Externo / Geocoding / Roteirização Pesada (máx 45 req/min por IP)
    const isHeavyRoute =
      pathLower.startsWith("/api/geocode") ||
      pathLower.startsWith("/api/road-places") ||
      pathLower.startsWith("/api/osrm") ||
      pathLower.startsWith("/api/ssw") ||
      pathLower.startsWith("/api/routerizador/generate") ||
      pathLower.startsWith("/api/routerizador/parse") ||
      pathLower.startsWith("/api/reports/export");

    if (isHeavyRoute) {
      const check = checkRateLimit(`heavy:${ip}`, 45, 60_000);
      if (!check.allowed) {
        return NextResponse.json(
          { error: "Limite de consultas por minuto excedido. Aguarde alguns segundos." },
          { status: 429, headers: { "Retry-After": String(check.retryAfterSec) } }
        );
      }
    }

    // Camada C: Limite global de API por IP (máx 240 req/min por IP)
    const globalCheck = checkRateLimit(`api:${ip}`, 240, 60_000);
    if (!globalCheck.allowed) {
      return NextResponse.json(
        { error: "Muitas requisições simultâneas. Aguarde alguns segundos." },
        { status: 429, headers: { "Retry-After": String(globalCheck.retryAfterSec) } }
      );
    }
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js).*)",
  ],
};
