#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import { loadConfiguration } from './config.js';
import { createPack } from './pack.js';
import { writeOutput } from './output.js';
import { readRegular, utf8, display } from './util.js';
import type { Rules } from './types.js';

const help = `contextpack — offline repository context attachments

Usage: contextpack <preview|pack> [local-folder] [options]

  --task TEXT           Task description (default: general overview)
  --task-file PATH      Read task from an explicitly named UTF-8 file
  --instructions TEXT   Additional user instructions
  --focus TEXT          Lexical priority (repeatable)
  --pin GLOB            Mandatory eligible whole files (repeatable)
  --include GLOB        Include allow-list (repeatable)
  --exclude GLOB        Additional exclusions (repeatable)
  --profile NAME        Saved profile in root .contextpack.json
  --budget TOKENS       Final o200k_base document budget (default: 20000)
  --max-file-bytes N    File size cap (default: 524288; maximum: 16777216)
  --out DIRECTORY       Export directory (default: <root>/.contextpack)
  --json                Source-free detailed manifest on stdout
  --help                Show this help
  --version             Show version

Glob patterns use / relative to the repository. Quote them literally.
CLI list flags replace their configured lists. Pins cannot override exclusions.
Preview performs the same capture, scan, rank and render without writing files.
`;

async function main() {
  let args;
  try {
    args = parseArgs({ allowPositionals: true, strict: true, options: {
      task: { type: 'string' }, 'task-file': { type: 'string' }, instructions: { type: 'string' },
      focus: { type: 'string', multiple: true }, pin: { type: 'string', multiple: true },
      include: { type: 'string', multiple: true }, exclude: { type: 'string', multiple: true },
      profile: { type: 'string' }, budget: { type: 'string' }, 'max-file-bytes': { type: 'string' },
      out: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
    } });
  } catch { throw new Error('Invalid command arguments; use --help'); }
  const { values: v, positionals } = args;
  if (v.help) { process.stdout.write(help); return; }
  if (v.version) { process.stdout.write('1.0.0\n'); return; }
  const [command, repo = '.'] = positionals;
  if (!['preview', 'pack'].includes(command) || positionals.length > 2) throw new Error('Expected preview or pack and one local folder; use --help');
  if (/^[a-z]+:\/\//i.test(repo)) throw new Error('Only local repository paths are supported');
  if (v.task !== undefined && v['task-file'] !== undefined) throw new Error('--task and --task-file are mutually exclusive');
  const root = path.resolve(repo);
  const explicit: Rules = {};
  for (const key of ['focus', 'pin', 'include', 'exclude', 'profile', 'instructions', 'task'] as const) if (v[key] !== undefined) (explicit as any)[key] = v[key];
  if (v.budget !== undefined) explicit.budget = Number(v.budget);
  if (v['max-file-bytes'] !== undefined) explicit.maxFileBytes = Number(v['max-file-bytes']);
  explicit.out = v.out ? path.resolve(v.out) : path.join(root, '.contextpack');
  if (v['task-file'] !== undefined) {
    try { explicit.task = utf8(await readRegular(path.resolve(v['task-file']), 1024 * 1024)); }
    catch { throw new Error('Cannot safely read task file as regular UTF-8 text (limit 1 MiB)'); }
  }
  const options = await loadConfiguration(root, explicit);
  const result = await createPack(root, options);
  if (command === 'pack') for (const warning of await writeOutput(options.out!, result)) process.stderr.write(`contextpack: ${warning}\n`);
  if (v.json) { process.stdout.write(JSON.stringify(result.manifest, null, 2) + '\n'); return; }
  process.stdout.write(`${command === 'preview' ? 'Preview' : 'Export written'}: ${result.manifest.files.filter((f: any) => f.status === 'included').length} files; ${result.manifest.document.tokens}/${options.budget} ${result.manifest.encoding} tokens\n`);
  for (const d of result.manifest.files) process.stdout.write(`${d.status}: ${display(d.path)} — ${d.reason}${d.reasons ? ` (${d.reasons.join(', ')})` : ''}\n`);
}
main().catch(error => {
  process.stderr.write(`contextpack: ${error instanceof Error ? error.message : 'Operation failed'}\n`);
  process.exitCode = 1;
});
