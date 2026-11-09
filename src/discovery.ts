import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ignore, { type Ignore } from 'ignore';
import { checkedScan, countTokens, scan } from './security.js';
import { assertNoLinks, canonicalPath, hash, matcher, order, readRegular, utf8, within, display } from './util.js';
import type { Rules, Scanner, Snapshot, Decision } from './types.js';

const blockedDirs = new Set(['.git', '.hg', '.svn', 'node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.venv', 'venv', 'env', '__pycache__', '.cache', '.pytest_cache', '.mypy_cache', '.tox', 'target', '.aws', '.ssh', '.azure', '.gcloud', '.kube', '.gnupg', '.npm', '.yarn', '.pnpm-store', '.contextpack', 'packs']);
function safety(name: string, directory: boolean): string | undefined {
  const n = name.toLowerCase();
  if (directory && blockedDirs.has(n)) return 'dependency, build, cache or credential directory';
  if (/^\.contextpack-(?:tmp|backup|lock)-/.test(n) || n === '.contextpack.json' || /^repomix\.config\./.test(n) || /^\.secretlintrc/.test(n) || n === 'context.md' || n === 'manifest.json') return 'tool configuration or export';
  if ((/^\.env(?:\.|$)/.test(n) && !/^\.env\.(example|sample|template)$/.test(n)) || /\.(pem|key|p12|pfx|keystore)$/.test(n) || /^(id_rsa|id_ed25519|credentials(?:\..*)?|secrets?(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials)$/.test(n)) return 'secret-bearing filename';
}
function git(root: string, args: string[], input?: string) {
  return spawnSync('git', ['--no-optional-locks', '-C', root, ...args], {
    encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' },
  });
}

export async function discover(inputRoot: string, options: Rules, scanner: Scanner = scan): Promise<Snapshot> {
  await assertNoLinks(inputRoot);
  let root: string;
  try { root = await realpath(inputRoot); if (!(await lstat(root)).isDirectory()) throw new Error(); }
  catch { throw new Error('Repository path must be an existing local directory'); }
  const include = matcher(options.include ?? []), exclude = matcher(options.exclude ?? []);
  const pinPatterns = (options.pin ?? []).map(p => ({ pattern: p, match: matcher([p]) }));
  const out = options.out ? await canonicalPath(options.out) : undefined;
  if (out && within(out, root)) throw new Error('Output must not contain or equal the repository');
  const relativeOut = out && within(root, out) ? path.relative(root, out).split(path.sep).join('/') : undefined;
  const probe = git(root, ['rev-parse', '--is-inside-work-tree']);
  const isGit = probe.status === 0 && probe.stdout.trim() === 'true';
  let metadata: Snapshot['git'] = null;
  const submodules = new Set<string>();
  let inventory: Set<string> | undefined;
  if (isGit) {
    const head = git(root, ['rev-parse', '--verify', 'HEAD']);
    const state = git(root, ['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', ...(relativeOut ? [`:(exclude,literal)${relativeOut}`] : [])]);
    const entries = git(root, ['ls-files', '--stage', '-z', '--', '.']);
    const listed = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.']);
    if (state.status !== 0 || entries.status !== 0 || listed.status !== 0) throw new Error('Git discovery failed');
    metadata = { head: head.status === 0 ? head.stdout.trim() : null, dirty: state.stdout.length > 0 };
    inventory = new Set(listed.stdout.split('\0').filter(Boolean));
    for (const item of entries.stdout.split('\0')) if (item.startsWith('160000 ')) submodules.add(item.slice(item.indexOf('\t') + 1));
  }
  const result: Snapshot = { label: path.basename(root), git: metadata, files: [], decisions: [] };
  // Record the designated output even before it exists, preserving repeatability.
  if (relativeOut) result.decisions.push({ path: relativeOut, status: 'excluded', reason: 'output directory' });
  const pending: { rel: string; abs: string; ignored: boolean }[] = [];
  const reject = (rel: string, reason: string) => result.decisions.push({ path: rel, status: 'excluded', reason });
  async function walk(dir: string, base: string, parents: { base: string; rules: Ignore }[]) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { if (base) { reject(base, 'unreadable directory'); return; } throw new Error('Repository directory is unreadable'); }
    const chain = [...parents];
    if (!isGit && entries.some(e => e.name === '.gitignore' && e.isFile())) {
      try { chain.push({ base, rules: ignore().add(utf8(await readRegular(path.join(dir, '.gitignore'), 512 * 1024, root))) }); }
      catch { throw new Error('Cannot safely read ignore rules'); }
    }
    for (const e of entries.sort((a, b) => order(a.name, b.name))) {
      const rel = base ? `${base}/${e.name}` : e.name, abs = path.join(dir, e.name);
      if (!within(root, abs)) { reject(rel, 'outside repository'); continue; }
      if (out && within(out, abs)) continue;
      const blocked = safety(e.name, e.isDirectory());
      if (blocked) { reject(rel, blocked); continue; }
      if (submodules.has(rel)) { reject(rel, 'submodule'); continue; }
      if (e.isSymbolicLink()) { reject(rel, 'symlink'); continue; }
      let ignored = false;
      if (!isGit) for (const layer of chain) {
        const local = layer.base ? rel.slice(layer.base.length + 1) : rel;
        const decision = layer.rules.test(local + (e.isDirectory() ? '/' : ''));
        if (decision.ignored) ignored = true;
        else if (decision.unignored) ignored = false;
      }
      if (e.isDirectory()) {
        if (ignored) reject(rel, 'ignore rule');
        else await walk(abs, rel, chain);
      } else if (e.isFile()) pending.push({ rel, abs, ignored });
      else reject(rel, 'not a regular file');
    }
  }
  await walk(root, '', []);
  const ignoredByGit = new Set<string>();
  if (isGit && pending.length) {
    const check = git(root, ['check-ignore', '--no-index', '--stdin', '-z'], pending.map(p => p.rel).join('\0') + '\0');
    if (check.status !== 0 && check.status !== 1) throw new Error('Git ignore check failed');
    check.stdout.split('\0').filter(Boolean).forEach(p => ignoredByGit.add(p));
  }
  for (const { rel, abs, ignored } of pending) {
    if (ignored || ignoredByGit.has(rel) || (inventory && !inventory.has(rel))) { reject(rel, 'ignore rule'); continue; }
    if (exclude(rel)) { reject(rel, 'user exclude'); continue; }
    if (options.include?.length && !include(rel)) { reject(rel, 'outside include allow-list'); continue; }
    let bytes: Buffer, content: string;
    try { bytes = await readRegular(abs, options.maxFileBytes ?? 512 * 1024, root); }
    catch (e: any) { reject(rel, e.message === 'oversized' ? 'oversized' : 'unreadable or changed file'); continue; }
    if (bytes.includes(0)) { reject(rel, 'binary'); continue; }
    try { content = utf8(bytes); } catch { reject(rel, 'invalid UTF-8'); continue; }
    if (/[\x01-\x08\x0e-\x1f]/.test(content)) { reject(rel, 'binary'); continue; }
    if (!await checkedScan(content, scanner)) { reject(rel, 'secret detected'); continue; }
    const file = { path: rel, content, bytes: bytes.length, characters: content.length, hash: hash(bytes), tokens: countTokens(content), pinned: pinPatterns.some(p => p.match(rel)), score: 0, reasons: [] as string[] };
    result.files.push(file);
    result.decisions.push({ path: rel, status: 'eligible', reason: 'eligible', bytes: file.bytes, characters: file.characters, hash: file.hash, tokens: file.tokens });
  }
  result.files.sort((a, b) => order(a.path, b.path));
  result.decisions.sort((a, b) => order(a.path, b.path));
  if (!await checkedScan([result.label, ...result.decisions.map(d => d.path)].join('\n'), scanner)) throw new Error('Secret detected in repository path metadata; export blocked');
  for (const pin of pinPatterns) {
    const blocked = result.decisions.filter(d => d.status === 'excluded' && (pin.match(d.path) || pin.match(d.path + '/') || pin.pattern.startsWith(d.path + '/')));
    if (blocked.length) throw new Error(`Pin ${display(pin.pattern)} matched excluded paths: ${blocked.slice(0, 10).map(d => `${display(d.path)} (${d.reason})`).join(', ')}`);
    if (!result.files.some(f => pin.match(f.path))) throw new Error(`Pin ${display(pin.pattern)} matched no eligible files`);
  }
  return result;
}
