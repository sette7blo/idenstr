import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { muteListTags, normalizeMuteEntry } from '../src/app/mutes.js';
import { getCapabilities } from '../src/app/system.js';

const root = fileURLToPath(new URL('..', import.meta.url));

test('kind 10000 mute entries map to NIP-51 tags', () => {
  const pubkey = 'a'.repeat(64);
  const eventId = 'b'.repeat(64);
  assert.deepEqual(muteListTags([
    { type: 'pubkey', value: pubkey },
    { type: 'thread', value: eventId },
    { type: 'hashtag', value: '#nostr' },
    { type: 'keyword', value: 'spoiler' }
  ]), [
    ['p', pubkey],
    ['e', eventId],
    ['t', 'nostr'],
    ['word', 'spoiler']
  ]);
});

test('Idenstr exposes a first-class mute section and scopes', async () => {
  const html = await readFile(join(root, 'public', 'index.html'), 'utf8');
  const app = await readFile(join(root, 'public', 'app.js'), 'utf8');
  assert.match(html, /section id="mutes"/);
  assert.match(html, /Canonical kind:10000 mute list/);
  assert.match(html, /value="mutes:read"/);
  assert.match(html, /value="mutes:write"/);
  assert.match(app, /renderMutes/);
  assert.match(app, /api\('mutes\/publish'/);
  const capabilities = getCapabilities();
  assert.ok(capabilities.capabilities.includes('mutes.read'));
  assert.ok(capabilities.capabilities.includes('mutes.write'));
});

test('mute entry normalization supports pubkeys, threads, hashtags, and keywords', () => {
  assert.equal(normalizeMuteEntry({ type: 'hashtag', value: '#Nostr' }).value, 'nostr');
  assert.equal(normalizeMuteEntry({ type: 'keyword', value: ' Spoiler ' }).value, 'spoiler');
  assert.equal(normalizeMuteEntry({ type: 'thread', value: 'ABC' }).value, 'abc');
});
