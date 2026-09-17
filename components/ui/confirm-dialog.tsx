"use client";

import React, { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

export interface ConfirmDialogProps {
  isOpen?: boolean;
  open?: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  variant?: "primary" | "danger" | "warning";
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  open,
  title,
  description,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  isDestructive = false,
  variant,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const isModalOpen = open !== undefined ? open : (isOpen ?? false);
  const destructive = isDestructive || variant === "danger";

  useEffect(() => {
    if (!isModalOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isModalOpen, onCancel]);

  if (!isModalOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99998,
        backgroundColor: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        style={{
          backgroundColor: "var(--card, #111827)",
          color: "var(--ink, #f9fafb)",
          border: "1px solid var(--line, rgba(255,255,255,0.12))",
          borderRadius: 14,
          padding: "20px 24px",
          width: "100%",
          maxWidth: 440,
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {destructive && (
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: "rgba(220, 38, 38, 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#ef4444",
                  flexShrink: 0,
                }}
              >
                <AlertTriangle size={20} />
              </div>
            )}
            <h3 id="confirm-dialog-title" style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fechar"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted, #9ca3af)",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 14, color: "var(--muted, #9ca3af)", lineHeight: 1.5 }}>
          {description}
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
          <button
            type="button"
            className="button secondary"
            onClick={onCancel}
            style={{ minWidth: 90, height: 38, fontSize: 13 }}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`button ${destructive ? "destructive" : "primary"}`}
            onClick={onConfirm}
            style={{
              minWidth: 100,
              height: 38,
              fontSize: 13,
              backgroundColor: destructive ? "#dc2626" : undefined,
              borderColor: destructive ? "#b91c1c" : undefined,
              color: "#ffffff",
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}