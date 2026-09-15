"use client";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Copy,
  Download,
  Eye,
  ExternalLink,
  FileText,
  Filter,
  Gauge,
  KeyRound,
  Lock,
  LogOut,
  LocateFixed,
  Mail,
  Map as MapIcon,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Power,
  Printer,
  RefreshCw,
  RotateCcw,
  Route as RouteIcon,
  Search,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Moon,
  Sun,
  Trash2,
  Truck,
  Upload,
  UserRound,
  Users,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { enqueue, flushQueue } from "@/lib/offline";
import { compressDriverPhoto, arrayBufferToBase64 } from "@/lib/driver-photo";
import { LiveFleetMap } from "./live-fleet-map";
import { DriverLiveMap } from "./driver-live-map";
import { RouteDetailModal, type DetailedRoute } from "./route-detail-modal";
import { RouteReportModal } from "./route-report-modal";
import { printElement } from "@/lib/print-document";
import RoteirizadorPage from "./roteirizador-page";
import type { SuggestedRoute, EngineConfig } from "@/lib/route-engine";
import { SSWTrackingView } from "./ssw-tracking-view";
import { DashboardAnalytics } from "./dashboard-analytics";
import { CityHeatmapModal } from "./city-heatmap-modal";
import { OperationsHub } from "./operations-hub";
import { PaymentRequestModal } from "./payment-request-modal";

type DispatcherUser = {
  id: string;
  name: string;
  email: string;
  role?: "superadmin" | "admin" | "route_creator" | "office";
  active: boolean;
  created_at: string;
};

type Driver = {
  id: string;
  public_id: string;
  name: string;
  phone?: string;
  photo?: string | null;
  active?: boolean;
};

type Vehicle = {
  id: string;
  name: string;
  plate: string;
  current_odometer: number;
  rate_per_km?: number | null;
  active?: boolean;
};
type Stop = {
  id?: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  is_origin?: boolean;
  status?: "pending" | "delivered";
  boxes?: number;
  volume_m3?: number;
  /** Números dos pedidos importados da planilha para esta entrega. */
  order_ids?: string[];
};
type Station = {
  id_rede: string;
  nome: string;
  latitude: string;
  longitude: string;
  diesel?: string;
  diesels10?: string;
  cidade: string;
  estado: string;
  logradouro: string;
  numero: string;
};
let stationsRequest: Promise<Station[]> | null = null;
function loadStations() {
  stationsRequest ??= api("/api/stations").catch((error) => {
    stationsRequest = null;
    throw error;
  });
  return stationsRequest;
}
export const STOP_PALETTE = [
  "#0f172a", // Origin (CD - Preto profundo)
  "#3b82f6", // 1 Azul Royal
  "#10b981", // 2 Verde Esmeralda
  "#8b5cf6", // 3 Roxo
  "#f97316", // 4 Laranja
  "#f43f5e", // 5 Vermelho
  "#06b6d4", // 6 Ciano
  "#eab308", // 7 Âmbar
  "#6366f1", // 8 Índigo
  "#14b8a6", // 9 Teal
];
export function getStopColor(index: number): string {
  if (index === 0) return "#0f172a";
  return STOP_PALETTE[((index - 1) % (STOP_PALETTE.length - 1)) + 1];
}
type RouteData = {
  id: string;
  public_id: string;
  name: string;
  route_date: string;
  status: string;
  driver_id?: string;
  driver_name?: string;
  vehicle_name?: string;
  plate?: string;
  vehicle_odometer?: number;
  odometer?: Array<{ phase: "start" | "finish"; kilometers: number; photo_url?: string; recorded_at: string }>;
  deliveries: number;
  delivered: number;
  estimated_km?: number;
  actual_km?: number;
  last_location?: { lat: number; lng: number; recorded_at: string };
  stops?: Stop[];
};
const api = async (url: string, options?: RequestInit) => {
  const role = typeof window !== "undefined" ? sessionStorage.getItem("rw_role") : null;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(role ? { "X-RouteWise-Role": role } : {}),
      ...options?.headers,
    },
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || "Não foi possível concluir");
  return out;
};
const DISPATCHER_OFFLINE_SNAPSHOT = "rw_dispatcher_offline_snapshot_v1";
function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true),
      off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function formatDateBR(dateStr?: string | null): string {
  if (!dateStr) return "—";
  const clean = String(dateStr).slice(0, 10);
  const parts = clean.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return clean;
}

export default function RouteWiseApp() {
  const [activePortal, setActivePortal] = useState<
    "planner" | "dispatcher" | "driver" | "home"
  >("home");
  const [targetRole, setTargetRole] = useState<"admin" | "route_creator" | "office">("admin");
  const [dispatcherAuthed, setDispatcherAuthed] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [pwaRefreshing, setPwaRefreshing] = useState(false);
  const online = useOnline();

  useEffect(() => {
    let pullStartY: number | null = null;
    let refreshing = false;
    let registration: ServiceWorkerRegistration | undefined;

    const checkForUpdate = () => registration?.update().catch(() => {});
    const refreshFromPull = async () => {
      if (refreshing || !navigator.onLine) return;
      refreshing = true;
      setPwaRefreshing(true);
      try {
        await Promise.all([
          registration?.update(),
          new Promise((resolve) => window.setTimeout(resolve, 550)),
        ]);
      } finally {
        // A navegação é feita depois da checagem: o service worker usa rede
        // primeiro e traz imediatamente a versão mais recente do servidor.
        window.location.reload();
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      const atTop = window.scrollY <= 0 && document.documentElement.scrollTop <= 0;
      pullStartY = atTop ? event.touches[0]?.clientY ?? null : null;
    };
    const onTouchEnd = (event: TouchEvent) => {
      const endY = event.changedTouches[0]?.clientY;
      if (pullStartY !== null && endY && endY - pullStartY > 92) refreshFromPull();
      pullStartY = null;
    };

    navigator.serviceWorker?.register("/sw.js", { updateViaCache: "none" }).then((nextRegistration) => {
      registration = nextRegistration;
      checkForUpdate();
    }).catch(() => {});
    if (online) flushQueue().catch(() => {});

    window.addEventListener("focus", checkForUpdate);
    document.addEventListener("visibilitychange", checkForUpdate);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });

    // Check saved dispatcher role in session and verify with server
    if (typeof window !== "undefined") {
      api("/api/session/me")
        .then((s) => {
          if (s?.authenticated && s.role === "dispatcher") {
            setDispatcherAuthed(true);
            sessionStorage.setItem("rw_role", "dispatcher");
            if (s.userRole) sessionStorage.setItem("rw_user_role", s.userRole);
          } else if (sessionStorage.getItem("rw_role") === "dispatcher") {
            setDispatcherAuthed(false);
            sessionStorage.removeItem("rw_role");
            sessionStorage.removeItem("rw_user_role");
          }
        })
        .catch(() => {
          // Não valida sessão sem rede, mas mantém o painel já autenticado
          // acessível nesta mesma sessão do PWA.
          if (!navigator.onLine && sessionStorage.getItem("rw_role") === "dispatcher") {
            setDispatcherAuthed(true);
            setActivePortal("dispatcher");
          }
        });
    }

    // Check saved theme
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("rw_theme") as "light" | "dark" | null;
      if (savedTheme === "dark" || savedTheme === "light") {
        setTheme(savedTheme);
        document.documentElement.setAttribute("data-theme", savedTheme);
        if (savedTheme === "dark") document.documentElement.classList.add("dark");
        else document.documentElement.classList.remove("dark");
      }
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("focus", checkForUpdate);
      document.removeEventListener("visibilitychange", checkForUpdate);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [online]);

  const handleThemeChange = (nextTheme: "light" | "dark") => {
    setTheme(nextTheme);
    if (typeof window !== "undefined") {
      localStorage.setItem("rw_theme", nextTheme);
      document.documentElement.setAttribute("data-theme", nextTheme);
      if (nextTheme === "dark") document.documentElement.classList.add("dark");
      else document.documentElement.classList.remove("dark");
    }
  };

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      setInstallPrompt(null);
    }
  };

  return (
    <div className="app">

      {pwaRefreshing && <div className="pwa-refreshing" role="status" aria-live="polite"><RefreshCw size={19} /> Atualizando Criar Rota...</div>}

      {installPrompt && (
        <aside className="pwa-install-banner no-print">
          <div className="pwa-banner-content">
            <span className="pwa-icon">📱</span>
            <div>
              <b>Instalar Criar Rota no Celular</b>
              <small>Acesso rápido direto da tela inicial, funciona offline</small>
            </div>
          </div>
          <div className="pwa-banner-actions">
            <button type="button" className="button primary compact" onClick={handleInstallClick}>
              Instalar
            </button>
            <button type="button" className="banner-dismiss" onClick={() => setInstallPrompt(null)} aria-label="Fechar">
              <X size={16} />
            </button>
          </div>
        </aside>
      )}

      {activePortal === "home" && (
        <Home
          onSelectRole={(role) => {
            if (role === "driver") {
              setActivePortal("driver");
            } else {
              setTargetRole(role);
              setActivePortal("dispatcher");
            }
          }}
        />
      )}

      {activePortal === "planner" && (
        <RoutePlannerView
          onClose={() => setActivePortal("home")}
          onSwitchToDispatcher={() => setActivePortal("dispatcher")}
          onSwitchToDriver={() => setActivePortal("driver")}
        />
      )}

      {activePortal === "dispatcher" && (
        !dispatcherAuthed ? (
          <Pin
            targetRole={targetRole}
            onBack={() => setActivePortal("home")}
            onSuccess={() => setDispatcherAuthed(true)}
          />
        ) : (
          <Dispatcher
            onExit={() => {
              api("/api/session/logout", { method: "POST" }).catch(() => {});
              sessionStorage.removeItem("rw_role");
              sessionStorage.removeItem("rw_user_role");
              localStorage.removeItem(DISPATCHER_OFFLINE_SNAPSHOT);
              setDispatcherAuthed(false);
              setActivePortal("home");
            }}
          />
        )
      )}

      {activePortal === "driver" && (
        !selectedDriver ? (
          <DriverPicker
            onBack={() => setActivePortal("home")}
            onPick={(d) => setSelectedDriver(d)}
          />
        ) : (
          <DriverApp
            driver={selectedDriver}
            onExit={() => {
              api("/api/session/logout", { method: "POST", headers: { "X-RouteWise-Role": "driver" } }).catch(() => {});
              setSelectedDriver(null);
              sessionStorage.removeItem("rw_role");
              sessionStorage.removeItem("rw_user_role");
              setActivePortal("home");
            }}
            online={online}
          />
        )
      )}
    </div>
  );
}

function Connection({ online }: { online: boolean }) {
  return (
    <div className={`connection ${online ? "online" : "offline"}`}>
      {online ? <Wifi size={13} /> : <WifiOff size={13} />}{" "}
      {online ? "Sincronizado" : "Offline · dados na fila"}
    </div>
  );
}

function Logo() {
  return (
    <div className="logo">
      <img src="/icon.svg" width={34} height={34} alt="" aria-hidden="true" style={{ borderRadius: "8px" }} />
      <b>Criar Rota</b>
    </div>
  );
}

function ThemeToggle({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const [currentTheme, setCurrentTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = (localStorage.getItem("rw_theme") as "light" | "dark") ||
        (document.documentElement.getAttribute("data-theme") as "light" | "dark") ||
        "light";
      setCurrentTheme(saved);
    }
  }, []);

  const toggle = () => {
    const next = currentTheme === "dark" ? "light" : "dark";
    setCurrentTheme(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("rw_theme", next);
      document.documentElement.setAttribute("data-theme", next);
      if (next === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  };

  return (
    <button
      type="button"
      className={`theme-toggle-btn ${className || ""}`}
      style={style}
      onClick={toggle}
      title={currentTheme === "dark" ? "Alternar para modo claro" : "Alternar para modo escuro"}
      aria-label="Alternar modo de cor"
    >
      {currentTheme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

function ChangePasswordModal({
  onClose,
  onLogout,
}: {
  onClose: () => void;
  onLogout: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("A nova senha e a confirmação não conferem.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await api("/api/session/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      alert(res.message || "Senha alterada com sucesso! Você foi desconectado por segurança.");
      onLogout();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Alterar minha senha" onClose={onClose}>
      <form onSubmit={handleSubmit} className="form-grid">
        <div className="modal-info-box">
          <KeyRound size={20} />
          <p>
            Por motivos de segurança, ao confirmar a alteração da sua senha você será desconectado imediatamente de todos os dispositivos.
          </p>
        </div>
        <label>
          Senha atual
          <input
            type="password"
            autoFocus
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Digite a senha atual"
            autoComplete="current-password"
          />
        </label>
        <label>
          Nova senha
          <input
            type="password"
            required
            minLength={4}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Mínimo 6 caracteres (ou 4 para motorista)"
            autoComplete="new-password"
          />
        </label>
        <label>
          Confirmar nova senha
          <input
            type="password"
            required
            minLength={4}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repita a nova senha"
            autoComplete="new-password"
          />
        </label>
        <button disabled={loading} className="button primary">
          {loading ? "Atualizando…" : "Salvar nova senha e sair"}
        </button>
        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  );
}

function Home({
  onSelectRole,
}: {
  onSelectRole: (role: "admin" | "route_creator" | "office" | "driver") => void;
}) {
  return (
    <main className="home">
      <section className="home-copy">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <Logo />
          <ThemeToggle />
        </div>
        <div>
          <span className="eyebrow">SISTEMA INTELIGENTE DE ROTAS</span>
          <h1>
            Rotas claras.
            <br />
            Entregas sob controle.
          </h1>
          <p>
            Planeje percursos otimizados, roteirize por planilhas, despache para motoristas e rastreie notas fiscais com comprovantes em tempo real.
          </p>
        </div>
        <small>
          Funciona em qualquer navegador e pode ser instalado no celular ou tablet.
        </small>
      </section>
      <section className="access-panel">
        <div className="access-head">
          <h2>Selecione seu perfil</h2>
          <p>Escolha o ambiente da sua operação para entrar.</p>
        </div>

        {/* 1. ADMIN */}
        <button className="access-card" onClick={() => onSelectRole("admin")}>
          <span className="access-icon" style={{ background: "rgba(99, 102, 241, 0.15)", color: "#4f46e5" }}>
            <ShieldCheck size={26} />
          </span>
          <span>
            <b>Administrador</b>
            <small>Acesso total ao sistema, frota, relatórios e novas empresas</small>
          </span>
          <ChevronRight />
        </button>

        {/* 2. CRIADOR DE ROTAS */}
        <button className="access-card" onClick={() => onSelectRole("route_creator")}>
          <span className="access-icon green" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#059669" }}>
            <SlidersHorizontal size={26} />
          </span>
          <span>
            <b>Criador de rotas</b>
            <small>Roteirizador automático, mapa, rotas, veículos e motoristas</small>
          </span>
          <ChevronRight />
        </button>

        {/* 3. ESCRITÓRIO */}
        <button className="access-card" onClick={() => onSelectRole("office")}>
          <span className="access-icon blue" style={{ background: "rgba(59, 130, 246, 0.15)", color: "#2563eb" }}>
            <ExternalLink size={26} />
          </span>
          <span>
            <b>Escritório</b>
            <small>Central de Rastreamento SSW e Correios para acompanhamento</small>
          </span>
          <ChevronRight />
        </button>

        {/* 4. MOTORISTA */}
        <button className="access-card" onClick={() => onSelectRole("driver")}>
          <span className="access-icon amber" style={{ background: "rgba(245, 158, 11, 0.15)", color: "#d97706" }}>
            <Truck size={26} />
          </span>
          <span>
            <b>Motorista</b>
            <small>Acessar viagens, GPS e registrar comprovantes de entrega</small>
          </span>
          <ChevronRight />
        </button>

        <p className="privacy-note">
          Operação integrada em tempo real e com suporte a funcionamento offline.
        </p>
      </section>
    </main>
  );
}

function Pin({
  targetRole,
  onBack,
  onSuccess,
}: {
  targetRole: "admin" | "route_creator" | "office";
  onBack: () => void;
  onSuccess: () => void;
}) {
  const [companyCode, setCompanyCode] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("rw_company_code") || "";
      if (saved === "LEGADO") {
        localStorage.removeItem("rw_company_code");
        return "";
      }
      return saved;
    }
    return "";
  });
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");

  const roleTitles: Record<string, { title: string; desc: string }> = {
    admin: { title: "Acesso de Administrador", desc: "Acesso completo a todas as funcionalidades e configurações." },
    route_creator: { title: "Criador de rotas", desc: "Acesso ao roteirizador, planejamento, veículos e motoristas." },
    office: { title: "Acesso de Escritório", desc: "Acesso à Central de Rastreamento SSW e Correios." },
  };

  const currentRoleInfo = roleTitles[targetRole] || roleTitles.admin;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (mode === "register") {
        await api("/api/companies/register", {
          method: "POST",
          body: JSON.stringify({ companyCode, companyName, name, email, password }),
        });
        sessionStorage.setItem("rw_role", "dispatcher");
        sessionStorage.setItem("rw_user_role", "admin");
        if (typeof window !== "undefined") {
          localStorage.setItem("rw_company_code", companyCode);
        }
      } else {
        const res = await api("/api/session/dispatcher", {
          method: "POST",
          body: JSON.stringify({ companyCode, email, password, expectedRole: targetRole }),
        });
        sessionStorage.setItem("rw_role", "dispatcher");
        sessionStorage.setItem("rw_user_role", res.userRole || targetRole);
        if (typeof window !== "undefined") {
          localStorage.setItem("rw_company_code", companyCode);
        }
      }
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main className="center-page">
      <form className="card narrow auth-card" onSubmit={submit}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: "8px" }}>
          <button type="button" className="back" onClick={onBack} style={{ margin: 0 }}>
            <ArrowLeft size={17} /> Voltar
          </button>
          <ThemeToggle />
        </div>
        <Logo />
        <h1>{mode === "register" ? "Cadastrar nova empresa" : currentRoleInfo.title}</h1>
        <p>
          {mode === "register"
            ? "Crie a empresa e o primeiro login administrador."
            : currentRoleInfo.desc}
        </p>

        <div className="auth-fields">
          {mode === "register" && (
            <>
              <label><span>Nome da Empresa</span><input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Ex.: Transportes Estrela" required /></label>
              <label><span>Seu nome completo</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Como podemos chamar você?" required /></label>
            </>
          )}

          <>
            <label><span>Código da empresa</span><input autoFocus value={companyCode} onChange={(e) => setCompanyCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))} placeholder="Ex.: MINHA-EMPRESA" autoComplete="organization" required /></label>
            <label><span>E-mail ou Usuário</span><input type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" autoComplete="username" required /></label>
            <label><span>Senha</span><input type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Digite sua senha" autoComplete={mode === "register" ? "new-password" : "current-password"} required /></label>
          </>
        </div>

        <div className="auth-actions">
          <button className="button primary">{mode === "register" ? "Criar empresa e entrar" : "Entrar no sistema"}</button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </form>
    </main>
  );
}

function DriverPicker({
  onBack,
  onPick,
}: {
  onBack: () => void;
  onPick: (d: Driver) => void;
}) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [companyCode, setCompanyCode] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("rw_company_code") || "";
      if (saved === "LEGADO") {
        localStorage.removeItem("rw_company_code");
        return "";
      }
      return saved;
    }
    return "";
  });
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");

  const fetchDrivers = useCallback((code: string) => {
    if (code.length < 3) {
      setDrivers([]);
      return;
    }
    setLoading(true);
    const normalizedCode = code.trim();
    api(`/api/drivers?company=${encodeURIComponent(normalizedCode)}&refresh=${Date.now()}`, { cache: "no-store" })
      .then((data) => {
        setDrivers(data);
        setError("");
      })
      .catch((e) => {
        setDrivers([]);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (companyCode.length >= 3) {
      const timer = window.setTimeout(() => {
        fetchDrivers(companyCode);
      }, 300);
      return () => window.clearTimeout(timer);
    } else {
      setDrivers([]);
    }
  }, [companyCode, fetchDrivers]);

  const handleCompanyCodeChange = (val: string) => {
    const formatted = val.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    setCompanyCode(formatted);
    setSelectedDriver(null);
    setError("");
    if (typeof window !== "undefined") {
      if (formatted) localStorage.setItem("rw_company_code", formatted);
    }
  };

  const filteredDrivers = drivers.filter((d) => {
    if (!filterSearch) return true;
    return d.name.toLowerCase().includes(filterSearch.toLowerCase());
  });

  const pick = async () => {
    if (!selectedDriver) return;
    try {
      await api("/api/session/driver", {
        method: "POST",
        body: JSON.stringify({ companyCode, driverId: selectedDriver.id, password }),
      });
      sessionStorage.setItem("rw_role", "driver");
      if (typeof window !== "undefined") {
        localStorage.setItem("rw_company_code", companyCode);
      }
      onPick(selectedDriver);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const getAvatarGradient = (name: string) => {
    const gradients = [
      "linear-gradient(135deg, #3b82f6, #1d4ed8)",
      "linear-gradient(135deg, #10b981, #047857)",
      "linear-gradient(135deg, #8b5cf6, #6d28d9)",
      "linear-gradient(135deg, #f59e0b, #d97706)",
      "linear-gradient(135deg, #06b6d4, #0e7490)",
      "linear-gradient(135deg, #ec4899, #be185d)",
    ];
    let sum = 0;
    for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
    return gradients[sum % gradients.length];
  };

  return (
    <main className="center-page">
      <section className="card auth-card picker-card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: "8px" }}>
          <button type="button" className="back" onClick={onBack} style={{ margin: 0 }}>
            <ArrowLeft size={17} /> Voltar
          </button>
          <ThemeToggle />
        </div>
        <Logo />
        <h1>Quem está dirigindo?</h1>
        <p>Informe o código da sua empresa e selecione seu perfil de motorista.</p>

        <div className="picker-company-field">
          <label>
            <span>
              <Building2 size={15} /> Código da Empresa
            </span>
            <div className="picker-input-wrap">
              <input
                autoFocus={!companyCode}
                value={companyCode}
                onChange={(e) => handleCompanyCodeChange(e.target.value)}
                placeholder="Ex.: MINHA-EMPRESA"
                autoComplete="organization"
              />
              {companyCode && (
                <button
                  type="button"
                  className="picker-clear-btn"
                  onClick={() => handleCompanyCodeChange("")}
                  title="Limpar código"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </label>
        </div>

        {loading && (
          <div className="picker-loading">
            <span className="spinner" /> Carregando equipe de motoristas...
          </div>
        )}

        {drivers.length > 2 && (
          <div className="picker-search-wrap">
            <Search size={15} className="picker-search-icon" />
            <input
              type="text"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              placeholder="Buscar motorista por nome..."
              className="picker-search-input"
            />
            {filterSearch && (
              <button
                type="button"
                className="picker-search-clear"
                onClick={() => setFilterSearch("")}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}

        {drivers.length > 0 && (
          <div className="profile-list">
            {filteredDrivers.map((d) => (
              <button
                key={d.id}
                type="button"
                className="profile-item"
                onClick={() => {
                  setSelectedDriver(d);
                  setPassword("");
                  setError("");
                }}
              >
                <span
                  className="profile-avatar"
                  style={{ background: getAvatarGradient(d.name) }}
                >
                  {d.photo ? <Image src={d.photo} alt="" width={44} height={44} unoptimized /> : d.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="profile-details">
                  <b>{d.name}</b>
                  <small>{d.phone || "Motorista cadastrado"}</small>
                </div>
                <ChevronRight size={18} className="profile-chevron" />
              </button>
            ))}
            {filterSearch && filteredDrivers.length === 0 && (
              <p className="no-filter-match">Nenhum motorista com o nome &quot;{filterSearch}&quot;.</p>
            )}
          </div>
        )}

        {!drivers.length && !loading && companyCode.length >= 3 && !error && (
          <div className="picker-empty-box">
            <Truck size={32} />
            <p>Nenhum motorista ativo encontrado nesta empresa.</p>
            <small>Verifique com o gestor da empresa se o seu cadastro foi realizado.</small>
          </div>
        )}

        {companyCode.length < 3 && (
          <div className="picker-guide-box">
            <Building2 size={28} />
            <p>Digite o código da sua empresa acima para visualizar a lista de motoristas disponíveis.</p>
          </div>
        )}

        {error && <p className="form-error">{error}</p>}

        {selectedDriver && (
          <Modal title={`Acessar como ${selectedDriver.name}`} onClose={() => setSelectedDriver(null)}>
            <form className="form-grid driver-pin-form" onSubmit={(e) => { e.preventDefault(); pick(); }}>
              {/* Campo oculto com nome do motorista para o Gerenciador de Senhas do Google salvar */}
              <input
                type="text"
                name="username"
                value={selectedDriver.name}
                autoComplete="username"
                tabIndex={-1}
                aria-hidden="true"
                style={{ position: "absolute", opacity: 0, pointerEvents: "none", height: 0, width: 0 }}
                readOnly
              />
              <label>
                Senha numérica de acesso
                <input
                  autoFocus
                  inputMode="numeric"
                  type="password"
                  minLength={4}
                  maxLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                  className="driver-pin-input"
                  autoComplete="current-password"
                  required
                />
              </label>

              <button className="button primary" disabled={password.length < 4} style={{ marginTop: "16px" }}>
                Ver minhas rotas
              </button>
              {error && <p className="form-error">{error}</p>}
            </form>
          </Modal>
        )}
      </section>
    </main>
  );
}

function DispatchersPanel({
  dispatchers,
  sessionInfo,
  reload,
}: {
  dispatchers: DispatcherUser[];
  sessionInfo: { companyCode?: string; companyName?: string; dispatcherId?: string } | null;
  reload: () => Promise<void>;
}) {
  const [openCreate, setOpenCreate] = useState(false);
  const [editing, setEditing] = useState<DispatcherUser | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("active");
  const [searchTerm, setSearchTerm] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const filteredItems = dispatchers
    .filter((d) => {
      if (filter === "active") return d.active !== false;
      if (filter === "inactive") return d.active === false;
      return true;
    })
    .filter((d) => {
      if (!searchTerm) return true;
      const q = searchTerm.toLowerCase();
      return d.name.toLowerCase().includes(q) || d.email.toLowerCase().includes(q);
    });

  const copyCode = () => {
    if (!sessionInfo?.companyCode) return;
    navigator.clipboard.writeText(sessionInfo.companyCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const submitCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await api("/api/dispatchers", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
          role: form.get("role"),
        }),
      });
      setOpenCreate(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const password = form.get("password");
    try {
      await api(`/api/dispatchers/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          role: form.get("role"),
          password: password ? String(password) : undefined,
          active: form.get("active") === "on",
        }),
      });
      setEditing(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (d: DispatcherUser) => {
    if (d.id === sessionInfo?.dispatcherId) {
      alert("Você não pode desativar seu próprio usuário conectado.");
      return;
    }
    const nextActive = d.active === false;
    const confirmMsg = nextActive
      ? `Reativar o acesso de ${d.name}?`
      : `Desativar o acesso de ${d.name}? Este usuário não poderá mais entrar no sistema.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await api(`/api/dispatchers/${d.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...d,
          active: nextActive,
        }),
      });
      await reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const roleLabels: Record<string, { label: string; color: string }> = {
    superadmin: { label: "Administrador Supremo", color: "#7c3aed" },
    admin: { label: "Administrador (Empresa)", color: "#4f46e5" },
    route_creator: { label: "Criador de rotas", color: "#059669" },
    office: { label: "Escritório", color: "#2563eb" },
  };

  return (
    <section className="panel dispatchers-panel">
      {sessionInfo?.companyCode && (
        <div className="company-code-banner">
          <div className="company-code-content">
            <Building2 size={22} className="banner-icon" />
            <div>
              <b>Código da Empresa: <span className="highlight-code">{sessionInfo.companyCode}</span></b>
              <p>Compartilhe este código com os colaboradores para que eles entrem com seus respectivos perfis.</p>
            </div>
          </div>
          <button type="button" className="button secondary compact" onClick={copyCode}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Código copiado!" : "Copiar código"}
          </button>
        </div>
      )}

      <div className="panel-title">
        <div>
          <h2>Equipe e Níveis de Acesso</h2>
          <p>{filteredItems.length} de {dispatchers.length} usuário(s) cadastrado(s)</p>
        </div>
        <div className="panel-actions-group">
          <div className="registry-filter-tabs">
            <button
              type="button"
              className={filter === "active" ? "active" : ""}
              onClick={() => setFilter("active")}
            >
              Ativos
            </button>
            <button
              type="button"
              className={filter === "inactive" ? "active" : ""}
              onClick={() => setFilter("inactive")}
            >
              Inativos
            </button>
            <button
              type="button"
              className={filter === "all" ? "active" : ""}
              onClick={() => setFilter("all")}
            >
              Todos
            </button>
          </div>
          <button
            className="button primary compact"
            onClick={() => {
              setError("");
              setOpenCreate(true);
            }}
          >
            <Plus size={15} /> Novo Usuário
          </button>
        </div>
      </div>

      {dispatchers.length > 3 && (
        <div className="panel-search-bar">
          <Search size={15} />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nome ou e-mail..."
          />
          {searchTerm && (
            <button type="button" className="clear-search" onClick={() => setSearchTerm("")}>
              <X size={14} />
            </button>
          )}
        </div>
      )}

      <div className="registry-grid">
        {filteredItems.map((d) => {
          const isActive = d.active !== false;
          const isSelf = d.id === sessionInfo?.dispatcherId;
          const roleInfo = roleLabels[d.role || "admin"] || roleLabels.admin;

          return (
            <article key={d.id} className={!isActive ? "item-inactive" : ""}>
              <span className={`avatar dispatcher-avatar ${!isActive ? "inactive" : ""}`}>
                {d.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="registry-info">
                <div className="registry-name-line" style={{ flexWrap: "wrap", gap: "6px" }}>
                  <b>{d.name}</b>
                  {isSelf && (
                    <span className="self-user-badge" title="Sua conta conectada no momento">
                      Você
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: "6px",
                      background: "rgba(0,0,0,0.06)",
                      color: roleInfo.color,
                    }}
                  >
                    {roleInfo.label}
                  </span>
                  <span className={`registry-status-pill ${isActive ? "active" : "inactive"}`}>
                    {isActive ? "Ativo" : "Inativo"}
                  </span>
                </div>
                <small className="dispatcher-email">
                  <Mail size={12} /> {d.email}
                </small>
                {d.created_at && (
                  <small className="dispatcher-date">
                    Cadastrado em {new Date(d.created_at).toLocaleDateString("pt-BR")}
                  </small>
                )}
              </div>
              <div className="registry-item-actions">
                <button
                  type="button"
                  className="btn-action-icon"
                  title="Editar perfil e permissões"
                  onClick={() => {
                    setError("");
                    setEditing(d);
                  }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  className={`btn-action-icon ${isActive ? "danger" : "success"}`}
                  title={isSelf ? "Você não pode desativar o seu próprio usuário" : (isActive ? "Desativar acesso" : "Reativar acesso")}
                  disabled={isSelf}
                  onClick={() => toggleActive(d)}
                >
                  <Power size={15} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {!filteredItems.length && (
        <Empty
          text={
            searchTerm
              ? `Nenhum usuário encontrado para "${searchTerm}".`
              : filter === "inactive"
                ? "Nenhum usuário inativo."
                : "Nenhum usuário cadastrado nesta empresa."
          }
        />
      )}

      {/* Modal Criar Usuário */}
      {openCreate && (
        <Modal title="Cadastrar Novo Usuário da Equipe" onClose={() => setOpenCreate(false)}>
          <form onSubmit={submitCreate} className="form-grid">
            <div className="modal-info-box">
              <ShieldCheck size={20} />
              <p>Escolha o perfil do usuário para limitar seu acesso apenas às ferramentas necessárias da operação.</p>
            </div>
            <label>
              Nome completo
              <input name="name" required placeholder="Ex.: Mariana Rodrigues" autoFocus />
            </label>
            <label>
              E-mail de acesso (login)
              <input name="email" type="email" required placeholder="mariana@empresa.com" autoComplete="email" />
            </label>
            <label>
              Função / Perfil de Acesso
              <select name="role" defaultValue="route_creator" style={{ height: "46px", borderRadius: "10px", padding: "0 12px", border: "1px solid var(--line)" }}>
                <option value="admin">Administrador (Acesso total)</option>
                <option value="route_creator">Criador de rotas (Roteirizador, Planejador, Rotas, Veículos, Motoristas)</option>
                <option value="office">Escritório (Rastreio SSW / Correios)</option>
              </select>
            </label>
            <label>
              Senha inicial de acesso
              <input
                name="password"
                type="password"
                minLength={6}
                required
                placeholder="Mínimo de 6 caracteres"
                autoComplete="new-password"
              />
            </label>
            <button disabled={busy} className="button primary">
              {busy ? "Cadastrando…" : "Cadastrar Usuário"}
            </button>
            {error && <p className="form-error">{error}</p>}
          </form>
        </Modal>
      )}

      {/* Modal Editar Usuário */}
      {editing && (
        <Modal title={`Editar Usuário: ${editing.name}`} onClose={() => setEditing(null)}>
          <form onSubmit={submitEdit} className="form-grid">
            <label>
              Nome completo
              <input name="name" defaultValue={editing.name} required />
            </label>
            <label>
              E-mail de acesso
              <input name="email" type="email" defaultValue={editing.email} required />
            </label>
            <label>
              Função / Perfil de Acesso
              <select
                name="role"
                defaultValue={editing.role || "admin"}
                disabled={editing.id === sessionInfo?.dispatcherId}
                style={{ height: "46px", borderRadius: "10px", padding: "0 12px", border: "1px solid var(--line)" }}
              >
                <option value="admin">Administrador (Acesso total)</option>
                <option value="route_creator">Criador de rotas (Roteirizador, Planejador, Rotas, Veículos, Motoristas)</option>
                <option value="office">Escritório (Rastreio SSW / Correios)</option>
              </select>
            </label>
            <label>
              Nova senha de acesso (opcional)
              <input
                name="password"
                type="password"
                minLength={6}
                placeholder="Deixe em branco para manter a senha atual"
                autoComplete="new-password"
              />
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                name="active"
                defaultChecked={editing.active !== false}
                disabled={editing.id === sessionInfo?.dispatcherId}
              />
              <span>
                Cadastro ativo {editing.id === sessionInfo?.dispatcherId ? "(Você não pode desativar seu próprio acesso)" : ""}
              </span>
            </label>
            <button disabled={busy} className="button primary">
              {busy ? "Salvando…" : "Salvar Alterações"}
            </button>
            {error && <p className="form-error">{error}</p>}
          </form>
        </Modal>
      )}
    </section>
  );
}

function CompaniesManagementModal({
  companies,
  currentCompanyId,
  onClose,
  onReload,
}: {
  companies: Array<{ id: string; code: string; name: string; active?: boolean }>;
  currentCompanyId?: string;
  onClose: () => void;
  onReload: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editingCompany, setEditingCompany] = useState<{ id: string; name: string } | null>(null);

  const toggleActive = async (c: { id: string; code: string; name: string; active?: boolean }) => {
    if (c.code === "EU") {
      alert("A empresa principal do Administrador Supremo não pode ser inativada.");
      return;
    }
    const nextActive = c.active === false;
    const confirmMsg = nextActive
      ? `Reativar a empresa "${c.name}" (${c.code})?`
      : `Inativar a empresa "${c.name}" (${c.code})? Seus usuários não conseguirão fazer login enquanto ela estiver inativa.`;
    if (!window.confirm(confirmMsg)) return;

    setError("");
    setBusyId(c.id);
    try {
      await api(`/api/companies/${c.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: c.name, active: nextActive }),
      });
      await onReload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const [deletingCompany, setDeletingCompany] = useState<{ id: string; code: string; name: string } | null>(null);
  const [confirmCodeInput, setConfirmCodeInput] = useState("");

  const executeDeleteCompany = async () => {
    if (!deletingCompany) return;
    if (deletingCompany.code === "EU") {
      alert("A empresa principal do Administrador Supremo não pode ser excluída.");
      return;
    }
    if (confirmCodeInput.trim().toUpperCase() !== deletingCompany.code.toUpperCase()) {
      setError(`Código incorreto. Digite exatamente "${deletingCompany.code}" para confirmar.`);
      return;
    }

    setError("");
    setBusyId(deletingCompany.id);
    try {
      await api(`/api/companies/${deletingCompany.id}`, {
        method: "DELETE",
      });
      setDeletingCompany(null);
      setConfirmCodeInput("");
      await onReload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const saveRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCompany) return;
    setError("");
    setBusyId(editingCompany.id);
    try {
      await api(`/api/companies/${editingCompany.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: editingCompany.name }),
      });
      setEditingCompany(null);
      await onReload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal title="Gerenciamento de Empresas (Supremo)" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: "min(100%, 540px)" }}>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
          Aqui você pode renomear, inativar temporariamente ou excluir de forma definitiva empresas e todos os dados vinculados a elas.
        </p>

        {error && <p className="form-error">{error}</p>}

        {editingCompany ? (
          <form onSubmit={saveRename} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px", border: "1px solid var(--line)", borderRadius: "10px" }}>
            <b style={{ fontSize: "14px" }}>Editar Nome da Empresa</b>
            <input
              autoFocus
              value={editingCompany.name}
              onChange={(e) => setEditingCompany({ ...editingCompany, name: e.target.value })}
              placeholder="Nome da empresa"
              required
              style={{ height: "42px", borderRadius: "8px", padding: "0 12px", border: "1px solid var(--line)" }}
            />
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button type="button" className="button secondary compact" onClick={() => setEditingCompany(null)}>Cancelar</button>
              <button type="submit" disabled={busyId === editingCompany.id} className="button primary compact">
                {busyId === editingCompany.id ? "Salvando…" : "Salvar Nome"}
              </button>
            </div>
          </form>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "380px", overflowY: "auto" }}>
          {companies.map((c) => {
            const isSelfComp = c.code === "EU";
            const isActive = c.active !== false;
            const isCurrent = c.id === currentCompanyId;

            return (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: "1px solid var(--line)",
                  background: isCurrent ? "rgba(99, 102, 241, 0.05)" : "var(--card)",
                  opacity: isActive ? 1 : 0.6,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <b style={{ fontSize: "14px", color: "var(--ink)" }}>{c.name}</b>
                    <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", background: "var(--line)", color: "var(--ink)" }}>
                      {c.code}
                    </span>
                    {isSelfComp && (
                      <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", background: "#7c3aed", color: "#fff" }}>
                        Matriz / Você
                      </span>
                    )}
                    {!isActive && (
                      <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", background: "#ef4444", color: "#fff" }}>
                        Inativa
                      </span>
                    )}
                  </div>
                  {isCurrent && (
                    <small style={{ color: "#4f46e5", fontWeight: 600 }}>Visualizando no momento</small>
                  )}
                </div>

                {!isSelfComp && (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => setEditingCompany({ id: c.id, name: c.name })}
                      className="button secondary compact"
                      title="Editar nome da empresa"
                      style={{ padding: "6px 8px", height: "32px" }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => toggleActive(c)}
                      className="button secondary compact"
                      title={isActive ? "Inativar empresa" : "Reativar empresa"}
                      style={{ padding: "6px 8px", height: "32px" }}
                    >
                      <Power size={13} color={isActive ? "#d97706" : "#059669"} />
                    </button>
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => {
                        setEditingCompany(null);
                        setDeletingCompany(c);
                        setConfirmCodeInput("");
                        setError("");
                      }}
                      className="button secondary compact"
                      title="Excluir empresa definitivamente"
                      style={{ padding: "6px 8px", height: "32px", color: "#dc2626", borderColor: "rgba(220, 38, 38, 0.2)", background: "rgba(220, 38, 38, 0.05)" }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {deletingCompany && (
          <div style={{ padding: "16px", borderRadius: "10px", border: "1px solid rgba(220, 38, 38, 0.3)", background: "rgba(220, 38, 38, 0.05)", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#dc2626" }}>
              <Trash2 size={18} />
              <b style={{ fontSize: "14px" }}>Confirmar Exclusão de Empresa</b>
            </div>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--ink)" }}>
              Tem certeza que deseja excluir a empresa <b>{deletingCompany.name}</b> ({deletingCompany.code})? Todas as rotas, motoristas, veículos e usuários associados serão permanentemente apagados.
            </p>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: 600 }}>
              <span>Para confirmar, digite <b>{deletingCompany.code}</b> no campo abaixo:</span>
              <input
                autoFocus
                value={confirmCodeInput}
                onChange={(e) => setConfirmCodeInput(e.target.value.toUpperCase())}
                placeholder={deletingCompany.code}
                style={{ height: "40px", borderRadius: "8px", border: "1px solid var(--line)", padding: "0 12px", background: "var(--card)", color: "var(--ink)", fontWeight: 700 }}
              />
            </label>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="button secondary compact"
                onClick={() => { setDeletingCompany(null); setConfirmCodeInput(""); setError(""); }}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busyId === deletingCompany.id || confirmCodeInput.trim().toUpperCase() !== deletingCompany.code.toUpperCase()}
                onClick={executeDeleteCompany}
                className="button primary compact"
                style={{ background: "#dc2626", borderColor: "#dc2626" }}
              >
                {busyId === deletingCompany.id ? "Excluindo…" : "Excluir Definitivamente"}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
          <button type="button" className="button secondary compact" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Dispatcher({
  onExit,
}: {
  onExit: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "planner" | "routes" | "people" | "vehicles" | "dispatchers" | "roteirizador" | "ssw" | "operations">(
    "overview",
  );
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [dispatchers, setDispatchers] = useState<DispatcherUser[]>([]);
  const [sessionInfo, setSessionInfo] = useState<{
    companyId?: string;
    companyCode?: string;
    companyName?: string;
    dispatcherId?: string;
    userRole?: string;
    userName?: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [reportingRoute, setReportingRoute] = useState<DetailedRoute | null>(null);
  const [assigningRoute, setAssigningRoute] = useState<RouteData | null>(null);
  const [importedPlannerData, setImportedPlannerData] = useState<{
    id: string;
    stops: Stop[];
    name?: string;
    date?: string;
  } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openNavGroups, setOpenNavGroups] = useState<Record<string, boolean>>({
    "Operação": true,
    "Rotas": true,
    "Cadastros": true,
    "Administração": true,
  });
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatPoints, setHeatPoints] = useState<Array<[number, number, number]>>([]);
  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem("rw_sidebar_collapsed") === "true");
  }, []);

  const handleOpenRouteInPlanner = (suggested: SuggestedRoute, engineConfig?: EngineConfig | null) => {
    const originStop: Stop = {
      id: crypto.randomUUID(),
      name: engineConfig?.originName ? `Origem (${engineConfig.originName})` : "Origem (CD Base)",
      address: "Base Operacional de Distribuição",
      lat: engineConfig?.originLat ?? -7.2306,
      lng: engineConfig?.originLng ?? -35.8811,
      is_origin: true,
    };

    const deliveryStops: Stop[] = (suggested.stops || []).map((s) => ({
      id: crypto.randomUUID(),
      name: s.clientName ? `${s.clientName} - ${s.city}` : s.city,
      address: s.address || s.city,
      lat: s.lat,
      lng: s.lng,
      boxes: s.boxes,
      volume_m3: s.volumeM3,
      order_ids: Array.from(new Set(s.orders.map((order) => order.orderId).filter(Boolean))),
      is_origin: false,
    }));

    setImportedPlannerData({
      id: crypto.randomUUID(),
      stops: [originStop, ...deliveryStops],
      name: suggested.name || "Rota Importada",
      date: engineConfig?.routeDate || new Date().toISOString().slice(0, 10),
    });
    setTab("planner");
  };

  const load = useCallback(
    () =>
      Promise.all([
        api("/api/routes"),
        api("/api/drivers?all=true"),
        api("/api/vehicles"),
        api("/api/dispatchers").catch(() => []),
        api("/api/session/me").catch(() => null),
      ])
        .then(([r, d, v, disp, sess]) => {
          setRoutes(r);
          setDrivers(d);
          setVehicles(v);
          if (Array.isArray(disp)) setDispatchers(disp);
          if (sess) setSessionInfo(sess);
          if (typeof window !== "undefined") {
            localStorage.setItem(DISPATCHER_OFFLINE_SNAPSHOT, JSON.stringify({ routes: r, drivers: d, vehicles: v, dispatchers: disp, session: sess, savedAt: Date.now() }));
          }
        })
        .catch((e) => {
          if (typeof window !== "undefined" && !navigator.onLine) {
            try {
              const snapshot = JSON.parse(localStorage.getItem(DISPATCHER_OFFLINE_SNAPSHOT) || "null");
              if (snapshot?.routes && snapshot?.drivers && snapshot?.vehicles) {
                setRoutes(snapshot.routes);
                setDrivers(snapshot.drivers);
                setVehicles(snapshot.vehicles);
                if (Array.isArray(snapshot.dispatchers)) setDispatchers(snapshot.dispatchers);
                if (snapshot.session) setSessionInfo(snapshot.session);
                setMessage("Você está offline. Exibindo os últimos dados sincronizados neste aparelho.");
                return;
              }
            } catch {}
          }
          if (String(e.message || "").includes("Sessão necessária")) {
            sessionStorage.removeItem("rw_role");
            onExit();
          } else {
            setMessage(e.message);
          }
        }),
    [onExit],
  );

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  const active = routes.filter((r) => r.status === "active");
  const completed = routes.filter((r) => r.status === "completed");

  const openReport = async (routeId: string) => {
    try {
      const detailed = await api(`/api/routes/${routeId}`);
      setReportingRoute(detailed);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const [companies, setCompanies] = useState<Array<{ id: string; code: string; name: string; active?: boolean }>>([]);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showManageCompanies, setShowManageCompanies] = useState(false);
  const [switchingCompany, setSwitchingCompany] = useState(false);

  // Determina o papel do usuário (admin por padrão se for dispatcher geral)
  const userRole = (sessionInfo as any)?.userRole || (typeof window !== "undefined" ? sessionStorage.getItem("rw_user_role") : null) || "admin";

  useEffect(() => {
    // Se for criador de rotas, inicia no roteirizador
    if (userRole === "route_creator" && tab === "overview") {
      setTab("roteirizador");
    } else if (userRole === "office" && tab === "overview") {
      setTab("ssw");
    }
  }, [userRole]);

  useEffect(() => {
    if (userRole === "superadmin") {
      api("/api/companies").then((comps) => {
        if (Array.isArray(comps)) setCompanies(comps);
      }).catch(() => {});
    }
  }, [userRole]);

  const handleSwitchCompany = async (companyId: string) => {
    if (!companyId || companyId === sessionInfo?.companyId) return;
    setSwitchingCompany(true);
    try {
      await api("/api/companies/switch", {
        method: "POST",
        body: JSON.stringify({ companyId }),
      });
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSwitchingCompany(false);
    }
  };

  // Filtragem estrita dos itens do menu lateral por perfil:
  // - Superadmin / Admin: Todas as abas
  // - Criador de rotas: roteirizador, planner, routes, vehicles, people
  // - Escritório: ssw
  const allNavItems: Array<[typeof tab, string, React.ReactNode]> = [
    ["overview", "Visão geral", <RouteIcon key="o" />],
    ["roteirizador", "Roteirizador", <FileText key="rot" />],
    ["planner", "Planejar rota", <Navigation key="n" />],
    ["routes", "Rotas", <Navigation key="r" />],
    ["people", "Motoristas", <Users key="p" />],
    ["vehicles", "Veículos", <Truck key="v" />],
    ["dispatchers", "Equipe / Acessos", <ShieldCheck key="g" />],
    ["ssw", "Rastreio SSW", <ExternalLink key="ssw" />],
    ["operations", "Central operacional", <Zap key="ops" />],
  ];

  const allowedNavItems = allNavItems.filter(([id]) => {
    if (userRole === "superadmin" || userRole === "admin") return true;
    if (userRole === "route_creator") {
      return ["roteirizador", "planner", "routes", "vehicles", "people"].includes(id);
    }
    if (userRole === "office") {
      return ["ssw", "operations"].includes(id);
    }
    return true;
  });
  const navGroups = [
    { label: "Operação", items: ["overview", "operations"] },
    { label: "Rotas", items: ["roteirizador", "planner", "routes"] },
    { label: "Cadastros", items: ["people", "vehicles"] },
    { label: "Administração", items: ["dispatchers", "ssw"] },
  ].map((group) => ({ ...group, entries: allowedNavItems.filter(([id]) => group.items.includes(id)) })).filter((group) => group.entries.length > 0);

  return (
    <div className={`workspace managed-workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${tab === "planner" ? "planning-workspace" : ""}`}>
      <aside className="sidebar">
        <button className="sidebar-collapse" type="button" aria-label={sidebarCollapsed ? "Expandir menu" : "Recolher menu"} title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"} aria-expanded={!sidebarCollapsed} onClick={() => {
          const next = !sidebarCollapsed;
          setSidebarCollapsed(next);
          localStorage.setItem("rw_sidebar_collapsed", String(next));
          window.setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
        }}>
          <ChevronRight size={18} style={{ transform: sidebarCollapsed ? undefined : "rotate(180deg)" }} />
          <span>Recolher menu</span>
        </button>
        <nav aria-label="Navegação principal">
          {navGroups.map((group) => <div className={`sidebar-nav-group ${openNavGroups[group.label] ? "open" : ""}`} key={group.label}>
            <button type="button" className="sidebar-nav-group-title" onClick={() => setOpenNavGroups((current) => ({ ...current, [group.label]: !current[group.label] }))} aria-expanded={openNavGroups[group.label]}>
              <span>{group.label}</span><ChevronDown size={15} />
            </button>
            <div className="sidebar-nav-items">
              {group.entries.map(([id, label, icon]) => <button key={id} title={label} aria-label={label} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{icon}<span>{label}</span></button>)}
            </div>
          </div>)}
        </nav>
        <div className="sidebar-footer-actions" style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
          <button
            type="button"
            className="sidebar-btn-action"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              justifyContent: "flex-start",
              padding: "10px 14px",
              borderRadius: "10px",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              background: "rgba(255, 255, 255, 0.06)",
              color: "#e2e8f0",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
            }}
            onClick={() => setShowChangePassword(true)}
            title="Alterar minha senha (desconecta após trocar)"
          >
            <KeyRound size={16} /> <span>Alterar senha</span>
          </button>
          <button className="exit" onClick={onExit} title="Desconectar do sistema">
            <LogOut size={16} /> <span>Sair / Desconectar</span>
          </button>
        </div>
      </aside>
      <main className="dashboard">
        <header>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span className="eyebrow" style={{ color: userRole === "superadmin" ? "#7c3aed" : undefined }}>
                {userRole === "superadmin"
                  ? "ADMINISTRADOR SUPREMO"
                  : userRole === "admin"
                  ? "PAINEL ADMINISTRADOR (EMPRESA)"
                  : userRole === "route_creator"
                  ? "CRIADOR DE ROTAS"
                  : "CENTRAL DE ESCRITÓRIO"}
              </span>
              {sessionInfo?.companyName && (
                <span style={{ fontSize: "12px", background: "rgba(0,0,0,0.06)", padding: "2px 8px", borderRadius: "6px", fontWeight: 600 }}>
                  {sessionInfo.companyName} ({sessionInfo.companyCode})
                </span>
              )}
            </div>
            <h1>
              {tab === "overview"
                ? "Visão geral"
                : tab === "planner"
                  ? "Planejador de rotas"
                : tab === "routes"
                  ? "Planejamento e Histórico de Rotas"
                  : tab === "people"
                    ? "Equipe de Motoristas"
                    : tab === "vehicles"
                      ? "Frota de Veículos"
                      : tab === "roteirizador"
                        ? "Roteirizador Automático"
                        : tab === "ssw"
                          ? "Rastreamento pelo DANFE (SSW e Correios)"
                          : tab === "operations"
                            ? "Central operacional"
                          : "Equipe e Níveis de Acesso"}
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            {/* Troca rápida de empresa para o Administrador Supremo */}
            {userRole === "superadmin" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Building2 size={16} color="var(--muted)" />
                <select
                  disabled={switchingCompany}
                  value={sessionInfo?.companyId || ""}
                  onChange={(e) => handleSwitchCompany(e.target.value)}
                  style={{
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    background: "var(--card)",
                    color: "var(--ink)",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  title="Trocar de empresa no painel de Administrador Supremo"
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id} style={{ background: "var(--card)", color: "var(--ink)" }}>
                      Empresa: {c.name} ({c.code})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button secondary compact"
                  onClick={() => setShowManageCompanies(true)}
                  title="Gerenciar, editar ou excluir empresas"
                  style={{ height: "36px", padding: "0 10px", fontSize: "13px", display: "flex", alignItems: "center", gap: "5px" }}
                >
                  <Settings size={14} /> <span>Empresas</span>
                </button>
              </div>
            )}
            <span className="live">
              <i /> Atualização automática
            </span>
            <ThemeToggle />
            <button
              type="button"
              className="button secondary compact"
              onClick={onExit}
              title="Desconectar do sistema"
              style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#dc2626", border: "1px solid rgba(220, 38, 38, 0.2)", background: "rgba(220, 38, 38, 0.05)" }}
            >
              <LogOut size={14} /> <span>Sair</span>
            </button>
          </div>
        </header>
        {message && <p className="form-error">{message}</p>}
        {tab === "planner" && (
          <RoutePlannerView
            key={importedPlannerData?.id || "planner-default"}
            onDone={load}
            initialStops={importedPlannerData?.stops}
            initialRouteName={importedPlannerData?.name}
            initialRouteDate={importedPlannerData?.date}
          />
        )}
        {tab === "overview" && (
          <Overview
            routes={routes}
            active={active}
            completed={completed}
            onSelectRoute={(id) => setSelectedRouteId(id)}
            onPrintReport={(r) => openReport(r.id)}
            onAssignRoute={(r) => setAssigningRoute(r)}
            onOpenTab={(t) => setTab(t as any)}
            userRole={userRole}
            drivers={drivers}
            onOpenHeatmap={(points) => { setHeatPoints(points); setShowHeatmap(true); }}
          />
        )}{" "}
        {tab === "routes" && (
          <RoutesPanel
            routes={routes}
            drivers={drivers}
            vehicles={vehicles}
            reload={load}
            onSelectRoute={(id) => setSelectedRouteId(id)}
            onPrintReport={(r) => openReport(r.id)}
            onOpenPlanner={() => setTab("planner")}
            onAssignRoute={(r) => setAssigningRoute(r)}
          />
        )}{" "}
        {tab === "people" && (
          <Registry kind="driver" reload={load} items={drivers} />
        )}{" "}
        {tab === "vehicles" && (
          <Registry kind="vehicle" reload={load} items={vehicles} />
        )}{" "}
        {tab === "dispatchers" && (
          <DispatchersPanel
            dispatchers={dispatchers}
            sessionInfo={sessionInfo}
            reload={load}
          />
        )}
        {tab === "roteirizador" && (
          <RoteirizadorPage
            onBack={() => setTab(userRole === "admin" ? "overview" : "roteirizador")}
            onOpenInPlanner={handleOpenRouteInPlanner}
          />
        )}
        {tab === "ssw" && (
          <SSWTrackingView onBack={() => setTab(userRole === "admin" ? "overview" : "ssw")} />
        )}
        {tab === "operations" && <OperationsHub userRole={userRole} drivers={drivers} />}
      </main>

      {showChangePassword && (
        <ChangePasswordModal
          onClose={() => setShowChangePassword(false)}
          onLogout={() => {
            setShowChangePassword(false);
            onExit();
          }}
        />
      )}

      {selectedRouteId && (
        <RouteDetailModal
          routeId={selectedRouteId}
          onClose={() => setSelectedRouteId(null)}
          onPrintReport={(r) => {
            setSelectedRouteId(null);
            setReportingRoute(r);
          }}
        />
      )}

      {reportingRoute && (
        <RouteReportModal
          route={reportingRoute}
          onClose={() => setReportingRoute(null)}
        />
      )}

      {assigningRoute && (
        <Assign
          route={assigningRoute}
          drivers={drivers.filter((d) => d.active !== false)}
          vehicles={vehicles.filter((v) => v.active !== false)}
          onDone={() => {
            setAssigningRoute(null);
            load();
          }}
        />
      )}

      {showManageCompanies && (
        <CompaniesManagementModal
          companies={companies}
          currentCompanyId={sessionInfo?.companyId}
          onClose={() => setShowManageCompanies(false)}
          onReload={async () => {
            const comps = await api("/api/companies");
            if (Array.isArray(comps)) setCompanies(comps);
            await load();
          }}
        />
      )}
      {showHeatmap && <CityHeatmapModal points={heatPoints} onClose={() => setShowHeatmap(false)} />}

    </div>
  );
}
function Overview({
  routes,
  active,
  completed,
  onSelectRoute,
  onPrintReport,
  onAssignRoute,
  onOpenTab,
  userRole,
  drivers,
  onOpenHeatmap,
}: {
  routes: RouteData[];
  active: RouteData[];
  completed: RouteData[];
  onSelectRoute: (routeId: string) => void;
  onPrintReport: (route: RouteData) => void;
  onAssignRoute?: (route: RouteData) => void;
  onOpenTab?: (tab: string) => void;
  userRole: string;
  drivers: Driver[];
  onOpenHeatmap: (points: Array<[number, number, number]>) => void;
}) {
  const delivered = routes.filter((route) => !["draft", "cancelled"].includes(route.status)).reduce((n, r) => n + Number(r.delivered || 0), 0);
  const todayLocal = new Date().toLocaleDateString("en-CA");
  const liveRoutes = routes.filter((route) => route.status === "assigned" || route.status === "active");
  const todayOperationalRoutes = routes.filter((route) =>
    String(route.route_date || "").slice(0, 10) === todayLocal && !["draft", "cancelled"].includes(route.status),
  );
  return (
    <>
      <DashboardAnalytics userRole={userRole} onOpenHeatmap={onOpenHeatmap} />
      <section className="metrics">
        <Metric
          label="Rotas hoje"
          value={
            todayOperationalRoutes.length
          }
          icon={<Navigation />}
        />
        <Metric
          label="Em andamento"
          value={active.length}
          icon={<LocateFixed />}
        />
        <Metric
          label="Entregas feitas"
          value={delivered}
          icon={<ClipboardCheck />}
        />
        <Metric label="Concluídas" value={completed.length} icon={<Check />} />
      </section>

      {/* Quick Launch Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <section className="panel" style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.12), rgba(5,150,105,0.05))", border: "1px solid rgba(16,185,129,0.3)", marginBottom: 0 }}>
          <div className="panel-title" style={{ marginBottom: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ color: "#10b981", fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                📄 Roteirizador de Planilhas
              </h2>
              <p style={{ fontSize: 12 }}>Upload de carteira (.xlsx / .csv / NOTFIS) e cubagem m³ com LIFO.</p>
            </div>
            <button type="button" className="button primary compact" style={{ background: "#10b981", border: "none" }} onClick={() => onOpenTab?.("roteirizador")}>
              Abrir
            </button>
          </div>
        </section>

        <section className="panel" style={{ background: "linear-gradient(135deg, rgba(14,165,233,0.12), rgba(2,132,199,0.05))", border: "1px solid rgba(14,165,233,0.3)", marginBottom: 0 }}>
          <div className="panel-title" style={{ marginBottom: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ color: "#0284c7", fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                📦 Rastreamento SSW (DANFE)
              </h2>
              <p style={{ fontSize: 12 }}>Consulta direta pelo DANFE (44 dígitos) integrado ao ssw.inf.br.</p>
            </div>
            <button type="button" className="button primary compact" style={{ background: "#0284c7", border: "none" }} onClick={() => onOpenTab?.("ssw")}>
              Consultar
            </button>
          </div>
        </section>
      </div>

      {/* Task 1: Mapa ao vivo para o Organizador */}
      <section className="panel live-fleet-panel">
        <div className="panel-title">
          <div>
            <h2>Mapa ao vivo da frota</h2>
            <p>Última posição transmitida por GPS dos motoristas em rota</p>
          </div>
        </div>
        <LiveFleetMap routes={liveRoutes} onSelectRoute={onSelectRoute} />
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Operação ao vivo</h2>
            <p>Clique em uma rota para abrir detalhes, paradas e fotos</p>
          </div>
        </div>
        <RouteTable
          routes={liveRoutes}
          onSelectRoute={onSelectRoute}
          onPrintReport={onPrintReport}
          onAssignRoute={onAssignRoute}
        />
      </section>
    </>
  );
}
function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <article className="metric">
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </article>
  );
}
function RouteTable({
  routes,
  onSelectRoute,
  onPrintReport,
  onAssignRoute,
  onCancelRoute,
}: {
  routes: RouteData[];
  onSelectRoute?: (routeId: string) => void;
  onPrintReport?: (route: RouteData) => void;
  onAssignRoute?: (route: RouteData) => void;
  onCancelRoute?: (route: RouteData) => void;
}) {
  return (
    <div className="route-list">
      {routes.map((r) => (
        <article
          key={r.id}
          className="clickable-route-row"
          onClick={() => onSelectRoute?.(r.id)}
        >
          <div className="route-badge">
            <Truck />
          </div>
          <div className="route-info-col">
            <b>{r.name}</b>
            <small>
              {formatDateBR(r.route_date)} · {r.driver_name || "Sem motorista"} ·{" "}
              {r.vehicle_name || "Sem veículo"} {r.plate ? `(${r.plate})` : ""}
            </small>
          </div>
          <Status value={r.status} />
          <div className="progress">
            <span>
              <i
                style={{
                  width: `${r.deliveries ? Math.round((r.delivered / r.deliveries) * 100) : 0}%`,
                }}
              />
            </span>
            <small>
              {r.delivered || 0}/{r.deliveries || 0}
            </small>
          </div>
          <div className="route-row-actions" onClick={(e) => e.stopPropagation()}>
            {(r.status === "draft" || r.status === "assigned") && onAssignRoute && (
              <button
                type="button"
                className={`btn-link ${r.status === "draft" ? "primary" : ""}`}
                onClick={() => onAssignRoute(r)}
                title={r.status === "draft" ? "Atribuir motorista e veículo" : "Alterar motorista ou veículo"}
              >
                <UserRound size={13} /> {r.status === "draft" ? "Atribuir" : "Reatribuir"}
              </button>
            )}
            {onSelectRoute && (
              <button
                type="button"
                className="btn-link"
                onClick={() => onSelectRoute(r.id)}
                title="Ver detalhes da rota"
              >
                <Eye size={13} /> Detalhes
              </button>
            )}
            {r.status === "completed" && onPrintReport && (
              <button
                type="button"
                className="btn-link secondary"
                onClick={() => onPrintReport(r)}
                title="Imprimir romaneio"
              >
                <Printer size={13} /> Romaneio
              </button>
            )}
            {["draft", "assigned", "active"].includes(r.status) && onCancelRoute && (
              <button
                type="button"
                className="btn-link danger"
                onClick={() => onCancelRoute(r)}
                title="Cancelar rota"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </article>
      ))}
      {!routes.length && <Empty text="Nenhuma rota criada." />}
    </div>
  );
}
function Status({ value }: { value: string }) {
  const labels: Record<string, string> = {
    draft: "Rascunho",
    assigned: "Atribuída",
    active: "Em rota",
    completed: "Concluída",
    cancelled: "Cancelada",
  };
  return <span className={`status ${value}`}>{labels[value] || value}</span>;
}
function DriverPhotoField({ initialPhoto }: { initialPhoto?: string | null }) {
  const [photo, setPhoto] = useState(initialPhoto || "");
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  return <div className="driver-photo-field">
    <input type="hidden" name="photo" value={photo} />
    {photo && <Image src={photo} alt="Prévia da foto do motorista" width={80} height={80} unoptimized />}
    <label>Foto do motorista (opcional)
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={processing} onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setError("");
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
          setError("Escolha uma imagem JPG, PNG ou WebP de até 10 MB."); return;
        }
        setProcessing(true);
        try {
          const bitmap = await createImageBitmap(file);
          try {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 256;
            const context = canvas.getContext("2d");
            if (!context) throw new Error();
            const side = Math.min(bitmap.width, bitmap.height);
            context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
            setPhoto(canvas.toDataURL("image/jpeg", 0.85));
          } finally { bitmap.close(); }
        } catch { setError("Não foi possível abrir a foto. Tente outra imagem."); }
        finally { setProcessing(false); }
      }} />
    </label>
    {processing && <><small>Preparando foto…</small><input className="photo-processing-guard" required value="" onChange={() => {}} aria-label="Aguarde o processamento da foto" /></>}
    <small>A foto aparecerá na seleção de motoristas da empresa.</small>
    {photo && <button type="button" className="button secondary compact" disabled={processing} onClick={() => setPhoto("")}>Remover foto</button>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </div>;
}

function Registry({
  kind,
  reload,
  items,
}: {
  kind: "driver" | "vehicle";
  reload: () => Promise<void>;
  items: Array<Driver | Vehicle>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | Vehicle | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("active");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const filteredItems = items.filter((item) => {
    if (filter === "active") return item.active !== false;
    if (filter === "inactive") return item.active === false;
    return true;
  });

  const submitCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await api(`/api/${kind === "driver" ? "drivers" : "vehicles"}`, {
        method: "POST",
        body: JSON.stringify(
          kind === "driver"
            ? {
                name: form.get("name"),
                phone: form.get("phone"),
                password: form.get("password"),
                photo: form.get("photo") || null,
              }
            : {
                name: form.get("name"),
                plate: form.get("plate"),
                odometer: Number(form.get("odometer")),
                rate_per_km: form.get("rate_per_km") ? Number(form.get("rate_per_km")) : null,
              },
        ),
      });
      setOpen(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await api(`/api/${kind === "driver" ? "drivers" : "vehicles"}/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify(
          kind === "driver"
            ? {
                name: form.get("name"),
                phone: form.get("phone"),
                password: form.get("password") || undefined,
                photo: form.get("photo") || null,
                active: form.get("active") === "on",
              }
            : {
                name: form.get("name"),
                plate: form.get("plate"),
                odometer: Number(form.get("odometer")),
                rate_per_km: form.get("rate_per_km") ? Number(form.get("rate_per_km")) : null,
                active: form.get("active") === "on",
              },
        ),
      });
      setEditing(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (item: Driver | Vehicle) => {
    const nextActive = item.active === false;
    const confirmMsg = nextActive
      ? `Reativar o cadastro de ${item.name}?`
      : `Desativar o cadastro de ${item.name}?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await api(`/api/${kind === "driver" ? "drivers" : "vehicles"}/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...item,
          active: nextActive,
        }),
      });
      await reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <h2>{kind === "driver" ? "Equipe de motoristas" : "Frota de veículos"}</h2>
          <p>{filteredItems.length} de {items.length} registro(s)</p>
        </div>
        <div className="panel-actions-group">
          <div className="registry-filter-tabs">
            <button
              type="button"
              className={filter === "active" ? "active" : ""}
              onClick={() => setFilter("active")}
            >
              Ativos
            </button>
            <button
              type="button"
              className={filter === "inactive" ? "active" : ""}
              onClick={() => setFilter("inactive")}
            >
              Inativos
            </button>
            <button
              type="button"
              className={filter === "all" ? "active" : ""}
              onClick={() => setFilter("all")}
            >
              Todos
            </button>
          </div>
          <button
            className="button primary compact"
            onClick={() => {
              setError("");
              setOpen(true);
            }}
          >
            <Plus size={15} /> Adicionar
          </button>
        </div>
      </div>

      <div className="registry-grid">
        {filteredItems.map((i) => {
          const isVehicle = "plate" in i;
          const isActive = i.active !== false;

          return (
            <article key={i.id} className={!isActive ? "item-inactive" : ""}>
              <span className={`avatar ${!isActive ? "inactive" : ""}`}>
                {!isVehicle && (i as Driver).photo ? <Image src={(i as Driver).photo!} alt="" width={42} height={42} unoptimized /> : (isVehicle ? (i as Vehicle).plate : i.name).slice(0, 2).toUpperCase()}
              </span>
              <div className="registry-info">
                <div className="registry-name-line">
                  <b>{i.name}</b>
                  <span className={`registry-status-pill ${isActive ? "active" : "inactive"}`}>
                    {isActive ? "Ativo" : "Inativo"}
                  </span>
                </div>
                <small>
                  {isVehicle
                    ? `${(i as Vehicle).plate} · ${Number((i as Vehicle).current_odometer).toLocaleString("pt-BR")} km${(i as Vehicle).rate_per_km ? ` · R$ ${(i as Vehicle).rate_per_km}/km` : ""}`
                    : (i as Driver).phone || "Sem telefone cadastrado"}
                </small>
              </div>
              <div className="registry-item-actions">
                <button
                  type="button"
                  className="btn-action-icon"
                  title="Editar cadastro"
                  onClick={() => {
                    setError("");
                    setEditing(i);
                  }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  className={`btn-action-icon ${isActive ? "danger" : "success"}`}
                  title={isActive ? "Desativar cadastro" : "Reativar cadastro"}
                  onClick={() => toggleActive(i)}
                >
                  <Power size={15} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {!filteredItems.length && (
        <Empty
          text={
            filter === "inactive"
              ? "Nenhum cadastro inativo."
              : kind === "driver"
                ? "Nenhum motorista encontrado."
                : "Nenhum veículo encontrado."
          }
        />
      )}

      {/* Modal Criar */}
      {open && (
        <Modal
          title={kind === "driver" ? "Novo motorista" : "Novo veículo"}
          onClose={() => setOpen(false)}
        >
          <form onSubmit={submitCreate} className="form-grid">
            {kind === "driver" && <DriverPhotoField />}
            <label>
              Nome completo
              <input name="name" required placeholder="Ex.: Carlos da Silva" />
            </label>
            {kind === "driver" ? (
              <>
                <label>
                  Telefone / WhatsApp
                  <input name="phone" inputMode="tel" placeholder="(11) 99999-9999" />
                </label>
                <label>
                  Senha de acesso do motorista (PIN)
                  <input
                    name="password"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{4,8}"
                    minLength={4}
                    maxLength={8}
                    required
                    placeholder="4 a 8 números"
                  />
                </label>
              </>
            ) : (
              <>
                <div className="form-row">
                  <label>
                    Placa do veículo
                    <input name="plate" required maxLength={8} placeholder="ABC1D23" />
                  </label>
                  <label>
                    Odômetro atual (km)
                    <input
                      name="odometer"
                      required
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="0.0"
                    />
                  </label>
                </div>
                <label>
                  Taxa por km (R$/km) (opcional)
                  <input
                    name="rate_per_km"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Ex.: 1.85"
                  />
                </label>
              </>
            )}
            <button disabled={busy} className="button primary">
              {busy ? "Salvando…" : "Salvar cadastro"}
            </button>
            {error && <p className="form-error">{error}</p>}
          </form>
        </Modal>
      )}

      {/* Modal Editar */}
      {editing && (
        <Modal
          title={kind === "driver" ? `Editar motorista: ${editing.name}` : `Editar veículo: ${(editing as Vehicle).plate}`}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={submitEdit} className="form-grid">
            {kind === "driver" && <DriverPhotoField initialPhoto={(editing as Driver).photo} />}
            <label>
              Nome
              <input name="name" required defaultValue={editing.name} />
            </label>
            {kind === "driver" ? (
              <>
                <label>
                  Telefone / WhatsApp
                  <input
                    name="phone"
                    inputMode="tel"
                    defaultValue={(editing as Driver).phone || ""}
                  />
                </label>
                <label>
                  Nova senha numérica (opcional)
                  <input
                    name="password"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{4,8}"
                    minLength={4}
                    maxLength={8}
                    placeholder="Deixe em branco para manter a atual"
                  />
                </label>
              </>
            ) : (
              <>
                <div className="form-row">
                  <label>
                    Placa do veículo
                    <input
                      name="plate"
                      required
                      maxLength={8}
                      defaultValue={(editing as Vehicle).plate}
                    />
                  </label>
                  <label>
                    Odômetro atual (km)
                    <input
                      name="odometer"
                      required
                      type="number"
                      min="0"
                      step="0.1"
                      defaultValue={(editing as Vehicle).current_odometer}
                    />
                  </label>
                </div>
                <label>
                  Taxa por km (R$/km) (opcional)
                  <input
                    name="rate_per_km"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={(editing as Vehicle).rate_per_km ?? ""}
                    placeholder="Ex.: 1.85"
                  />
                </label>
              </>
            )}
            <label className="check">
              <input
                type="checkbox"
                name="active"
                defaultChecked={editing.active !== false}
              />
              Cadastro ativo na operação
            </label>
            <div className="form-actions-split">
              <button
                type="button"
                className="button secondary"
                onClick={() => setEditing(null)}
              >
                Cancelar
              </button>
              <button disabled={busy} className="button primary">
                {busy ? "Salvando…" : "Salvar alterações"}
              </button>
            </div>
            {error && <p className="form-error">{error}</p>}
          </form>
        </Modal>
      )}
    </section>
  );
}

function RoutesPanel({
  routes,
  drivers,
  vehicles,
  reload,
  onSelectRoute,
  onPrintReport,
  onOpenPlanner,
  onAssignRoute,
}: {
  routes: RouteData[];
  drivers: Driver[];
  vehicles: Vehicle[];
  reload: () => Promise<void>;
  onSelectRoute: (routeId: string) => void;
  onPrintReport: (route: RouteData) => void;
  onOpenPlanner?: () => void;
  onAssignRoute?: (route: RouteData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<RouteData | null>(null);

  // Filters state
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [driverFilter, setDriverFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");

  const filteredRoutes = useMemo(() => {
    return routes.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (driverFilter !== "all" && r.driver_id !== driverFilter) return false;
      const rDate = String(r.route_date || "").slice(0, 10);
      if (dateFilter && rDate !== dateFilter) return false;
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesName = r.name.toLowerCase().includes(query);
        const matchesDriver = r.driver_name?.toLowerCase().includes(query);
        const matchesVehicle = r.vehicle_name?.toLowerCase().includes(query);
        const matchesPlate = r.plate?.toLowerCase().includes(query);
        if (!matchesName && !matchesDriver && !matchesVehicle && !matchesPlate) return false;
      }
      return true;
    });
  }, [routes, statusFilter, driverFilter, dateFilter, searchTerm]);

  const hasActiveFilters =
    statusFilter !== "all" ||
    driverFilter !== "all" ||
    dateFilter !== "" ||
    searchTerm.trim() !== "";

  const clearFilters = () => {
    setStatusFilter("all");
    setDriverFilter("all");
    setDateFilter("");
    setSearchTerm("");
  };

  const cancelRoute = async (route: RouteData) => {
    if (
      !window.confirm(
        `Cancelar a rota “${route.name}”? Esta ação interrompe o rastreamento e não pode ser desfeita.`,
      )
    )
      return;
    await api(`/api/routes/${route.id}/cancel`, { method: "POST" });
    await reload();
  };

  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Rotas e Viagens</h2>
            <p>Histórico completo, filtros e atribuição de viagens</p>
          </div>
          <button
            className="button primary compact"
            onClick={() => {
              if (onOpenPlanner) onOpenPlanner();
              else setOpen(true);
            }}
          >
            <Plus size={15} /> Nova rota
          </button>
        </div>

        {/* Filters Toolbar */}
        <div className="routes-filter-bar">
          <div className="filter-input-search">
            <Search size={15} />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por rota, motorista ou placa…"
            />
            {searchTerm && (
              <button type="button" onClick={() => setSearchTerm("")}>
                <X size={14} />
              </button>
            )}
          </div>

          <div className="filter-group">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              title="Filtrar por status"
            >
              <option value="all">Todos os status</option>
              <option value="draft">Rascunho</option>
              <option value="assigned">Atribuída</option>
              <option value="active">Em rota (ativa)</option>
              <option value="completed">Concluída</option>
              <option value="cancelled">Cancelada</option>
            </select>

            <select
              value={driverFilter}
              onChange={(e) => setDriverFilter(e.target.value)}
              title="Filtrar por motorista"
            >
              <option value="all">Todos os motoristas</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              title="Filtrar por data"
            />

            {hasActiveFilters && (
              <button
                type="button"
                className="clear-filters-btn"
                onClick={clearFilters}
                title="Limpar filtros"
              >
                <RotateCcw size={13} /> Limpar
              </button>
            )}
          </div>
        </div>

        <div className="filter-summary-row">
          <small>
            Exibindo <b>{filteredRoutes.length}</b> de <b>{routes.length}</b> rota(s)
          </small>
        </div>

        <RouteTable
          routes={filteredRoutes}
          onSelectRoute={onSelectRoute}
          onPrintReport={onPrintReport}
          onAssignRoute={onAssignRoute || ((r) => setSelected(r))}
          onCancelRoute={cancelRoute}
        />

        {selected && (
          <Assign
            route={selected}
            drivers={drivers.filter((d) => d.active !== false)}
            vehicles={vehicles.filter((v) => v.active !== false)}
            onDone={() => {
              setSelected(null);
              reload();
            }}
          />
        )}
      </section>

      {open && (
        <RouteBuilder
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            reload();
          }}
        />
      )}
    </>
  );
}
function DirectAssignModal({
  stops,
  routeInfo,
  defaultName,
  onClose,
  onDone,
}: {
  stops: Stop[];
  routeInfo: { km: number; seconds: number } | null;
  defaultName?: string;
  onClose: () => void;
  onDone: (assignedRoute: any) => void;
}) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [name, setName] = useState(defaultName || `Rota ${new Intl.DateTimeFormat("pt-BR").format(new Date())}`);
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api("/api/drivers").catch(() => []),
      api("/api/vehicles").catch(() => []),
    ]).then(([d, v]) => {
      const activeD = (d || []).filter((x: Driver) => x.active !== false);
      const activeV = (v || []).filter((x: Vehicle) => x.active !== false);
      setDrivers(activeD);
      setVehicles(activeV);
      if (activeD.length > 0) setSelectedDriverId(activeD[0].id);
      if (activeV.length > 0) setSelectedVehicleId(activeV[0].id);
    });
  }, []);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDriverId) return setError("Selecione um motorista para atribuir a rota.");
    if (!selectedVehicleId) return setError("Selecione um veículo para a viagem.");
    setLoading(true);
    setError("");

    try {
      const res = await api("/api/routes", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim() || `Rota ${new Intl.DateTimeFormat("pt-BR").format(new Date())}`,
          routeDate: date,
          optimizeBy: "distance",
          circular: false,
          stops,
          estimatedKm: routeInfo?.km,
          driverId: selectedDriverId,
          vehicleId: selectedVehicleId,
        }),
      });
      onDone(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Salvar e Atribuir a Motorista" onClose={onClose}>
      <form className="form-grid" onSubmit={handleAssign}>
        <label>
          Nome da rota
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Data da viagem
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          Motorista escalado
          <select value={selectedDriverId} onChange={(e) => setSelectedDriverId(e.target.value)} required>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} {d.phone ? `(${d.phone})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Veículo da frota
          <select value={selectedVehicleId} onChange={(e) => setSelectedVehicleId(e.target.value)} required>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.plate} ({v.current_odometer} km)
              </option>
            ))}
          </select>
        </label>
        {routeInfo && (
          <div className="route-summary-box">
            <span><b>{Math.max(0, stops.length - 1)} entregas</b></span> · <span><b>{routeInfo.km.toFixed(1)} km</b></span> · <span>{formatRouteTime(routeInfo.seconds)}</span>
          </div>
        )}
        {drivers.length === 0 && (
          <div className="alert-warning-box">
            ⚠️ Nenhum motorista ativo cadastrado. Cadastre motoristas na Central do Organizador antes de despachar viagens.
          </div>
        )}
        {vehicles.length === 0 && (
          <div className="alert-warning-box">
            ⚠️ Nenhum veículo ativo cadastrado. Cadastre veículos na Central do Organizador antes de despachar viagens.
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions-row">
          <button type="button" className="button secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={loading || drivers.length === 0 || vehicles.length === 0}
          >
            {loading ? "Atribuindo…" : "Salvar e Despachar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RoutePlannerView({
  onClose,
  onDone,
  onSwitchToDispatcher,
  onSwitchToDriver,
  initialStops,
  initialRouteName,
  initialRouteDate,
}: {
  onClose?: () => void;
  onDone?: () => void;
  onSwitchToDispatcher?: () => void;
  onSwitchToDriver?: () => void;
  initialStops?: Stop[];
  initialRouteName?: string;
  initialRouteDate?: string;
}) {
  const [stops, setStops] = useState<Stop[]>(initialStops || []);
  const [mobileShowMap, setMobileShowMap] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [results, setResults] = useState<Stop[]>([]);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [geometry, setGeometry] = useState<[number, number][]>([]);
  const [routeInfo, setRouteInfo] = useState<{ km: number; seconds: number } | null>(null);
  const [circular, setCircular] = useState(false);
  const [showStations, setShowStations] = useState(true);
  const [optimizeBy, setOptimizeBy] = useState<"distance" | "time" | "manual">("distance");
  const [routeName, setRouteName] = useState(initialRouteName || "");
  const [routeDate, setRouteDate] = useState(initialRouteDate || new Date().toLocaleDateString("en-CA"));
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showExtraConfig, setShowExtraConfig] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const optimizeRef = useRef<() => void>(() => {});
  const lastOptimizedCoordsRef = useRef<string>("");

  useEffect(() => {
    if (initialStops && initialStops.length > 0) {
      setStops(initialStops);
      if (initialRouteName) setRouteName(initialRouteName);
      if (initialRouteDate) setRouteDate(initialRouteDate);
    }
  }, [initialStops, initialRouteName, initialRouteDate]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setResults([]);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const changeStops = (next: Stop[]) => {
    setStops(next);
    setGeometry([]);
    setRouteInfo(null);
  };

  const moveStop = (fromIdx: number, toIdx: number) => {
    if (fromIdx < 1 || toIdx < 1 || fromIdx >= stops.length || toIdx >= stops.length) return;
    const next = [...stops];
    [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
    setOptimizeBy("manual");
    changeStops(next);
  };

  const search = useCallback(async (term: string, signal?: AbortSignal) => {
    if (term.trim().length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=br&q=${encodeURIComponent(term)}`,
        { signal },
      ).then((r) => r.json());
      setResults(
        res.map(
          (x: {
            name?: string;
            display_name: string;
            lat: string;
            lon: string;
          }) => ({
            name: x.name || x.display_name.split(",")[0],
            address: x.display_name,
            lat: +x.lat,
            lng: +x.lon,
          }),
        ),
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("Não foi possível pesquisar o endereço.");
    } finally {
      if (!signal?.aborted) setSearching(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => search(queryText, controller.signal), 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [queryText, search]);

  const addStop = (item: { name: string; address: string; lat: number; lng: number }) => {
    let lat = item.lat;
    let lng = item.lng;
    if (stops.some((s) => Math.abs(s.lat - lat) < 0.0001 && Math.abs(s.lng - lng) < 0.0001)) {
      lat += 0.00025 * (stops.length + 1);
      lng += 0.00025 * (stops.length + 1);
    }
    const stopWithId: Stop = {
      id: crypto.randomUUID(),
      name: item.name,
      address: item.address,
      lat,
      lng,
      is_origin: stops.length === 0,
    };
    changeStops([...stops, stopWithId]);
    setResults([]);
    setQueryText("");
  };

  const optimize = async (forceManual = false) => {
    if (stops.length < 2) return setError("Adicione uma origem e ao menos uma entrega.");
    const isManual = forceManual || optimizeBy === "manual";
    setOptimizing(true);
    setError("");
    try {
      const stopsToRoute = isManual
        ? (circular && stops.length > 1 ? [...stops, stops[0]] : [...stops])
        : stops;

      const coords = stopsToRoute.map((s, idx) => {
        let lat = s.lat;
        let lng = s.lng;
        for (let j = 0; j < idx; j++) {
          if (Math.abs(stopsToRoute[j].lat - lat) < 0.0002 && Math.abs(stopsToRoute[j].lng - lng) < 0.0002) {
            lat += 0.00025 * (idx - j);
            lng += 0.00025 * (idx - j);
            break;
          }
        }
        return `${lng.toFixed(6)},${lat.toFixed(6)}`;
      }).join(";");

      let data: any;

      if (isManual) {
        // Traçado exato na ordem definida pelo usuário (sem reordenar paradas)
        const osrmRouteProxy = `/api/osrm/route/v1/driving/${coords}?overview=full&geometries=geojson`;
        try {
          const res = await fetch(osrmRouteProxy);
          if (!res.ok) throw new Error(`Proxy status ${res.status}`);
          data = await res.json();
        } catch (proxyErr) {
          console.warn("OSRM route proxy fallback to direct URL:", proxyErr);
          const directUrl = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
          data = await fetch(directUrl).then((r) => r.json());
        }

        if (data.code !== "Ok" || !data.routes?.length) {
          throw new Error(data.message || "Não foi possível calcular trajeto pelo OSRM");
        }

        const line: [number, number][] = data.routes[0].geometry.coordinates.map(
          ([lng, lat]: [number, number]) => [lat, lng],
        );
        const distance = Number(data.routes[0].distance);
        const duration = Number(data.routes[0].duration);

        lastOptimizedCoordsRef.current = stops.map(s => `${s.lat},${s.lng}`).join(";") + `:${circular}:${optimizeBy}`;
        setGeometry(line);
        setRouteInfo({ km: distance / 1000, seconds: duration });
      } else {
        // Otimização automática por IA / OSRM Trip
        const osrmProxyUrl = `/api/osrm/trip/v1/driving/${coords}?source=first&roundtrip=${circular ? "true" : "false"}&overview=full&geometries=geojson`;
        try {
          const res = await fetch(osrmProxyUrl);
          if (!res.ok) throw new Error(`Proxy status ${res.status}`);
          data = await res.json();
        } catch (proxyErr) {
          console.warn("OSRM proxy fallback to direct URL:", proxyErr);
          const directUrl = `https://router.project-osrm.org/trip/v1/driving/${coords}?source=first&roundtrip=${circular ? "true" : "false"}&overview=full&geometries=geojson`;
          data = await fetch(directUrl).then((r) => r.json());
        }

        if (data.code !== "Ok" || !data.trips?.length) {
          throw new Error(data.message || "Não foi possível calcular trajeto pelo OSRM");
        }

        const ordered = new Array<Stop>(stops.length);
        data.waypoints.forEach((waypoint: { waypoint_index: number }, index: number) => {
          if (waypoint.waypoint_index >= 0 && waypoint.waypoint_index < stops.length) {
            ordered[waypoint.waypoint_index] = stops[index];
          }
        });
        const validOrdered = ordered.filter(Boolean).length === stops.length ? ordered : stops;

        const line: [number, number][] = data.trips[0].geometry.coordinates.map(
          ([lng, lat]: [number, number]) => [lat, lng],
        );
        const distance = Number(data.trips[0].distance);
        const duration = Number(data.trips[0].duration);

        lastOptimizedCoordsRef.current = validOrdered.map(s => `${s.lat},${s.lng}`).join(";") + `:${circular}:${optimizeBy}`;
        setStops(validOrdered);
        setGeometry(line);
        setRouteInfo({ km: distance / 1000, seconds: duration });
      }
    } catch (e) {
      console.warn("OSRM routing fallback:", e);
      const line: [number, number][] = stops.map((s) => [s.lat, s.lng]);
      if (circular && stops.length > 1) {
        line.push([stops[0].lat, stops[0].lng]);
      }
      let fallbackKm = 0;
      for (let i = 0; i < stops.length - 1; i++) {
        fallbackKm += distanceKm(stops[i].lat, stops[i].lng, stops[i + 1].lat, stops[i + 1].lng);
      }
      if (circular && stops.length > 1) {
        fallbackKm += distanceKm(stops[stops.length - 1].lat, stops[stops.length - 1].lng, stops[0].lat, stops[0].lng);
      }
      lastOptimizedCoordsRef.current = stops.map(s => `${s.lat},${s.lng}`).join(";") + `:${circular}:${optimizeBy}`;
      setGeometry(line);
      setRouteInfo({ km: fallbackKm, seconds: Math.round((fallbackKm / 45) * 3600) });
    } finally {
      setOptimizing(false);
    }
  };

  optimizeRef.current = optimize;
  const stopsKey = stops.map((s) => `${s.lat},${s.lng}`).join(";");
  useEffect(() => {
    if (stops.length < 2) return;
    const currentKey = stopsKey + `:${circular}:${optimizeBy}`;
    if (currentKey === lastOptimizedCoordsRef.current) return;
    const timer = window.setTimeout(() => optimizeRef.current(), 650);
    return () => window.clearTimeout(timer);
  }, [stopsKey, circular, optimizeBy, stops.length]);

  const saveDraft = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (stops.length < 2) return setError("Adicione uma origem e ao menos uma entrega.");
    if (savingDraft) return;
    setSavingDraft(true);
    setError("");
    const name = routeName.trim() || `Rota ${new Intl.DateTimeFormat("pt-BR").format(new Date())}`;
    try {
      await api("/api/routes", {
        method: "POST",
        body: JSON.stringify({
          name,
          routeDate,
          optimizeBy,
          circular,
          stops,
          estimatedKm: routeInfo?.km,
        }),
      });
      setSuccessMessage(`Rota "${name}" salva com sucesso no painel!`);
      if (onDone) onDone();
      setTimeout(() => setSuccessMessage(""), 5000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingDraft(false);
    }
  };

  const openGoogleMaps = () => {
    if (!stops.length) return;
    const path = stops.map((s) => `${s.lat},${s.lng}`).join("/");
    window.open(`https://www.google.com/maps/dir/${path}`, "_blank", "noopener,noreferrer");
  };

  const copyRouteLink = async () => {
    if (stops.length < 2) return;
    const path = stops.map((s) => `${s.lat},${s.lng}`).join("/");
    const gmapsUrl = `https://www.google.com/maps/dir/${path}`;
    try {
      await navigator.clipboard.writeText(gmapsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setError("Não foi possível copiar o link.");
    }
  };

  const printRouteSheet = () => {
    if (stops.length < 2) return;
    printElement("planner-print-document", `Romaneio - ${routeName || "Nova rota"}`)
      .catch((error) => window.alert(error.message));
  };

  const shareWhatsApp = () => {
    if (stops.length < 2) return;
    const name = routeName.trim() || `Rota ${new Intl.DateTimeFormat("pt-BR").format(new Date())}`;
    const lines = [
      `*CRIAR ROTA - ${name.toUpperCase()}*`,
      `Data: ${formatDateBR(routeDate)}`,
      `Entregas: ${stops.length - 1} pontos`,
      routeInfo ? `Distancia estimada: ${routeInfo.km.toFixed(1)} km (~${formatRouteTime(routeInfo.seconds)})` : "",
      "",
      "*ITINERARIO:*",
      ...stops.map((s, i) => `${i === 0 ? "Origem (CD):" : `Parada ${i}:`} ${s.name} - ${s.address}`),
    ].filter(Boolean).join("\n");
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(lines)}`, "_blank");
  };

  const toggleTheme = () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    if (next === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    localStorage.setItem("rw_theme", next);
  };

  return (
    <div className={`planner-fullscreen ${mobileShowMap ? "mobile-show-map" : ""}`}>
      <div className="planner-panel">
        <header className="planner-header">
          <div className="logo">
            <img src="/icon.svg" width={32} height={32} alt="" aria-hidden="true" style={{ borderRadius: "8px" }} />
            <div className="logo-text-group">
              <b>Criar Rota</b>
              <small className="logo-sub">Roteamento & Cargas</small>
            </div>
          </div>
          <div className="planner-header-actions">
            <ThemeToggle />
            <button
              type="button"
              className="planner-mobile-toggle"
              onClick={() => setMobileShowMap(!mobileShowMap)}
            >
              {mobileShowMap ? "Ver paradas" : "Ver mapa"}
            </button>
            {onClose && (
              <button type="button" onClick={onClose} aria-label="Fechar criador de rotas">
                <X size={16} />
              </button>
            )}
          </div>
        </header>

        {successMessage && (
          <div className="alert-success-banner">
            <div className="alert-success-text">
              <Check size={16} />
              <span>{successMessage}</span>
            </div>
            {(onSwitchToDispatcher || onSwitchToDriver) && (
              <div className="alert-success-actions">
                {onSwitchToDispatcher && (
                  <button
                    type="button"
                    className="banner-action-btn"
                    onClick={onSwitchToDispatcher}
                  >
                    Ir para Central
                  </button>
                )}
                {onSwitchToDriver && (
                  <button
                    type="button"
                    className="banner-action-btn"
                    onClick={onSwitchToDriver}
                  >
                    Portal do Motorista
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="planner-search-container" ref={searchContainerRef}>
          <div className="search planner-search">
            <input
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  search(queryText);
                }
              }}
              placeholder="Pesquisar cidade, bairro ou endereço…"
              autoComplete="off"
            />
            {searching && <span className="searching" role="status">Buscando…</span>}
          </div>

          <div className="stops-count-bar">
            <span>{stops.length === 0 ? "Nenhuma parada adicionada" : `${stops.length} parada${stops.length > 1 ? "s" : ""} adicionada${stops.length > 1 ? "s" : ""}`}</span>
          </div>

          {results.length > 0 && (
            <div className="search-results">
              {results.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    addStop(r);
                    setResults([]);
                    setQueryText("");
                  }}
                >
                  <MapPin size={15} />
                  <div>
                    <b>{r.name}</b>
                    <small>{r.address}</small>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="builder-stops">
          {stops.length === 0 && (
            <div className="empty-stops">
              <MapPin size={24} />
              <span>
                <b>Comece pela origem</b>
                <small>Pesquise e selecione o ponto de saída (galpão / depósito).</small>
              </span>
            </div>
          )}
          {stops.map((s, i) => {
            const isOrigin = i === 0;
            const loadOrder = !isOrigin && stops.length > 1 ? stops.length - i : null;
            return (
              <div key={s.id || `${s.lat}-${s.lng}-${i}`} className="stop-item-card">
                <span
                  className={`stop-item-badge ${isOrigin ? "origin" : ""}`}
                  style={{ backgroundColor: getStopColor(i) }}
                >
                  {isOrigin ? "CD" : `${i}º`}
                </span>
                <div className="stop-item-info">
                  <div className="stop-item-name">{s.name}</div>
                  <div className="stop-item-addr">{isOrigin ? `Origem · ${s.address}` : s.address}</div>
                  <div className="stop-cubagem-row">
                    {loadOrder !== null && (
                      <span className="stop-loading-tag">
                        📦 {loadOrder}º a carregar ({loadOrder === 1 ? "porta" : "fundo"})
                      </span>
                    )}
                    {!isOrigin && (
                      <div className="stop-inputs-cubagem" onClick={(e) => e.stopPropagation()}>
                        <label title="Quantidade de caixas/volumes nesta entrega">
                          <span>Cx:</span>
                          <input
                            type="number"
                            min="0"
                            max="9999"
                            placeholder="0"
                            value={s.boxes ?? ""}
                            onChange={(e) => {
                              const val = e.target.value === "" ? undefined : Math.max(0, parseInt(e.target.value) || 0);
                              const next = [...stops];
                              next[i] = { ...s, boxes: val };
                              changeStops(next);
                            }}
                          />
                        </label>
                        <label title="Volume total em metros cúbicos (m³)">
                          <span>m³:</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="999"
                            placeholder="0.0"
                            value={s.volume_m3 ?? ""}
                            onChange={(e) => {
                              const val = e.target.value === "" ? undefined : Math.max(0, parseFloat(e.target.value) || 0);
                              const next = [...stops];
                              next[i] = { ...s, volume_m3: val };
                              changeStops(next);
                            }}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
                <div className="stop-item-actions">
                  <button
                    type="button"
                    className="stop-item-btn"
                    disabled={i <= 1}
                    onClick={() => moveStop(i, i - 1)}
                    title="Mover para cima (Ordem manual)"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="stop-item-btn"
                    disabled={i === 0 || i === stops.length - 1}
                    onClick={() => moveStop(i, i + 1)}
                    title="Mover para baixo (Ordem manual)"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="stop-item-btn remove"
                    onClick={() => changeStops(stops.filter((_, x) => x !== i))}
                    title="Remover parada"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="travel-options-card">
          <div className="travel-options-header">
            <div className="travel-opt-title">
              <SlidersHorizontal size={13} />
              <span>OPÇÕES DE VIAGEM</span>
            </div>
            <button
              type="button"
              className="travel-opt-more-btn"
              onClick={() => setShowExtraConfig(!showExtraConfig)}
              title="Mais configurações da rota (nome, data)"
            >
              <Settings size={12} />
            </button>
          </div>

          {showExtraConfig && (
            <div className="travel-extra-config">
              <input
                value={routeName}
                onChange={(e) => setRouteName(e.target.value)}
                placeholder="Nome da rota (opcional)"
                className="compact-input"
              />
              <input
                type="date"
                value={routeDate}
                onChange={(e) => setRouteDate(e.target.value)}
                className="compact-input"
              />
            </div>
          )}

          <div className="travel-options-row">
            <span className="travel-opt-label">Critério de rota</span>
            <div className="option-segmented-pills">
              <button
                type="button"
                className={`option-pill ${optimizeBy === "distance" ? "active" : ""}`}
                onClick={() => setOptimizeBy("distance")}
                title="Otimiza automaticamente a ordem para a menor quilometragem total"
              >
                Menor Distância
              </button>
              <button
                type="button"
                className={`option-pill ${optimizeBy === "time" ? "active" : ""}`}
                onClick={() => setOptimizeBy("time")}
                title="Otimiza automaticamente a ordem para o menor tempo"
              >
                Menor Tempo
              </button>
              <button
                type="button"
                className={`option-pill ${optimizeBy === "manual" ? "active" : ""}`}
                onClick={() => setOptimizeBy("manual")}
                title="Mantém estritamente a ordem que você definir nas paradas"
              >
                Ordem Manual
              </button>
            </div>
          </div>

          <div
            className="travel-options-toggle-row"
            onClick={() => {
              setCircular(!circular);
              setGeometry([]);
              setRouteInfo(null);
            }}
          >
            <div className="travel-toggle-text">
              <b>Retornar à origem</b>
              <small>Volta à garagem ao descarregar tudo</small>
            </div>
            <div className={`toggle-switch ${circular ? "checked" : ""}`}>
              <div className="toggle-knob" />
            </div>
          </div>

          <div
            className="travel-options-toggle-row"
            style={{ marginTop: 8 }}
            onClick={() => setShowStations(!showStations)}
            title="Ativa ou desativa a exibição dos postos de combustível e preços ao longo da rota"
          >
            <div className="travel-toggle-text">
              <b>Exibir postos no mapa</b>
              <small>{showStations ? "Postos de combustível visíveis" : "Postos ocultados para limpar o mapa"}</small>
            </div>
            <div className={`toggle-switch ${showStations ? "checked" : ""}`}>
              <div className="toggle-knob" />
            </div>
          </div>
        </div>

        {routeInfo && (
          <div className="route-summary-gradient-card">
            <div className="route-summary-card-title">
              {optimizeBy === "manual" ? "RESUMO DO TRAJETO (ORDEM MANUAL)" : "RESUMO DA ROTA OTIMIZADA"}
            </div>
            <div className="route-summary-grid-3col">
              <div className="summary-col">
                <Navigation size={13} className="summary-col-icon" />
                <span className="summary-val">{stops.length}</span>
                <span className="summary-lbl">paradas</span>
              </div>
              <div className="summary-col">
                <RouteIcon size={13} className="summary-col-icon" />
                <span className="summary-val">{routeInfo.km.toFixed(1)}</span>
                <span className="summary-lbl">km distância</span>
              </div>
              <div className="summary-col">
                <Clock size={13} className="summary-col-icon" />
                <span className="summary-val">{formatRouteTime(routeInfo.seconds)}</span>
                <span className="summary-lbl">tempo est.</span>
              </div>
            </div>

            {/* Total Cubagem e Carga do Baú */}
            {(() => {
              const totalBoxes = stops.reduce((acc, s) => acc + (s.boxes || 0), 0);
              const totalVolume = stops.reduce((acc, s) => acc + (s.volume_m3 || 0), 0);
              return (totalBoxes > 0 || totalVolume > 0) ? (
                <div className="route-summary-cubagem-bar">
                  <span>📦 <b>{totalBoxes}</b> {totalBoxes === 1 ? "volume / caixa" : "volumes / caixas"}</span>
                  <span>📐 <b>{totalVolume > 0 ? `${totalVolume.toFixed(2)} m³` : "--"}</b> cubagem</span>
                </div>
              ) : null;
            })()}

            <div className="route-summary-footer-note">
              <Check size={11} />
              <span>{circular ? "Inclui retorno à origem" : "Sem retorno à garagem"}</span>
            </div>
          </div>
        )}

        <div className="planner-footer">
          {optimizing && <div className="route-calculating" role="status">Calculando trajeto pelas ruas…</div>}

          <button
            type="button"
            className="btn-recalculate-primary"
            disabled={stops.length < 2 || optimizing}
            onClick={() => optimize()}
            title={optimizeBy === "manual" ? "Atualizar traçado mantendo ordem manual das paradas" : "Recalcular melhor traçado e sequência (TSP)"}
          >
            <Zap size={14} className={optimizing ? "spin" : ""} />
            <span>{optimizing ? "Calculando rota…" : (optimizeBy === "manual" ? "Atualizar Trajeto Manual" : "Recalcular Rota")}</span>
          </button>

          <div className="actions-grid-2x2">
            <button
              type="button"
              className="btn-action-tile btn-gmaps"
              disabled={stops.length < 2}
              onClick={openGoogleMaps}
              title="Abrir rota no Google Maps"
            >
              <Navigation size={13} />
              <span>Google Maps</span>
            </button>
            <button
              type="button"
              className="btn-action-tile btn-copy"
              disabled={stops.length < 2}
              onClick={copyRouteLink}
              title="Copiar link da rota"
            >
              <Copy size={13} />
              <span>{copied ? "Copiado!" : "Copiar link"}</span>
            </button>
            <button
              type="button"
              className="btn-action-tile btn-whatsapp"
              disabled={stops.length < 2}
              onClick={shareWhatsApp}
              title="Compartilhar no WhatsApp"
            >
              <Share2 size={13} />
              <span>WhatsApp</span>
            </button>
            <button
              type="button"
              className="btn-action-tile btn-print"
              disabled={stops.length < 2}
              onClick={printRouteSheet}
              title="Imprimir romaneio de carga"
            >
              <Printer size={13} />
              <span>Imprimir</span>
            </button>
          </div>

          <div className="actions-save-row">
            <button
              type="button"
              className="btn-save-compact btn-save-draft"
              disabled={stops.length < 2 || optimizing || !routeInfo || savingDraft}
              onClick={() => saveDraft()}
              title="Salvar rota como rascunho na Central"
            >
              {savingDraft ? "Salvando…" : "Salvar Rascunho"}
            </button>
            <button
              type="button"
              className="btn-save-compact btn-assign-direct"
              disabled={stops.length < 2 || optimizing || !routeInfo}
              onClick={() => setAssignModalOpen(true)}
              title="Salvar e atribuir rota a um motorista"
            >
              <UserRound size={13} />
              <span>Salvar e Atribuir</span>
            </button>
          </div>

          {stops.length > 0 && (
            <button
              type="button"
              className="btn-clear-stops-link"
              onClick={() => changeStops([])}
            >
              <RotateCcw size={11} /> Limpar todas as paradas
            </button>
          )}

          {error && <p className="form-error">{error}</p>}
          {successMessage && <p className="form-success" style={{ color: "#10b981", fontSize: "13px", fontWeight: "600", margin: "6px 0 0" }}>✓ {successMessage}</p>}
        </div>
      </div>

      <section className="planner-map" aria-label="Mapa da rota">
        {mobileShowMap && (
          <div className="planner-map-mobile-bar">
            <button
              type="button"
              className="planner-map-back-btn"
              onClick={() => setMobileShowMap(false)}
            >
              <ArrowLeft size={16} /> Voltar para lista de paradas
            </button>
            <span className="planner-map-stops-badge">
              {stops.length} {stops.length === 1 ? "parada" : "paradas"}
            </span>
          </div>
        )}
        <RouteMap stops={stops} geometry={geometry} visible={mobileShowMap} showStations={showStations} />
      </section>

      <section id="planner-print-document" className="planner-print-sheet" aria-label="Romaneio da rota planejada">
        <header className="planner-print-header">
          <div className="report-logo"><img src="/icon.svg" width={34} height={34} alt="" aria-hidden="true" style={{ borderRadius: "8px" }} /><b>Criar Rota</b></div>
          <div>
            <h1>ROMANEIO DE ROTA</h1>
            <p>{routeName.trim() || `Rota ${formatDateBR(routeDate)}`}</p>
          </div>
          <strong>{formatDateBR(routeDate)}</strong>
        </header>
        <div className="planner-print-summary">
          <span><b>{Math.max(0, stops.length - 1)}</b> entregas</span>
          <span><b>{routeInfo ? `${routeInfo.km.toFixed(1)} km` : "—"}</b> estimados</span>
          <span><b>{routeInfo ? formatRouteTime(routeInfo.seconds) : "—"}</b> de percurso</span>
        </div>
        {/* Tabela de paradas planejadas */}
        <h2>Sequência planejada</h2>
        <table className="planner-print-table" style={{ width: "100%", borderCollapse: "collapse", marginBottom: "20px" }}>
          <thead>
            <tr style={{ background: "#f1f5f9", textAlign: "left", fontSize: "11px", color: "#475569" }}>
              <th style={{ padding: "8px 10px", width: "45px" }}>Parada</th>
              <th style={{ padding: "8px 10px" }}>Destino / Cliente</th>
              <th style={{ padding: "8px 10px", width: "115px" }}>Nº pedido(s)</th>
              <th style={{ padding: "8px 10px" }}>Endereço Completo</th>
              <th style={{ padding: "8px 10px", width: "70px", textAlign: "center" }}>Volumes</th>
              <th style={{ padding: "8px 10px", width: "70px", textAlign: "center" }}>Cubagem</th>
            </tr>
          </thead>
          <tbody>
            {stops.map((stop, index) => (
              <tr key={`${stop.lat}-${stop.lng}-${index}`} style={{ borderBottom: "1px solid #e2e8f0", fontSize: "12px" }}>
                <td style={{ padding: "8px 10px", fontWeight: "800", color: index === 0 ? "#0f172a" : "#2563eb" }}>
                  {index === 0 ? "A" : index}
                </td>
                <td style={{ padding: "8px 10px", fontWeight: "700" }}>
                  {index === 0 ? "Origem — " : ""}{stop.name}
                </td>
                <td style={{ padding: "8px 10px", fontSize: "11px", fontWeight: "700", overflowWrap: "anywhere" }}>
                  {stop.order_ids?.length ? stop.order_ids.join(", ") : "--"}
                </td>
                <td style={{ padding: "8px 10px", color: "#475569" }}>{stop.address}</td>
                <td style={{ padding: "8px 10px", textAlign: "center" }}>
                  {stop.boxes && stop.boxes > 0 ? `${stop.boxes} cx` : "--"}
                </td>
                <td style={{ padding: "8px 10px", textAlign: "center" }}>
                  {stop.volume_m3 && stop.volume_m3 > 0 ? `${Number(stop.volume_m3).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} m³` : "--"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Guia LIFO de Carregamento integrado ao planejamento */}
        {stops.length > 2 && (
          <div className="planner-lifo-section" style={{ pageBreakBefore: "always", breakBefore: "page", marginTop: "24px", paddingTop: "20px", borderTop: "2px solid #087f5b" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <div>
                <h2 style={{ color: "#087f5b", margin: 0, fontSize: "16px" }}>GUIA DE CARREGAMENTO DO BAÚ (LIFO)</h2>
                <small style={{ color: "#64748b" }}>Ordem de carregamento no pátio antes da viagem iniciar</small>
              </div>
              <div style={{ padding: "4px 10px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", color: "#166534", fontWeight: "750", fontSize: "11px" }}>
                Expedição & Conferência
              </div>
            </div>

            <div style={{ background: "#f0fdf4", border: "1.5px dashed #22c58b", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "11.5px", color: "#166534" }}>
              <b>Regra LIFO:</b> A <b>última entrega</b> entra <b>primeiro</b> (fundo do baú). A <b>primeira entrega</b> entra por <b>último</b> (porta do baú).
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11.5px" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #cbd5e1", textAlign: "left", color: "#475569" }}>
                  <th style={{ padding: "6px 8px", width: "45px", textAlign: "center" }}>Ordem</th>
                  <th style={{ padding: "6px 8px", width: "85px" }}>Posição</th>
                  <th style={{ padding: "6px 8px" }}>Destino</th>
                  <th style={{ padding: "6px 8px" }}>Endereço</th>
                  <th style={{ padding: "6px 8px", width: "65px", textAlign: "center" }}>Volumes</th>
                  <th style={{ padding: "6px 8px", width: "65px", textAlign: "center" }}>Cubagem</th>
                  <th style={{ padding: "6px 8px", width: "75px", textAlign: "center" }}>Entrega Nº</th>
                  <th style={{ padding: "6px 8px", width: "55px", textAlign: "center" }}>Check</th>
                </tr>
              </thead>
              <tbody>
                {stops.filter((_, idx) => idx > 0).reverse().map((stop, idx, arr) => {
                  const originalIndex = stops.length - 1 - idx;
                  const isFirstLoaded = idx === 0;
                  const isLastLoaded = idx === arr.length - 1;

                  return (
                    <tr key={`lifo-${stop.lat}-${stop.lng}-${idx}`} style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "6px 8px", textAlign: "center", fontWeight: "800", color: "#087f5b" }}>#{idx + 1}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {isFirstLoaded && <span style={{ background: "#dbeafe", color: "#1d4ed8", padding: "1px 5px", borderRadius: "4px", fontWeight: "750", fontSize: "10px" }}>FUNDO</span>}
                        {isLastLoaded && <span style={{ background: "#dcfce7", color: "#15803d", padding: "1px 5px", borderRadius: "4px", fontWeight: "750", fontSize: "10px" }}>PORTA</span>}
                        {!isFirstLoaded && !isLastLoaded && <span style={{ color: "#64748b", fontSize: "10px" }}>Meio</span>}
                      </td>
                      <td style={{ padding: "6px 8px", fontWeight: "700" }}>{stop.name}</td>
                      <td style={{ padding: "6px 8px", color: "#475569" }}>{stop.address}</td>
                      <td style={{ padding: "6px 8px", textAlign: "center" }}>{stop.boxes && stop.boxes > 0 ? `${stop.boxes} cx` : "--"}</td>
                      <td style={{ padding: "6px 8px", textAlign: "center" }}>{stop.volume_m3 && stop.volume_m3 > 0 ? `${Number(stop.volume_m3).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} m³` : "--"}</td>
                      <td style={{ padding: "6px 8px", textAlign: "center", fontWeight: "700" }}>{originalIndex}ª entrega</td>
                      <td style={{ padding: "6px 8px", textAlign: "center" }}>
                        <div style={{ width: "16px", height: "16px", border: "1.5px solid #94a3b8", borderRadius: "3px", margin: "auto" }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <footer>Documento operacional gerado pelo Criar Rota em {new Date().toLocaleString("pt-BR")}</footer>
      </section>

      {assignModalOpen && (
        <DirectAssignModal
          stops={stops}
          routeInfo={routeInfo}
          defaultName={routeName}
          onClose={() => setAssignModalOpen(false)}
          onDone={(res) => {
            setAssignModalOpen(false);
            setSuccessMessage(`Rota "${res.name}" criada e atribuída com sucesso!`);
            if (onDone) onDone();
            setTimeout(() => setSuccessMessage(""), 6000);
          }}
        />
      )}
    </div>
  );
}

function RouteBuilder({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  return <RoutePlannerView onClose={onClose} onDone={onDone} />;
}

function formatRouteTime(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

function RouteMap({ stops, geometry, visible, showStations = true }: { stops: Stop[]; geometry: [number, number][]; visible?: boolean; showStations?: boolean }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const markersLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const routeLineRef = useRef<import("leaflet").Polyline | null>(null);
  const stationsLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const stationsDataRef = useRef<Station[] | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Initialize persistent Leaflet map once
  useEffect(() => {
    let active = true;
    if (!mapElement.current) return;

    if (mapRef.current) {
      setMapReady(true);
      return;
    }

    import("leaflet").then((L) => {
      if (!active || !mapElement.current || mapRef.current) return;
      leafletRef.current = L;

      // Ensure no leftover leaflet container state
      if ((mapElement.current as any)._leaflet_id) {
        delete (mapElement.current as any)._leaflet_id;
      }

      const map = L.map(mapElement.current, {
        zoomControl: true,
        scrollWheelZoom: true,
      }).setView([-14.2, -51.9], 4);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      routeLineRef.current = L.polyline([], {
        color: "#2563eb",
        weight: 5,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);

      stationsLayerRef.current = L.layerGroup().addTo(map);
      markersLayerRef.current = L.layerGroup().addTo(map);

      mapRef.current = map;
      setMapReady(true);

      // Invalidate size once DOM container has finalized its layout dimensions
      requestAnimationFrame(() => {
        if (mapRef.current) mapRef.current.invalidateSize();
      });
    });

    return () => {
      active = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markersLayerRef.current = null;
        routeLineRef.current = null;
        stationsLayerRef.current = null;
        leafletRef.current = null;
        setMapReady(false);
      }
      if (mapElement.current && (mapElement.current as any)._leaflet_id) {
        delete (mapElement.current as any)._leaflet_id;
      }
    };
  }, []);

  // When switching visibility or stops change, recalculate Leaflet viewport
  useEffect(() => {
    const map = mapRef.current;
    if (map) {
      const timer = setTimeout(() => {
        map.invalidateSize();
        if (stops.length > 0 && leafletRef.current) {
          const validStops = stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
          if (validStops.length > 0) {
            const bounds = leafletRef.current.latLngBounds(validStops.map((s) => [s.lat, s.lng]));
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
          }
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [visible, stops]);

  // Update layer contents whenever stops, geometry, or mapReady changes
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const markersLayer = markersLayerRef.current;
    const routeLine = routeLineRef.current;
    const stationsLayer = stationsLayerRef.current;

    if (!map || !L || !markersLayer || !routeLine || !stationsLayer) return;

    map.invalidateSize();

    // 1. Update stop markers
    markersLayer.clearLayers();
    if (stops.length > 0) {
      const coordCounts = new Map<string, number>();
      stops.forEach((stop, index) => {
        const key = `${stop.lat.toFixed(4)},${stop.lng.toFixed(4)}`;
        const count = coordCounts.get(key) || 0;
        coordCounts.set(key, count + 1);

        let displayLat = stop.lat;
        let displayLng = stop.lng;
        if (count > 0) {
          const angle = (count * (2 * Math.PI)) / 6;
          const radius = 0.00045 * (1 + Math.floor(count / 6) * 0.5);
          displayLat += radius * Math.cos(angle);
          displayLng += radius * Math.sin(angle);
        }

        const isOrigin = index === 0;
        const color = getStopColor(index);
        const icon = L.divIcon({
          className: "route-number-marker-wrap",
          html: `<span class="route-number-marker ${isOrigin ? "origin" : ""}" style="background-color: ${color}">${isOrigin ? "CD" : index}</span>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        const label = isOrigin ? `Origem: ${stop.name}` : `${index}. ${stop.name}`;
        L.marker([displayLat, displayLng], { icon })
          .bindTooltip(label, { direction: "top", offset: [0, -12] })
          .addTo(markersLayer);
      });
    }

    // 2. Update polyline route and camera bounds
    if (geometry.length > 1) {
      routeLine.setLatLngs(geometry);
      try {
        const bounds = routeLine.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [45, 45], maxZoom: 15 });
        }
      } catch {}
    } else if (stops.length === 1) {
      routeLine.setLatLngs([]);
      map.setView([stops[0].lat, stops[0].lng], 13);
    } else if (stops.length > 1) {
      routeLine.setLatLngs([]);
      try {
        const points = stops.map((s) => L.latLng(s.lat, s.lng));
        const bounds = L.latLngBounds(points);
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [45, 45], maxZoom: 15 });
        }
      } catch {}
    } else {
      routeLine.setLatLngs([]);
    }

    // 3. Update stations along route corridor
    const renderStations = (stationList: Station[]) => {
      if (!stationsLayerRef.current || !mapRef.current) return;
      stationsLayer.clearLayers();
      if (!stops.length || !stationList.length) return;

      const corridor: [number, number][] = geometry.length > 1
        ? geometry.filter((_, i) => i % 15 === 0).concat([geometry[geometry.length - 1]])
        : stops.map((s) => [s.lat, s.lng]);

      const nearby = stationList
        .map((station) => {
          const sLat = parseFloat(String(station.latitude).replace(",", "."));
          const sLng = parseFloat(String(station.longitude).replace(",", "."));
          if (isNaN(sLat) || isNaN(sLng)) return null;
          let minD = Infinity;
          for (let i = 0; i < corridor.length; i++) {
            const d = distanceKm(corridor[i][0], corridor[i][1], sLat, sLng);
            if (d < minD) minD = d;
          }
          return { station, distance: minD, sLat, sLng };
        })
        .filter((item): item is { station: Station; distance: number; sLat: number; sLng: number } => item !== null && item.distance <= 120)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 100);

      nearby.forEach(({ station, distance, sLat, sLng }) => {
        const icon = L.divIcon({
          className: "fuel-map-marker-wrap",
          html: '<span class="fuel-map-marker" title="Posto eFleet">⛽</span>',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        const tooltipHtml = `<b>${station.nome}</b><br/>${distance.toFixed(1)} km da rota · ${station.cidade}/${station.estado}${station.diesels10 ? `<br/><b>S10:</b> R$ ${station.diesels10}` : station.diesel ? `<br/><b>D:</b> R$ ${station.diesel}` : ""}`;
        const popupHtml = `<div style="font-size:12px;min-width:180px;line-height:1.4">
          <strong style="color:#0f172a;display:block;margin-bottom:4px">⛽ ${station.nome}</strong>
          <div style="color:#64748b;margin-bottom:6px">${station.logradouro || ""}, ${station.numero || "S/N"} · ${station.cidade}/${station.estado}</div>
          <div style="background:#f1f5f9;padding:4px 6px;border-radius:4px;font-size:11px">
            <div>Distância da rota: <b>${distance.toFixed(1)} km</b></div>
            ${station.diesels10 ? `<div>Diesel S10: <b style="color:#16a34a">R$ ${station.diesels10}</b></div>` : ""}
            ${station.diesel ? `<div>Diesel Comum: <b style="color:#16a34a">R$ ${station.diesel}</b></div>` : ""}
          </div>
        </div>`;

        L.marker([sLat, sLng], { icon })
          .bindTooltip(tooltipHtml, { direction: "top", offset: [0, -10] })
          .bindPopup(popupHtml)
          .addTo(stationsLayer);
      });
    };

    if (!showStations) {
      stationsLayer.clearLayers();
    } else if (stationsDataRef.current) {
      renderStations(stationsDataRef.current);
    } else {
      loadStations()
        .then((data) => {
          if (Array.isArray(data)) {
            stationsDataRef.current = data;
            if (showStations) renderStations(data);
          }
        })
        .catch(() => {});
    }
  }, [stops, geometry, mapReady, showStations]);

  return <div ref={mapElement} className="leaflet-route-map" />;
}
function Assign({
  route,
  drivers,
  vehicles,
  onDone,
}: {
  route: RouteData;
  drivers: Driver[];
  vehicles: Vehicle[];
  onDone: () => void;
}) {
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const result = await api(`/api/routes/${route.id}/assign`, {
      method: "POST",
      body: JSON.stringify({
        driverId: f.get("driver"),
        vehicleId: f.get("vehicle"),
      }),
    });
    const url = `${location.origin}/?route=${result.public_id}`;
    await navigator.clipboard.writeText(url);
    onDone();
  };
  return (
    <Modal title={`Atribuir ${route.name}`} onClose={onDone}>
      <form className="form-grid" onSubmit={submit}>
        <label>
          Motorista
          <select name="driver" required>
            <option value="">Selecione</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Veículo
          <select name="vehicle" required>
            <option value="">Selecione</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.plate}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary">Atribuir e copiar link</button>
      </form>
    </Modal>
  );
}

function DriverApp({
  driver,
  onExit,
  online,
}: {
  driver: Driver;
  onExit: () => void;
  online: boolean;
}) {
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [selected, setSelected] = useState<RouteData | null>(null);
  const [tab, setTab] = useState<"today" | "upcoming" | "completed">("today");

  const load = useCallback(() => api("/api/routes").then(setRoutes), []);
  useEffect(() => {
    load();
  }, [load]);

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showPaymentRequest, setShowPaymentRequest] = useState(false);

  const todayStr = new Date().toLocaleDateString("en-CA");

  const todayRoutes = useMemo(() => {
    return routes.filter((r) => {
      const rDate = String(r.route_date || "").slice(0, 10);
      return (
        r.status === "active" ||
        (r.status !== "completed" && r.status !== "cancelled" && rDate <= todayStr)
      );
    });
  }, [routes, todayStr]);

  const upcomingRoutes = useMemo(() => {
    return routes.filter((r) => {
      const rDate = String(r.route_date || "").slice(0, 10);
      return (
        r.status !== "completed" &&
        r.status !== "cancelled" &&
        rDate > todayStr
      );
    });
  }, [routes, todayStr]);

  const completedRoutes = useMemo(() => {
    return routes.filter((r) => r.status === "completed" || r.status === "cancelled");
  }, [routes]);

  const currentTabRoutes =
    tab === "today"
      ? todayRoutes
      : tab === "upcoming"
        ? upcomingRoutes
        : completedRoutes;

  if (selected)
    return (
      <ActiveRoute
        route={selected}
        driver={driver}
        onBack={() => {
          setSelected(null);
          load();
        }}
        online={online}
      />
    );

  return (
    <main className="driver-shell">
      <header>
        <Logo />
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <ThemeToggle />
          <button
            type="button"
            className="secondary compact"
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", borderRadius: "8px", fontSize: "12px", border: "1px solid var(--line)", background: "var(--paper)", cursor: "pointer" }}
            onClick={() => setShowChangePassword(true)}
            title="Alterar meu PIN de acesso"
          >
            <KeyRound size={14} /> <span>Alterar PIN</span>
          </button>
          <button
            type="button"
            className="secondary compact"
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", borderRadius: "8px", fontSize: "12px", border: "1px solid rgba(5, 150, 105, 0.25)", background: "rgba(5, 150, 105, 0.08)", color: "#047857", cursor: "pointer" }}
            onClick={() => setShowPaymentRequest(true)}
            title="Solicitar pagamento, diária ou reembolso"
          >
            <Send size={14} /> <span>Solicitar pagamento</span>
          </button>
          <button
            type="button"
            className="secondary compact"
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", borderRadius: "8px", fontSize: "12px", border: "1px solid rgba(220, 38, 38, 0.2)", background: "rgba(220, 38, 38, 0.05)", color: "#dc2626", cursor: "pointer" }}
            onClick={onExit}
            title="Sair / Desconectar"
          >
            <LogOut size={14} /> <span>Sair</span>
          </button>
          <button className="avatar-button" onClick={onExit} title="Perfil / Sair">
            {driver.name.slice(0, 2).toUpperCase()}
          </button>
        </div>
      </header>
      <section className="driver-content">
        <span className="eyebrow">BOM TRABALHO</span>
        <h1>Olá, {driver.name.split(" ")[0]}</h1>
        <p>Suas rotas estão organizadas por data e situação.</p>

        {/* Task 3: Driver Tabs com contadores e filtros funcionais */}
        <div className="driver-tabs">
          <button
            className={tab === "today" ? "active" : ""}
            onClick={() => setTab("today")}
          >
            Hoje ({todayRoutes.length})
          </button>
          <button
            className={tab === "upcoming" ? "active" : ""}
            onClick={() => setTab("upcoming")}
          >
            Próximas ({upcomingRoutes.length})
          </button>
          <button
            className={tab === "completed" ? "active" : ""}
            onClick={() => setTab("completed")}
          >
            Concluídas ({completedRoutes.length})
          </button>
        </div>

        <div className="driver-routes">
          {currentTabRoutes.map((r) => (
            <button
              key={r.id}
              onClick={async () =>
                setSelected(await api(`/api/routes/${r.id}`))
              }
            >
              <div>
                <Status value={r.status} />
                <h2>{r.name}</h2>
                <p>
                  <Truck /> {r.vehicle_name || "Veículo"} · {r.plate || "--"}
                </p>
                <p>
                  <MapPin /> {r.delivered || 0}/{r.deliveries || 0} entregas
                </p>
                <p className="route-date-tag">
                  <Calendar size={13} /> Data: {formatDateBR(r.route_date)}
                </p>
              </div>
              <ChevronRight />
            </button>
          ))}

          {!currentTabRoutes.length && (
            <Empty
              text={
                tab === "today"
                  ? "Nenhuma rota para hoje."
                  : tab === "upcoming"
                    ? "Nenhuma rota agendada."
                    : "Nenhuma rota concluída ainda."
              }
            />
          )}
        </div>
      </section>

      {showChangePassword && (
        <ChangePasswordModal
          onClose={() => setShowChangePassword(false)}
          onLogout={() => {
            setShowChangePassword(false);
            onExit();
          }}
        />
      )}
      {showPaymentRequest && (
        <PaymentRequestModal
          userRole="driver"
          onClose={() => setShowPaymentRequest(false)}
        />
      )}
    </main>
  );
}

function ActiveRoute({
  route,
  driver,
  onBack,
  online,
}: {
  route: RouteData;
  driver: Driver;
  onBack: () => void;
  online: boolean;
}) {
  const [data, setData] = useState(route);
  const [modal, setModal] = useState<"start" | "delivery" | "finish" | null>(
    null,
  );
  const [showReport, setShowReport] = useState(false);
  const [next, setNext] = useState<Stop | null>(null);
  const [currentCoords, setCurrentCoords] = useState<{
    lat: number;
    lng: number;
    accuracy?: number;
  } | null>(null);
  const watch = useRef<number | null>(null);

  useEffect(() => {
    setNext(
      data.stops?.find((s) => !s.is_origin && s.status !== "delivered") || null,
    );
  }, [data]);

  const reload = useCallback(
    async () => setData(await api(`/api/routes/${data.id}`)),
    [data.id],
  );

  useEffect(() => {
    if (online) {
      flushQueue()
        .then((count) => {
          if (count > 0) reload();
        })
        .catch(() => {});
    }
    const handleFlushed = () => reload();
    window.addEventListener("routewise:queue-flushed", handleFlushed);
    return () => window.removeEventListener("routewise:queue-flushed", handleFlushed);
  }, [online, reload]);

  useEffect(() => {
    if (data.status !== "active") return;

    watch.current = navigator.geolocation.watchPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        setCurrentCoords(coords);

        const payload = {
          points: [
            {
              operationId: crypto.randomUUID(),
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              recordedAt: new Date().toISOString(),
            },
          ],
        };
        if (navigator.onLine)
          api(`/api/routes/${data.id}/location`, {
            method: "POST",
            body: JSON.stringify(payload),
          }).catch(() =>
            enqueue({
              id: crypto.randomUUID(),
              url: `/api/routes/${data.id}/location`,
              body: payload,
            }),
          );
        else
          enqueue({
            id: crypto.randomUUID(),
            url: `/api/routes/${data.id}/location`,
            body: payload,
          });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );

    return () => {
      if (watch.current !== null)
        navigator.geolocation.clearWatch(watch.current);
    };
  }, [data.id, data.status]);

  return (
    <main className="active-route">
      <header>
        <button onClick={onBack} title="Voltar para lista">
          <ArrowLeft />
        </button>
        <div>
          <small>{driver.name}</small>
          <b>{data.name}</b>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <ThemeToggle />
          <Status value={data.status} />
        </div>
      </header>

      {/* Task 4: Navegação GPS / mini-mapa interativo integrado */}
      <section className="route-map">
        <DriverLiveMap
          stops={data.stops || []}
          currentLocation={currentCoords}
          nextStop={next}
          status={data.status}
        />
      </section>

      <section className="trip-sheet">
        <div className="trip-summary">
          <div>
            <small>PROGRESSO</small>
            <strong>
              {data.delivered ||
                data.stops?.filter((s) => s.status === "delivered").length ||
                0}
              /{data.stops?.filter((s) => !s.is_origin).length || 0}
            </strong>
          </div>
          <div>
            <small>VEÍCULO</small>
            <strong>{data.plate || "--"}</strong>
          </div>
        </div>

        {data.status === "assigned" && (
          <button
            className="button primary tall"
            onClick={() => setModal("start")}
          >
            <Navigation /> Iniciar rota (Registrar Odômetro)
          </button>
        )}

        {data.status === "active" && (
          <>
            {next ? (
              <article className="next-stop">
                <span className="eyebrow">PRÓXIMA ENTREGA</span>
                <h2>{next.name}</h2>
                <p>{next.address}</p>
                <div className="next-stop-actions">
                  <a
                    className="button secondary"
                    target="_blank"
                    rel="noreferrer"
                    href={`https://www.google.com/maps/dir/?api=1&destination=${next.lat},${next.lng}`}
                  >
                    <Navigation /> Abrir no Maps
                  </a>
                  <button
                    className="button primary"
                    onClick={() => setModal("delivery")}
                  >
                    <Check /> Entrega feita
                  </button>
                </div>
              </article>
            ) : (
              <div className="complete-callout">
                <Check size={28} />
                <b>Todas as entregas foram concluídas!</b>
                <p>Retorne ao ponto de saída e registre o odômetro final.</p>
              </div>
            )}

            <StationsNearRoute stops={data.stops || []} />

            <button
              className="button finish"
              onClick={() => setModal("finish")}
            >
              Finalizar rota (Registrar retorno)
            </button>
          </>
        )}

        {data.status === "completed" && (
          <div className="complete-callout success">
            <Check size={32} />
            <b>Rota concluída com sucesso</b>
            <span>{data.actual_km ?? "--"} km percorridos</span>
            {/* Task 5: Romaneio / Relatório em PDF */}
            <button
              type="button"
              className="button primary compact mt-3"
              onClick={() => setShowReport(true)}
            >
              <Printer size={16} /> Ver Romaneio / Prestação de Contas
            </button>
          </div>
        )}
      </section>

      {modal && (
        <ProofModal
          phase={modal}
          route={data}
          stop={next}
          onClose={() => setModal(null)}
          onDone={async (completedPhase, completedStop) => {
            const currentPhase = completedPhase || modal;
            const currentStop = completedStop !== undefined ? completedStop : next;
            setModal(null);
            if (currentPhase === "start") {
              setData((prev) => ({ ...prev, status: "active" }));
            } else if (currentPhase === "delivery" && currentStop?.id) {
              setData((prev) => ({
                ...prev,
                delivered: (prev.delivered || 0) + 1,
                stops: prev.stops?.map((s) =>
                  s.id === currentStop.id ? { ...s, status: "delivered" } : s,
                ),
              }));
            } else if (currentPhase === "finish") {
              setData((prev) => ({ ...prev, status: "completed" }));
            }
            await reload().catch(() => {});
          }}
        />
      )}

      {showReport && (
        <RouteReportModal
          route={data as any}
          onClose={() => setShowReport(false)}
        />
      )}
    </main>
  );
}
function ProofModal({
  phase,
  route,
  stop,
  onClose,
  onDone,
}: {
  phase: "start" | "delivery" | "finish";
  route: RouteData;
  stop: Stop | null;
  onClose: () => void;
  onDone: (completedPhase?: "start" | "delivery" | "finish", completedStop?: Stop | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [compressedBlob, setCompressedBlob] = useState<Blob | null>(null);
  const [compressedBase64, setCompressedBase64] = useState<string>("");

  const isSubmittingRef = useRef(false);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const vehicleOdo = Number(route.vehicle_odometer || 0);
  const startOdo = Number(
    route.odometer?.find((o) => o.phase === "start")?.kilometers ??
    route.vehicle_odometer ??
    0,
  );
  const minKm = phase === "start" ? vehicleOdo : startOdo;

  const handleSelectedFile = async (file: File) => {
    if (previewUrl && previewUrl.startsWith("blob:")) {
      try { URL.revokeObjectURL(previewUrl); } catch {}
    }
    setSelectedFile(file);
    setError("");
    setOfflineSaved(false);
    setStatusMessage("Otimizando imagem...");
    setCompressing(true);
    try {
      // R1: Client-Side WebP Compression (max 1600x1200, 0.70 quality)
      const res = await compressDriverPhoto(file, {
        maxWidth: 1600,
        maxHeight: 1200,
        quality: 0.70,
      });
      setCompressedBlob(res.blob);
      setCompressedBase64(res.base64);
      setPreviewUrl(res.dataUrl);
      setStatusMessage(null);
    } catch (err) {
      console.warn("Compressão de foto falhou:", err);
      setCompressedBlob(file);
      try {
        const buf = await file.arrayBuffer();
        setCompressedBase64(arrayBufferToBase64(buf));
      } catch {}
      setPreviewUrl(URL.createObjectURL(file));
      setStatusMessage(null);
    } finally {
      setCompressing(false);
    }
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (compressing) return;
    if (busy || offlineSaved || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    const f = new FormData(e.currentTarget);
    const blobToSend = compressedBlob || selectedFile;
    if (!blobToSend || !blobToSend.size) {
      isSubmittingRef.current = false;
      setError("Por favor, tire uma foto ou selecione uma imagem.");
      return;
    }
    setBusy(true);
    setError("");
    setStatusMessage(null);

    const operationId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // 1. Geolocalização rápida (máximo 1.5s para não travar a interface)
    let lat = stop?.lat ?? (route.stops?.[0]?.lat ?? -14.2);
    let lng = stop?.lng ?? (route.stops?.[0]?.lng ?? -51.9);
    try {
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        const loc = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            timeout: 1500,
            maximumAge: 120000,
          });
        });
        lat = loc.coords.latitude;
        lng = loc.coords.longitude;
      }
    } catch (geoErr) {
      console.warn("GPS fallback used:", geoErr);
    }

    let photoKey = "";

    // Helper: Safely queue payload into IndexedDB routewise-offline
    const queueOfflinePayload = async () => {
      let b64 = compressedBase64;
      if (!b64 && blobToSend) {
        try {
          const buf = await blobToSend.arrayBuffer();
          b64 = arrayBufferToBase64(buf);
        } catch {}
      }
      const payload: any = {
        operationId,
        lat,
        lng,
        photoBase64: b64,
        photoContentType: "image/webp",
      };
      if (photoKey) {
        payload.photoKey = photoKey;
      }

      let targetUrl = "";
      if (phase === "start") {
        targetUrl = `/api/routes/${route.id}/start`;
        payload.kilometers = Number(f.get("kilometers"));
      } else if (phase === "finish") {
        targetUrl = `/api/routes/${route.id}/finish`;
        payload.kilometers = Number(f.get("kilometers"));
        payload.confirmIncomplete = f.get("incomplete") === "on";
      } else if (stop?.id) {
        targetUrl = `/api/routes/${route.id}/deliveries/${stop.id}/complete`;
        payload.occurrence = f.get("occurrence") || "entregue";
        payload.note = String(f.get("note") || "").trim();
      }

      await enqueue({
        id: operationId,
        idempotencyKey: operationId,
        url: targetUrl,
        method: "POST",
        headers: { "X-RouteWise-Role": "driver" },
        body: payload,
      });

      setOfflineSaved(true);
      setStatusMessage("Salvo offline. Aguardando rede...");
      setTimeout(() => {
        onDone(phase, stop);
      }, 1200);
    };

    // If device is offline, immediately save to IndexedDB queue
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      try {
        await queueOfflinePayload();
      } catch (qErr) {
        isSubmittingRef.current = false;
        setError("Erro ao armazenar comprovante offline no aparelho.");
        setBusy(false);
      }
      return;
    }

    // Attempt online submission with fallback to offline queue
    try {
      photoKey = "";

      // Tentativa 1: Presigned PUT
      try {
        const signed = await api("/api/uploads/presign", {
          method: "POST",
          body: JSON.stringify({
            kind: phase,
            contentType: "image/webp",
            size: blobToSend.size,
          }),
        });

        const uploadTarget = signed.url;
        const uploadRes = await fetch(uploadTarget, {
          method: "PUT",
          headers: { "Content-Type": "image/webp" },
          body: blobToSend,
        });

        if (uploadRes.ok) {
          photoKey = signed.key;
        } else {
          throw new Error(`PUT falhou com status ${uploadRes.status}`);
        }
      } catch (putErr) {
        console.warn("Upload PUT falhou, tentando envio direto:", putErr);

        // Tentativa 2: Direct upload
        try {
          if (compressedBase64) {
            const b64Res = await api("/api/uploads/direct", {
              method: "POST",
              body: JSON.stringify({
                kind: phase,
                contentType: "image/webp",
                base64: compressedBase64,
              }),
            });
            photoKey = b64Res.key;
          } else {
            const formData = new FormData();
            formData.append("file", blobToSend, "photo.webp");
            formData.append("kind", phase);
            const directRes = await fetch("/api/uploads/direct", {
              method: "POST",
              headers: { "X-RouteWise-Role": "driver" },
              body: formData,
            });
            if (directRes.ok) {
              const dData = await directRes.json();
              photoKey = dData.key;
            } else {
              throw new Error(`Direct POST falhou com status ${directRes.status}`);
            }
          }
        } catch (directErr) {
          console.warn("Direct upload falhou, armazenando na fila offline:", directErr);
          await queueOfflinePayload();
          return;
        }
      }

      if (!photoKey) {
        await queueOfflinePayload();
        return;
      }

      // 3. Finalizar etapa correspondente
      const common = {
        photoKey,
        lat,
        lng,
        operationId,
      };

      if (phase === "start") {
        await api(`/api/routes/${route.id}/start`, {
          method: "POST",
          body: JSON.stringify({
            ...common,
            kilometers: Number(f.get("kilometers")),
          }),
        });
      } else if (phase === "finish") {
        await api(`/api/routes/${route.id}/finish`, {
          method: "POST",
          body: JSON.stringify({
            ...common,
            kilometers: Number(f.get("kilometers")),
            confirmIncomplete: f.get("incomplete") === "on",
          }),
        });
      } else if (stop?.id) {
        await api(`/api/routes/${route.id}/deliveries/${stop.id}/complete`, {
          method: "POST",
          body: JSON.stringify({
            ...common,
            occurrence: f.get("occurrence") || "entregue",
            note: String(f.get("note") || "").trim(),
          }),
        });
      }
      onDone(phase, stop);
    } catch (e) {
      console.warn("Envio online falhou, armazenando na fila offline:", e);
      try {
        await queueOfflinePayload();
      } catch (queueErr) {
        isSubmittingRef.current = false;
        setError((e as Error).message || "Erro ao registrar foto");
        setBusy(false);
      }
    }
  };

  return (
    <Modal
      title={
        phase === "start"
          ? "Registrar saída (Odômetro)"
          : phase === "finish"
            ? "Registrar retorno (Odômetro)"
            : "Comprovar entrega"
      }
      onClose={onClose}
    >
      <form className="form-grid" onSubmit={submit}>
        {phase !== "delivery" && (
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span style={{ fontWeight: 600 }}>Quilometragem do painel (KM)</span>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.45rem 0.65rem",
              borderRadius: "0.5rem",
              background: "var(--surface-muted, rgba(0,0,0,0.04))",
              fontSize: "0.82rem",
              color: "var(--text-dim)",
            }}>
              <Gauge size={16} style={{ color: "var(--primary)" }} />
              {phase === "start" ? (
                <span>
                  Odômetro anterior do veículo: <strong>{vehicleOdo.toFixed(1)} km</strong>
                </span>
              ) : (
                <span>
                  Odômetro de saída registrado: <strong>{startOdo.toFixed(1)} km</strong>
                </span>
              )}
            </div>
            <input
              name="kilometers"
              type="number"
              min={minKm}
              step="0.1"
              required
              autoFocus
              placeholder={`Ex.: ${Math.ceil(minKm + 5)}`}
            />
            <small style={{ color: "var(--text-dim)", fontSize: "0.76rem" }}>
              Digite o valor total atual exibido no velocímetro do veículo
            </small>
          </label>
        )}

        {/* Lightweight Compression Status Indicator */}
        {compressing && (
          <div
            className="status-indicator compression-status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              borderRadius: "8px",
              background: "#e0f2fe",
              color: "#0369a1",
              fontSize: "0.85rem",
              fontWeight: 600,
            }}
          >
            <RefreshCw className="spin" size={16} />
            <span>Otimizando imagem...</span>
          </div>
        )}

        {/* Lightweight Offline Saved Indicator */}
        {offlineSaved && (
          <div
            className="status-indicator offline-status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 14px",
              borderRadius: "8px",
              background: "#fff3d8",
              color: "#8a5a00",
              fontSize: "0.88rem",
              fontWeight: 600,
            }}
          >
            <WifiOff size={18} />
            <span>Salvo offline. Aguardando rede...</span>
          </div>
        )}

        {previewUrl ? (
          <div className="photo-preview-box">
            <img src={previewUrl} alt="Pré-visualização da foto" className="photo-preview-img" />
            <div className="photo-preview-details">
              <span className="photo-preview-badge">✓ Imagem otimizada (WebP)</span>
              <small>{selectedFile?.name || "foto.webp"} ({(Number(compressedBlob?.size || selectedFile?.size || 0) / 1024).toFixed(0)} KB otimizada)</small>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button
                  type="button"
                  className="button secondary compact"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  <Camera size={14} /> Tirar outra
                </button>
                <button
                  type="button"
                  className="button secondary compact"
                  onClick={() => galleryInputRef.current?.click()}
                >
                  <Upload size={14} /> Galeria
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", margin: "0.25rem 0" }}>
            <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Foto do comprovante</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <button
                type="button"
                className="button primary"
                style={{ padding: "0.9rem 0.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera size={26} />
                <span style={{ fontWeight: 600, fontSize: "0.92rem" }}>Tirar Foto</span>
                <span style={{ fontSize: "0.72rem", opacity: 0.85 }}>Abrir Câmera</span>
              </button>
              <button
                type="button"
                className="button secondary"
                style={{ padding: "0.9rem 0.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}
                onClick={() => galleryInputRef.current?.click()}
              >
                <Upload size={26} />
                <span style={{ fontWeight: 600, fontSize: "0.92rem" }}>Galeria</span>
                <span style={{ fontSize: "0.72rem", opacity: 0.85 }}>Escolher Arquivo</span>
              </button>
            </div>
            <small style={{ textAlign: "center", color: "var(--text-dim)", fontSize: "0.76rem" }}>
              Tire uma foto nítida do painel do veículo ou do comprovante
            </small>
          </div>
        )}

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleSelectedFile(f);
          }}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleSelectedFile(f);
          }}
        />

        {phase === "delivery" && (
          <label>
            Ocorrência da entrega
            <select name="occurrence" defaultValue="entregue">
              <option value="entregue">Entrega realizada</option>
              <option value="cliente_ausente">Cliente ausente</option>
              <option value="endereco_incorreto">Endereço incorreto</option>
              <option value="recusado">Entrega recusada</option>
            </select>
            Observação da entrega
            <textarea name="note" rows={3} placeholder="Opcional (Ex.: Recebido por João)" />
          </label>
        )}

        {phase === "finish" && (
          <label className="check">
            <input type="checkbox" name="incomplete" /> Confirmo o encerramento
            mesmo que existam entregas pendentes
          </label>
        )}

        <button
          disabled={busy || compressing || offlineSaved || (!selectedFile && !previewUrl)}
          className="button primary"
          style={{ marginTop: "0.5rem" }}
        >
          {compressing
            ? "Otimizando imagem..."
            : offlineSaved
              ? "Salvo offline. Aguardando rede..."
              : busy
                ? "Enviando foto e registrando…"
                : "Confirmar registro"}
        </button>
        {error && <p className="form-error" style={{ margin: "0.5rem 0 0 0" }}>{error}</p>}
      </form>
    </Modal>
  );
}
function StationsNearRoute({
  stops,
  title = "Postos conveniados próximos",
}: {
  stops: Stop[];
  title?: string;
}) {
  const [stations, setStations] = useState<
    Array<Station & { distance: number }>
  >([]);
  useEffect(() => {
    if (!stops.length) return;
    loadStations()
      .then((all: Station[]) =>
        setStations(
          all
            .map((s) => ({
              ...s,
              distance: Math.min(
                ...stops.map((p) =>
                  distanceKm(p.lat, p.lng, +s.latitude, +s.longitude),
                ),
              ),
            }))
            .filter((s) => s.distance <= 25)
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 8),
        ),
      )
      .catch(() => {});
  }, [stops]);
  return (
    <section className="stations">
      <div className="panel-title">
        <div>
          <h3>{title}</h3>
          <p>Rede eFleet em um raio de até 25 km das paradas</p>
        </div>
        <span>{stations.length}</span>
      </div>
      <div>
        {stations.map((s) => (
          <article key={s.id_rede}>
            <span className="fuel">⛽</span>
            <div>
              <b>{s.nome}</b>
              <small>
                {s.logradouro}, {s.numero} · {s.cidade}/{s.estado}
              </small>
              <em>
                {s.diesels10
                  ? `S10 R$ ${s.diesels10}`
                  : s.diesel
                    ? `Diesel R$ ${s.diesel}`
                    : "Consulte o preço"}
              </em>
            </div>
            <a
              target="_blank"
              href={`https://www.google.com/maps/dir/?api=1&destination=${s.latitude},${s.longitude}`}
            >
              {s.distance.toFixed(1)} km <ChevronRight />
            </a>
          </article>
        ))}
      </div>
      {!stations.length && <small>Nenhum posto conveniado próximo.</small>}
    </section>
  );
}
function distanceKm(a: number, b: number, c: number, d: number) {
  const rad = (x: number) => (x * Math.PI) / 180,
    R = 6371,
    dl = rad(c - a),
    dn = rad(d - b),
    q =
      Math.sin(dl / 2) ** 2 +
      Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop">
      <section className={`modal ${wide ? "wide" : ""}`}>
        <header>
          <h2>{title}</h2>
          <button onClick={onClose}>
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <RouteIcon />
      <b>{text}</b>
      <small>Os novos registros aparecerão aqui.</small>
    </div>
  );
}
