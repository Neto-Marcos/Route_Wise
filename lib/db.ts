import { Pool, type QueryResultRow } from "pg";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

type Client={query:<T extends QueryResultRow=QueryResultRow>(text:string,values?:unknown[])=>Promise<{rows:T[]}>;release:()=>void};
const shared=globalThis as typeof globalThis&{routewisePool?:Pool;routewiseLocal?:Promise<Client>};
async function backend():Promise<Client>{
  if(process.env.DATABASE_URL){
    let pool=shared.routewisePool;
    if(!pool){
      pool=new Pool({connectionString:process.env.DATABASE_URL,max:8});
      shared.routewisePool=pool;
      pool.query("ALTER TABLE upload_objects ADD COLUMN IF NOT EXISTS file_data bytea").catch((e)=>{
        console.warn("upload_objects auto-migration notice:", e?.message);
      });
    }
    return {query:(text,values=[])=>pool!.query(text,values) as never,release:()=>{}}
  }
  if(!shared.routewiseLocal)shared.routewiseLocal=(async()=>{
    try {
      const dbDir = resolve(process.cwd(),".local-db","routewise");
      await mkdir(resolve(process.cwd(),".local-db"),{recursive:true});
      const {PGlite}=await import("@electric-sql/pglite");
      let pg: InstanceType<typeof PGlite>;
      try {
        const pidFile = resolve(dbDir, "postmaster.pid");
        if (existsSync(pidFile)) {
          await rm(pidFile, { force: true }).catch(() => {});
        }
        pg = new PGlite(dbDir);
        await pg.query("SELECT 1");
      } catch (err) {
        console.warn("Local PGlite database reset after corruption:", err);
        await rm(dbDir, { recursive: true, force: true }).catch(() => {});
        pg = new PGlite(dbDir);
      }
      const migrationsDir=resolve(process.cwd(),"db","migrations");
      for(const file of (await readdir(migrationsDir)).filter(f=>f.endsWith(".sql")).sort())await pg.exec(await readFile(resolve(migrationsDir,file),"utf8"));
      return {query:async<T extends QueryResultRow>(text:string,values:unknown[]=[])=>{const result=await pg.query<T>(text,values as never);return {rows:result.rows}},release:()=>{}}
    } catch(e) {
      shared.routewiseLocal = undefined;
      throw e;
    }
  })();
  return shared.routewiseLocal;
}
export const db={connect:backend};
export async function query<T extends QueryResultRow>(text:string,values:unknown[]=[]){return (await backend()).query<T>(text,values)}
export async function audit(actorType:string,actorId:string|null,action:string,entityType:string,entityId:string|null,details:unknown=null){await query("INSERT INTO audit_log(actor_type,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)",[actorType,actorId,action,entityType,entityId,details])}
