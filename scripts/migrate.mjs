import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
if (!process.env.DATABASE_URL) { console.log("DATABASE_URL ausente; migration ignorada."); process.exit(0); }
const dir=new URL("../db/migrations/",import.meta.url);const files=(await readdir(dir)).filter(f=>f.endsWith(".sql")).sort();
const client=new pg.Client({connectionString:process.env.DATABASE_URL}); await client.connect();for(const file of files){const sql=(await readFile(new URL(file,dir),"utf8")).replace(/^\uFEFF/,"");await client.query(sql);console.log(`Migration aplicada: ${file}`)}await client.end();console.log("Banco atualizado.");
