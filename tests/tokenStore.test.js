import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenStore } from '../src/app/tokenStore.js';

test('API tokens are shown once and stored only as hashes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'idenstr-token-'));
  try {
    const store = new TokenStore(join(dir, 'tokens.json'));
    const created = await store.createToken('Feedstr link', ['read:identity', 'read:following']);

    assert.equal(created.name, 'Feedstr link');
    assert.match(created.token, /^ids_[a-zA-Z0-9_-]+$/);

    const listed = await store.listTokens();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, 'Feedstr link');
    assert.equal(Object.hasOwn(listed[0], 'token'), false);
    assert.equal(await store.verifyToken(created.token, 'read:identity'), true);
    assert.equal(await store.verifyToken(created.token, 'write:identity'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('revoked tokens stop authenticating', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'idenstr-token-'));
  try {
    const store = new TokenStore(join(dir, 'tokens.json'));
    const created = await store.createToken('Publishstr link', ['publish:events']);
    assert.equal(await store.verifyToken(created.token, 'publish:events'), true);
    await store.revokeToken(created.id);
    assert.equal(await store.verifyToken(created.token, 'publish:events'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
