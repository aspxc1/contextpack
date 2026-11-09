import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshSession } from '../src/auth/refresh.ts';

test('revoked sessions cannot refresh', () => {
  assert.throws(() => refreshSession({ userId: 'demo', expiresAt: 2000, revoked: true }, 1000));
});
