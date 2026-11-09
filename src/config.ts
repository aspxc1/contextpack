import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { readRegular, utf8 } from './util.js';
import { normalize } from './pack.js';
import type { Rules, Options } from './types.js';

const keys = new Set(['include', 'exclude', 'pin', 'focus', 'budget', 'maxFileBytes', 'instructions']);
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validate(value: unknown): Rules {
  if (!object(value)) throw new Error('Configuration must be a JSON object');
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new Error('Unknown configuration key');
  normalize(value as Rules);
  return value as Rules;
}
export async function loadConfiguration(root: string, cli: Rules): Promise<Options> {
  const file = path.join(root, '.contextpack.json');
  let exists = false;
  try { await lstat(file); exists = true; } catch (e: any) { if (e.code !== 'ENOENT') throw new Error('Cannot read configuration'); }
  let base: Rules = {}, profiles: Record<string, Rules> = {};
  if (exists) {
    let parsed: unknown;
    try { parsed = JSON.parse(utf8(await readRegular(file, 512 * 1024, await realpath(root)))); }
    catch { throw new Error('Cannot safely read configuration as plain UTF-8 JSON'); }
    if (!object(parsed)) throw new Error('Configuration must be a JSON object');
    const { profiles: rawProfiles, ...rest } = parsed;
    base = validate(rest);
    if (rawProfiles !== undefined) {
      if (!object(rawProfiles)) throw new Error('Configuration profiles must be an object');
      profiles = Object.create(null);
      for (const [name, profile] of Object.entries(rawProfiles)) profiles[name] = validate(profile);
    }
  }
  if (cli.profile && !Object.hasOwn(profiles, cli.profile)) throw new Error('Unknown configuration profile');
  return normalize({ ...base, ...(cli.profile ? profiles[cli.profile] : {}), ...cli });
}
