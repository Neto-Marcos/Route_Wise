export async function printElement(elementId: string, title: string) {
  const source = document.getElementById(elementId);
  if (!source) throw new Error("Documento de impressão não encontrado");

  // Limpa frames anteriores para evitar acúmulo no DOM
  document.querySelectorAll(".routewise-print-frame").forEach((el) => {
    try { el.remove(); } catch {}
  });

  const frame = document.createElement("iframe");
  frame.className = "routewise-print-frame";
  frame.title = "Visualização de impressão";
  // Crucial para mobile (iOS Safari / Android Chrome):
  // 1. NÃO pode ter 1px de largura/altura (senão o motor do Safari imprime página vazia ou minúscula)
  // 2. NÃO pode ter opacity: 0 ou visibility: hidden (senão o WebKit considera não renderizado)
  // 3. Fica em segundo plano (z-index: -9999) com dimensões reais para o motor calcular o layout completo
  frame.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;z-index:-9999;border:0;opacity:0.01;pointer-events:none;";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    throw new Error("Não foi possível preparar a impressão");
  }

  // Clona estilos da página principal
  const styles = Array.from(document.head.querySelectorAll('style,link[rel="stylesheet"]'))
    .map((node) => node.outerHTML)
    .join("");

  // CSS de contingência embutido: garante que o romaneio NUNCA fique em branco mesmo se o CSS externo demorar no 3G/4G
  const criticalPrintStyles = `
    <style>
      @page {
        size: A4 portrait;
        margin: 10mm;
      }
      *, *::before, *::after {
        box-sizing: border-box;
      }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: #ffffff !important;
        color: #0f172a !important;
        width: 100% !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      body.isolated-print-document {
        margin: 0 !important;
        padding: 12px !important;
        background: #fff !important;
      }
      body.isolated-print-document * {
        visibility: visible !important;
      }
      .printable-report-paper,
      .planner-print-sheet {
        display: block !important;
        position: static !important;
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 auto !important;
        box-shadow: none !important;
        visibility: visible !important;
      }
      .no-print {
        display: none !important;
      }
    </style>
  `;

  doc.open();
  doc.write(`<!doctype html>
<html data-theme="light" lang="pt-BR">
<head>
  <base href="${location.origin}/">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title.replace(/[<>&]/g, "")}</title>
  ${styles}
  ${criticalPrintStyles}
</head>
<body class="isolated-print-document">
  ${source.outerHTML}
</body>
</html>`);
  doc.close();

  // Aguarda stylesheets, fontes e imagens
  const linkPromises = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).map(
    (link) =>
      new Promise<void>((resolve) => {
        if ((link as HTMLLinkElement).sheet) return resolve();
        link.addEventListener("load", () => resolve(), { once: true });
        link.addEventListener("error", () => resolve(), { once: true });
      })
  );

  const imagePromises = Array.from(doc.images).map((img) =>
    img.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          img.onload = img.onerror = () => resolve();
        })
  );

  await Promise.race([
    Promise.all([
      doc.fonts?.ready,
      ...linkPromises,
      ...imagePromises,
    ]),
    new Promise((resolve) => window.setTimeout(resolve, 3000)),
  ]);

  // Pequeno intervalo extra para os motores mobile terminarem o reflow
  await new Promise((resolve) => window.setTimeout(resolve, 300));

  const win = frame.contentWindow;
  if (!win) {
    frame.remove();
    return;
  }

  // No celular, o diálogo de impressão (AirPrint / Spooler Android) é assíncrono e demora vários segundos.
  // NUNCA remova o iframe em 1.5s! Mantemos o frame vivo e limpamos com onafterprint ou fallback de 60s.
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      frame.remove();
    } catch {}
  };

  win.addEventListener("afterprint", cleanup, { once: true });
  window.addEventListener("afterprint", cleanup, { once: true });
  window.setTimeout(cleanup, 60000);

  win.focus();
  win.print();
}
