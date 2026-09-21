"use client";

import React, { useEffect, useState, useCallback } from "react";
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";

export type ToastType = "success" | "info" | "warning" | "error";

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

/**
 * Dispatch a lightweight, non-blocking toast notification anywhere in the application.
 */
export function showToast(message: string, type: ToastType = "info", duration = 4000) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("routewise:toast", {
        detail: { message, type, duration, id: Math.random().toString(36).substring(2, 9) },
      })
    );
  }
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    function handleToast(e: Event) {
      const customEvent = e as CustomEvent<ToastItem>;
      if (!customEvent.detail) return;
      const item = customEvent.detail;
      setToasts((prev) => [...prev.slice(-4), item]);

      const timer = setTimeout(() => {
        removeToast(item.id);
      }, item.duration ?? 4000);

      return () => clearTimeout(timer);
    }

    function handleQueueFlushed(e: Event) {
      const customEvent = e as CustomEvent<{ count?: number }>;
      const count = customEvent.detail?.count ?? 1;
      showToast(
        count === 1
          ? "Comprovante sincronizado com o servidor com sucesso!"
          : `${count} comprovantes sincronizados com sucesso!`,
        "success"
      );
    }

    window.addEventListener("routewise:toast", handleToast);
    window.addEventListener("routewise:queue-flushed", handleQueueFlushed);

    return () => {
      window.removeEventListener("routewise:toast", handleToast);
      window.removeEventListener("routewise:queue-flushed", handleQueueFlushed);
    };
  }, [removeToast]);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 99999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: "90%",
        maxWidth: 420,
        pointerEvents: "none",
      }}
      role="region"
      aria-label="Notificações"
    >
      {toasts.map((t) => {
        const bg =
          t.type === "success"
            ? "rgba(6, 78, 59, 0.95)"
            : t.type === "error"
            ? "rgba(127, 29, 29, 0.95)"
            : t.type === "warning"
            ? "rgba(120, 53, 15, 0.95)"
            : "rgba(30, 41, 59, 0.95)";
        const border =
          t.type === "success"
            ? "#059669"
            : t.type === "error"
            ? "#dc2626"
            : t.type === "warning"
            ? "#d97706"
            : "#3b82f6";
        const Icon =
          t.type === "success"
            ? CheckCircle2
            : t.type === "error"
            ? XCircle
            : t.type === "warning"
            ? AlertTriangle
            : Info;

        return (
          <div
            key={t.id}
            style={{
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 10,
              backgroundColor: bg,
              color: "#ffffff",
              border: `1px solid ${border}`,
              backdropFilter: "blur(8px)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
              fontSize: 13,
              fontWeight: 500,
              animation: "fadeIn 0.2s ease-out",
            }}
          >
            <Icon size={18} style={{ flexShrink: 0, color: border }} />
            <div style={{ flex: 1, wordBreak: "break-word", lineHeight: 1.4 }}>{t.message}</div>
            <button
              type="button"
              onClick={() => removeToast(t.id)}
              aria-label="Fechar notificação"
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.7)",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}