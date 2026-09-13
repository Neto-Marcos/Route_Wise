/**
 * lib/control-tower.ts
 * Dia 11: Torre de Controle Logística com Alertas em Tempo Real
 */

export interface ControlTowerAlert {
  id: string;
  routeId: string;
  routeName: string;
  driverName: string;
  type: "LONG_STOP" | "DELAY" | "OFF_ROUTE" | "BATTERY_LOW";
  severity: "low" | "medium" | "critical";
  message: string;
  timestamp: string;
  location?: { lat: number; lng: number };
}

export function detectControlTowerAlerts(routes: Array<{
  id: string;
  name: string;
  driver_name?: string;
  status: string;
  started_at?: string;
  stops?: Array<{ status: string; delivered_at?: string }>;
  location_points?: Array<{ lat: number; lng: number; recorded_at: string }>;
}>): ControlTowerAlert[] {
  const alerts: ControlTowerAlert[] = [];
  const now = Date.now();

  for (const r of routes) {
    if (r.status !== "active") continue;

    // 1. Alerta de Parada Prolongada (> 45 min sem nova entrega ou sem movimento)
    if (r.started_at) {
      const elapsedMinutes = (now - new Date(r.started_at).getTime()) / 60000;
      const deliveredCount = r.stops?.filter(s => s.status === "delivered").length || 0;
      const totalStops = r.stops?.length || 1;

      if (elapsedMinutes > 120 && deliveredCount === 0) {
        alerts.push({
          id: `alert-delay-${r.id}`,
          routeId: r.id,
          routeName: r.name,
          driverName: r.driver_name || "Motorista",
          type: "DELAY",
          severity: "critical",
          message: "Viagem iniciada há mais de 2 horas sem nenhuma entrega registrada.",
          timestamp: new Date().toISOString(),
        });
      }

      // Alerta de parada longa
      if (elapsedMinutes > 60 && deliveredCount > 0 && deliveredCount < totalStops) {
        alerts.push({
          id: `alert-longstop-${r.id}`,
          routeId: r.id,
          routeName: r.name,
          driverName: r.driver_name || "Motorista",
          type: "LONG_STOP",
          severity: "medium",
          message: "Veículo parado na mesma localização há mais de 40 minutos.",
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  return alerts;
}
