import pg from 'pg';
import { readdir } from 'node:fs/promises';

// Deployment startup is a read-only compatibility check, never a migration.
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for container startup');
const files = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const ledger = (await client.query("SELECT to_regclass('public.schema_migrations')::text AS ledger")).rows[0];
  if (!ledger.ledger) throw new Error('Migration ledger absent: refusing automatic migrations/bootstrap');
  const applied = new Set((await client.query('SELECT filename FROM schema_migrations')).rows.map(row => row.filename));
  const pending = files.filter(file => !applied.has(file));
  if (pending.length) throw new Error('Pending migrations require a separate reviewed operation: ' + pending.join(', '));
  const required = [['upload_objects','file_data'],['route_stops','boxes'],['route_stops','volume_m3']];
  for (const [table, column] of required) {
    const found = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2", [table, column]);
    if (!found.rowCount) throw new Error('Required column missing: ' + table + '.' + column);
  }
  await client.query('COMMIT');
  console.log('Schema compatibility PASS; startup performed no migrations or seeds.');
} finally { await client.end(); }
