import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../src/server.js';

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

test('root route serves the cyberpunk dashboard HTML', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Idenstr/);
    assert.match(html, /sovereign/i);
  });
});

test('stylesheet route serves CSS assets', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/styles.css`);
    const css = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/css/);
    assert.match(css, /--sovereign-purple/);
  });
});

test('dashboard APIs expose usable identity features without nsec leakage', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'idenstr-test-'));
  process.env.IDENSTR_STATE_STORE = join(tempDir, 'state.json');
  process.env.IDENSTR_DB_STORE = join(tempDir, 'idenstr.db');
  process.env.IDENSTR_ADMIN_TOKEN = 'admin-secret';
  await withServer(async (baseUrl) => {
    const headers = { authorization: 'Bearer admin-secret' };
    const identityResponse = await fetch(`${baseUrl}/api/v1/identity`, { headers });
    const identity = await identityResponse.json();
    assert.equal(identityResponse.status, 200);
    assert.equal(identity.secretExposed, false);
    assert.equal(Object.hasOwn(identity, 'nsec'), false);

    const profileResponse = await fetch(`${baseUrl}/api/v1/profile`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'sette', displayName: 'Sette', about: 'Nostr profile draft', banner: 'https://example.com/banner.jpg' })
    });
    const profile = await profileResponse.json();
    assert.equal(profileResponse.status, 200);
    assert.equal(profile.name, 'sette');
    assert.equal(profile.banner, 'https://example.com/banner.jpg');
    assert.equal(profile.event.kind, 0);

    const followResponse = await fetch(`${baseUrl}/api/v1/following`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ pubkey: 'a'.repeat(64), petname: 'example' })
    });
    const follow = await followResponse.json();
    assert.equal(followResponse.status, 201);
    assert.equal(follow.petname, 'example');

    const saveFollowingResponse = await fetch(`${baseUrl}/api/v1/following/save`, { method: 'POST', headers });
    const savedFollowing = await saveFollowingResponse.json();
    assert.equal(saveFollowingResponse.status, 200);
    assert.equal(savedFollowing.following.event.kind, 3);
    assert.equal(savedFollowing.following.event.status, 'draft-local');
  });
});
