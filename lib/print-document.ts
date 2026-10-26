/**
 * Utilitário de impressão de relatórios e romaneios para Criar Rota.
 *
 * Suporta desktop, navegadores mobile (iOS Safari, Android Chrome) e PWA instalado (standalone):
 * 1. Não utiliza window.open("", "_blank"), eliminando bloqueios de popups e falhas em PWAs instalados.
 * 2. Cria um portal isolado (#routewise-print-portal) montado diretamente no body.
 * 3. Aplica classes no body (routewise-portal-active isolated-print-document) para ocultar
 *    a interface da aplicação (barras de navegação, mapas, modais) durante o print.
 * 4. Define o document.title com o nome do romaneio para que o arquivo PDF salvo receba o nome correto.
 * 5. Dispara window.print() de forma imediata preservando o gesto do usuário no iOS/Android.
 * 6. Limpa o portal e restaura o título após a impressão (evento afterprint e fallback seguro).
 */
export async function printElement(elementId: string, title: string): Promise<void> {
  const source = document.getElementById(elementId);
  if (!source) throw new Error("Documento de impressão não encontrado");

  // Limpa portais ou frames anteriores para evitar acúmulo no DOM
  document.querySelectorAll("#routewise-print-portal, .routewise-print-frame").forEach((el) => {
    try { el.remove(); } catch {}
  });
  document.body.classList.remove("routewise-portal-active", "isolated-print-document");

  // Cria o portal de impressão isolado no body principal
  const portal = document.createElement("div");
  portal.id = "routewise-print-portal";
  portal.setAttribute("aria-hidden", "true");

  // Clona o elemento de forma profunda
  const clone = source.cloneNode(true) as HTMLElement;
  portal.appendChild(clone);
  document.body.appendChild(portal);

  // Altera o título da página para que o PDF gerado ou diálogo de impressão mostre o nome correto
  const prevTitle = document.title;
  if (title) {
    document.title = title.replace(/[<>&]/g, "").trim();
  }

  // Ativa classes de impressão no body
  document.body.classList.add("routewise-portal-active", "isolated-print-document");

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    document.body.classList.remove("routewise-portal-active", "isolated-print-document");
    try {
      portal.remove();
    } catch {}
    document.title = prevTitle;
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup, { once: true });
  // Timeout de segurança caso afterprint não seja disparado
  window.setTimeout(cleanup, 120000);

  // Aguarda imagens pendentes decodificarem (máximo 400ms para não expirar o gesto do usuário no iOS Safari)
  const images = Array.from(portal.querySelectorAll("img"));
  const pendingImages = images.filter((img) => !img.complete);
  if (pendingImages.length > 0) {
    await Promise.race([
      Promise.all(
        pendingImages.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) return resolve();
              img.onload = img.onerror = () => resolve();
            })
        )
      ),
      new Promise<void>((resolve) => window.setTimeout(resolve, 400)),
    ]);
  }

  // Invoca a impressão nativa do navegador
  // iOS Safari / PWA: abre a folha nativa do AirPrint imediatamente
  // Android Chrome / PWA: abre o Spooler de Impressão do Android (Salvar como PDF / Imprimir)
  // Desktop: abre o diálogo nativo de impressão
  if (typeof window.print !== "function") {
    cleanup();
    throw new Error("Seu navegador não suporta impressão nativa. Abra o Criar Rota no Google Chrome ou Safari.");
  }

  try {
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}
