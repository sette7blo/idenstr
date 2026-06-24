import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../src/server.js';
import { TokenStore } from '../src/app/tokenStore.js';
import { bech32Encode, convertBits } from '../src/app/state.js';

async function withTempEnv(env, fn) {
  const previous = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

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

test('tokenless requests get the dashboard, but signing always needs a token', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'idenstr-auth-'));
  await withTempEnv({
    IDENSTR_DB_STORE: join(tempDir, 'idenstr.db')
  }, async () => {
    await withServer(async (baseUrl) => {
      const health = await fetch(`${baseUrl}/api/v1/system/health`);
      assert.equal(health.status, 200);

      const dashboard = await fetch(`${baseUrl}/api/v1/dashboard`);
      assert.equal(dashboard.status, 200);

      const mutation = await fetch(`${baseUrl}/api/v1/profile`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'dashboard-user', displayName: 'Dashboard User' })
      });
      assert.equal(mutation.status, 200);

      const sign = await fetch(`${baseUrl}/api/v1/sign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'hello' })
      });
      assert.equal(sign.status, 401);
    });
  });
});

test('presented tokens are always validated, even though tokenless is allowed', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'idenstr-token-validate-'));
  await withTempEnv({
    IDENSTR_DB_STORE: join(tempDir, 'idenstr.db'),
    IDENSTR_ADMIN_TOKEN: 'admin-secret'
  }, async () => {
    await withServer(async (baseUrl) => {
      const badToken = await fetch(`${baseUrl}/api/v1/dashboard`, {
        headers: { authorization: 'Bearer idstr_not-a-real-token' }
      });
      assert.equal(badToken.status, 401);

      const adminToken = await fetch(`${baseUrl}/api/v1/dashboard`, {
        headers: { authorization: 'Bearer admin-secret' }
      });
      assert.equal(adminToken.status, 200);
    });
  });
});

test('insufficient token scope returns 403 with required scope', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'idenstr-scope-'));
  await withTempEnv({ IDENSTR_DB_STORE: join(tempDir, 'idenstr.db') }, async () => {
    const store = new TokenStore(join(tempDir, 'tokens-ignored.json'));
    const created = await store.createToken('feedstr', ['relays:read']);
    await withTempEnv({
      IDENSTR_DB_STORE: join(tempDir, 'idenstr.db')
    }, async () => {
      await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/profile`, {
          headers: { authorization: `Bearer ${created.token}` }
        });
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error: 'scope_denied', required: 'profile:read' });
      });
    });
  });
});

test('token store uses idstr prefix, hashes tokens, and persists last use in sqlite', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'idenstr-token-'));
  await withTempEnv({ IDENSTR_DB_STORE: join(tempDir, 'idenstr.db') }, async () => {
    const store = new TokenStore(join(tempDir, 'legacy-token-path.json'));
    const created = await store.createToken('feedstr', ['profile:read']);
    assert.match(created.token, /^idstr_[A-Za-z0-9_-]{43}$/);
    assert.equal(await store.verifyToken(created.token, 'profile:read'), true);
    const listed = await store.listTokens();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, 'feedstr');
    assert.ok(listed[0].lastUsedAt);
    assert.equal(Object.hasOwn(listed[0], 'tokenHash'), false);
  });
});

test('json state migrates into sqlite and old file is renamed migrated', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'idenstr-migrate-'));
  const statePath = join(tempDir, 'idenstr-state.json');
  await writeFile(statePath, JSON.stringify({ profile: { name: 'migrated' }, audit: [] }));
  await withTempEnv({ IDENSTR_STATE_STORE: statePath, IDENSTR_DB_STORE: join(tempDir, 'idenstr.db') }, async () => {
    const { loadState, saveState } = await import(`../src/app/state.js?migrate=${Date.now()}`);
    const state = await loadState();
    assert.equal(state.profile.name, 'migrated');
    state.profile.name = 'sqlite';
    await saveState(state);
    const migrated = await readFile(`${statePath}.migrated`, 'utf8');
    assert.match(migrated, /migrated/);
    const reloaded = await loadState();
    assert.equal(reloaded.profile.name, 'sqlite');
  });
});

test('sign endpoint refuses to release signed event when local vault is unavailable', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'idenstr-sign-'));
  await withTempEnv({ IDENSTR_DB_STORE: join(tempDir, 'idenstr.db') }, async () => {
    const store = new TokenStore(join(tempDir, 'ignored.json'));
    const token = await store.createToken('feedstr', ['sign:kind:1']);
    await withTempEnv({
      IDENSTR_DB_STORE: join(tempDir, 'idenstr.db'),
      IDENSTR_NSEC: testNsec(),
      IDENSTR_PRIVATE_RELAY_URL: 'ws://127.0.0.1:9'
    }, async () => {
      await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/sign`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'hello' })
        });
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: 'vault_unavailable' });
      });
    });
  });
});

function testNsec() {
  return bech32Encode('nsec', convertBits([...Buffer.from('01'.repeat(32), 'hex')], 8, 5, true));
}
