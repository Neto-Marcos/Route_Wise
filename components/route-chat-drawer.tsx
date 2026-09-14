"use client";

import React, { useState, useEffect, useRef } from "react";
import { MessageSquare, Send, X, Zap } from "lucide-react";
import { haptics } from "@/lib/haptics";

export function RouteChatDrawer({
  routeId,
  routeName,
  onClose,
}: {
  routeId: string;
  routeName: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = async () => {
    try {
      const res = await fetch(`/api/chat?routeId=${routeId}`);
      if (res.ok) {
        setMessages(await res.json());
      }
    } catch {}
  };

  useEffect(() => {
    loadMessages();
    const interval = setInterval(loadMessages, 5000);
    return () => clearInterval(interval);
  }, [routeId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (textToSend?: string, quickTag?: string) => {
    const text = (textToSend || input).trim();
    if (!text) return;

    haptics.tap();
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route_id: routeId,
          message: text,
          quick_tag: quickTag || null,
        }),
      });
      if (res.ok) {
        haptics.success();
        setInput("");
        loadMessages();
      }
    } catch {
      haptics.error();
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        justifyContent: "flex-end",
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
          maxWidth: "420px",
          height: "100%",
          background: "var(--card, #ffffff)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-10px 0 25px -5px rgba(0,0,0,0.2)",
        }}
      >
        {/* Header do Chat */}
        <div
          style={{
            padding: "16px 18px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <MessageSquare size={18} color="#2563eb" />
            <div>
              <b style={{ fontSize: "14px", color: "var(--ink)" }}>Chat Operacional da Rota</b>
              <p style={{ margin: 0, fontSize: "11px", color: "var(--muted)" }}>{routeName}</p>
            </div>
          </div>
          <button
            type="button"
            className="button secondary compact"
            onClick={() => {
              haptics.tap();
              onClose();
            }}
            style={{ width: "30px", height: "30px", padding: 0 }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Histórico de Mensagens */}
        <div style={{ flex: 1, padding: "16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
          {messages.length === 0 ? (
            <div style={{ margin: "auto", textAlign: "center", color: "var(--muted)", fontSize: "13px" }}>
              Nenhuma mensagem trocada ainda nesta rota. Envie um aviso rápido abaixo!
            </div>
          ) : (
            messages.map((m) => {
              const isDispatcher = m.sender_type === "dispatcher";
              return (
                <div
                  key={m.id}
                  style={{
                    alignSelf: isDispatcher ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                    padding: "8px 12px",
                    borderRadius: isDispatcher ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                    background: isDispatcher ? "#2563eb" : "var(--card-subtle, #f1f5f9)",
                    color: isDispatcher ? "#ffffff" : "var(--ink)",
                    fontSize: "13px",
                  }}
                >
                  <div style={{ fontSize: "10px", fontWeight: 750, opacity: 0.8, marginBottom: 2 }}>
                    {m.sender_name}
                  </div>
                  <span>{m.message}</span>
                  <div style={{ fontSize: "9px", opacity: 0.6, textAlign: "right", marginTop: 4 }}>
                    {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Atalhos Rápidos de Operação */}
        <div style={{ padding: "8px 12px", borderTop: "1px solid var(--line)", background: "var(--card-subtle, #f8fafc)", display: "flex", gap: "6px", overflowX: "auto", scrollbarWidth: "none" }}>
          <button
            type="button"
            onClick={() => handleSend("📍 Cheguei no cliente, aguardando conferência.", "cheguei_cliente")}
            style={{ fontSize: "11px", fontWeight: 600, padding: "4px 8px", borderRadius: 99, border: "1px solid var(--line)", background: "var(--card)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            📍 Cheguei no cliente
          </button>
          <button
            type="button"
            onClick={() => handleSend("⏳ Doca lotada, fila de espera.", "atraso_doca")}
            style={{ fontSize: "11px", fontWeight: 600, padding: "4px 8px", borderRadius: 99, border: "1px solid var(--line)", background: "var(--card)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            ⏳ Doca lotada
          </button>
          <button
            type="button"
            onClick={() => handleSend("⚠️ Parada técnica / trânsito pesado.", "transito")}
            style={{ fontSize: "11px", fontWeight: 600, padding: "4px 8px", borderRadius: 99, border: "1px solid var(--line)", background: "var(--card)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            ⚠️ Trânsito / Alerta
          </button>
        </div>

        {/* Input de Envio */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          style={{ padding: "12px 14px", borderTop: "1px solid var(--line)", display: "flex", gap: "8px" }}
        >
          <input
            type="text"
            placeholder="Digite sua mensagem rápida..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{
              flex: 1,
              height: "38px",
              borderRadius: "10px",
              border: "1px solid var(--line)",
              padding: "0 12px",
              fontSize: "13px",
              background: "var(--card)",
              color: "var(--ink)",
            }}
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="button primary"
            style={{ height: "38px", width: "42px", padding: 0, display: "grid", placeItems: "center" }}
          >
            <Send size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}
