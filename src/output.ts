import { lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { assertNoLinks, readRegular, utf8, hash } from './util.js';
import { countTokens } from './security.js';
import type { PackResult } from './types.js';

async function owned(out: string): Promise<boolean> {
  try {
    const stat = await lstat(out);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
    const names = await readdir(out);
    if (names.length === 0) return true;
    if (names.length !== 2 || !names.includes('context.md') || !names.includes('manifest.json')) throw new Error();
    const manifest = JSON.parse(utf8(await readRegular(path.join(out, 'manifest.json'), 16 * 1024 * 1024)));
    if (manifest.schemaVersion !== 1 || typeof manifest.versions?.contextpack !== 'string') throw new Error();
    await assertNoLinks(path.join(out, 'context.md'));
    return true;
  } catch (e: any) {
    if (e.code === 'ENOENT') return false;
    throw new Error('Output must be empty or a tool-owned export directory; refusing unrelated files');
  }
}
export async function writeOutput(inputOut: string, result: PackResult): Promise<void> {
  const out = path.resolve(inputOut), parent = path.dirname(out);
  if (hash(result.context) !== result.manifest.document.hash || countTokens(result.context) !== result.manifest.document.tokens || result.manifest.document.tokens > result.manifest.budget) throw new Error('Output validation failed');
  await assertNoLinks(out);
  await mkdir(parent, { recursive: true });
  const lock = path.join(parent, `.contextpack-lock-${hash(out).slice(0, 16)}`);
  try { await mkdir(lock); } catch { throw new Error('Output is locked by another export or a stale lock; inspect the output parent'); }
  let staged: string | undefined, backup: string | undefined;
  try {
    await assertNoLinks(out);
    const replace = await owned(out);
    staged = await mkdtemp(path.join(parent, '.contextpack-tmp-'));
    await writeFile(path.join(staged, 'context.md'), result.context, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await writeFile(path.join(staged, 'manifest.json'), JSON.stringify(result.manifest, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    if (replace) {
      backup = path.join(parent, `.contextpack-backup-${randomUUID()}`);
      await rename(out, backup);
    }
    try { await rename(staged, out); staged = undefined; }
    catch {
      if (backup) { await rename(backup, out); backup = undefined; }
      throw new Error('Atomic output replacement failed; previous export restored');
    }
    if (backup) { await rm(backup, { recursive: true, force: true }); backup = undefined; }
  } catch (e: any) {
    if (e.message.startsWith('Output must') || e.message.startsWith('Atomic output')) throw e;
    throw new Error('Cannot write output; export was not replaced');
  } finally {
    if (staged) await rm(staged, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
