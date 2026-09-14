import pg from "pg";
import { readFile, readdir } from "node:fs/promises";

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL ausente; migration ignorada.");
  process.exit(0);
}

const dir = new URL("../db/migrations/", import.meta.url);
const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  // A migration is an immutable, one-time database operation. Recording it here
  // prevents a restart or a deploy from replaying data-changing SQL.
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const file of files) {
    const alreadyApplied = await client.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [file],
    );
    if (alreadyApplied.rowCount) {
      console.log(`Migration já aplicada: ${file}`);
      continue;
    }

    const sql = (await readFile(new URL(file, dir), "utf8")).replace(/^\uFEFF/, "");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Migration aplicada: ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.end();
}

console.log("Banco atualizado.");
