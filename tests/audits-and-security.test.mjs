import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();

describe("Audits and Security Verification", () => {
  it("S1: lib/auth.ts contains production warning for fallback SESSION_SECRET", () => {
    const authPath = path.join(ROOT_DIR, "lib", "auth.ts");
    const authCode = fs.readFileSync(authPath, "utf8");
    assert.ok(authCode.includes("SESSION_SECRET is not set in production"), "Must warn if SESSION_SECRET is missing in production");
  });

  it("S2: db/migrations/0014_performance_indexes.sql defines composite performance indexes", () => {
    const migPath = path.join(ROOT_DIR, "db", "migrations", "0014_performance_indexes.sql");
    assert.ok(fs.existsSync(migPath), "Migration 0014 must exist");
    const migSql = fs.readFileSync(migPath, "utf8");
    assert.ok(migSql.includes("routes_company_status_idx"), "Must define index on routes(company_id, status)");
    assert.ok(migSql.includes("route_stops_route_position_idx"), "Must define index on route_stops(route_id, position)");
  });
});
