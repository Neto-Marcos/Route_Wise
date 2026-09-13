import test from "node:test";
import assert from "node:assert/strict";
import { detectControlTowerAlerts } from "../lib/control-tower.ts";
import { calculateTripFinancials } from "../lib/financial-engine.ts";
import { calculateLogisticsKpis } from "../lib/kpi-engine.ts";
import { hasPermission } from "../lib/rbac.ts";

test("Dia 11: Torre de Controle detecta atrasos em rotas ativas", () => {
  const alerts = detectControlTowerAlerts([
    {
      id: "route-test-1",
      name: "Rota Campina - Patos",
      status: "active",
      started_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), // 3 horas atrás
      stops: [{ status: "pending" }, { status: "pending" }],
    },
  ]);

  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].type, "DELAY");
  assert.strictEqual(alerts[0].severity, "critical");
});

test("Dia 12 & 15: RBAC garante permissões por perfil", () => {
  assert.strictEqual(hasPermission("admin", "any:action"), true);
  assert.strictEqual(hasPermission("branch_manager", "routes:create"), true);
  assert.strictEqual(hasPermission("driver", "routes:create"), false);
  assert.strictEqual(hasPermission("driver", "mobile:submit_pod"), true);
});

test("Dia 7 & 10: KPIs e DRE calculam margem e OTIF com precisão", () => {
  const dre = calculateTripFinancials(200, 4.0, 20000);
  assert.ok(dre.totalCost > 0);
  assert.ok(dre.revenue > 0);
  assert.strictEqual(typeof dre.marginPct, "number");

  const kpis = calculateLogisticsKpis([
    {
      status: "completed",
      totalVolumeM3: 25,
      estimatedKm: 180,
      stops: [{ status: "delivered" }, { status: "delivered" }],
    },
  ]);
  assert.ok(kpis.otifPct >= 90);
  assert.ok(kpis.avgOccupancyPct > 50);
});
