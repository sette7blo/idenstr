import test from 'node:test';
import assert from 'node:assert/strict';
import { followListTruth } from '../src/app/identity.js';

const a = 'a'.repeat(64);
const b = 'b'.repeat(64);
const c = 'c'.repeat(64);

function event(pubkeys, created_at = 100) {
  return { id: `event-${created_at}`, kind: 3, created_at, tags: pubkeys.map((pubkey) => ['p', pubkey]), relay: 'wss://relay.example' };
}

test('follow list truth matches by signed kind:3 pubkey set', () => {
  const truth = followListTruth(
    { entries: [{ pubkey: a }, { pubkey: b }], event: { created_at: 100 } },
    [{ relay: 'wss://relay.example', status: 'ok', events: [event([a, b])], latencyMs: 12 }]
  );

  assert.equal(truth.status, 'match');
  assert.equal(truth.score, 100);
  assert.equal(truth.localCount, 2);
  assert.equal(truth.newestPublished.count, 2);
  assert.equal(truth.rows[0].status, 'match');
});

test('follow list truth reports local-only and published-only follows', () => {
  const truth = followListTruth(
    { entries: [{ pubkey: a }, { pubkey: b }], event: { created_at: 100 } },
    [{ relay: 'wss://relay.example', status: 'ok', events: [event([b, c], 101)], latencyMs: 12 }]
  );

  assert.equal(truth.status, 'review');
  assert.equal(truth.score, 0);
  assert.equal(truth.rows[0].status, 'newer-public');
  assert.equal(truth.rows[0].localOnlyCount, 1);
  assert.equal(truth.rows[0].publishedOnlyCount, 1);
  assert.equal(truth.latestComparison.localOnly[0].pubkey, a);
  assert.equal(truth.latestComparison.publishedOnly[0].pubkey, c);
});
