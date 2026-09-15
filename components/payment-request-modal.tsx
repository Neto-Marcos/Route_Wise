"use client";

import React, { useState, useEffect } from "react";
import { DollarSign, Send, CheckCircle2, XCircle, Clock, AlertCircle, Upload } from "lucide-react";
import { haptics } from "@/lib/haptics";

export function PaymentRequestModal({
  onClose,
  userRole,
  activeRouteId,
}: {
  onClose: () => void;
  userRole?: string;
  activeRouteId?: string;
}) {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("adiantamento");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const isAdmin = userRole === "admin" || userRole === "superadmin";

  const loadRequests = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/payments");
      if (res.ok) {
        setRequests(await res.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !description) return;
    haptics.tap();
    setSending(true);
    setMsg("");
    try {
      let receipt_url: string | null = null;
      if (receiptFile) {
        const upload = new FormData();
        upload.append("file", receiptFile);
        upload.append("kind", "payment-receipt");
        const uploadRes = await fetch("/api/uploads/direct", { method: "POST", body: upload });
        if (!uploadRes.ok) throw new Error("Não foi possível enviar o comprovante.");
        receipt_url = (await uploadRes.json()).url;
      }
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(amount.replace(",", ".")),
          description,
          category,
          route_id: activeRouteId || null,
          receipt_url,
        }),
      });
      if (res.ok) {
        haptics.success();
        setAmount("");
        setDescription("");
        setReceiptFile(null);
        setMsg("Solicitação enviada com sucesso ao Administrador!");
        loadRequests();
      } else {
        haptics.error();
        const err = await res.json();
        setMsg(err.error || "Erro ao solicitar");
      }
    } catch {
      haptics.error();
      setMsg("Erro de conexão");
    } finally {
      setSending(false);
    }
  };

  const handleReview = async (id: string, status: "approved" | "rejected" | "paid") => {
    haptics.tap();
    try {
      const res = await fetch("/api/payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (res.ok) {
        haptics.success();
        loadRequests();
      }
    } catch {
      haptics.error();
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          haptics.tap();
          onClose();
        }
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "600px",
          maxHeight: "85vh",
          background: "var(--card, #ffffff)",
          borderRadius: "18px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <DollarSign size={20} color="#059669" />
            <b style={{ fontSize: "16px", color: "var(--ink)" }}>
              {isAdmin ? "Solicitações de Pagamento & Diárias" : "Solicitar Adiantamento / Reembolso"}
            </b>
          </div>
          <button
            type="button"
            className="button secondary compact"
            onClick={() => {
              haptics.tap();
              onClose();
            }}
            style={{ width: "32px", height: "32px", padding: 0 }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "18px" }}>
          {/* Formulário para Motorista ou Operador */}
          <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px", borderRadius: "12px", background: "var(--card-subtle, #f8fafc)", border: "1px solid var(--line)" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>Nova Solicitação</span>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>
                Categoria:
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={{ width: "100%", height: "36px", marginTop: "4px", borderRadius: "8px", border: "1px solid var(--line)", padding: "0 8px", background: "var(--card)", color: "var(--ink)" }}
                >
                  <option value="adiantamento">Adiantamento</option>
                  <option value="combustivel">Combustível</option>
                  <option value="pedagio">Pedágio</option>
                  <option value="diaria">Diária</option>
                  <option value="reembolso">Reembolso / Manutenção</option>
                </select>
              </label>

              <label style={{ fontSize: "12px", fontWeight: 600 }}>
                Valor (R$):
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0,00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={{ width: "100%", height: "36px", marginTop: "4px", borderRadius: "8px", border: "1px solid var(--line)", padding: "0 8px", background: "var(--card)", color: "var(--ink)", fontWeight: 700 }}
                />
              </label>
            </div>

            <label style={{ fontSize: "12px", fontWeight: 600 }}>
              Motivo / Descrição:
              <input
                type="text"
                required
                placeholder="Ex: Abastecimento emergencial posto BR km 120"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ width: "100%", height: "36px", marginTop: "4px", borderRadius: "8px", border: "1px solid var(--line)", padding: "0 8px", background: "var(--card)", color: "var(--ink)" }}
              />
            </label>
            <label style={{ fontSize: "12px", fontWeight: 600 }}>
              Comprovante financeiro (opcional):
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                style={{ width: "100%", marginTop: "4px" }}
              />
              {receiptFile && <small style={{ color: "var(--muted)" }}>{receiptFile.name}</small>}
            </label>

            <button type="submit" disabled={sending} className="button primary" style={{ marginTop: "4px", background: "#059669", borderColor: "#059669", height: "38px" }}>
              {sending ? "Enviando..." : "Enviar Solicitação ao ADM"}
            </button>
            {msg && <p style={{ margin: 0, fontSize: "12px", color: msg.includes("sucesso") ? "#059669" : "#dc2626", fontWeight: 600 }}>{msg}</p>}
          </form>

          {/* Lista de Solicitações */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>Histórico de Solicitações</span>
            {loading ? (
              <p style={{ fontSize: "12px", color: "var(--muted)" }}>Carregando...</p>
            ) : requests.length === 0 ? (
              <p style={{ fontSize: "12px", color: "var(--muted)" }}>Nenhuma solicitação registrada.</p>
            ) : (
              requests.map((r) => (
                <div
                  key={r.id}
                  style={{
                    padding: "12px",
                    borderRadius: "10px",
                    border: "1px solid var(--line)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "10px",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <strong style={{ fontSize: "14px", color: "var(--ink)" }}>
                        R$ {Number(r.amount).toFixed(2).replace(".", ",")}
                      </strong>
                      <span style={{ fontSize: "11px", textTransform: "uppercase", background: "rgba(0,0,0,0.06)", padding: "2px 6px", borderRadius: "4px", fontWeight: 700 }}>
                        {r.category}
                      </span>
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--ink)" }}>{r.description}</span>
                    <small style={{ fontSize: "11px", color: "var(--muted)" }}>
                      {r.driver_name ? `Motorista: ${r.driver_name}` : ""} • {new Date(r.created_at).toLocaleDateString("pt-BR")}
                    </small>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    {r.status === "pending" && (
                      isAdmin ? (
                        <>
                          <button
                            type="button"
                            className="button primary compact"
                            style={{ background: "#059669", height: "30px", fontSize: "11px" }}
                            onClick={() => handleReview(r.id, "approved")}
                          >
                            Aprovar
                          </button>
                          <button
                            type="button"
                            className="button secondary compact"
                            style={{ color: "#dc2626", height: "30px", fontSize: "11px" }}
                            onClick={() => handleReview(r.id, "rejected")}
                          >
                            Recusar
                          </button>
                        </>
                      ) : (
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "#d97706", display: "flex", alignItems: "center", gap: "4px" }}>
                          <Clock size={12} /> Aguardando ADM
                        </span>
                      )
                    )}
                    {r.status === "approved" && (
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "#059669", display: "flex", alignItems: "center", gap: "4px" }}>
                        <CheckCircle2 size={13} /> Aprovado
                      </span>
                    )}
                    {r.status === "rejected" && (
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "#dc2626", display: "flex", alignItems: "center", gap: "4px" }}>
                        <XCircle size={13} /> Recusado
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
