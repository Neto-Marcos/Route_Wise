"use client";
import { useEffect, useRef, useState } from "react";
import { draftKey, readPlannerDraft, removePlannerDraft, writePlannerDraft, type PlannerDraft } from "@/lib/planner-draft";

export function usePlannerRecovery(scope: string | undefined, snapshot: Omit<PlannerDraft, "scope" | "revision" | "savedAt" | "version">, restored?: PlannerDraft) {
  const [candidate, setCandidate] = useState<PlannerDraft | null>(null);
  const [notice, setNotice] = useState("");
  const [readyScope, setReadyScope] = useState<string>();
  const revision = useRef<string | null>(null);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const paused = useRef(true);
  const cleared = useRef<string | null>(null);
  const save = useRef<() => void>(() => {});
  useEffect(() => {
    if (!scope) return;
    paused.current = true;
    setCandidate(null);
    try {
      const stored = readPlannerDraft(localStorage, scope);
      revision.current = restored?.scope === scope ? restored.revision : stored?.revision ?? null;
      setCandidate(restored?.scope === scope ? null : stored);
      paused.current = !!stored && restored?.scope !== scope;
      setReadyScope(scope);
    } catch { setNotice("Não foi possível acessar a recuperação automática neste navegador."); }
    const external = (event: StorageEvent) => {
      if (event.key !== draftKey(scope)) return;
      paused.current = true;
      try {
        const stored = readPlannerDraft(localStorage, scope);
        setCandidate(stored);
        if(!stored) { revision.current=null; paused.current=false; }
      } catch {}
      setNotice("O rascunho foi alterado em outra aba. Confira antes de continuar.");
    };
    const flush = () => save.current();
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("storage", external);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      flush();
      paused.current = true;
      window.removeEventListener("storage", external);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [scope, restored]);

  save.current = () => {
    if (!scope || readyScope !== scope || paused.current) return;
    const value = latest.current;
    if (JSON.stringify(value) === cleared.current) return;
    // Never replace a recoverable route with a fresh empty planner.
    if (!value.stops.length && !value.routeName.trim()) return;
    try {
      const draft: PlannerDraft = { ...value, version: 1, scope, revision: crypto.randomUUID(), savedAt: Date.now() };
      const result = writePlannerDraft(localStorage, draft, revision.current);
      if (result.status === "conflict") {
        paused.current = true;
        setCandidate(result.current);
        setNotice("Há uma versão mais recente em outra aba. Seu trabalho atual continua nesta tela.");
        return;
      }
      revision.current = draft.revision;
      setNotice("Rascunho salvo neste aparelho");
    } catch { setNotice("Recuperação automática indisponível. Salve a rota no painel para não perder o trabalho."); }
  };
  const serialized = JSON.stringify(snapshot);
  useEffect(() => {
    if (readyScope !== scope || candidate) return;
    // The pagehide/unmount handlers flush any last keystroke before this timer.
    const timer = window.setTimeout(() => save.current(), 300);
    return () => window.clearTimeout(timer);
  }, [serialized, scope, readyScope, candidate]);

  const clear = () => {
    if (!scope) return;
    try {
      if (!removePlannerDraft(localStorage, scope, revision.current)) return;
      revision.current = null;
      cleared.current = JSON.stringify(latest.current);
      setCandidate(null);
      setNotice("");
    } catch { setNotice("Não foi possível remover o rascunho local."); }
  };
  const discard = () => {
    if (!scope) return;
    try {
      if (!removePlannerDraft(localStorage, scope, candidate?.revision ?? revision.current)) {
        setCandidate(readPlannerDraft(localStorage, scope));
        return;
      }
      revision.current = null;
      paused.current = false;
      setCandidate(null);
      setNotice("");
    } catch { setNotice("Não foi possível remover o rascunho local."); }
  };
  return { candidate, notice, clear, discard };
}
