import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata:Metadata={title:"RouteWise — Gestão de Rotas",description:"Planejamento, acompanhamento e comprovação de entregas.",manifest:"/manifest.json"};
export const viewport:Viewport={width:"device-width",initialScale:1,viewportFit:"cover",themeColor:"#0b1220"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
