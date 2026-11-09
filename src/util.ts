import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';

export const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const display = (value: string) => JSON.stringify(value).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
export const within = (root: string, target: string) => {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
};
export function matcher(patterns: string[]) {
  for (const p of patterns) {
    if (!p || p.includes('\\') || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..') || p.startsWith('!') || /[\x00-\x1f]/.test(p)) {
      throw new Error('Invalid repository-relative glob pattern');
    }
  }
  return picomatch(patterns, { dot: true, nocase: false, nonegate: true });
}

// Reject links in every existing component, including ancestor directories.
export async function assertNoLinks(target: string): Promise<void> {
  let current = path.resolve(target);
  while (true) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Symbolic links are not allowed'); }
    catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

// Resolve aliases (including Windows 8.3 names) even for a destination that does
// not exist yet. Existing link components remain forbidden.
export async function canonicalPath(input: string): Promise<string> {
  await assertNoLinks(input);
  let current = path.resolve(input);
  const suffix: string[] = [];
  while (true) {
    try { return path.join(await realpath(current), ...suffix); }
    catch (e: any) {
      if (e.code !== 'ENOENT') throw new Error('Cannot canonicalize local path');
      const parent = path.dirname(current);
      if (parent === current) throw new Error('Cannot canonicalize local path');
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

export async function readRegular(file: string, maxBytes: number, root?: string): Promise<Buffer> {
  await assertNoLinks(file);
  if (root && !within(root, await realpath(file))) throw new Error('File outside repository');
  const before = await lstat(file);
  if (!before.isFile()) throw new Error('Not a regular file');
  if (before.size > maxBytes) throw new Error('oversized');
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev) throw new Error('File changed during capture');
    // Bounded read also protects against concurrent growth.
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > maxBytes) throw new Error('oversized');
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}
export const utf8 = (bytes: Buffer) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
