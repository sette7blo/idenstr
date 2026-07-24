import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const sk = generateSecretKey();
const pk = getPublicKey(sk);
process.env.IDENSTR_NSEC = nip19.nsecEncode(sk);
process.env.IDENSTR_ADMIN_TOKEN = 'admin-secret-token';
process.env.IDENSTR_DB_STORE = join(await mkdtemp(join(tmpdir(), 'idenstr-dms-')), 'idenstr.db');

const { createServer } = await import('../src/server.js');
const { TokenStore } = await import('../src/app/tokenStore.js');

async function withServer(assertions) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await assertions(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (base, path, token, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(body)
});

test('DM crypto endpoints require bearer-token attribution', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/v1/dms/capabilities`);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'unauthorized');
  });
});

test('DM crypto endpoints enforce narrow scopes', async () => {
  const { token } = await new TokenStore().createToken('reader', ['profile:read']);
  await withServer(async (base) => {
    const res = await post(base, '/api/v1/dms/nip44/encrypt', token, { recipientPubkey: pk, plaintext: 'hi' });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'scope_denied');
    assert.equal(body.required, 'encrypt:nip44');
  });
});

test('NIP-44 encrypt/decrypt roundtrips without exposing nsec', async () => {
  const { token } = await new TokenStore().createToken('dmstr-crypto', ['encrypt:nip44', 'decrypt:nip44']);
  await withServer(async (base) => {
    const enc = await post(base, '/api/v1/dms/nip44/encrypt', token, { recipientPubkey: pk, plaintext: 'hello from DMstr' });
    assert.equal(enc.status, 200);
    const encrypted = await enc.json();
    assert.match(encrypted.payload, /^[A-Za-z0-9+/]+={0,2}$/);
    assert.doesNotMatch(JSON.stringify(encrypted), /nsec1/i);

    const dec = await post(base, '/api/v1/dms/nip44/decrypt', token, { senderPubkey: pk, payload: encrypted.payload });
    assert.equal(dec.status, 200);
    assert.deepEqual(await dec.json(), { plaintext: 'hello from DMstr', peerPubkey: pk });
  });
});

test('NIP-17 wrap/unwrap works behind dms and signing scopes', async () => {
  const { token } = await new TokenStore().createToken('dmstr-writer', ['dms:read', 'dms:write', 'sign:kind:13', 'sign:kind:1059']);
  await withServer(async (base) => {
    const wrapped = await post(base, '/api/v1/dms/wrap', token, { recipientPubkey: pk, message: 'sealed hello' });
    assert.equal(wrapped.status, 200);
    const body = await wrapped.json();
    assert.equal(body.count, 1);
    assert.equal(body.events[0].kind, 1059);
    assert.doesNotMatch(JSON.stringify(body), /sealed hello/);

    const unwrapped = await post(base, '/api/v1/dms/unwrap', token, { event: body.events[0] });
    assert.equal(unwrapped.status, 200);
    const clear = await unwrapped.json();
    assert.equal(clear.event.kind, 14);
    assert.equal(clear.event.content, 'sealed hello');
  });
});
