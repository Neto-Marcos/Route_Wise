export const technicalKinds = ["client_exception", "api_failure", "sync_failure", "upload_failure", "server_error"] as const;
export type TechnicalKind = typeof technicalKinds[number];
export function technicalPath(path: string) {
  return path.split(/[?#]/)[0].replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, ":id").replace(/\b\d{3,}\b/g, ":number").slice(0, 160);
}
export function validateTechnicalEvent(value: unknown): { kind: TechnicalKind; path: string } | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (!technicalKinds.includes(event.kind as TechnicalKind) || typeof event.path !== "string" || !event.path.startsWith("/") || event.path.startsWith("//")) return null;
  return { kind: event.kind as TechnicalKind, path: technicalPath(event.path) };
}
export function reportTechnicalFailure(kind: TechnicalKind, path: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("criarrota:technical-failure", { detail: { kind, path: technicalPath(path) } }));
}
