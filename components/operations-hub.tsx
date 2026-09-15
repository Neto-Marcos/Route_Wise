"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BellRing, CheckCircle2, FileImage, MessageSquare, ReceiptText, Send, Target, WalletCards } from "lucide-react";
import { haptics } from "@/lib/haptics";
import { PaymentRequestModal } from "./payment-request-modal";

type Driver = { id: string; name: string };
type HubTab = "goals" | "chat" | "delivery" | "expense";

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
  const [tab, setTab] = useState<HubTab>("goals");
  const [messages, setMessages] = useState<any[]>([]);
  const [goals, setGoals] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [pushStatus, setPushStatus] = useState("Ative alertas no dispositivo");
  const [goal, setGoal] = useState({ driver_id: "", target_km: "", target_deliveries: "", target_sla: "95" });
  const [showPaymentReview, setShowPaymentReview] = useState(false);
  const isAdmin = userRole === "admin" || userRole === "superadmin";
  const month = new Date().toISOString().slice(0, 7);

  const load = async () => {
    try {
      setError("");
      const [nextMessages, nextGoals, nextDelivery] = await Promise.all([
        api<any[]>("/api/operations?resource=messages"),
        api<any[]>(`/api/operations?resource=goals&month=${month}`),
        api<any[]>("/api/operations?resource=receipts&kind=delivery"),
      ]);
      setMessages(nextMessages); setGoals(nextGoals);
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
    try { haptics.tap(); await api("/api/operations", { method: "POST", body: JSON.stringify({ action: "message", message: text }) }); setText(""); haptics.success(); await load(); }
    catch (e) { haptics.error(); setError((e as Error).message); }
  };

  const saveGoal = async (event: FormEvent) => {
    event.preventDefault();
    try { await api("/api/operations", { method: "POST", body: JSON.stringify({ action: "driver_goal", month, ...goal }) }); setGoal({ driver_id: "", target_km: "", target_deliveries: "", target_sla: "95" }); haptics.success(); await load(); }
    catch (e) { setError((e as Error).message); haptics.error(); }
  };

  const enablePush = async () => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Este dispositivo não suporta notificações Push.");
      const config = await api<{ publicKey: string | null; enabled: boolean }>("/api/notifications/subscribe");
      if (!config.enabled || !config.publicKey) throw new Error("Push será ativado assim que as chaves VAPID forem configuradas no Railway.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Permissão de notificação não concedida.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.publicKey) });
      await api("/api/notifications/subscribe", { method: "POST", body: JSON.stringify(subscription) });
      setPushStatus("Alertas Push ativos neste dispositivo"); haptics.success();
    } catch (e) { setPushStatus((e as Error).message); haptics.error(); }
  };

  const tabs: Array<[HubTab, string, React.ReactNode]> = [["goals", "Metas", <Target size={16} key="g" />], ["chat", "Chat", <MessageSquare size={16} key="c" />], ["delivery", "Entregas", <FileImage size={16} key="d" />], ["expense", "Pagamentos", <ReceiptText size={16} key="e" />]];
  return <section className="panel" style={{ marginTop: 16, overflow: "hidden" }}>
    <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><div><h2>Central operacional</h2><p>Metas, comunicação e comprovantes em um só lugar.</p></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{isAdmin && <button className="button primary compact" onClick={() => setShowPaymentReview(true)}><WalletCards size={15} /> Aprovar pagamentos</button>}<button className="button secondary compact" onClick={enablePush}><BellRing size={15} /> {pushStatus}</button></div></div>
    <div style={{ display: "flex", gap: 6, overflowX: "auto", margin: "10px 0 14px" }}>{tabs.map(([id, label, icon]) => <button key={id} onClick={() => { haptics.tap(); setTab(id); }} className={`button compact ${tab === id ? "primary" : "secondary"}`}>{icon}{label}</button>)}</div>
    {error && <p className="form-error">{error}</p>}
    {tab === "goals" && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12 }}>
      {goals.map((item) => <article key={item.id} style={{ padding: 14, border: "1px solid var(--line)", borderRadius: 12 }}><strong>{item.driver_name}</strong><p style={{ color: "var(--muted)", fontSize: 13 }}>{Number(item.realized_km).toFixed(0)} / {item.target_km} km · {item.realized_deliveries}/{item.target_deliveries} entregas</p><small>SLA alvo: {item.target_sla}%</small></article>)}
      {!goals.length && <p style={{ color: "var(--muted)" }}>Ainda não há metas individuais neste mês.</p>}
      {isAdmin && <form onSubmit={saveGoal} style={{ padding: 14, border: "1px dashed var(--line)", borderRadius: 12, display: "grid", gap: 7 }}><strong>Definir meta do motorista</strong><select required value={goal.driver_id} onChange={e => setGoal({ ...goal, driver_id: e.target.value })}><option value="">Selecione</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select><input required type="number" placeholder="Meta KM" value={goal.target_km} onChange={e => setGoal({ ...goal, target_km: e.target.value })}/><input required type="number" placeholder="Meta entregas" value={goal.target_deliveries} onChange={e => setGoal({ ...goal, target_deliveries: e.target.value })}/><button className="button primary compact">Salvar meta</button></form>}
    </div>}
    {tab === "chat" && <><div style={{ maxHeight: 300, overflowY: "auto", display: "grid", gap: 8 }}>{messages.map(m => <div key={m.id} style={{ padding: "9px 11px", borderRadius: 10, background: m.sender_type === "driver" ? "rgba(14,165,233,.09)" : "var(--card-subtle)" }}><strong style={{ fontSize: 12 }}>{m.sender_name}</strong><div>{m.message}</div><small style={{ color: "var(--muted)" }}>{new Date(m.created_at).toLocaleString("pt-BR")}</small></div>)}</div><form onSubmit={sendMessage} style={{ display: "flex", gap: 8, marginTop: 10 }}><input value={text} onChange={e => setText(e.target.value)} placeholder="Mensagem para toda a operação" style={{ flex: 1 }}/><button className="button primary compact"><Send size={15}/>Enviar</button></form></>}
    {(tab === "delivery" || tab === "expense") && <div style={{ display: "grid", gap: 12 }}>{groupedReceipts.map(([driver, items]) => <article key={driver} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}><strong>{driver}</strong>{(items as any[]).map(item => <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, paddingTop: 8, fontSize: 13 }}><span>{tab === "delivery" ? `${item.route_name} · ${item.stop_name}` : `${item.category} · ${item.description}`}</span><span>{tab === "expense" ? `R$ ${Number(item.amount).toFixed(2)} · ${item.status}` : new Date(item.delivered_at).toLocaleDateString("pt-BR")}</span></div>)}</article>)}{!groupedReceipts.length && <p style={{ color: "var(--muted)" }}>Nenhum comprovante enviado ainda.</p>}</div>}
    {showPaymentReview && <PaymentRequestModal userRole={userRole} onClose={() => setShowPaymentReview(false)} />}
  </section>;
}
