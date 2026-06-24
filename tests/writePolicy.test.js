import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const policyPath = fileURLToPath(new URL('../relay/write-policy.py', import.meta.url));
const OWNER_NPUB = 'npub1yrshm58vrwcgxf5guuu6mztsn5z8m6era4g5dq3wlhfdy2h9qntsp0ja94';
const OWNER_HEX = '20e17dd0ec1bb0832688e739ad89709d047deb23ed5146822efdd2d22ae504d7';
const FOREIGN_HEX = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

function runPolicy(event, owner = OWNER_NPUB) {
  const env = { ...process.env };
  if (owner === null) delete env.IDENSTR_OWNER_PUBKEY;
  else env.IDENSTR_OWNER_PUBKEY = owner;
  const input = JSON.stringify({ type: 'new', event }) + '\n';
  const result = spawnSync('python3', [policyPath], { input, env, encoding: 'utf8' });
  return JSON.parse(result.stdout.trim());
}

test('owner-signed event is accepted (npub owner)', () => {
  const out = runPolicy({ id: 'e1', pubkey: OWNER_HEX, kind: 1, tags: [], content: 'hi' });
  assert.equal(out.action, 'accept');
});

test('owner config accepts hex as well as npub', () => {
  const out = runPolicy({ id: 'e2', pubkey: OWNER_HEX, kind: 1, tags: [], content: 'hi' }, OWNER_HEX);
  assert.equal(out.action, 'accept');
});

test('event signed by another key is rejected', () => {
  const out = runPolicy({ id: 'e3', pubkey: FOREIGN_HEX, kind: 1, tags: [], content: 'x' });
  assert.equal(out.action, 'reject');
  assert.match(out.msg, /owner key/);
});

test('owner kind 5 deletion is rejected (the vault never forgets)', () => {
  const out = runPolicy({ id: 'e4', pubkey: OWNER_HEX, kind: 5, tags: [], content: '' });
  assert.equal(out.action, 'reject');
  assert.match(out.msg, /deletion/);
});

test('owner event with expiration tag is rejected', () => {
  const out = runPolicy({ id: 'e5', pubkey: OWNER_HEX, kind: 1, tags: [['expiration', '123']], content: '' });
  assert.equal(out.action, 'reject');
  assert.match(out.msg, /expiration/);
});

test('missing owner config fails closed: every write is rejected', () => {
  const out = runPolicy({ id: 'e6', pubkey: OWNER_HEX, kind: 1, tags: [], content: '' }, null);
  assert.equal(out.action, 'reject');
  assert.match(out.msg, /not configured/);
});
