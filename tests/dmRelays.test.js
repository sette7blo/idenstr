import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const sk = generateSecretKey();
getPublicKey(sk);
process.env.IDENSTR_NSEC = nip19.nsecEncode(sk);
process.env.IDENSTR_ADMIN_TOKEN = 'admin-secret-token';
process.env.IDENSTR_DB_STORE = join(await mkdtemp(join(tmpdir(), 'idenstr-dmrelays-')), 'idenstr.db');

const { createServer } = await import('../src/server.js');
const { TokenStore } = await import('../src/app/tokenStore.js');

async function withServer(fn) {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try { await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((r) => server.close(r)); }
}

const admin = (base, path, method, body) => fetch(`${base}${path}`, {
  method,
  headers: { 'content-type': 'application/json', authorization: 'Bearer admin-secret-token' },
  body: body ? JSON.stringify(body) : undefined
});

test('DM relays (kind:10050) save, persist, and expose separately from read/write', async () => {
  await withServer(async (base) => {
    const put = await admin(base, '/api/v1/relays', 'PUT', {
      read: 'wss://relay.damus.io',
      write: 'wss://relay.damus.io',
      dm: 'wss://relay.damus.io\nwss://nos.lol'
    });
    assert.equal(put.status, 200);
    const saved = await put.json();
    assert.equal(saved.dm.length, 2);
    assert.ok(saved.dm.includes('wss://relay.damus.io') && saved.dm.includes('wss://nos.lol'));
    assert.equal(saved.dmEvent.kind, 10050);

    const got = await (await admin(base, '/api/v1/relays', 'GET')).json();
    assert.equal(got.dm.length, 2);
    assert.equal(got.dmEvent.kind, 10050);
  });
});

test('a read/write-only save preserves existing DM relays (no wipe on toggle)', async () => {
  await withServer(async (base) => {
    await admin(base, '/api/v1/relays', 'PUT', { read: 'wss://relay.damus.io', write: 'wss://relay.damus.io', dm: 'wss://nos.lol' });
    // Save again WITHOUT dm, as a read/write-only toggle would.
    const saved = await (await admin(base, '/api/v1/relays', 'PUT', { read: 'wss://relay.primal.net', write: 'wss://relay.primal.net' })).json();
    assert.deepEqual(saved.dm, ['wss://nos.lol']);
  });
});

test('the generic publish endpoint rejects the owned DM-relay kind (10050) for scoped tokens', async () => {
  const { token } = await new TokenStore().createToken('dmstr-pub', ['publish:events']);
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/v1/events/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: 10050, tags: [['relay', 'wss://nos.lol']], content: '' })
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'owned_kind_denied');
  });
});
