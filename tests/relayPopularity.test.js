import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFollowingRelayPopularity } from '../src/app/identity.js';

test('computes local relay popularity and top missing relay suggestions from follow relay lists', () => {
  const follows = [
    { pubkey: 'a'.repeat(64) },
    { pubkey: 'b'.repeat(64) },
    { pubkey: 'c'.repeat(64) }
  ];
  const events = [
    { pubkey: 'a'.repeat(64), kind: 10002, created_at: 10, tags: [['r', 'wss://relay.one', 'read'], ['r', 'wss://relay.shared', 'write']] },
    { pubkey: 'b'.repeat(64), kind: 10002, created_at: 11, tags: [['r', 'wss://relay.one/', 'write'], ['r', 'wss://relay.missing', 'read']] },
    { pubkey: 'c'.repeat(64), kind: 10002, created_at: 12, tags: [['r', 'wss://relay.missing', 'read']] }
  ];
  const popularity = computeFollowingRelayPopularity({ read: ['wss://relay.one'], write: ['wss://relay.shared'] }, follows, events, []);
  assert.equal(popularity.queryableFollows, 3);
  assert.equal(popularity.followsWithRelayLists, 3);
  assert.deepEqual(popularity.local.map((row) => [row.url, row.fraction, row.tier]), [
    ['wss://relay.one', '2/3', 'high'],
    ['wss://relay.shared', '1/3', 'common']
  ]);
  assert.equal(popularity.suggestions[0].url, 'wss://relay.missing');
  assert.equal(popularity.suggestions[0].fraction, '2/3');
});
