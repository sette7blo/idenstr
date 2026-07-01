import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.IDENSTR_AUTH_USER = 'legacy-user-ignored';
process.env.IDENSTR_AUTH_PASSWORD = 'legacy-password-ignored';
process.env.IDENSTR_ADMIN_TOKEN = 'admin-secret-token';
process.env.IDENSTR_DB_STORE = join(await mkdtemp(join(tmpdir(), 'idenstr-open-dashboard-')), 'idenstr.db');

const { createServer } = await import('../src/server.js');

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

test('health is reachable without credentials', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/system/health`);
    assert.equal(response.status, 200);
  });
});

test('dashboard HTML is open without username/password even when legacy auth env vars exist', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('www-authenticate'), null);
    assert.match(await response.text(), /Idenstr/);
  });
});

test('same-origin dashboard API is open as dashboard admin without Authorization', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/system/info`);
    assert.equal(response.status, 200);
    const info = await response.json();
    assert.equal(info.app, 'idenstr');
  });
});

test('the low-level signing endpoint still requires a bearer token for attribution', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 1, content: 'hi', tags: [] })
    });
    assert.equal(response.status, 401);
  });
});

test('scoped bearer tokens still authenticate and scope-check app-to-app calls', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/system/info`, {
      headers: { authorization: 'Bearer admin-secret-token' }
    });
    assert.equal(response.status, 200);
  });
});

test('an invalid bearer token is rejected instead of falling back to open dashboard admin', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/system/info`, {
      headers: { authorization: 'Bearer not-a-real-token' }
    });
    assert.equal(response.status, 401);
  });
});
