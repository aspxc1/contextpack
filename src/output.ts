import { lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { assertNoLinks, canonicalPath, readRegular, utf8, hash } from './util.js';
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
    const contextPath = path.join(out, 'context.md');
    await assertNoLinks(contextPath);
    if (!(await lstat(contextPath)).isFile()) throw new Error();
    return true;
  } catch (e: any) {
    if (e.code === 'ENOENT') return false;
    throw new Error('Output must be empty or a tool-owned export directory; refusing unrelated files');
  }
}
export async function writeOutput(inputOut: string, result: PackResult): Promise<string[]> {
  const warnings: string[] = [];
  let out: string;
  try { out = await canonicalPath(inputOut); }
  catch { throw new Error('Cannot safely access output directory (links are refused)'); }
  const parent = path.dirname(out);
  if (hash(result.context) !== result.manifest.document.hash || countTokens(result.context) !== result.manifest.document.tokens || result.manifest.document.tokens > result.manifest.budget) throw new Error('Output validation failed');
  try { await assertNoLinks(out); await mkdir(parent, { recursive: true }); }
  catch { throw new Error('Cannot safely access output directory (links are refused)'); }
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
    if (backup) {
      try { await rm(backup, { recursive: true, force: true }); backup = undefined; }
      catch { warnings.push('Export saved; backup cleanup failed. Inspect the .contextpack-backup-* directory in the output parent.'); }
    }
  } catch (e: any) {
    if (e.message.startsWith('Output must') || e.message.startsWith('Atomic output')) throw e;
    throw new Error('Cannot write output; export was not replaced');
  } finally {
    if (staged) { try { await rm(staged, { recursive: true, force: true }); } catch { /* A failed staging directory is never a successful export. */ } }
    try { await rm(lock, { recursive: true, force: true }); }
    catch { warnings.push('Output lock cleanup failed; inspect the .contextpack-lock-* directory in the output parent.'); }
  }
  return warnings;
}
