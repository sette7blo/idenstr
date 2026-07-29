import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../src/server.js';
import { TokenStore } from '../src/app/tokenStore.js';
import { closeDbForTests } from '../src/app/db.js';
import { createScheduledPost, listScheduledPosts, publishScheduledPostNow } from '../src/app/scheduledPosts.js';

async function withTempEnv(env, fn) {
  const previous = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  closeDbForTests();
  try {
    return await fn();
  } finally {
    closeDbForTests();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withServer(assertions) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await assertions(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

function auth(token) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

test('scheduled posts can be created, listed, edited, and cancelled through scoped APIs', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'idenstr-schedule-api-'));
  await withTempEnv({ IDENSTR_DB_STORE: join(tempDir, 'idenstr.db') }, async () => {
    const { token } = await new TokenStore().createToken('feedstr-scheduler', ['schedule:read', 'schedule:write']);
    await withServer(async (base) => {
      const publishAt = Math.floor(Date.now() / 1000) + 3600;
      const create = await fetch(`${base}/api/v1/scheduled-posts`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({
          kind: 1,
          content: 'scheduled hello',
          tags: [['t', 'feedstr']],
          publish_at: publishAt,
          timezone: 'Europe/Rome',
          scheduled_local: '2026-07-29T09:00'
        })
      });
      assert.equal(create.status, 201);
      const created = await create.json();
      assert.match(created.id, /^sched_/);
      assert.equal(created.status, 'pending');
      assert.equal(created.publishAt, publishAt);
      assert.equal(created.timezone, 'Europe/Rome');

      const list = await fetch(`${base}/api/v1/scheduled-posts`, { headers: auth(token) });
      assert.equal(list.status, 200);
      assert.equal((await list.json()).scheduledPosts.length, 1);

      const update = await fetch(`${base}/api/v1/scheduled-posts/${created.id}`, {
        method: 'PUT',
        headers: auth(token),
        body: JSON.stringify({ content: 'edited scheduled hello', publish_at: publishAt + 60 })
      });
      assert.equal(update.status, 200);
      const edited = await update.json();
      assert.equal(edited.content, 'edited scheduled hello');
      assert.equal(edited.publishAt, publishAt + 60);

      const cancel = await fetch(`${base}/api/v1/scheduled-posts/${created.id}`, { method: 'DELETE', headers: auth(token) });
      assert.equal(cancel.status, 200);
      assert.equal((await cancel.json()).status, 'cancelled');
    });
  });
});

test('scheduled post APIs enforce schedule scopes and future times', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'idenstr-schedule-scope-'));
  await withTempEnv({ IDENSTR_DB_STORE: join(tempDir, 'idenstr.db') }, async () => {
    const { token } = await new TokenStore().createToken('reader', ['profile:read']);
    await withServer(async (base) => {
      const denied = await fetch(`${base}/api/v1/scheduled-posts`, { headers: auth(token) });
      assert.equal(denied.status, 403);
      assert.equal((await denied.json()).required, 'schedule:read');

      const invalid = await fetch(`${base}/api/v1/scheduled-posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 1, content: 'past', tags: [], publish_at: Math.floor(Date.now() / 1000) - 1 })
      });
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).error, 'invalid_schedule');
    });
  });
});

test('token UI exposes schedule scopes for Feedstr scheduling', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /value="schedule:read"/);
  assert.match(html, /value="schedule:write"/);
});

test('publish-now records a failed scheduled post when signer or relay config is unavailable', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'idenstr-schedule-publish-'));
  await withTempEnv({ IDENSTR_DB_STORE: join(tempDir, 'idenstr.db') }, async () => {
    const post = createScheduledPost({ kind: 1, content: 'publish later', tags: [], publish_at: Math.floor(Date.now() / 1000) + 3600 });
    const result = await publishScheduledPostNow(post.id);
    assert.equal(result.status, 'failed');
    assert.match(result.lastError, /IDENSTR_NSEC is required/);
    assert.equal(listScheduledPosts()[0].status, 'failed');
  });
});
