import { discover } from './discovery.js';
import { rank } from './ranking.js';
import { render } from './render.js';
import { checkedScan, scan, countTokens, encoding, versions } from './security.js';
import { hash, matcher } from './util.js';
import type { Rules, Options, PackResult, Scanner } from './types.js';

export const defaults: Options = { include: [], exclude: [], pin: [], focus: [], budget: 20000, maxFileBytes: 512 * 1024, task: '', instructions: '' };
export function normalize(input: Rules): Options {
  const options = { ...defaults, ...input };
  for (const key of ['budget', 'maxFileBytes'] as const) {
    if (!Number.isSafeInteger(options[key]) || options[key] <= 0 || (key === 'maxFileBytes' && options[key] > 16 * 1024 * 1024)) throw new Error(`Invalid ${key}`);
  }
  for (const key of ['task', 'instructions'] as const) if (typeof options[key] !== 'string' || options[key].length > 1024 * 1024) throw new Error(`Invalid ${key}`);
  for (const key of ['include', 'exclude', 'pin', 'focus'] as const) {
    if (!Array.isArray(options[key]) || options[key].some(v => typeof v !== 'string' || !v.length)) throw new Error(`Invalid ${key}`);
    options[key] = [...new Set(options[key])];
    if (key !== 'focus') matcher(options[key]);
  }
  return options;
}
export async function createPack(root: string, input: Rules, scanner: Scanner = scan): Promise<PackResult> {
  const options = normalize(input);
  // Scan user-controlled text before it reaches errors, reports, or rendering.
  if (!await checkedScan([options.task, options.instructions, ...options.focus, ...options.pin, ...options.include, ...options.exclude].join('\n'), scanner)) throw new Error('Secret detected in task, instructions or selection rules; export blocked');
  const snapshot = await discover(root, options, scanner);
  // Paths and the repository label are exported too.
  if (!await checkedScan([snapshot.label, ...snapshot.decisions.map(d => d.path)].join('\n'), scanner)) throw new Error('Secret detected in repository path metadata; export blocked');
  const ranked = rank(snapshot.files, options);
  const selected = new Set(ranked.filter(f => f.pinned).map(f => f.path));
  let listingLimit = 20;
  let context = render(snapshot, selected, options, listingLimit);
  while (countTokens(context) > options.budget && listingLimit > 0) {
    listingLimit = listingLimit === 20 ? 5 : 0;
    context = render(snapshot, selected, options, listingLimit);
  }
  if (countTokens(context) > options.budget) throw new Error(selected.size ? 'Pinned files plus required metadata exceed budget; increase --budget or adjust pins' : 'Required metadata exceeds budget; increase --budget');
  for (const file of ranked.filter(f => !f.pinned)) {
    selected.add(file.path);
    const candidate = render(snapshot, selected, options, listingLimit);
    if (countTokens(candidate) <= options.budget) context = candidate;
    else selected.delete(file.path);
  }
  context = render(snapshot, selected, options, listingLimit);
  const tokens = countTokens(context);
  if (tokens > options.budget) throw new Error('Final document exceeded budget');
  if (!await checkedScan(context, scanner)) throw new Error('Secret detected in rendered document; export blocked');
  const fileMap = new Map(snapshot.files.map(f => [f.path, f]));
  const decisions = snapshot.decisions.map(d => {
    const f = fileMap.get(d.path);
    return f ? { ...d, status: selected.has(f.path) ? 'included' : 'omitted', reason: selected.has(f.path) ? 'selected by ranking' : 'budget', score: f.score, reasons: f.reasons } : d;
  });
  const { task, instructions, out, ...effective } = options;
  return { context, manifest: {
    schemaVersion: 1, versions, encoding, budget: options.budget,
    configuration: { ...effective, instructionsHash: hash(instructions) },
    task: { kind: task ? 'task-specific' : 'general-overview', hash: hash(task) },
    profile: options.profile ?? null, repository: { label: snapshot.label, git: snapshot.git, capture: 'sequential working-tree view; not atomic' },
    document: { hash: hash(context), tokens, bytes: Buffer.byteLength(context), characters: context.length },
    files: decisions,
  } };
}
