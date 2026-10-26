import { NextRequest, NextResponse } from "next/server";

// Cache em memória de romaneios para impressão (TTL: 2 horas)
interface PrintTokenData {
  html: string;
  title: string;
  routeId?: string;
  expiresAt: number;
}

const printTokenStore = new Map<string, PrintTokenData>();

// Limpeza de tokens expirados
function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [key, data] of printTokenStore.entries()) {
    if (data.expiresAt < now) {
      printTokenStore.delete(key);
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    cleanupExpiredTokens();
    const body = await req.json();
    const { html, title, routeId } = body || {};

    if (!html || typeof html !== "string") {
      return NextResponse.json({ error: "Conteúdo HTML obrigatório" }, { status: 400 });
    }

    const token = `prt_${crypto.randomUUID().replace(/-/g, "")}`;
    printTokenStore.set(token, {
      html: String(html).slice(0, 500000), // Proteção de tamanho de payload
      title: String(title || "Romaneio de Entrega").slice(0, 200),
      routeId: routeId ? String(routeId).slice(0, 100) : undefined,
      expiresAt: Date.now() + 2 * 60 * 60 * 1000, // Válido por 2 horas
    });

    return NextResponse.json({
      token,
      url: `/imprimir-romaneio?token=${token}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Erro ao gerar token de impressão", details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  cleanupExpiredTokens();
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Token não fornecido" }, { status: 400 });
  }

  const data = printTokenStore.get(token);
  if (!data || data.expiresAt < Date.now()) {
    return NextResponse.json({ error: "Token não encontrado ou expirado" }, { status: 404 });
  }

  return NextResponse.json({
    html: data.html,
    title: data.title,
    routeId: data.routeId,
  });
}
