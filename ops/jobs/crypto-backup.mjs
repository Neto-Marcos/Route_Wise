import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, appendFile, stat, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
export const MAGIC = Buffer.from('CRBACKUP1');
export function backupKey(value) {
  if (!/^[a-f0-9]{64}$/i.test(value || '')) throw new Error('A 32-byte backup encryption key is required');
  return Buffer.from(value, 'hex');
}
export async function encryptBackup(input, file, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const output = createWriteStream(file, { mode: 0o600 });
  output.write(Buffer.concat([MAGIC, iv]));
  await pipeline(input, cipher, output);
  await appendFile(file, cipher.getAuthTag());
}
export async function decryptBackup(file, output, key) {
  const size = (await stat(file)).size;
  if (size < MAGIC.length + 12 + 16) throw new Error('Truncated encrypted backup');
  const fd = await open(file, 'r');
  const header = Buffer.alloc(MAGIC.length + 12), tag = Buffer.alloc(16);
  try { await fd.read(header, 0, header.length, 0); await fd.read(tag, 0, 16, size - 16); } finally { await fd.close(); }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Invalid encrypted backup format');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  const target = await open(output, 'wx', 0o600);
  try {
    await pipeline(createReadStream(file, { start: header.length, end: size - 17 }), decipher, target.createWriteStream());
  } catch (error) {
    await target.close().catch(() => {});
    await rm(output, {force:true});
    throw error;
  }
}
