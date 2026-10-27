import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Proxy reverso otimizado para o SSW e Correios.
 * Submete o formulário diretamente do lado do servidor ou injeta auto-submit
 * no padrão do script do SSW (document['Form1'].submit()).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const danfe = searchParams.get("danfe");
    const nf = searchParams.get("nf");
    const cnpj = searchParams.get("cnpj");
    const dias = searchParams.get("dias") || "30";
    const correios = searchParams.get("correios");

    // 1. Rastreamento dos Correios
    if (correios) {
      const target = `https://rastreamento.correios.com.br/app/index.php?codigo=${encodeURIComponent(correios)}`;
      const response = await fetch(target, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(10000),
      });

      let html = await response.text();

      // Ajusta URLs relativas para apontar para o domínio oficial dos Correios
      html = html.replace(/src="\/(?!\/)/g, 'src="https://rastreamento.correios.com.br/');
      html = html.replace(/href="\/(?!\/)/g, 'href="https://rastreamento.correios.com.br/');
      html = html.replace(/action="\/(?!\/)/g, 'action="https://rastreamento.correios.com.br/');

      if (html.includes("<head>")) {
        html = html.replace("<head>", `<head><base href="https://rastreamento.correios.com.br/app/" />`);
      }

      const headers = new Headers();
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.delete("X-Frame-Options");
      headers.delete("Content-Security-Policy");

      return new NextResponse(html, { status: 200, headers });
    }

    // 2. Rastreamento por DANFE no SSW
    if (danfe) {
      // Faz o POST direto para o endpoint do SSW recebendo o resultado renderizado
      const formData = new URLSearchParams();
      formData.append("danfe", danfe);
      formData.append("urlori", "");

      const postRes = await fetch("https://ssw.inf.br/2/rastreamento_danfe", {
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

      let html = await postRes.text();

      if (html.includes("<head>")) {
        html = html.replace("<head>", `<head><base href="https://ssw.inf.br/" />`);
      } else {
        html = `<base href="https://ssw.inf.br/" />` + html;
      }

      const headers = new Headers();
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.delete("X-Frame-Options");
      headers.delete("Content-Security-Policy");

      return new NextResponse(html, { status: 200, headers });
    }

    // 2.1 Rastreamento por Número de Nota Fiscal no SSW (rastreamento_nf)
    if (nf) {
      const formData = new URLSearchParams();
      formData.append("nrnf", nf.trim());
      formData.append("cnpj", cnpj ? cnpj.replace(/\D/g, "") : "");
      formData.append("urlori", "/2/rastreamento_nf");

      const postRes = await fetch("https://ssw.inf.br/2/resultSSW_dest", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://ssw.inf.br/2/rastreamento_nf",
          "Origin": "https://ssw.inf.br",
        },
        body: formData.toString(),
        signal: AbortSignal.timeout(10000),
      });

      let html = await postRes.text();

      if (html.includes("<head>")) {
        html = html.replace("<head>", `<head><base href="https://ssw.inf.br/" />`);
      } else {
        html = `<base href="https://ssw.inf.br/" />` + html;
      }

      const headers = new Headers();
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.delete("X-Frame-Options");
      headers.delete("Content-Security-Policy");

      return new NextResponse(html, { status: 200, headers });
    }

    // 3. Rastreamento por CNPJ / CPF no SSW
    if (cnpj) {
      const formData = new URLSearchParams();
      formData.append("cnpjdest", cnpj);
      formData.append("limite_dias", dias);
      formData.append("urlori", "/2/rastreamento_dest");

      const postRes = await fetch("https://ssw.inf.br/2/resultSSW_dest", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://ssw.inf.br/2/rastreamento_dest?pwd=2&",
          "Origin": "https://ssw.inf.br",
        },
        body: formData.toString(),
        signal: AbortSignal.timeout(10000),
      });

      let html = await postRes.text();

      if (html.includes("<head>")) {
        html = html.replace("<head>", `<head><base href="https://ssw.inf.br/" />`);
      } else {
        html = `<base href="https://ssw.inf.br/" />` + html;
      }

      const headers = new Headers();
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.delete("X-Frame-Options");
      headers.delete("Content-Security-Policy");

      return new NextResponse(html, { status: 200, headers });
    }

    return new NextResponse("Parâmetro de consulta não informado.", { status: 400 });
  } catch (err: any) {
    return new NextResponse(`Erro ao processar consulta: ${err.message}`, { status: 500 });
  }
}
