import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.rm;
fs.rm = async function(target, ...args) {
  if (String(target).includes('.contextpack-backup-')) throw Object.assign(new Error('injected cleanup failure'), { code: 'EPERM' });
  return original.call(this, target, ...args);
};
syncBuiltinESMExports();
