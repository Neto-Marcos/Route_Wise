// Local recovery only: this never submits or authorizes a route on the server.
export type DraftStop = {
  id?: string; name: string; address: string; lat: number; lng: number;
  is_origin?: boolean; order_ids?: string[]; boxes?: number; volume_m3?: number;
};
export type PlannerDraft = {
  version: 1; revision: string; savedAt: number; scope: string;
  stops: DraftStop[]; baselineStops: DraftStop[]; routeId?: string;
  routeName: string; routeDate: string; circular: boolean;
  optimizeBy: "distance" | "time" | "manual";
  routingTransfer?: unknown;
};
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const draftKey = (scope: string) => `rw_planner_draft_v1:${encodeURIComponent(scope)}`;
const MAX_BYTES = 3_000_000;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

export function readPlannerDraft(storage: DraftStorage, scope: string, now = Date.now()): PlannerDraft | null {
  const raw = storage.getItem(draftKey(scope));
  if (!raw || raw.length > MAX_BYTES) return null;
  try {
    const value = JSON.parse(raw) as PlannerDraft;
    const validStops = (stops: DraftStop[]) => Array.isArray(stops) && stops.length <= 2000 && stops.every(stop =>
      stop && typeof stop.name === "string" && typeof stop.address === "string" &&
      Number.isFinite(stop.lat) && Math.abs(stop.lat) <= 90 && Number.isFinite(stop.lng) && Math.abs(stop.lng) <= 180 &&
      (stop.id === undefined || typeof stop.id === "string"));
    if (value?.version !== 1 || value.scope !== scope || typeof value.revision !== "string" ||
      !Number.isFinite(value.savedAt) || now - value.savedAt > MAX_AGE || value.savedAt > now + 60_000 ||
      !validStops(value.stops) || !validStops(value.baselineStops) ||
      typeof value.routeName !== "string" || typeof value.routeDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.routeDate) || typeof value.circular !== "boolean" ||
      (value.routeId !== undefined && typeof value.routeId !== "string") ||
      !["distance", "time", "manual"].includes(value.optimizeBy)) return null;
    return value;
  } catch { return null; }
}

export function writePlannerDraft(storage: DraftStorage, draft: PlannerDraft, expectedRevision: string | null) {
  const current = readPlannerDraft(storage, draft.scope);
  if (current && current.revision !== expectedRevision) return { status: "conflict" as const, current };
  const raw = JSON.stringify(draft);
  if (raw.length > MAX_BYTES) throw new Error("Rascunho grande demais para recuperação automática. Salve a rota no painel.");
  storage.setItem(draftKey(draft.scope), raw);
  return { status: "saved" as const };
}

export function removePlannerDraft(storage: DraftStorage, scope: string, expectedRevision: string | null) {
  const current = readPlannerDraft(storage, scope);
  if (current && current.revision !== expectedRevision) return false;
  storage.removeItem(draftKey(scope));
  return true;
}
