import test from 'node:test';
import assert from 'node:assert/strict';
import { scan, countTokens } from '../src/security.js';

test('real tokenizer counts plain text and literal special tokens', () => {
  assert.equal(countTokens('hello world'), 2);
  assert.ok(countTokens('<|endoftext|>') > 0);
});

test('scanner detects a synthetic credential without returning matched values', async () => {
  const credential = ['AKIA', 'A'.repeat(16)].join('');
  assert.equal(await scan(`const key = "${credential}";`), false);
  assert.equal(await scan('export const enabled = true;'), true);
});
