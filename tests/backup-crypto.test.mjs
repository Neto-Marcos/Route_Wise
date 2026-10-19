import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupKey, encryptBackup, decryptBackup } from '../ops/jobs/crypto-backup.mjs';
test('backup encryption round trip preserves binary proof bytes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'backup-test-')),key=randomBytes(32),input=randomBytes(1024*1024);
  try{await encryptBackup(Readable.from(input),join(dir,'backup.enc'),key);const encrypted=await readFile(join(dir,'backup.enc'));assert(!encrypted.includes(input.subarray(0,64)));await decryptBackup(join(dir,'backup.enc'),join(dir,'restore.dump'),key);assert.deepEqual(await readFile(join(dir,'restore.dump')),input);}
  finally{await rm(dir,{recursive:true,force:true});}
});
test('wrong key, truncated file and modified ciphertext are rejected',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'backup-auth-')),key=randomBytes(32),file=join(dir,'backup.enc');
  try{await encryptBackup(Readable.from(Buffer.from('private proof bytes')),file,key);await assert.rejects(decryptBackup(file,join(dir,'wrong.dump'),randomBytes(32)));const value=await readFile(file);value[25]^=1;await writeFile(file,value);await assert.rejects(decryptBackup(file,join(dir,'tampered.dump'),key));await writeFile(file,Buffer.from('short'));await assert.rejects(decryptBackup(file,join(dir,'truncated.dump'),key),/Truncated/);assert.throws(()=>backupKey('invalid'));}
  finally{await rm(dir,{recursive:true,force:true});}
});
