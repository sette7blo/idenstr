import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getHealth } from '../src/app/system.js';

test('default key custody is .env nsec, not signer or docker secret', async () => {
  const health = getHealth({ privateRelayUrl: 'ws://private-relay:8080' });
  assert.equal(health.keyMode, 'env_nsec');

  const envExample = await readFile(new URL('../../infra/.env.example', import.meta.url), 'utf8');
  assert.match(envExample, /IDENSTR_KEY_MODE=env_nsec/);
  assert.match(envExample, /IDENSTR_NSEC=/);
  assert.doesNotMatch(envExample, /watch_only/);
  assert.doesNotMatch(envExample, /docker_secret/);
  assert.match(envExample, /No signer/);
});

test('architecture docs mark signer as intentionally out of scope', async () => {
  const architecture = await readFile(new URL('../docs/architecture.md', import.meta.url), 'utf8');
  assert.match(architecture, /\.env/);
  assert.match(architecture, /No signer/);
  assert.match(architecture, /same-host signer is redundant/);
});
