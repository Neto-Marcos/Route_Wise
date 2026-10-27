import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/ssw/rastreio
 * Encaminha a consulta diretamente para o sistema real do SSW (https://ssw.inf.br/2/rastreamento_danfe)
 * e retorna os dados brutos e estruturados da transportadora parceira.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { danfeKey } = body;

    if (!danfeKey) {
      return NextResponse.json(
        { error: "Informe a Chave DANFE (44 dígitos)." },
        { status: 400 }
      );
    }

    const cleanDanfe = String(danfeKey).replace(/\D/g, "");

    // 1. Faz a requisição POST real ao servidor do SSW
    const formData = new URLSearchParams();
    formData.append("danfe", cleanDanfe);
    formData.append("urlori", "");

    const sswResponse = await fetch("https://ssw.inf.br/2/rastreamento_danfe", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://ssw.inf.br/2/rastreamento_danfe",
        "Origin": "https://ssw.inf.br",
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(10000),
    });

    const html = await sswResponse.text();

    // 2. Verifica se o SSW retornou erro ou não localizou a NF
    const isNotFound = html.includes("não localizada") || html.includes("Nenhum registro") || html.includes("Chave DANFE inválida");

    return NextResponse.json({
      danfeKey: cleanDanfe,
      success: sswResponse.ok && !isNotFound,
      rawHtml: html,
      directUrl: `https://ssw.inf.br/2/rastreamento_danfe?danfe=${cleanDanfe}`,
      notFound: isNotFound,
    });
  } catch (err: any) {
    console.error("[SSW Proxy Error]", err);
    return NextResponse.json(
      { error: "Erro ao conectar com o serviço do SSW Sistemas." },
      { status: 500 }
    );
  }
}
