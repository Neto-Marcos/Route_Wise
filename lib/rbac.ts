/**
 * lib/rbac.ts
 * Dia 15: Controle de Acesso Baseado em Funções (RBAC) & Multi-Filiais
 */

export type UserRole = "admin" | "branch_manager" | "expedition" | "driver";

export interface Branch {
  id: string;
  name: string;
  code: string;
  city: string;
  state: string;
}

export const SYSTEM_PERMISSIONS: Record<UserRole, string[]> = {
  admin: ["*"],
  branch_manager: [
    "routes:create",
    "routes:edit",
    "routes:dispatch",
    "drivers:view",
    "reports:view",
  ],
  expedition: [
    "routes:view",
    "routes:lifo_guide",
    "vehicles:checkin",
  ],
  driver: [
    "mobile:view_assigned",
    "mobile:submit_pod",
    "mobile:odometer",
  ],
};

export function hasPermission(role: UserRole, permission: string): boolean {
  const perms = SYSTEM_PERMISSIONS[role] || [];
  return perms.includes("*") || perms.includes(permission);
}
