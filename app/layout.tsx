import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rota fácil — Gestão de Rotas",
  description: "Planejamento, acompanhamento e comprovação de entregas.",
  applicationName: "Rota fácil",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Rota fácil",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "Rota fácil",
    description: "Rotas claras. Entregas sob controle.",
    images: ["https://criarrota.up.railway.app/brand/social.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Rota fácil",
    description: "Rotas claras. Entregas sob controle.",
    images: ["https://criarrota.up.railway.app/brand/social.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon.svg", type: "image/svg+xml" },
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
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
