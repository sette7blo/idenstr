import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('compose separates container bind from host bind so Docker port publishing works', async () => {
  const compose = await readFile(new URL('../compose.yaml', import.meta.url), 'utf8');
  assert.match(compose, /IDENSTR_BIND_HOST:\s*0\.0\.0\.0/);
  assert.match(compose, /\$\{IDENSTR_HOST_BIND:-0\.0\.0\.0\}:\$\{IDENSTR_HOST_PORT:-3000\}:3000/);
  assert.doesNotMatch(compose, /\$\{IDENSTR_BIND_HOST:-127\.0\.0\.1\}:\$\{IDENSTR_HOST_PORT:-3000\}:3000/);
});

test('compose pins relay writes to the owner key via IDENSTR_NPUB', async () => {
  const compose = await readFile(new URL('../compose.yaml', import.meta.url), 'utf8');
  assert.match(compose, /IDENSTR_OWNER_PUBKEY:\s*\$\{IDENSTR_NPUB:-\}/);
});
