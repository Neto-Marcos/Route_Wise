import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Proxy reverso que submete a consulta automaticamente ao SSW ou Correios
 * e devolve a página já preenchida e com a busca disparada.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const danfe = searchParams.get("danfe");
    const cnpj = searchParams.get("cnpj");
    const dias = searchParams.get("dias") || "30";

    // 1. Consulta DANFE automatizada no SSW
    if (danfe) {
      const target = "https://ssw.inf.br/2/rastreamento_danfe";
      const response = await fetch(target, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      let html = await response.text();

      // Injeta script que preenche o input e clica automaticamente no botão Rastrear assim que a página carregar
      const autoSubmitScript = `
        <script>
          window.addEventListener('DOMContentLoaded', function() {
            var input = document.getElementById('danfe');
            var btn = document.getElementById('btn_rastrear');
            if (input) input.value = '${danfe}';
            if (btn) {
              setTimeout(function() { btn.click(); }, 150);
            }
          });
        </script>
      `;

      if (html.includes("<head>")) {
        html = html.replace("<head>", `<head><base href="https://ssw.inf.br/" />${autoSubmitScript}`);
      } else {
        html = `<base href="https://ssw.inf.br/" />${autoSubmitScript}` + html;
      }

      const headers = new Headers();
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.delete("X-Frame-Options");
      headers.delete("Content-Security-Policy");

      return new NextResponse(html, { status: 200, headers });
    }

    // 2. Consulta CPF / CNPJ automatizada no SSW
    if (cnpj) {
      const target = "https://ssw.inf.br/2/rastreamento_dest?pwd=2&";
      const response = await fetch(target, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      let html = await response.text();

      const autoSubmitScript = `
        <script>
          window.addEventListener('DOMContentLoaded', function() {
            var input = document.getElementById('cnpjdest');
            var select = document.getElementById('limite_dias');
            var btn = document.getElementById('btn_rastrear_30');
            if (input) input.value = '${cnpj}';
            if (select) select.value = '${dias}';
            if (btn) {
              setTimeout(function() { btn.click(); }, 150);
            }
          });
        </script>
      `;

      if (html.includes("<head>")) {
        html = html.replace("<head>", `<head><base href="https://ssw.inf.br/" />${autoSubmitScript}`);
      } else {
        html = `<base href="https://ssw.inf.br/" />${autoSubmitScript}` + html;
      }

      const headers = new Headers();
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.delete("X-Frame-Options");
      headers.delete("Content-Security-Policy");

      return new NextResponse(html, { status: 200, headers });
    }

    // Fallback padrão
    return new NextResponse("Parâmetro de consulta não informado.", { status: 400 });
  } catch (err: any) {
    return new NextResponse(`Erro ao consultar: ${err.message}`, { status: 500 });
  }
}
