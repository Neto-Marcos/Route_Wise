"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Clock, Copy, DollarSign, ImageIcon, XCircle } from "lucide-react";
import { haptics } from "@/lib/haptics";

type Payment = { id: string; amount: number; category: string; description: string; status: "pending" | "approved" | "rejected" | "paid"; created_at: string; driver_name?: string; receipt_url?: string | null; pix_key?: string | null; pix_qr_url?: string | null; payment_receipt_url?: string | null };
const inputStyle = { width: "100%", height: "36px", marginTop: "4px", borderRadius: "8px", border: "1px solid var(--line)", padding: "0 8px", background: "var(--card)", color: "var(--ink)" };

export function PaymentRequestModal({ onClose, userRole, activeRouteId }: { onClose: () => void; userRole?: string; activeRouteId?: string }) {
  const [requests, setRequests] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState(""); const [description, setDescription] = useState(""); const [category, setCategory] = useState("adiantamento"); const [pixKey, setPixKey] = useState("");
  const [expenseFile, setExpenseFile] = useState<File | null>(null); const [pixQrFile, setPixQrFile] = useState<File | null>(null); const [paidFiles, setPaidFiles] = useState<Record<string, File | null>>({});
  const [sending, setSending] = useState(false); const [reviewingId, setReviewingId] = useState<string | null>(null); const [msg, setMsg] = useState("");
  const isAdmin = userRole === "admin" || userRole === "superadmin";

  const loadRequests = async () => { setLoading(true); try { const res = await fetch("/api/payments"); if (res.ok) setRequests(await res.json()); } catch (error) { console.error(error); } finally { setLoading(false); } };
  useEffect(() => { loadRequests(); }, []);
  const upload = async (file: File, kind: string) => { const body = new FormData(); body.append("file", file); body.append("kind", kind); const res = await fetch("/api/uploads/direct", { method: "POST", body }); if (!res.ok) throw new Error("Não foi possível enviar a imagem."); return (await res.json()).url as string; };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault(); if (!amount || !description) return;
    haptics.tap(); setSending(true); setMsg("");
    try {
      const [receipt_url, pix_qr_url] = await Promise.all([expenseFile ? upload(expenseFile, "payment-expense-receipt") : null, pixQrFile ? upload(pixQrFile, "payment-pix-qr") : null]);
      const res = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: Number(amount.replace(",", ".")), description, category, route_id: activeRouteId || null, receipt_url, pix_key: pixKey, pix_qr_url }) });
      if (!res.ok) throw new Error((await res.json()).error || "Erro ao solicitar");
      haptics.success(); setAmount(""); setDescription(""); setPixKey(""); setExpenseFile(null); setPixQrFile(null); setMsg("Solicitação enviada ao ADM."); loadRequests();
    } catch (error: any) { haptics.error(); setMsg(error.message || "Erro de conexão"); } finally { setSending(false); }
  };

  const review = async (request: Payment, status: "approved" | "rejected" | "paid") => {
    haptics.tap(); setReviewingId(request.id);
    try {
      const file = paidFiles[request.id]; if (status === "paid" && !file) throw new Error("Anexe o comprovante Pix para marcar como pago.");
      const payment_receipt_url = status === "paid" && file ? await upload(file, "payment-pix-receipt") : null;
      const res = await fetch("/api/payments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: request.id, status, payment_receipt_url }) });
      if (!res.ok) throw new Error((await res.json()).error || "Não foi possível atualizar a solicitação.");
      haptics.success(); setMsg(status === "paid" ? "Pagamento registrado e comprovante enviado." : "Solicitação atualizada."); loadRequests();
    } catch (error: any) { haptics.error(); setMsg(error.message || "Erro ao atualizar solicitação."); } finally { setReviewingId(null); }
  };

  const link = (url: string, label: string) => <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: "11px", fontWeight: 700, color: "#0f9f78", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px" }}><ImageIcon size={13} />{label}</a>;
  const copyPix = async (key: string) => { try { await navigator.clipboard.writeText(key); haptics.success(); setMsg("Chave Pix copiada."); } catch { setMsg("Não foi possível copiar a chave Pix."); } };
  const status = (request: Payment) => {
    if (request.status === "pending") return <span style={{ color: "#d97706" }}><Clock size={12} /> Aguardando ADM</span>;
    if (request.status === "rejected") return <span style={{ color: "#dc2626" }}><XCircle size={13} /> Recusado</span>;
    return <span style={{ color: "#059669" }}><CheckCircle2 size={13} /> {request.status === "paid" ? "Pago" : "Aprovado"}</span>;
  };

  const content = <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.6)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: "max(16px, env(safe-area-inset-top, 0px)) 16px max(16px, env(safe-area-inset-bottom, 0px))" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div style={{ width: "100%", maxWidth: "640px", maxHeight: "85vh", background: "var(--card, #fff)", borderRadius: "18px", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 20px 25px -5px rgba(0,0,0,.2)" }}>
      <header style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={{ display: "flex", alignItems: "center", gap: "8px" }}><DollarSign size={20} color="#059669" /><b style={{ fontSize: "16px", color: "var(--ink)" }}>{isAdmin ? "Solicitações de pagamento" : "Solicitar pagamento"}</b></div><button type="button" className="button secondary compact" onClick={onClose} style={{ width: "32px", height: "32px", padding: 0 }}>✕</button></header>
      <div style={{ padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "18px" }}>
        {!isAdmin && <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px", borderRadius: "12px", background: "var(--card-subtle, #f8fafc)", border: "1px solid var(--line)" }}>
          <b style={{ fontSize: "13px", color: "var(--ink)" }}>Nova solicitação</b>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}><label style={{ fontSize: "12px", fontWeight: 600 }}>Categoria:<select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}><option value="adiantamento">Adiantamento</option><option value="combustivel">Combustível</option><option value="pedagio">Pedágio</option><option value="diaria">Diária</option><option value="reembolso">Reembolso / Manutenção</option></select></label><label style={{ fontSize: "12px", fontWeight: 600 }}>Valor (R$):<input type="number" step="0.01" required placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...inputStyle, fontWeight: 700 }} /></label></div>
          <label style={{ fontSize: "12px", fontWeight: 600 }}>Motivo / descrição:<input type="text" required placeholder="Ex: alimentação durante a rota" value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} /></label>
          <div style={{ padding: "10px", border: "1px dashed #65bfa4", borderRadius: "9px", display: "flex", flexDirection: "column", gap: "8px" }}><b style={{ fontSize: "12px", color: "var(--ink)" }}>Dados para receber via Pix</b><label style={{ fontSize: "12px", fontWeight: 600 }}>Chave Pix (opcional):<input type="text" placeholder="CPF, e-mail, telefone ou chave aleatória" value={pixKey} onChange={(e) => setPixKey(e.target.value)} style={inputStyle} /></label><label style={{ fontSize: "12px", fontWeight: 600 }}>QR Code do Pix (opcional):<input type="file" accept="image/*" onChange={(e) => setPixQrFile(e.target.files?.[0] || null)} style={{ width: "100%", marginTop: "4px" }} />{pixQrFile && <small>{pixQrFile.name}</small>}</label></div>
          <label style={{ fontSize: "12px", fontWeight: 600 }}>Comprovante da despesa (opcional):<input type="file" accept="image/*" onChange={(e) => setExpenseFile(e.target.files?.[0] || null)} style={{ width: "100%", marginTop: "4px" }} />{expenseFile && <small>{expenseFile.name}</small>}</label>
          <button type="submit" disabled={sending} className="button primary" style={{ background: "#059669", borderColor: "#059669", height: "38px" }}>{sending ? "Enviando..." : "Enviar solicitação ao ADM"}</button>
        </form>}
        {msg && <p style={{ margin: 0, fontSize: "12px", color: /erro|anexe|não foi/i.test(msg) ? "#dc2626" : "#059669", fontWeight: 600 }}>{msg}</p>}
        <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}><b style={{ fontSize: "13px", color: "var(--ink)" }}>Histórico de solicitações</b>{loading ? <p>Carregando...</p> : requests.length === 0 ? <p>Nenhuma solicitação registrada.</p> : requests.map((request) => <article key={request.id} style={{ padding: "12px", borderRadius: "10px", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: "9px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}><div><strong style={{ color: "var(--ink)" }}>R$ {Number(request.amount).toFixed(2).replace(".", ",")}</strong> <span style={{ fontSize: "11px", textTransform: "uppercase" }}>{request.category}</span><div style={{ fontSize: "12px", color: "var(--ink)" }}>{request.description}</div><small>{request.driver_name ? `Motorista: ${request.driver_name} • ` : ""}{new Date(request.created_at).toLocaleDateString("pt-BR")}</small></div><span style={{ fontSize: "11px", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "4px" }}>{status(request)}</span></div>
          {(request.pix_key || request.pix_qr_url || request.receipt_url || request.payment_receipt_url) && <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: "8px" }}>{request.pix_key && <button type="button" className="button secondary compact" onClick={() => copyPix(request.pix_key!)} style={{ height: "28px", fontSize: "11px" }}><Copy size={12} />Copiar chave Pix</button>}{request.pix_qr_url && link(request.pix_qr_url, "Ver QR Code Pix")}{request.receipt_url && link(request.receipt_url, "Comprovante da despesa")}{request.payment_receipt_url && link(request.payment_receipt_url, "Comprovante Pix")}</div>}
          {isAdmin && request.status === "pending" && <div style={{ display: "flex", gap: "6px" }}><button type="button" className="button primary compact" disabled={reviewingId === request.id} onClick={() => review(request, "approved")} style={{ background: "#059669", height: "30px", fontSize: "11px" }}>Aprovar</button><button type="button" className="button secondary compact" disabled={reviewingId === request.id} onClick={() => review(request, "rejected")} style={{ color: "#dc2626", height: "30px", fontSize: "11px" }}>Recusar</button></div>}
          {isAdmin && request.status === "approved" && <div style={{ paddingTop: "8px", borderTop: "1px solid var(--line)" }}><label style={{ fontSize: "12px", fontWeight: 600 }}>Comprovante do Pix (obrigatório):<input type="file" accept="image/*,application/pdf" onChange={(e) => setPaidFiles((files) => ({ ...files, [request.id]: e.target.files?.[0] || null }))} style={{ width: "100%", marginTop: "4px" }} />{paidFiles[request.id] && <small>{paidFiles[request.id]?.name}</small>}</label><button type="button" className="button primary" disabled={reviewingId === request.id} onClick={() => review(request, "paid")} style={{ marginTop: "7px", background: "#0f9f78", height: "34px", fontSize: "12px" }}>{reviewingId === request.id ? "Registrando..." : "Marcar como pago e enviar comprovante"}</button></div>}
        </article>)}</section>
      </div>
    </div>
  </div>;
  return typeof document === "undefined" ? null : createPortal(content, document.body);
}
