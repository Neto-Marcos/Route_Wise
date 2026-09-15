"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BellRing, ExternalLink, FileImage, MessageSquare, ReceiptText, Send, WalletCards } from "lucide-react";
import { haptics } from "@/lib/haptics";
import { PaymentRequestModal } from "./payment-request-modal";

type Driver = { id: string; name: string; active?: boolean };
type HubTab = "chat" | "delivery" | "expense";

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível carregar os dados.");
  return data;
};

const urlBase64ToUint8Array = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - base64.length % 4) % 4);
  return Uint8Array.from(atob(base64 + padding), (char) => char.charCodeAt(0));
};

export function OperationsHub({ userRole, drivers }: { userRole: string; drivers: Driver[] }) {
  const [tab, setTab] = useState<HubTab>("chat");
  const [messages, setMessages] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [messageRecipient, setMessageRecipient] = useState("");
  const [error, setError] = useState("");
  const [pushStatus, setPushStatus] = useState(() => typeof Notification !== "undefined" && Notification.permission === "granted" ? "Verificando alertas deste dispositivo..." : "Ative alertas no dispositivo");
  const [showPaymentReview, setShowPaymentReview] = useState(false);
  const [paymentDriverFilter, setPaymentDriverFilter] = useState<{ id: string; name: string } | null>(null);
  const isAdmin = userRole === "admin" || userRole === "superadmin";

  const load = async () => {
    try {
      setError("");
      const [nextMessages, nextDelivery] = await Promise.all([
        api<any[]>("/api/operations?resource=messages"),
        api<any[]>("/api/operations?resource=receipts&kind=delivery"),
      ]);
      setMessages(nextMessages);
      if (tab === "delivery") setReceipts(nextDelivery);
      if (tab === "expense") setReceipts(await api<any[]>("/api/payments"));
    } catch (e) { setError((e as Error).message); }
  };

  useEffect(() => { load(); const timer = window.setInterval(load, 20_000); return () => clearInterval(timer); }, [tab]);

  const groupedReceipts = useMemo(() => Object.entries(receipts.reduce((all: Record<string, any[]>, item) => {
    const key = item.driver_name || "Sem motorista"; (all[key] ||= []).push(item); return all;
  }, {})), [receipts]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault(); if (!text.trim()) return;
    try { haptics.tap(); await api("/api/operations", { method: "POST", body: JSON.stringify({ action: "message", message: text, recipient_driver_id: messageRecipient || null }) }); setText(""); haptics.success(); await load(); }
    catch (e) { haptics.error(); setError((e as Error).message); }
  };

  const syncPushSubscription = async (requestPermission = false) => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Este dispositivo não suporta notificações Push.");
      const config = await api<{ publicKey: string | null; enabled: boolean }>("/api/notifications/subscribe");
      if (!config.enabled || !config.publicKey) throw new Error("Push será ativado assim que as chaves VAPID forem configuradas no Railway.");
      const permission = requestPermission ? await Notification.requestPermission() : Notification.permission;
      if (permission === "default") { setPushStatus("Ative alertas no dispositivo"); return; }
      if (permission !== "granted") throw new Error("Permissão de notificação não concedida.");
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.publicKey) });
      await api("/api/notifications/subscribe", { method: "POST", body: JSON.stringify(subscription) });
      setPushStatus("Alertas Push ativos neste dispositivo"); haptics.success();
    } catch (e) { setPushStatus((e as Error).message); haptics.error(); }
  };
  const enablePush = () => syncPushSubscription(true);
  const testPush = async () => {
    try { const result = await api<{ delivered: number }>("/api/notifications/subscribe", { method: "POST", body: JSON.stringify({ action: "test" }) }); setPushStatus(result.delivered ? "Teste enviado para este dispositivo" : "Este dispositivo ainda não está inscrito"); haptics.success(); }
    catch (e) { setPushStatus((e as Error).message); haptics.error(); }
  };
  useEffect(() => { void syncPushSubscription(); }, []);

  const tabs: Array<[HubTab, string, React.ReactNode]> = [["chat", "Chat", <MessageSquare size={16} key="c" />], ["delivery", "Entregas", <FileImage size={16} key="d" />], ["expense", "Pagamentos", <ReceiptText size={16} key="e" />]];
  return <section className="panel" style={{ marginTop: 16, overflow: "hidden" }}>
    <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><div><h2>Central operacional</h2><p>Comunicação, comprovantes e pagamentos em um só lugar.</p></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{isAdmin && <button className="button primary compact" onClick={() => setShowPaymentReview(true)}><WalletCards size={15} /> Aprovar pagamentos</button>}<button className="button secondary compact" onClick={enablePush}><BellRing size={15} /> {pushStatus}</button>{pushStatus.includes("ativos") && <button className="button secondary compact" onClick={testPush}>Testar alerta</button>}</div></div>
    <div style={{ display: "flex", gap: 6, overflowX: "auto", margin: "10px 0 14px" }}>{tabs.map(([id, label, icon]) => <button key={id} onClick={() => { haptics.tap(); setTab(id); }} className={`button compact ${tab === id ? "primary" : "secondary"}`}>{icon}{label}</button>)}</div>
    {error && <p className="form-error">{error}</p>}
    {tab === "chat" && <><div style={{ maxHeight: 300, overflowY: "auto", display: "grid", gap: 8 }}>{messages.map(m => <div key={m.id} style={{ padding: "9px 11px", borderRadius: 10, background: m.sender_type === "driver" ? "rgba(14,165,233,.09)" : "var(--card-subtle)" }}><strong style={{ fontSize: 12 }}>{m.sender_name}</strong>{m.recipient_driver_id && isAdmin && <small style={{ marginLeft: 7, color: "#0f9f78", fontWeight: 700 }}>Mensagem privada</small>}<div>{m.message}</div><small style={{ color: "var(--muted)" }}>{new Date(m.created_at).toLocaleString("pt-BR")}</small></div>)}</div><form onSubmit={sendMessage} style={{ display: "grid", gridTemplateColumns: isAdmin ? "210px minmax(0,1fr) auto" : "minmax(0,1fr) auto", gap: 8, marginTop: 10 }}>
      {isAdmin && <select value={messageRecipient} onChange={e => setMessageRecipient(e.target.value)} aria-label="Destinatário da mensagem"><option value="">Toda a operação</option>{drivers.filter(d => d.active !== false).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
      <input value={text} onChange={e => setText(e.target.value)} placeholder={messageRecipient ? "Mensagem para o motorista selecionado" : "Mensagem para toda a operação"} />
      <button className="button primary compact"><Send size={15}/>Enviar</button></form></>}
    {(tab === "delivery" || tab === "expense") && <div style={{ display: "grid", gap: 12 }}>{groupedReceipts.map(([driver, items]) => {
      const driverItems = items as any[];
      const driverId = driverItems[0]?.driver_id as string | undefined;
      const pendingPayments = driverItems.filter(item => item.status === "pending");
      const openDriverPayments = () => {
        if (!driverId) return;
        haptics.tap();
        setPaymentDriverFilter({ id: driverId, name: driver });
        setShowPaymentReview(true);
      };
      return <article key={driver} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
        {tab === "expense" ? <>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}><strong>{driver}</strong>{isAdmin && driverId && <button type="button" className="button secondary compact" onClick={openDriverPayments} style={{ fontSize: 11 }}><ReceiptText size={13} /> Ver histórico ({driverItems.length})</button>}</div>
          {pendingPayments.length > 0 ? <div style={{ display: "grid", gap: 6, marginTop: 8 }}>{pendingPayments.map(item => <button key={item.id} type="button" onClick={openDriverPayments} className="payment-pending-row" aria-label={`Abrir solicitação pendente de ${driver}`}><span>{item.category} · {item.description}</span><strong>R$ {Number(item.amount).toFixed(2).replace(".", ",")} · Pendente</strong></button>)}</div> : <p style={{ margin: "9px 0 0", color: "var(--muted)", fontSize: 13 }}>Nenhum pagamento pendente.</p>}
        </> : <>
          <strong>{driver}</strong>
          {driverItems.map(item => <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, paddingTop: 8, fontSize: 13 }}><span>{item.route_name} · {item.stop_name}</span>{item.photo_url ? <a href={item.photo_url} target="_blank" rel="noreferrer" className="button secondary compact" style={{ fontSize: 11, textDecoration: "none" }}><ExternalLink size={13} /> Abrir comprovante</a> : <span>{new Date(item.delivered_at).toLocaleDateString("pt-BR")}</span>}</div>)}
        </>}
      </article>;
    })}{!groupedReceipts.length && <p style={{ color: "var(--muted)" }}>{tab === "expense" ? "Nenhuma solicitação de pagamento registrada." : "Nenhum comprovante enviado ainda."}</p>}</div>}
    {showPaymentReview && <PaymentRequestModal userRole={userRole} driverId={paymentDriverFilter?.id} driverName={paymentDriverFilter?.name} onClose={() => { setShowPaymentReview(false); setPaymentDriverFilter(null); }} />}
  </section>;
}
