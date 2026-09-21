/**
 * lib/business-rules.ts
 * Regras de negócio, políticas comerciais e restrições operacionais da frota.
 */

/**
 * Tabela de Pedido Mínimo por Estado (UF)
 * - PB: R$ 1.500,00
 * - AL, BA, CE, PE, RN, SE: R$ 2.000,00
 * - MA, PA, PI, TO: R$ 7.000,00
 * - AP: R$ 10.000,00
 */
export const STATE_MIN_ORDER_VALUE: Record<string, number> = {
  PB: 1500,
  AL: 2000,
  BA: 2000,
  CE: 2000,
  PE: 2000,
  RN: 2000,
  SE: 2000,
  MA: 7000,
  PA: 7000,
  PI: 7000,
  TO: 7000,
  AP: 10000,
};

/**
 * Retorna o valor de pedido mínimo configurado para o estado, ou 0 se não houver exigência cadastrada.
 */
export function getMinOrderValueForState(uf?: string): number {
  if (!uf) return 0;
  const cleanUf = uf.trim().toUpperCase();
  return STATE_MIN_ORDER_VALUE[cleanUf] ?? 0;
}

export interface MinOrderCheckResult {
  eligible: boolean;
  minRequired: number;
  currentValue: number;
  difference: number;
  reason?: string;
}

/**
 * Avalia se um pedido atinge a política de pedido mínimo por estado.
 */
export function checkOrderMinEligibility(order: { uf?: string; totalValue?: number; city?: string; orderId?: string }): MinOrderCheckResult {
  const uf = (order.uf ?? "").trim().toUpperCase();
  const minRequired = getMinOrderValueForState(uf);
  const currentValue = order.totalValue ?? 0;

  if (minRequired === 0) {
    return {
      eligible: true,
      minRequired: 0,
      currentValue,
      difference: 0,
    };
  }

  const eligible = currentValue >= minRequired;
  const difference = eligible ? 0 : Math.round((minRequired - currentValue) * 100) / 100;
  const reason = eligible
    ? undefined
    : `Pedido com valor de ${currentValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} abaixo do mínimo de ${minRequired.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} para o estado ${uf}`;

  return {
    eligible,
    minRequired,
    currentValue,
    difference,
    reason,
  };
}
