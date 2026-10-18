"use client";
import { useEffect, useRef } from "react";
import { attachPlannerResize } from "@/lib/planner-resize";

export function PlannerDivider() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const divider = ref.current;
    const root = divider?.parentElement;
    if (divider && root) return attachPlannerResize(root, divider);
  }, []);
  return <div ref={ref} className="planner-divider" role="separator" aria-label="Ajustar largura do painel da rota e do mapa" aria-orientation="vertical" tabIndex={0} />;
}
