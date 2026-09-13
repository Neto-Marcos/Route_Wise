import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Proxy reverso seguro para renderizar páginas do SSW sem bloqueios de frame
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

    // Insere base href para que todos os scripts, estilos e fontes carreguem do domínio oficial
    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head><base href="https://ssw.inf.br/" />`);
    } else {
      html = `<base href="https://ssw.inf.br/" />` + html;
    }

    const headers = new Headers();
    headers.set("Content-Type", "text/html; charset=utf-8");
    // Remove cabeçalhos de bloqueio
    headers.delete("X-Frame-Options");
    headers.delete("Content-Security-Policy");

    return new NextResponse(html, {
      status: response.status,
      headers,
    });
  } catch (err: any) {
    return new NextResponse(`Erro ao carregar SSW: ${err.message}`, { status: 500 });
  }
}
