/**
 * lib/financial-engine.ts
 * Dia 7: Motor de Gestão Financeira e Custos Logísticos (DRE de Viagem)
 */

export interface TripFinancialSummary {
  distanceKm: number;
  ratePerKm: number;
  estimatedFreightCost: number;
  fixedCost: number;
  fuelCost: number;
  totalCost: number;
  revenue: number;
  operatingMargin: number;
  marginPct: number;
}

export function calculateTripFinancials(
  distanceKm: number,
  ratePerKm = 3.5,
  totalValue = 15000,
  dieselPricePerLiter = 6.20,
  averageKmPerLiter = 3.8
): TripFinancialSummary {
  const safeKm = Math.max(0, distanceKm);
  const estimatedFreightCost = safeKm * ratePerKm;
  const fixedCost = 150.00; // Custo fixo diário de diária/operacional
  const fuelLiters = safeKm / averageKmPerLiter;
  const fuelCost = fuelLiters * dieselPricePerLiter;
  const totalCost = estimatedFreightCost + fixedCost + fuelCost;
  const revenue = totalValue * 0.08; // 8% do valor declarado como frete cobrado
  const operatingMargin = revenue - totalCost;
  const marginPct = revenue > 0 ? (operatingMargin / revenue) * 100 : 0;

  return {
    distanceKm: parseFloat(safeKm.toFixed(1)),
    ratePerKm,
    estimatedFreightCost: parseFloat(estimatedFreightCost.toFixed(2)),
    fixedCost,
    fuelCost: parseFloat(fuelCost.toFixed(2)),
    totalCost: parseFloat(totalCost.toFixed(2)),
    revenue: parseFloat(revenue.toFixed(2)),
    operatingMargin: parseFloat(operatingMargin.toFixed(2)),
    marginPct: parseFloat(marginPct.toFixed(1)),
  };
}
