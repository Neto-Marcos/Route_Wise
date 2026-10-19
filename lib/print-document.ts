export async function printElement(elementId: string, title: string) {
  const source = document.getElementById(elementId);
  if (!source) throw new Error("Documento de impressão não encontrado");

  // Open during the click, before waiting for assets. Mobile browsers need a
  // visible document and a retry button when automatic printing is ignored.
  const mobile = window.matchMedia("(any-pointer: coarse), (max-width: 860px)").matches;
  const preview = mobile ? window.open("", "_blank") : null;
  if (mobile && !preview) {
    throw new Error("Permita abrir novas abas neste navegador e toque em Imprimir novamente. Se estiver no aplicativo instalado, abra o Criar Rota no Chrome ou Safari.");
  }
  if (preview) preview.opener = null;

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
  if (!preview) document.body.appendChild(frame);

  const doc = preview?.document ?? frame.contentDocument;
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
      @media screen {
        .print-preview-toolbar { position: sticky; top: 0; z-index: 10; padding: 12px; background: #fff; border-bottom: 1px solid #cbd5e1; }
        .print-preview-toolbar button { min-height: 44px; padding: 8px 16px; background: #006b50; color: white; border: 0; border-radius: 8px; font: 600 16px Arial, sans-serif; }
        .print-preview-toolbar p { margin: 8px 0 0; font: 14px/1.5 Arial, sans-serif; }
      }
      @media print { .print-preview-toolbar { display: none !important; } }
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
  ${preview ? '<div class="print-preview-toolbar"><button type="button" id="print-preview-button">Imprimir / Salvar PDF</button><p>Se a impressão não abrir, toque no botão acima ou use a opção Imprimir no menu do navegador. Volte à aba anterior para continuar no Criar Rota.</p></div>' : ""}
  ${source.outerHTML}
</body>
</html>`);
  doc.close();
  doc.getElementById("print-preview-button")?.addEventListener("click", () => preview?.print());

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

  const win = preview ?? frame.contentWindow;
  if (!win) {
    frame.remove();
    return;
  }
  if (win.closed) return;

  // Keep the visible preview available after cancel/print for retry or PDF.
  if (preview) {
    preview.focus();
    try { preview.print(); } catch { /* The visible button remains available. */ }
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
