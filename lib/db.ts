import { Pool, type QueryResultRow } from "pg";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

type Client = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
  release: () => void;
};

const shared = globalThis as typeof globalThis & { routewisePool?: Pool; routewiseLocal?: Promise<Client> };

async function backend(): Promise<Client> {
  if (process.env.DATABASE_URL) {
    let pool = shared.routewisePool;
    if (!pool) {
      pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
      pool.on("error", (err) => {
        console.error("Unexpected error on idle PostgreSQL client", err);
      });
      shared.routewisePool = pool;
    }
    const pgClient = await pool.connect();
    return {
      query: (text, values = []) => pgClient.query(text, values) as never,
      release: () => pgClient.release(),
    };
  }
  if (!shared.routewiseLocal) shared.routewiseLocal = (async () => {
    try {
      const dbDir = resolve(process.cwd(), ".local-db", "routewise");
      await mkdir(resolve(process.cwd(), ".local-db"), { recursive: true });
      const { PGlite } = await import("@electric-sql/pglite");
      const pg = new PGlite(dbDir);
      await pg.query("SELECT 1");
      const check = await pg.query<{ ledger: string | null; users: string | null }>(
        "SELECT to_regclass('public.schema_migrations')::text AS ledger, to_regclass('public.dispatchers')::text AS users"
      );
      if (!check.rows[0]?.ledger && check.rows[0]?.users) {
        await pg.close();
        throw new Error("Banco local legado sem histórico: não reaplicar migrations ou seeds automaticamente.");
      }
      await pg.exec("CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      const migrationsDir = resolve(process.cwd(), "db", "migrations");
      for (const file of (await readdir(migrationsDir)).filter(f => f.endsWith(".sql")).sort()) {
        const applied = await pg.query("SELECT 1 FROM schema_migrations WHERE filename=$1", [file]);
        if (!applied.rows.length) {
          if (file === "0008_superadmin_marcos.sql") {
            await pg.close();
            throw new Error("Migration legada com credencial fixa exige revisão administrativa explícita; inicialização interrompida.");
          }
          await pg.exec("BEGIN");
          try {
            await pg.exec(await readFile(resolve(migrationsDir, file), "utf8"));
            await pg.query("INSERT INTO schema_migrations(filename) VALUES($1)", [file]);
            await pg.exec("COMMIT");
          } catch (err) {
            await pg.exec("ROLLBACK");
            throw err;
          }
        }
      }
      return {
        query: async <T extends QueryResultRow>(text: string, values: unknown[] = []) => {
          const result = await pg.query<T>(text, values as never);
          return { rows: result.rows };
        },
        release: () => {},
      };
    } catch (e) {
      shared.routewiseLocal = undefined;
      throw e;
    }
  })();
  return shared.routewiseLocal;
}
export const db = { connect: backend };
export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  if (process.env.DATABASE_URL) {
    let pool = shared.routewisePool;
    if (!pool) {
      (await backend()).release();
      pool = shared.routewisePool;
    }
    return (pool ? pool.query(text, values) : (await backend()).query(text, values)) as unknown as { rows: T[] };
  }
  return (await backend()).query<T>(text, values);
}
export async function audit(actorType: string, actorId: string | null, action: string, entityType: string, entityId: string | null, details: unknown = null) {
  await query("INSERT INTO audit_log(actor_type,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)", [actorType, actorId, action, entityType, entityId, details]);
}
