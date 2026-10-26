/**
 * Utilitário de impressão de relatórios e romaneios para Criar Rota.
 *
 * Suporta desktop, navegadores mobile (iOS Safari, Android Chrome) e PWA instalado (standalone):
 * 1. Não utiliza window.open("", "_blank"), eliminando bloqueios de popups e falhas em PWAs instalados.
 * 2. Em standalone PWA no Android (WebAPK), o Chromium bloqueia chamadas diretas a window.print().
 *    O utilitário armazena o romaneio e despacha via Intent para o Google Chrome,
 *    onde o Spooler de Impressão do Android abre perfeitamente.
 * 3. Em standalone PWA no iOS (iPhone/iPad), o WebKit bloqueia chamadas diretas a window.print().
 *    O utilitário armazena o romaneio com token efêmero e despacha via x-safari- para o Apple Safari,
 *    onde o AirPrint abre perfeitamente.
 * 4. Cria um portal isolado (#routewise-print-portal) montado diretamente no body para navegadores padrão.
 * 5. Dispara window.print() imediatamente sem atrasos assíncronos para não expirar o gesto do usuário no iOS/Android.
 */

export interface PrintOptions {
  routeId?: string;
}

/**
 * Detecta se a aplicação está sendo executada no modo standalone (PWA instalado) em dispositivo Android.
 */
export function isAndroidPwaStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const ua = (typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "").toLowerCase();
  const isAndroid = ua.includes("android");
  const isStandalone =
    Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches) ||
    (window.navigator as unknown as { standalone?: boolean })?.standalone === true ||
    (typeof document !== "undefined" && Boolean(document.referrer?.includes("android-app://")));
  return Boolean(isAndroid && isStandalone);
}

/**
 * Detecta se a aplicação está sendo executada no modo standalone (PWA instalado) em dispositivo iOS (iPhone / iPad).
 */
export function isIosPwaStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const ua = (typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "").toLowerCase();
  const isIos =
    /iphone|ipad|ipod/.test(ua) ||
    (typeof navigator !== "undefined" && navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
  const isStandalone =
    (window.navigator as unknown as { standalone?: boolean })?.standalone === true ||
    Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches);
  return Boolean(isIos && isStandalone);
}

export async function printElement(
  elementId: string,
  title: string,
  options?: PrintOptions
): Promise<void> {
  const source = document.getElementById(elementId);
  if (!source) throw new Error("Documento de impressão não encontrado");

  // Clona o elemento de forma profunda
  const clone = source.cloneNode(true) as HTMLElement;

  // Salva no localStorage local para fallback
  try {
    localStorage.setItem("routewise_print_html", clone.outerHTML);
    localStorage.setItem("routewise_print_title", title || "Romaneio - Criar Rota");
    if (options?.routeId) localStorage.setItem("routewise_print_route_id", options.routeId);
    localStorage.setItem("routewise_print_ts", String(Date.now()));
  } catch {}

  // 1. Standalone PWA (iOS ou Android)
  if (isIosPwaStandalone() || isAndroidPwaStandalone()) {
    let token = "";
    try {
      const res = await fetch(`${window.location.origin}/api/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html: clone.outerHTML,
          title: title || "Romaneio de Entrega",
          routeId: options?.routeId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        token = data.token || "";
      }
    } catch (e) {
      console.warn("Falha ao registrar token de impressão:", e);
    }

    const tokenParam = token
      ? `?token=${encodeURIComponent(token)}`
      : options?.routeId
      ? `?routeId=${encodeURIComponent(options.routeId)}`
      : "";
    const printUrl = `${window.location.origin}/imprimir-romaneio${tokenParam}`;

    // No Android PWA: Intent direto para o Google Chrome
    if (isAndroidPwaStandalone()) {
      const strippedUrl = printUrl.replace(/^https?:\/\//, "");
      const intentUrl = `intent://${strippedUrl}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(printUrl)};end;`;
      window.location.href = intentUrl;
      return;
    }

    // No iOS PWA (iPhone / iPad):
    // Apple WebKit standalone bloqueia window.print().
    // Redireciona via protocolo nativo x-safari- para abrir diretamente no Safari,
    // onde o AirPrint e geração de PDF abrem com 100% de suporte nativo da Apple.
    if (isIosPwaStandalone()) {
      window.location.href = `x-safari-${printUrl}`;
      return;
    }
  }

  // 2. Navegador padrão (Desktop ou Safari móvel comum)
  document.querySelectorAll("#routewise-print-portal, .routewise-print-frame").forEach((el) => {
    try { el.remove(); } catch {}
  });
  document.body.classList.remove("routewise-portal-active", "isolated-print-document");

  const portal = document.createElement("div");
  portal.id = "routewise-print-portal";
  portal.setAttribute("aria-hidden", "true");
  portal.appendChild(clone);
  document.body.appendChild(portal);

  const prevTitle = document.title;
  if (title) {
    document.title = title.replace(/[<>&]/g, "").trim();
  }
  document.body.classList.add("routewise-portal-active", "isolated-print-document");

  let cleanedUp = false;
  let cleanupTimer: any = null;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (cleanupTimer) {
      try { clearTimeout(cleanupTimer); } catch {}
      cleanupTimer = null;
    }
    if (typeof document !== "undefined" && document.body) {
      document.body.classList.remove("routewise-portal-active", "isolated-print-document");
    }
    try {
      portal.remove();
    } catch {}
    if (typeof document !== "undefined") {
      document.title = prevTitle;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("afterprint", cleanup);
    }
  };

  window.addEventListener("afterprint", cleanup, { once: true });
  cleanupTimer = window.setTimeout(cleanup, 30000);

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
