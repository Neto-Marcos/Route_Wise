"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Printer, Share2, RefreshCw } from "lucide-react";

function PrintContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const routeId = searchParams.get("routeId");

  const [htmlContent, setHtmlContent] = useState<string>("");
  const [docTitle, setDocTitle] = useState<string>("Romaneio de Entrega");
  const [loading, setLoading] = useState<boolean>(true);
  const [printed, setPrinted] = useState<boolean>(false);
  const [canShare, setCanShare] = useState<boolean>(false);

  useEffect(() => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      setCanShare(true);
    }

    // 1. Prioridade máxima: carregar via Token de Impressão da API (funciona cross-browser, cross-PWA e Safari sem auth)
    if (token) {
      fetch(`/api/print?token=${encodeURIComponent(token)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.html) {
            setHtmlContent(data.html);
            if (data.title) {
              setDocTitle(data.title);
              document.title = data.title;
            }
            setLoading(false);
          } else {
            fallbackLocal();
          }
        })
        .catch(() => fallbackLocal());
      return;
    }

    fallbackLocal();

    function fallbackLocal() {
      // 2. Fallback: carregar do localStorage da sessão atual
      let loadedHtml = "";
      let loadedTitle = "";
      try {
        loadedHtml = localStorage.getItem("routewise_print_html") || "";
        loadedTitle = localStorage.getItem("routewise_print_title") || "";
      } catch {}

      if (loadedHtml) {
        setHtmlContent(loadedHtml);
        if (loadedTitle) {
          setDocTitle(loadedTitle);
          document.title = loadedTitle;
        }
        setLoading(false);
        return;
      }

      // 3. Fallback: carregar via routeId da API
      if (routeId) {
        fetch(`/api/routes/${encodeURIComponent(routeId)}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.route) {
              const r = data.route;
              setDocTitle(`Romaneio - ${r.name}`);
              document.title = `Romaneio - ${r.name}`;
              setHtmlContent(`
                <div class="printable-report-paper">
                  <header class="report-doc-header">
                    <div class="report-logo">
                      <img class="brand-mark" src="/icon.svg" width="40" height="40" alt="" />
                      <b>Criar Rota</b>
                    </div>
                    <div class="report-title-block">
                      <h1>ROMANEIO DE ENTREGA</h1>
                      <p>Comprovante operacional de viagem e entregas</p>
                    </div>
                  </header>
                  <section class="report-section">
                    <h2>${r.name}</h2>
                    <p>Motorista: <b>${r.driver_name || "Não atribuído"}</b> | Placa: <b>${r.driver_plate || "--"}</b></p>
                    <p>Data: <b>${r.route_date ? new Date(r.route_date).toLocaleDateString("pt-BR") : "--"}</b></p>
                  </section>
                </div>
              `);
            }
          })
          .catch(() => {})
          .finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    }
  }, [token, routeId]);

  // Disparo automático do AirPrint / Spooler nativo ao abrir a página
  useEffect(() => {
    if (!htmlContent || loading || printed) return;
    const timer = setTimeout(() => {
      try {
        setPrinted(true);
        window.print();
      } catch (e) {
        console.warn("Auto print error:", e);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [htmlContent, loading, printed]);

  const handlePrint = () => {
    try {
      window.print();
    } catch (e) {
      console.error("Print error:", e);
    }
  };

  const handleShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: docTitle,
          text: `Romaneio de entrega Criar Rota: ${docTitle}`,
          url: window.location.href,
        });
      } catch {}
    }
  };

  if (loading) {
    return (
      <main className="standalone-print-page">
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <RefreshCw className="spin" size={32} style={{ marginBottom: "16px", color: "var(--primary, #008060)" }} />
          <p>Preparando romaneio para impressão…</p>
        </div>
      </main>
    );
  }

  if (!htmlContent) {
    return (
      <main className="standalone-print-page">
        <div className="standalone-print-bar no-print">
          <Link href="/" className="back-link">
            <ArrowLeft size={16} /> Voltar ao Criar Rota
          </Link>
        </div>
        <div style={{ textAlign: "center", padding: "60px 20px", maxWidth: "480px" }}>
          <h2>Nenhum documento encontrado</h2>
          <p style={{ margin: "12px 0 24px", color: "var(--muted)" }}>
            Não encontramos nenhum romaneio recente para impressão nesta sessão.
          </p>
          <Link href="/" className="button primary">
            Ir para a página inicial
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="standalone-print-page">
      {/* Barra de Ações Superior (Oculta na folha impressa A4) */}
      <div className="standalone-print-bar no-print">
        <div className="print-bar-brand">
          <Link href="/" className="back-link">
            <ArrowLeft size={16} /> Voltar ao App
          </Link>
          <span className="print-bar-title">{docTitle}</span>
        </div>

        <div className="print-bar-actions">
          {canShare && (
            <button type="button" onClick={handleShare} className="button secondary compact">
              <Share2 size={15} /> Compartilhar
            </button>
          )}
          <button type="button" onClick={handlePrint} className="button primary compact">
            <Printer size={15} /> Imprimir / Salvar PDF
          </button>
        </div>
      </div>

      {/* Conteúdo Impresso */}
      <div
        className="standalone-print-content"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </main>
  );
}

export default function ImprimirRomaneioPage() {
  return (
    <Suspense
      fallback={
        <main className="standalone-print-page">
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <p>Carregando romaneio…</p>
          </div>
        </main>
      }
    >
      <PrintContent />
    </Suspense>
  );
}
