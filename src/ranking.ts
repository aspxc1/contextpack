import path from 'node:path';
import { order } from './util.js';
import type { CapturedFile, Options } from './types.js';

const terms = (text: string) => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? []).filter(t => !new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'fix']).has(t)))].slice(0, 40);
const stem = (p: string) => path.posix.basename(p).replace(/\.[^.]+$/, '').replace(/\.(test|spec)$/, '').toLowerCase();

export function rank(files: CapturedFile[], options: Options): CapturedFile[] {
  const taskTerms = terms(options.task);
  const entrypoints = new Set<string>();
  for (const f of files.filter(f => path.posix.basename(f.path) === 'package.json')) {
    try {
      const pkg = JSON.parse(f.content);
      for (const value of [pkg.main, pkg.module, ...(typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {}))]) {
        if (typeof value === 'string') entrypoints.add(path.posix.normalize(path.posix.join(path.posix.dirname(f.path), value)));
      }
    } catch { /* A malformed manifest remains ordinary source. */ }
  }
  for (const f of files) {
    let score = 0; const reasons: string[] = [];
    const add = (value: number, reason: string) => { score += value; reasons.push(reason); };
    const p = f.path.toLowerCase(), text = f.content.toLowerCase();
    if (f.pinned) add(10000, 'pinned');
    if (options.focus.some(s => p.includes(s.toLowerCase()))) add(100, 'focus path match');
    if (options.focus.some(s => text.includes(s.toLowerCase()))) add(35, 'focus text match');
    const pathHits = taskTerms.filter(t => p.includes(t)).length;
    const textHits = taskTerms.filter(t => text.includes(t)).length;
    if (pathHits) add(Math.min(60, pathHits * 15), 'task path match');
    if (textHits) add(Math.min(30, textHits * 5), 'task text match');
    if (/(^|\/)readme(?:\.[^/]*)?$/.test(p)) add(55, 'project readme');
    if (/(^|\/)(package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|requirements\.txt|composer\.json|gemfile)$/.test(p)) add(60, 'project manifest');
    if (/(^|\/)(tsconfig[^/]*\.json|dockerfile|compose\.ya?ml|makefile|\.github\/workflows\/[^/]+)$/.test(p)) add(20, 'project configuration');
    if (entrypoints.has(f.path)) add(50, 'declared entrypoint');
    if (/\.(ts|tsx|js|jsx|mjs|py|go|rs|java|c|cpp|h|cs|rb|php|sql|graphql|prisma)$/.test(p)) add(5, 'source file');
    f.score = score; f.reasons = reasons.length ? reasons : ['other eligible file'];
  }
  const anchors = files.filter(f => f.pinned || f.reasons.some(r => r === 'focus path match' || r === 'task path match'));
  for (const f of files) {
    if (/(?:test|spec|schema)/i.test(f.path) && anchors.some(a => a !== f && stem(a.path) === stem(f.path))) {
      f.score += 40; f.reasons.push('related test or schema');
    }
  }
  return [...files].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.score - a.score || order(a.path, b.path));
}
