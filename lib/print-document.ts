export async function printElement(elementId: string, title: string) {
  const source = document.getElementById(elementId);
  if (!source) throw new Error("Documento de impressão não encontrado");

  const frame = document.createElement("iframe");
  frame.title = "Visualização de impressão";
  frame.style.cssText = "position:fixed;width:1px;height:1px;right:0;bottom:0;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); throw new Error("Não foi possível preparar a impressão"); }

  const styles = Array.from(document.head.querySelectorAll('style,link[rel="stylesheet"]'))
    .map((node) => node.outerHTML).join("");
  doc.open();
  doc.write(`<!doctype html><html data-theme="light"><head><base href="${location.origin}/"><meta charset="utf-8"><title>${title.replace(/[<>&]/g, "")}</title>${styles}</head><body class="isolated-print-document">${source.outerHTML}</body></html>`);
  doc.close();

  await Promise.race([
    Promise.all([
      doc.fonts?.ready,
      ...Array.from(doc.images).map((img) => img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
        img.onload = img.onerror = () => resolve();
      })),
    ]),
    new Promise((resolve) => window.setTimeout(resolve, 2500)),
  ]);
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  window.setTimeout(() => frame.remove(), 1500);
}
