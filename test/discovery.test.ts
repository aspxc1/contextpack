import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, symlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { discover } from '../src/discovery.js';
import { fixture, gitRun } from './helpers.js';

test('Git discovery excludes tracked ignored files, nested ignores and secrets before hashing', async t => {
  const root = await fixture(t, {
    '.gitignore': 'ignored.ts\n', 'ignored.ts': 'tracked ignored',
    'src/.gitignore': '*.tmp\n!keep.tmp\n', 'src/no.tmp': 'no', 'src/keep.tmp': 'yes',
    '.env': 'do not read', 'src/auth.ts': 'export const auth = true;',
    'node_modules/a.js': 'dependency', 'dist/a.js': 'build',
  }, true);
  await writeFile(path.join(root, 'new.ts'), 'untracked');
  const before = gitRun(root, ['status', '--porcelain=v1']);
  const result = await discover(root, {});
  assert.equal(result.git?.dirty, true);
  assert.match(result.git!.head!, /^[a-f0-9]{40,64}$/);
  assert.ok(result.files.some(f => f.path === 'new.ts' && f.content === 'untracked'));
  for (const name of ['ignored.ts', 'src/no.tmp', '.env', 'node_modules', 'dist']) {
    const decision = result.decisions.find(d => d.path === name)!;
    assert.equal(decision.status, 'excluded', name);
    assert.equal(decision.hash, undefined, name);
  }
  assert.ok(result.files.some(f => f.path === 'src/keep.tmp'));
  assert.equal(gitRun(root, ['status', '--porcelain=v1']), before);
});

test('ordinary folders reject binary, invalid UTF-8, oversized, custom output and flagged source', async t => {
  const secret = ['AKIA', 'A'.repeat(16)].join('');
  const root = await fixture(t, {
    'hello world ü.ts': 'valid', 'binary.bin': Buffer.from([0, 1, 2]),
    'invalid.ts': Buffer.from([0xc3, 0x28]), 'large.ts': 'x'.repeat(100),
    'custom/context.md': 'old export', 'ordinary.ts': `const token = "${secret}";`,
    '.env.example': 'HOST=localhost',
  });
  const result = await discover(root, { maxFileBytes: 80, out: path.join(root, 'custom') });
  assert.deepEqual(result.files.map(f => f.path), ['.env.example', 'hello world ü.ts']);
  assert.equal(result.decisions.find(d => d.path === 'ordinary.ts')?.reason, 'secret detected');
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(result.git, null);
});

test('pins fail when unmatched or excluded and globs never escape the root', async t => {
  const root = await fixture(t, { 'a.ts': 'a', '.env': 'hidden', 'nested/a.ts': 'nested' });
  await assert.rejects(discover(root, { pin: ['.env'] }), /pin.*excluded/i);
  await assert.rejects(discover(root, { pin: ['missing/**'] }), /pin.*matched no/i);
  await assert.rejects(discover(root, { include: ['../**'] }), /pattern/i);
  const result = await discover(root, { include: ['*.ts'] });
  assert.deepEqual(result.files.map(f => f.path), ['a.ts']);
});

test('scanner exceptions fail closed without leaking their messages', async t => {
  const root = await fixture(t, { 'a.ts': 'safe' });
  await assert.rejects(discover(root, {}, async () => { throw new Error('PRIVATE VALUE'); }), e => {
    assert.match(String(e), /scanner failed/i);
    assert.ok(!String(e).includes('PRIVATE VALUE'));
    return true;
  });
});

test('symlinks are never traversed and submodule contents are excluded', async t => {
  const root = await fixture(t, { 'a.ts': 'safe' }, true);
  await mkdir(path.join(root, 'module'));
  await writeFile(path.join(root, 'module', 'inside.ts'), 'must not include');
  gitRun(root, ['update-index', '--add', '--cacheinfo', `160000,${gitRun(root, ['rev-parse', 'HEAD']).trim()},module`]);
  try { await symlink(root, path.join(root, 'link'), 'junction'); }
  catch (e: any) { if (e.code !== 'EPERM') throw e; }
  const result = await discover(root, {});
  assert.ok(!result.files.some(f => f.path.startsWith('module/') || f.path.startsWith('link/')));
  assert.equal(result.decisions.find(d => d.path === 'module')?.reason, 'submodule');
});

test('Git subdirectory capture stays scoped and unusual names remain distinct', async t => {
  const files: Record<string, string> = {
    'outside.ts': 'outside',
    'app/space ü.ts': 'inside',
    'app/bidi\u202e.ts': 'bidi path',
    'app/.gitignore': 'nested/*.tmp\n', 'app/nested/ignored.tmp': 'ignored',
  };
  if (process.platform !== 'win32') files['app/new\nline\x1b.ts'] = 'control path';
  const root = await fixture(t, files, true);
  await writeFile(path.join(root, 'outside.ts'), 'changed outside');
  const result = await discover(path.join(root, 'app'), {});
  assert.equal(result.git?.dirty, false);
  assert.ok(result.files.some(f => f.path === 'space ü.ts'));
  assert.ok(result.files.some(f => f.path === 'bidi\u202e.ts'));
  assert.ok(!result.files.some(f => f.path.includes('outside') || f.path.endsWith('ignored.tmp')));
  if (process.platform !== 'win32') assert.ok(result.files.some(f => f.path === 'new\nline\x1b.ts'));
});
