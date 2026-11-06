import { test } from 'node:test';
import * as assert from 'node:assert';
import { canonicalJson, sign } from './protocol';

test('canonical JSON matches the app contract (sorted keys)', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}');
});

test('signing is deterministic and payload-sensitive', () => {
  const secret = 'ab'.repeat(32);
  const a = sign(secret, 1000, 'n1', { title: 'npm test' });
  assert.equal(a, sign(secret, 1000, 'n1', { title: 'npm test' }));
  assert.notEqual(a, sign(secret, 1000, 'n1', { title: 'evil' }));
});
