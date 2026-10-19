import type { Metadata, Viewport } from "next";
import { ClientMonitor } from "@/components/client-monitor";
import Script from "next/script";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "./ui-refinement.css";
import "./mobile-ui.css";
import "./account-menu.css";
import "./planner-resize.css";
import "./wide-ui.css";
import "./navigation-viewport.css";

export const metadata: Metadata = {
  title: "Criar Rota — Gestão de Rotas",
  description: "Planejamento, acompanhamento e comprovação de entregas.",
  applicationName: "Criar Rota",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Criar Rota",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "Criar Rota",
    description: "Rotas claras. Entregas sob controle.",
    images: ["https://criarrota.com.br/brand/social.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Criar Rota",
    description: "Rotas claras. Entregas sob controle.",
    images: ["https://criarrota.com.br/brand/social.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#14243A",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <Script src="/local-network-errors.js" strategy="beforeInteractive" />
      </head>
      <body><ClientMonitor />{children}</body>
    </html>
  );
}
