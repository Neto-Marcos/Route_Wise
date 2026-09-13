import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/ssw/proxy?url=...
 * Proxy reverso que busca a página do SSW e remove o cabeçalho X-Frame-Options
 * e Content-Security-Policy para permitir renderizar diretamente no seu painel sem bloqueio do navegador.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const target = searchParams.get("url") || "https://ssw.inf.br/2/rastreamento_danfe";

    const response = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    let html = await response.text();

    // Reescreve URLs relativas para apontarem para o domínio do SSW
    html = html.replace(/href="\/(?!\/)/g, 'href="https://ssw.inf.br/');
    html = html.replace(/src="\/(?!\/)/g, 'src="https://ssw.inf.br/');
    html = html.replace(/action="\/(?!\/)/g, 'action="https://ssw.inf.br/');

    return new NextResponse(html, {
      status: response.status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Remove restrições de iframe para rodar liso no seu site
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: any) {
    return new NextResponse(`Erro ao carregar página do SSW: ${err.message}`, { status: 500 });
  }
}
