"use client";

import { useRef, useState, useEffect } from "react";
import { RotateCcw, Check, PenTool } from "lucide-react";

export function SignaturePad({
  onSave,
  onCancel,
}: {
  onSave: (signatureDataUrl: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    return {
      x: (e as React.MouseEvent).clientX - rect.left,
      y: (e as React.MouseEvent).clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasDrawn(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const save = () => {
    if (!canvasRef.current || !hasDrawn) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    onSave(dataUrl);
  };

  return (
    <div style={{ padding: 16, background: "var(--card)", borderRadius: 14, border: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <PenTool size={18} color="var(--green)" />
        <strong style={{ fontSize: 14 }}>Assinatura Digital do Recebedor</strong>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--muted)" }}>
        Peça para o cliente assinar diretamente na área abaixo com o dedo ou caneta touch.
      </p>

      <div style={{ border: "2px dashed var(--line)", borderRadius: 10, background: "#fff", touchAction: "none" }}>
        <canvas
          ref={canvasRef}
          width={360}
          height={160}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          style={{ width: "100%", height: 160, display: "block", cursor: "crosshair" }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <button
          type="button"
          className="button secondary compact"
          onClick={clear}
          disabled={!hasDrawn}
        >
          <RotateCcw size={14} /> Limpar
        </button>

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="button secondary compact" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="button primary compact"
            onClick={save}
            disabled={!hasDrawn}
            style={{ background: "var(--green)" }}
          >
            <Check size={14} /> Confirmar Assinatura
          </button>
        </div>
      </div>
    </div>
  );
}
