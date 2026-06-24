import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.IDENSTR_DB_STORE = join(await mkdtemp(join(tmpdir(), 'idenstr-pub-')), 'idenstr.db');
process.env.IDENSTR_ADMIN_TOKEN = 'admin-secret-token';

const { createServer } = await import('../src/server.js');
const { TokenStore } = await import('../src/app/tokenStore.js');

async function withServer(assertions) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await assertions(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

const publish = (base, token, event) => fetch(`${base}/api/v1/events/publish`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(event)
});

test('a token with publish:kind:1 passes the publish authorization gate', async () => {
  const { token } = await new TokenStore().createToken('workstr', ['publish:kind:1']);
  await withServer(async (base) => {
    const res = await publish(base, token, { kind: 1, content: 'hi', tags: [] });
    const body = await res.json();
    // Authorization passes; it may then fail on signer/relay config in the test env,
    // but it must NOT be a scope denial.
    assert.notEqual(res.status, 403);
    assert.notEqual(body.error, 'scope_denied');
  });
});

test('a token without a publish scope is denied with the required scope', async () => {
  const { token } = await new TokenStore().createToken('reader', ['profile:read']);
  await withServer(async (base) => {
    const res = await publish(base, token, { kind: 1, content: 'hi', tags: [] });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'scope_denied');
    assert.equal(body.required, 'publish:kind:1');
  });
});

test('scoped tokens cannot publish Idenstr-owned identity kinds', async () => {
  const { token } = await new TokenStore().createToken('workstr2', ['publish:events']);
  await withServer(async (base) => {
    const res = await publish(base, token, { kind: 3, content: '', tags: [] });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'owned_kind_denied');
  });
});
