import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import pg from 'pg';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { backupKey, encryptBackup, decryptBackup } from './crypto-backup.mjs';

const PREFIX = 'criar-rota/database/';
const bucket = process.env.BACKUP_BUCKET;
const key = backupKey(process.env.BACKUP_ENCRYPTION_KEY);
if (!bucket || !process.env.DATABASE_URL || !process.env.BACKUP_ENDPOINT) throw new Error('Backup configuration missing');
const s3 = new S3Client({ region: process.env.BACKUP_REGION || 'auto', endpoint: process.env.BACKUP_ENDPOINT,
  credentials: { accessKeyId: process.env.BACKUP_ACCESS_KEY_ID || '', secretAccessKey: process.env.BACKUP_SECRET_ACCESS_KEY || '' } });
const directory = await mkdtemp(join(tmpdir(), 'criar-rota-backup-'));
const sourceUrl = new URL(process.env.DATABASE_URL);
const env = { ...process.env, PGHOST: sourceUrl.hostname, PGPORT: sourceUrl.port || '5432', PGUSER: decodeURIComponent(sourceUrl.username), PGPASSWORD: decodeURIComponent(sourceUrl.password), PGDATABASE: decodeURIComponent(sourceUrl.pathname.slice(1)), PGSSLMODE: sourceUrl.searchParams.get('sslmode') || 'prefer', PGCONNECT_TIMEOUT: '10', PGOPTIONS: '-c lock_timeout=10000 -c statement_timeout=600000' };
function processResult(child) {
  let errorText = '';
  child.stderr?.on('data', data => { errorText = (errorText + data).slice(-3000); });
  return new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`Database operation failed (${code}): ${errorText.replaceAll(process.env.DATABASE_URL, '[redacted database]')}`))); });
}
async function run(command, args, options = {}) { const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'], ...options }); await processResult(child); }
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
let restoreStarted = false;
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='60s'");
  const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const counts = {};
  for (const { tablename } of tables) counts[tablename] = (await client.query(`SELECT count(*)::text AS n FROM public."${tablename.replaceAll('"','""')}"`)).rows[0].n;
  const proofBytes = (await client.query('SELECT coalesce(sum(octet_length(file_data)),0)::text AS n FROM upload_objects')).rows[0].n;
  const encrypted = join(directory, 'database.enc');
  const dump = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-acl', `--snapshot=${snapshot}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await Promise.all([processResult(dump), encryptBackup(dump.stdout, encrypted, key)]);
  await client.query('COMMIT');
  await client.end();
  const filename = PREFIX + new Date().toISOString().replaceAll(':','-') + '.pgdump.enc';
  const checksum = createHash('sha256');
  for await (const chunk of createReadStream(encrypted)) checksum.update(chunk);
  const digest = checksum.digest('hex');
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: filename, Body: createReadStream(encrypted), ContentLength: (await stat(encrypted)).size, ContentType: 'application/octet-stream', Metadata: { sha256: digest, encryption: 'aes-256-gcm' } }));
  // Exercise the actual object stored remotely, not only the local dump.
  const downloaded = join(directory, 'download.enc');
  const remote = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: filename }));
  await pipeline(remote.Body, createWriteStream(downloaded, {mode:0o600}));
  const downloadedHash = createHash('sha256');
  for await (const chunk of createReadStream(downloaded)) downloadedHash.update(chunk);
  if (downloadedHash.digest('hex') !== digest) throw new Error('Downloaded backup checksum mismatch');
  const restoredDump = join(directory, 'restore.dump');
  await decryptBackup(downloaded, restoredDump, key);
  const pgdata = join(directory, 'restore-db');
  // This instance is ephemeral, loopback-only, and unrelated to production.
  await run('initdb', ['-D', pgdata, '--auth-local=trust', '--auth-host=trust', '--no-locale'], {env:{...env,PGDATABASE:''}});
  await run('pg_ctl', ['-D', pgdata, '-l', join(directory,'restore.log'), '-o', '-h 127.0.0.1 -p 55432 -F', '-w', 'start']);
  restoreStarted = true;
  const local = 'postgresql://postgres@127.0.0.1:55432/postgres';
  await run('pg_restore', ['--dbname', local, '--exit-on-error', '--no-owner', '--no-acl', restoredDump], {env:{...env,PGSSLMODE:'disable',PGPASSWORD:''}});
  const restored = new pg.Client({connectionString:local});
  await restored.connect();
  try {
    for (const [table, expected] of Object.entries(counts)) {
      const actual = (await restored.query(`SELECT count(*)::text AS n FROM public."${table.replaceAll('"','""')}"`)).rows[0].n;
      if (actual !== expected) throw new Error('Restored table count mismatch');
    }
    const actualBytes = (await restored.query('SELECT coalesce(sum(octet_length(file_data)),0)::text AS n FROM upload_objects')).rows[0].n;
    if (actualBytes !== proofBytes) throw new Error('Restored proof file size mismatch');
  } finally { await restored.end(); }
  const manifest = { version:1, object:filename, completedAt:new Date().toISOString(), sha256:digest, bytes:(await stat(encrypted)).size, tableCount:tables.length, restoreVerified:true, proofBytes };
  await s3.send(new PutObjectCommand({Bucket:bucket,Key:filename+'.json',Body:JSON.stringify({...manifest,counts}),ContentType:'application/json'}));
  await s3.send(new PutObjectCommand({ Bucket:bucket,Key:PREFIX+'latest.json',Body:JSON.stringify(manifest),ContentType:'application/json' }));
  // Delete only our expired backups, and only after a verified replacement.
  let token;
  do {
    const list=await s3.send(new ListObjectsV2Command({Bucket:bucket,Prefix:PREFIX,ContinuationToken:token}));
    const expired=(list.Contents||[]).filter(item=>item.Key?.endsWith('.pgdump.enc') && item.LastModified && Date.now()-item.LastModified.getTime()>30*86400000);
    if(expired.length) await s3.send(new DeleteObjectsCommand({Bucket:bucket,Delete:{Objects:expired.flatMap(item=>[{Key:item.Key},{Key:item.Key+'.json'}])}}));
    token=list.NextContinuationToken;
  } while(token);
  console.log(JSON.stringify({event:'backup_verified',...manifest}));
} catch(error) {
  console.error(JSON.stringify({event:'backup_failed',error:error?.name||'Error',message:String(error?.message||'').replaceAll(process.env.DATABASE_URL,'[redacted database]').slice(0,1000)}));
  process.exitCode=1;
} finally {
  await client.end().catch(()=>{});
  if(restoreStarted) await run('pg_ctl',['-D',join(directory,'restore-db'),'-m','immediate','-w','stop']).catch(()=>{});
  await rm(directory,{recursive:true,force:true});
  s3.destroy();
}
