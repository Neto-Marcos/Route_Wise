"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Copy,
  Download,
  Eye,
  FileText,
  Filter,
  Gauge,
  KeyRound,
  LocateFixed,
  Mail,
  Map as MapIcon,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Power,
  Printer,
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
import { LiveFleetMap } from "./live-fleet-map";
import { DriverLiveMap } from "./driver-live-map";
import { RouteDetailModal, type DetailedRoute } from "./route-detail-modal";
import { RouteReportModal } from "./route-report-modal";

type DispatcherUser = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  created_at: string;
};

type Driver = {
  id: string;
  public_id: string;
  name: string;
  phone?: string;
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
    headers: { "Content-Type": "application/json", ...(role ? { "X-RouteWise-Role": role } : {}), ...options?.headers },
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || "Não foi possível concluir");
  return out;
};
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

function TopNavBar({
  activePortal,
  setActivePortal,
  theme,
  setTheme,
  online,
  driverName,
  isDispatcher,
}: {
  activePortal: "planner" | "dispatcher" | "driver" | "home";
  setActivePortal: (portal: "planner" | "dispatcher" | "driver" | "home") => void;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  online: boolean;
  driverName?: string;
  isDispatcher?: boolean;
}) {
  return (
    <header className="top-nav-bar no-print">
      <div
        className="top-nav-brand"
        onClick={() => setActivePortal("home")}
        role="button"
        tabIndex={0}
        title="Página inicial"
      >
        <Logo />
      </div>

      <nav className="top-nav-tabs" aria-label="Portais do sistema">
        <button
          type="button"
          className={`top-nav-tab ${activePortal === "dispatcher" ? "active" : ""}`}
          onClick={() => setActivePortal("dispatcher")}
        >
          <SlidersHorizontal size={16} />
          <span>Central do Organizador</span>
        </button>

        <button
          type="button"
          className={`top-nav-tab ${activePortal === "driver" ? "active" : ""}`}
          onClick={() => setActivePortal("driver")}
        >
          <Truck size={16} />
          <span>Portal do Motorista{driverName ? ` (${driverName.split(" ")[0]})` : ""}</span>
        </button>
      </nav>

      <div className="top-nav-actions">
        {(driverName || isDispatcher) && (
          <div className="active-user-pill" title="Usuário conectado">
            <UserRound size={13} />
            <span>{driverName ? `Motorista: ${driverName.split(" ")[0]}` : "Gestor: Central"}</span>
          </div>
        )}

        <button
          type="button"
          className="theme-toggle-btn"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title={`Alternar para tema ${theme === "dark" ? "claro" : "escuro"}`}
          aria-label="Alternar tema"
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        <div
          className={`connection-pill ${online ? "online" : "offline"}`}
          title={online ? "Conexão ativa e sincronizada" : "Operando offline"}
        >
          <span className="dot" />
          <span>{online ? "Online" : "Offline"}</span>
        </div>
      </div>
    </header>
  );
}

export default function RouteWiseApp() {
  const [activePortal, setActivePortal] = useState<
    "planner" | "dispatcher" | "driver" | "home"
  >("home");
  const [dispatcherAuthed, setDispatcherAuthed] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const online = useOnline();

  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js");
    if (online) flushQueue().catch(() => {});

    // Check saved dispatcher role in session
    if (typeof window !== "undefined" && sessionStorage.getItem("rw_role") === "dispatcher") {
      setDispatcherAuthed(true);
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
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
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
      <TopNavBar
        activePortal={activePortal}
        setActivePortal={setActivePortal}
        theme={theme}
        setTheme={handleThemeChange}
        online={online}
        driverName={selectedDriver?.name}
        isDispatcher={dispatcherAuthed}
      />

      {installPrompt && (
        <aside className="pwa-install-banner no-print">
          <div className="pwa-banner-content">
            <span className="pwa-icon">📱</span>
            <div>
              <b>Instalar RouteWise no Celular</b>
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
          onDispatcher={() => setActivePortal("dispatcher")}
          onDriver={() => setActivePortal("driver")}
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
            onBack={() => setActivePortal("home")}
            onSuccess={() => setDispatcherAuthed(true)}
          />
        ) : (
          <Dispatcher
            onExit={() => {
              sessionStorage.removeItem("rw_role");
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
              setSelectedDriver(null);
              sessionStorage.removeItem("rw_role");
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
      <span>↗</span>
      <b>routewise</b>
    </div>
  );
}

function Home({
  onDispatcher,
  onDriver,
}: {
  onDispatcher: () => void;
  onDriver: () => void;
}) {
  return (
    <main className="home">
      <section className="home-copy">
        <Logo />
        <div>
          <span className="eyebrow">OPERAÇÃO EM MOVIMENTO</span>
          <h1>
            Rotas claras.
            <br />
            Entregas sob controle.
          </h1>
          <p>
            Planeje percursos otimizados no mapa, despache para motoristas e acompanhe
            em tempo real cada entrega com comprovantes e fotos.
          </p>
        </div>
        <small>
          Funciona em qualquer navegador e pode ser instalado no celular ou tablet.
        </small>
      </section>
      <section className="access-panel">
        <div className="access-head">
          <h2>Como você quer acessar?</h2>
          <p>Entre no ambiente da sua empresa.</p>
        </div>
        <button className="access-card" onClick={onDispatcher}>
          <span className="access-icon green" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#059669" }}>
            <SlidersHorizontal />
          </span>
          <span>
            <b>Sou gestor</b>
            <small>Planejar rotas, cadastrar equipe e acompanhar a operação</small>
          </span>
          <ChevronRight />
        </button>
        <button className="access-card" onClick={onDriver}>
          <span className="access-icon amber">
            <Truck />
          </span>
          <span>
            <b>Sou motorista</b>
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
  onBack,
  onSuccess,
}: {
  onBack: () => void;
  onSuccess: () => void;
}) {
  const [companyCode, setCompanyCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [register, setRegister] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(register ? "/api/companies/register" : "/api/session/dispatcher", {
        method: "POST",
        body: JSON.stringify({ companyCode, companyName, name, email, password }),
      });
      sessionStorage.setItem("rw_role", "dispatcher");
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <main className="center-page">
      <form className="card narrow auth-card" onSubmit={submit}>
        <button type="button" className="back" onClick={onBack}>
          <ArrowLeft size={17} /> Voltar
        </button>
        <Logo />
        <h1>{register ? "Cadastrar empresa" : "Acesso do gestor"}</h1>
        <p>{register ? "Crie a empresa e o primeiro gestor." : "Entre no ambiente da sua empresa."}</p>
        <div className="auth-fields">
          {register && <><label><span>Empresa</span><input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Nome da empresa" required /></label><label><span>Seu nome</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Como podemos chamar você?" required /></label></>}
          <label><span>Código da empresa</span><input autoFocus value={companyCode} onChange={(e) => setCompanyCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))} placeholder="Ex.: MINHA-EMPRESA" autoComplete="organization" required /></label>
          <label><span>E-mail</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" autoComplete="email" required /></label>
          <label><span>Senha</span><input type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Digite sua senha" autoComplete={register ? "new-password" : "current-password"} required /></label>
        </div>
        <div className="auth-actions">
          <button className="button primary">{register ? "Criar empresa" : "Entrar"}</button>
          <button type="button" className="button auth-secondary" onClick={() => { setRegister(!register); setError(""); }}>{register ? "Já tenho uma empresa" : "Cadastrar nova empresa"}</button>
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
      return localStorage.getItem("rw_company_code") || "";
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
    api(`/api/drivers?company=${encodeURIComponent(code)}`)
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
    const formatted = val.toUpperCase().replace(/[^A-Z0-9-]/g, "");
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
        <button className="back" onClick={onBack}>
          <ArrowLeft size={17} /> Voltar
        </button>
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
                  {d.name.slice(0, 2).toUpperCase()}
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

              <div className="numeric-keypad" aria-label="Teclado numérico">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                  <button
                    key={num}
                    type="button"
                    className="keypad-btn"
                    onClick={() => {
                      if (password.length < 8) setPassword((prev) => prev + num);
                    }}
                  >
                    {num}
                  </button>
                ))}
                <button
                  type="button"
                  className="keypad-btn keypad-clear"
                  onClick={() => setPassword("")}
                  title="Limpar"
                >
                  C
                </button>
                <button
                  type="button"
                  className="keypad-btn"
                  onClick={() => {
                    if (password.length < 8) setPassword((prev) => prev + "0");
                  }}
                >
                  0
                </button>
                <button
                  type="button"
                  className="keypad-btn keypad-backspace"
                  onClick={() => setPassword((prev) => prev.slice(0, -1))}
                  title="Apagar"
                >
                  ⌫
                </button>
              </div>

              <button className="button primary" disabled={password.length < 4}>
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
      ? `Reativar o acesso do gestor ${d.name}?`
      : `Desativar o acesso de ${d.name}? Este gestor não poderá mais entrar na Central.`;
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

  return (
    <section className="panel dispatchers-panel">
      {sessionInfo?.companyCode && (
        <div className="company-code-banner">
          <div className="company-code-content">
            <Building2 size={22} className="banner-icon" />
            <div>
              <b>Código da Empresa: <span className="highlight-code">{sessionInfo.companyCode}</span></b>
              <p>Compartilhe este código com os novos gestores para que eles entrem na Central informando seus respectivos e-mails e senhas.</p>
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
          <h2>Equipe de Gestão e Operações</h2>
          <p>{filteredItems.length} de {dispatchers.length} gestor(es) cadastrado(s)</p>
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
            <Plus size={15} /> Novo Gestor
          </button>
        </div>
      </div>

      {dispatchers.length > 3 && (
        <div className="panel-search-bar">
          <Search size={15} />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar gestor por nome ou e-mail..."
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

          return (
            <article key={d.id} className={!isActive ? "item-inactive" : ""}>
              <span className={`avatar dispatcher-avatar ${!isActive ? "inactive" : ""}`}>
                {d.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="registry-info">
                <div className="registry-name-line">
                  <b>{d.name}</b>
                  {isSelf && (
                    <span className="self-user-badge" title="Sua conta conectada no momento">
                      Você
                    </span>
                  )}
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
                  title="Editar dados e senha do gestor"
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
              ? `Nenhum gestor encontrado para "${searchTerm}".`
              : filter === "inactive"
                ? "Nenhum gestor inativo."
                : "Nenhum gestor cadastrado nesta empresa."
          }
        />
      )}

      {/* Modal Criar Gestor */}
      {openCreate && (
        <Modal title="Cadastrar Novo Gestor" onClose={() => setOpenCreate(false)}>
          <form onSubmit={submitCreate} className="form-grid">
            <div className="modal-info-box">
              <ShieldCheck size={20} />
              <p>O novo gestor terá acesso à Central de Operações da sua empresa para planejar e gerenciar rotas e motoristas.</p>
            </div>
            <label>
              Nome completo do gestor
              <input name="name" required placeholder="Ex.: Mariana Rodrigues" autoFocus />
            </label>
            <label>
              E-mail de acesso (login)
              <input name="email" type="email" required placeholder="mariana@empresa.com" autoComplete="email" />
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
              {busy ? "Cadastrando…" : "Cadastrar Gestor"}
            </button>
            {error && <p className="form-error">{error}</p>}
          </form>
        </Modal>
      )}

      {/* Modal Editar Gestor */}
      {editing && (
        <Modal title={`Editar Gestor: ${editing.name}`} onClose={() => setEditing(null)}>
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

function Dispatcher({
  onExit,
}: {
  onExit: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "planner" | "routes" | "people" | "vehicles" | "dispatchers">(
    "overview",
  );
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [dispatchers, setDispatchers] = useState<DispatcherUser[]>([]);
  const [sessionInfo, setSessionInfo] = useState<{ companyCode?: string; companyName?: string; dispatcherId?: string } | null>(null);
  const [message, setMessage] = useState("");
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [reportingRoute, setReportingRoute] = useState<DetailedRoute | null>(null);
  const [assigningRoute, setAssigningRoute] = useState<RouteData | null>(null);

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
        })
        .catch((e) => setMessage(e.message)),
    [],
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

  return (
    <div className="workspace">
      <aside className="sidebar">
        <Logo />
        <nav>
          {[
            ["overview", "Visão geral", <RouteIcon key="o" />],
            ["planner", "Planejar rota", <Navigation key="n" />],
            ["routes", "Rotas", <Navigation key="r" />],
            ["people", "Motoristas", <Users key="p" />],
            ["vehicles", "Veículos", <Truck key="v" />],
            ["dispatchers", "Gestores", <ShieldCheck key="g" />],
          ].map(([id, label, icon]) => (
            <button
              key={id as string}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id as typeof tab)}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>
        <button className="exit" onClick={onExit}>
          <ArrowLeft /> Sair do painel
        </button>
      </aside>
      <main className="dashboard">
        <header>
          <div>
            <span className="eyebrow">CENTRAL DE OPERAÇÕES</span>
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
                      : "Gestores e Coordenadores"}
            </h1>
          </div>
          <span className="live">
            <i /> Atualização automática
          </span>
        </header>
        {message && <p className="form-error">{message}</p>}
        {tab === "planner" && <RoutePlannerView onDone={load} />}
        {tab === "overview" && (
          <Overview
            routes={routes}
            active={active}
            completed={completed}
            onSelectRoute={(id) => setSelectedRouteId(id)}
            onPrintReport={(r) => openReport(r.id)}
            onAssignRoute={(r) => setAssigningRoute(r)}
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
      </main>

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
}: {
  routes: RouteData[];
  active: RouteData[];
  completed: RouteData[];
  onSelectRoute: (routeId: string) => void;
  onPrintReport: (route: RouteData) => void;
  onAssignRoute?: (route: RouteData) => void;
}) {
  const delivered = routes.reduce((n, r) => n + Number(r.delivered || 0), 0);
  const todayLocal = new Date().toLocaleDateString("en-CA");
  return (
    <>
      <section className="metrics">
        <Metric
          label="Rotas hoje"
          value={
            routes.filter(
              (r) => String(r.route_date || "").slice(0, 10) === todayLocal,
            ).length
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

      {/* Task 1: Mapa ao vivo para o Organizador */}
      <section className="panel live-fleet-panel">
        <div className="panel-title">
          <div>
            <h2>Mapa ao vivo da frota</h2>
            <p>Última posição transmitida por GPS dos motoristas em rota</p>
          </div>
        </div>
        <LiveFleetMap routes={routes} onSelectRoute={onSelectRoute} />
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Operação ao vivo</h2>
            <p>Clique em uma rota para abrir detalhes, paradas e fotos</p>
          </div>
        </div>
        <RouteTable
          routes={routes}
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
                {(isVehicle ? (i as Vehicle).plate : i.name).slice(0, 2).toUpperCase()}
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
          pin: "2468",
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
}: {
  onClose?: () => void;
  onDone?: () => void;
  onSwitchToDispatcher?: () => void;
  onSwitchToDriver?: () => void;
}) {
  const [stops, setStops] = useState<Stop[]>([]);
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
  const [optimizeBy, setOptimizeBy] = useState<"distance" | "time">("distance");
  const [routeName, setRouteName] = useState("");
  const [routeDate, setRouteDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showExtraConfig, setShowExtraConfig] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const optimizeRef = useRef<() => void>(() => {});
  const lastOptimizedCoordsRef = useRef<string>("");

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
    const duplicate = stops.some((s) => Math.abs(s.lat - lat) < 0.0001 && Math.abs(s.lng - lng) < 0.0001);
    if (duplicate) {
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

  const optimize = async () => {
    if (stops.length < 2) return setError("Adicione uma origem e ao menos uma entrega.");
    setOptimizing(true);
    setError("");
    try {
      const coords = stops.map((s, idx) => {
        let lat = s.lat;
        let lng = s.lng;
        for (let j = 0; j < idx; j++) {
          if (Math.abs(stops[j].lat - lat) < 0.0002 && Math.abs(stops[j].lng - lng) < 0.0002) {
            lat += 0.00025 * (idx - j);
            lng += 0.00025 * (idx - j);
            break;
          }
        }
        return `${lng.toFixed(6)},${lat.toFixed(6)}`;
      }).join(";");

      let data: any;
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
          pin: "2468",
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
    window.print();
  };

  const shareWhatsApp = () => {
    if (stops.length < 2) return;
    const name = routeName.trim() || `Rota ${new Intl.DateTimeFormat("pt-BR").format(new Date())}`;
    const lines = [
      `📦 *RouteWise - ${name}*`,
      `📅 Data: ${formatDateBR(routeDate)}`,
      `📍 Entregas: ${stops.length - 1}`,
      routeInfo ? `📏 Distância: ${routeInfo.km.toFixed(1)} km (~${formatRouteTime(routeInfo.seconds)})` : "",
      "",
      "📋 *Itinerário:*",
      ...stops.map((s, i) => `${i === 0 ? "🏢 Origem:" : `${i}.`} ${s.name} - ${s.address}`),
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
            <RouteIcon />
            <div className="logo-text-group">
              <b>RouteWise</b>
              <small className="logo-sub">Roteamento & Cargas</small>
            </div>
          </div>
          <div className="planner-header-actions">
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={toggleTheme}
              title="Alternar modo claro / escuro"
            >
              <Sun size={15} />
            </button>
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
                  {loadOrder !== null && (
                    <span className="stop-loading-tag">
                      📦 {loadOrder}º a carregar ({loadOrder === 1 ? "porta" : "fundo"})
                    </span>
                  )}
                </div>
                <div className="stop-item-actions">
                  <button
                    type="button"
                    className="stop-item-btn"
                    disabled={i <= 1}
                    onClick={() => {
                      const next = [...stops];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      changeStops(next);
                    }}
                    title="Mover para cima"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="stop-item-btn"
                    disabled={i === 0 || i === stops.length - 1}
                    onClick={() => {
                      const next = [...stops];
                      [next[i], next[i + 1]] = [next[i + 1], next[i]];
                      changeStops(next);
                    }}
                    title="Mover para baixo"
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
              >
                Menor Distância
              </button>
              <button
                type="button"
                className={`option-pill ${optimizeBy === "time" ? "active" : ""}`}
                onClick={() => setOptimizeBy("time")}
              >
                Menor Tempo
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
        </div>

        {routeInfo && (
          <div className="route-summary-gradient-card">
            <div className="route-summary-card-title">RESUMO DA ROTA OTIMIZADA</div>
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
            <div className="route-summary-footer-note">
              <Check size={11} />
              <span>{circular ? "Inclui retorno à origem" : "Sem retorno à garagem"}</span>
            </div>
          </div>
        )}

        <div className="planner-footer">
          {optimizing && <div className="route-calculating" role="status">Calculando melhor percurso pelas ruas…</div>}

          <button
            type="button"
            className="btn-recalculate-primary"
            disabled={stops.length < 2 || optimizing}
            onClick={() => optimize()}
            title="Recalcular melhor traçado e sequência (TSP)"
          >
            <Zap size={14} className={optimizing ? "spin" : ""} />
            <span>{optimizing ? "Calculando rota…" : "Recalcular Rota"}</span>
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
        <RouteMap stops={stops} geometry={geometry} visible={mobileShowMap} />
      </section>

      <section className="planner-print-sheet" aria-label="Romaneio da rota planejada">
        <header className="planner-print-header">
          <div className="report-logo"><span>↗</span><b>routewise</b></div>
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
        <h2>Sequência planejada</h2>
        <ol className="planner-print-stops">
          {stops.map((stop, index) => (
            <li key={`${stop.lat}-${stop.lng}-${index}`}>
              <span>{index === 0 ? "A" : index}</span>
              <div><b>{index === 0 ? "Origem — " : ""}{stop.name}</b><small>{stop.address}</small></div>
            </li>
          ))}
        </ol>
        <footer>Documento gerado pelo RouteWise em {new Date().toLocaleString("pt-BR")}</footer>
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

function RouteMap({ stops, geometry, visible }: { stops: Stop[]; geometry: [number, number][]; visible?: boolean }) {
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

    if (stationsDataRef.current) {
      renderStations(stationsDataRef.current);
    } else {
      loadStations()
        .then((data) => {
          if (Array.isArray(data)) {
            stationsDataRef.current = data;
            renderStations(data);
          }
        })
        .catch(() => {});
    }
  }, [stops, geometry, mapReady]);

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
        <button className="avatar-button" onClick={onExit} title="Sair do perfil">
          {driver.name.slice(0, 2).toUpperCase()}
        </button>
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

  const reload = async () => setData(await api(`/api/routes/${data.id}`));

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
        <Status value={data.status} />
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
          onDone={async () => {
            setModal(null);
            await reload();
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
async function compressImage(
  file: File,
  maxWidth = 1600,
  maxHeight = 1600,
  quality = 0.82,
): Promise<{ blob: Blob; base64: string; dataUrl: string }> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/") && file.size < 60 * 1024) {
      const url = URL.createObjectURL(file);
      return resolve({ blob: file, base64: "", dataUrl: url });
    }
    const reader = new FileReader();
    reader.onerror = () => {
      resolve({ blob: file, base64: "", dataUrl: URL.createObjectURL(file) });
    };
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => {
        resolve({ blob: file, base64: "", dataUrl: URL.createObjectURL(file) });
      };
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return resolve({ blob: file, base64: "", dataUrl: URL.createObjectURL(file) });
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
        canvas.toBlob(
          (blob) => {
            resolve({
              blob: blob || file,
              base64,
              dataUrl,
            });
          },
          "image/jpeg",
          quality,
        );
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
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
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [compressedBlob, setCompressedBlob] = useState<Blob | null>(null);
  const [compressedBase64, setCompressedBase64] = useState<string>("");

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
    setSelectedFile(file);
    setError("");
    setCompressing(true);
    try {
      const res = await compressImage(file);
      setCompressedBlob(res.blob);
      setCompressedBase64(res.base64);
      setPreviewUrl(res.dataUrl);
    } catch {
      setCompressedBlob(file);
      setPreviewUrl(URL.createObjectURL(file));
    } finally {
      setCompressing(false);
    }
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const blobToSend = compressedBlob || selectedFile;
    if (!blobToSend || !blobToSend.size) {
      setError("Por favor, tire uma foto ou selecione uma imagem.");
      return;
    }
    setBusy(true);
    setError("");

    try {
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

      // 2. Upload da foto com tripla redundância à prova de falhas
      let photoKey = "";

      // Tentativa 1: Presigned PUT
      try {
        const signed = await api("/api/uploads/presign", {
          method: "POST",
          body: JSON.stringify({
            kind: phase,
            contentType: "image/jpeg",
            size: blobToSend.size,
          }),
        });

        const uploadTarget = signed.url;
        const uploadRes = await fetch(uploadTarget, {
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          body: blobToSend,
        });

        if (uploadRes.ok) {
          photoKey = signed.key;
        } else {
          throw new Error(`PUT falhou com status ${uploadRes.status}`);
        }
      } catch (putErr) {
        console.warn("Upload PUT falhou, acionando rota direta:", putErr);

        // Tentativa 2: Direct upload multipart POST
        try {
          const formData = new FormData();
          formData.append("file", blobToSend, "photo.jpg");
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
        } catch (directErr) {
          console.warn("Direct multipart falhou, acionando fallback base64 JSON:", directErr);

          // Tentativa 3: Base64 JSON POST
          if (compressedBase64) {
            const b64Res = await api("/api/uploads/direct", {
              method: "POST",
              body: JSON.stringify({
                kind: phase,
                contentType: "image/jpeg",
                base64: compressedBase64,
              }),
            });
            photoKey = b64Res.key;
          } else {
            throw new Error("Não foi possível enviar a foto. Tente novamente.");
          }
        }
      }

      if (!photoKey) {
        throw new Error("Erro ao salvar comprovante de foto.");
      }

      // 3. Finalizar etapa correspondente
      const common = {
        photoKey,
        lat,
        lng,
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
            operationId: crypto.randomUUID(),
            note: f.get("note"),
          }),
        });
      }
      onDone();
    } catch (e) {
      setError((e as Error).message || "Erro ao registrar foto");
    } finally {
      setBusy(false);
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

        {previewUrl ? (
          <div className="photo-preview-box">
            <img src={previewUrl} alt="Pré-visualização da foto" className="photo-preview-img" />
            <div className="photo-preview-details">
              <span className="photo-preview-badge">✓ Imagem pronta para envio</span>
              <small>{selectedFile?.name || "foto.jpg"} ({(Number(compressedBlob?.size || selectedFile?.size || 0) / 1024).toFixed(0)} KB otimizada)</small>
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
          disabled={busy || compressing || (!selectedFile && !previewUrl)}
          className="button primary"
          style={{ marginTop: "0.5rem" }}
        >
          {compressing
            ? "Otimizando imagem…"
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
