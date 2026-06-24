import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.IDENSTR_AUTH_USER = 'tester';
process.env.IDENSTR_AUTH_PASSWORD = 'secret-pass';
process.env.IDENSTR_ADMIN_TOKEN = 'admin-secret-token';
process.env.IDENSTR_DB_STORE = join(await mkdtemp(join(tmpdir(), 'idenstr-auth-')), 'idenstr.db');

const { createServer, authConfigured, isLoopbackBind } = await import('../src/server.js');

function basic(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
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

test('authConfigured reflects the presence of dashboard credentials', () => {
  assert.equal(authConfigured(), true);
});

test('isLoopbackBind treats only loopback addresses as local-only', () => {
  assert.equal(isLoopbackBind('127.0.0.1'), true);
  assert.equal(isLoopbackBind('localhost'), true);
  assert.equal(isLoopbackBind(''), true);
  assert.equal(isLoopbackBind('0.0.0.0'), false);
  assert.equal(isLoopbackBind('100.89.97.65'), false);
  assert.equal(isLoopbackBind('192.168.1.10'), false);
});

test('health is reachable without credentials', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/system/health`);
    assert.equal(response.status, 200);
  });
});

test('protected API without credentials returns 401 and a Basic challenge', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/system/info`);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate') ?? '', /^Basic /);
  });
});

test('the dashboard HTML is also gated behind Basic auth', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate') ?? '', /^Basic /);
  });
});

test('correct Basic credentials unlock the dashboard and API', async () => {
  await withServer(async (baseUrl) => {
    const headers = { authorization: basic('tester', 'secret-pass') };
    const api = await fetch(`${baseUrl}/api/v1/system/info`, { headers });
    assert.equal(api.status, 200);
    const info = await api.json();
    assert.equal(info.app, 'idenstr');

    const page = await fetch(`${baseUrl}/`, { headers });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Idenstr/);
  });
});

test('wrong Basic credentials are rejected', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/system/info`, {
      headers: { authorization: basic('tester', 'wrong') }
    });
    assert.equal(response.status, 401);
  });
});

test('scoped bearer tokens still authenticate alongside Basic auth', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/system/info`, {
      headers: { authorization: 'Bearer admin-secret-token' }
    });
    assert.equal(response.status, 200);
  });
});

test('an invalid bearer token is rejected even when Basic auth is configured', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/system/info`, {
      headers: { authorization: 'Bearer not-a-real-token' }
    });
    assert.equal(response.status, 401);
  });
});
