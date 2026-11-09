import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfiguration } from '../src/config.js';
import { writeOutput } from '../src/output.js';
import { createPack } from '../src/pack.js';
import { fixture, gitRun } from './helpers.js';

const cliPath = path.resolve('src/cli.ts');
const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
const loader = pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href;
function cli(root: string, args: string[]) {
  return spawnSync(process.execPath, [tsx, cliPath, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
}

test('JSON config and profiles are strict, with CLI lists replacing configured lists', async t => {
  const root = await fixture(t, { '.contextpack.json': JSON.stringify({ budget: 5000, focus: ['default'], pin: ['a.ts'], profiles: { auth: { budget: 3000, focus: ['auth'] } } }), 'a.ts': 'safe' });
  const config = await loadConfiguration(root, { profile: 'auth', focus: ['refresh'] });
  assert.equal(config.budget, 3000);
  assert.deepEqual(config.focus, ['refresh']);
  assert.deepEqual(config.pin, ['a.ts']);
  await assert.rejects(loadConfiguration(root, { profile: 'missing' }), /profile/i);
  await writeFile(path.join(root, '.contextpack.json'), '{"bogus": true}');
  await assert.rejects(loadConfiguration(root, {}), /unknown.*configuration/i);
  await writeFile(path.join(root, '.contextpack.json'), '{"profiles":{"x":{"budegt":4}}}');
  await assert.rejects(loadConfiguration(root, {}), /unknown.*configuration/i);
  await writeFile(path.join(root, '.contextpack.json'), '{"budget":0}');
  await assert.rejects(loadConfiguration(root, {}), /budget/i);
});

test('CLI preview writes nothing and agrees with pack, even for custom nested output', async t => {
  const root = await fixture(t, { 'src/auth.ts': 'export const refresh = true;', 'notes.md': 'notes' }, true);
  const args = ['.', '--task', 'Fix refresh', '--focus', 'auth', '--budget', '2000', '--out', './custom/export'];
  const before = await readdir(root);
  const preview = cli(root, ['preview', ...args, '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(await readdir(root), before);
  const proposed = JSON.parse(preview.stdout);
  assert.ok(!preview.stdout.includes('export const refresh'));
  const packed = cli(root, ['pack', ...args]);
  assert.equal(packed.status, 0, packed.stderr);
  const saved = JSON.parse(await readFile(path.join(root, 'custom/export/manifest.json'), 'utf8'));
  assert.equal(saved.document.hash, proposed.document.hash);
  assert.equal(saved.document.tokens, proposed.document.tokens);
  // Ignore output so the captured Git dirty flag stays identical on reruns.
  await writeFile(path.join(root, '.git/info/exclude'), 'custom/\n');
  const again = cli(root, ['pack', ...args]);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(await readFile(path.join(root, 'custom/export/manifest.json'), 'utf8')).document.hash, saved.document.hash);
});

test('CLI validates mutually exclusive task flags, unknown flags and missing paths without echoing data', async t => {
  const root = await fixture(t, { 'a.ts': 'safe', 'task.txt': 'Please inspect a.ts' });
  for (const args of [
    ['preview', '.', '--task', 'x', '--task-file', 'task.txt'],
    ['preview', '.', '--task-file', 'missing.txt'], ['preview', 'missing'],
    ['preview', '.', '--unknown'], ['preview', '.', '--budget', 'NaN'],
  ]) assert.notEqual(cli(root, args).status, 0);
  const taskFile = cli(root, ['preview', '.', '--task-file', 'task.txt', '--json']);
  assert.equal(taskFile.status, 0, taskFile.stderr);
  const secret = 'AKIA' + 'A'.repeat(16);
  const failed = cli(root, ['pack', '.', '--task', secret]);
  assert.notEqual(failed.status, 0);
  assert.ok(!(failed.stdout + failed.stderr).includes(secret));
});

test('failed exports preserve earlier successful output and refuse unrelated directories', async t => {
  const root = await fixture(t, { 'a.ts': 'safe' });
  const out = path.join(root, 'export');
  const result = await createPack(root, { out });
  await writeOutput(out, result);
  const before = await readFile(path.join(out, 'context.md'), 'utf8');
  const failed = cli(root, ['pack', '.', '--budget', '1', '--out', out]);
  assert.notEqual(failed.status, 0);
  assert.equal(await readFile(path.join(out, 'context.md'), 'utf8'), before);
  await mkdir(path.join(root, 'unrelated'));
  await writeFile(path.join(root, 'unrelated', 'important.txt'), 'keep');
  await assert.rejects(writeOutput(path.join(root, 'unrelated'), result), /unrelated|tool-owned/i);
  assert.equal(await readFile(path.join(root, 'unrelated', 'important.txt'), 'utf8'), 'keep');
  assert.ok(!(await readdir(root)).some(n => n.startsWith('.contextpack-tmp-')));
});

test('configuration, task and output links cannot read or overwrite other locations', async t => {
  const root = await fixture(t, { 'a.ts': 'safe', 'target.json': '{"budget":2000}' });
  try { await symlink(path.join(root, 'target.json'), path.join(root, '.contextpack.json')); }
  catch (e: any) { if (e.code === 'EPERM') { t.skip('File symlinks require Windows developer mode or elevation'); return; } throw e; }
  await assert.rejects(loadConfiguration(root, {}), /configuration/i);
  assert.notEqual(cli(root, ['preview', '.', '--task-file', '.contextpack.json']).status, 0);
  const result = await createPack(root, {});
  await mkdir(path.join(root, 'target'));
  await symlink(path.join(root, 'target'), path.join(root, 'export'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(writeOutput(path.join(root, 'export'), result), /link|output/i);
  assert.deepEqual(await readdir(path.join(root, 'target')), []);
});

test('normal capture succeeds with Node network APIs disabled and an external explicit task file', async t => {
  const root = await fixture(t, { 'a.ts': 'safe' });
  const external = await fixture(t, { 'task.txt': 'Inspect the source' });
  const guard = pathToFileURL(path.resolve('test/offline-guard.mjs')).href;
  const result = spawnSync(process.execPath, ['--import', guard, '--import', loader, cliPath, 'preview', root, '--task-file', path.join(external, 'task.txt'), '--json'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).document.tokens > 0);
});

test('backup cleanup failure reports a successful replacement with a recoverable backup', async t => {
  const root = await fixture(t, { 'a.ts': 'first' });
  const out = path.join(root, 'export');
  await writeOutput(out, await createPack(root, { out }));
  await writeFile(path.join(root, 'a.ts'), 'second');
  const fault = pathToFileURL(path.resolve('test/cleanup-fault.mjs')).href;
  const result = spawnSync(process.execPath, ['--import', fault, '--import', loader, cliPath, 'pack', root, '--out', out], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /backup.*cleanup|cleanup.*backup/i);
  assert.ok((await readFile(path.join(out, 'context.md'), 'utf8')).includes('second'));
  assert.ok((await readdir(root)).some(n => n.startsWith('.contextpack-backup-')));
});

test('a directory masquerading as context.md never passes output ownership checks', async t => {
  const root = await fixture(t, { 'a.ts': 'safe' });
  const out = path.join(root, 'export');
  const result = await createPack(root, { out });
  await mkdir(path.join(out, 'context.md'), { recursive: true });
  await writeFile(path.join(out, 'context.md', 'keep.txt'), 'important');
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(result.manifest));
  await assert.rejects(writeOutput(out, result), /tool-owned|unrelated/i);
  assert.equal(await readFile(path.join(out, 'context.md', 'keep.txt'), 'utf8'), 'important');
});
