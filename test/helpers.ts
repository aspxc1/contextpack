import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { TestContext } from 'node:test';

export async function fixture(t: TestContext, files: Record<string, string | Buffer>, git = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'contextpack-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  if (git) {
    gitRun(root, ['init', '-q']);
    gitRun(root, ['add', '-f', '.']);
    gitRun(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  }
  return root;
}

export function gitRun(root: string, args: string[]) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
