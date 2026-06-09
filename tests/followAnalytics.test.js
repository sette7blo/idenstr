import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFollowAnalytics, followAnalyticsSummary, mergeFollowActivityAnalytics } from '../src/app/identity.js';

const me = 'f'.repeat(64);
const a = 'a'.repeat(64);
const b = 'b'.repeat(64);

const now = Math.floor(Date.now() / 1000);

test('follow analytics detects reciprocal follows and activity tiers', () => {
  const analytics = computeFollowAnalytics(
    [{ pubkey: a }, { pubkey: b }],
    [
      { id: 'a-contact', kind: 3, pubkey: a, created_at: now - 100, tags: [['p', me]], relay: 'wss://relay.example' },
      { id: 'b-contact', kind: 3, pubkey: b, created_at: now - 100, tags: [], relay: 'wss://relay.example' },
      { id: 'a-note', kind: 1, pubkey: a, created_at: now - 86400, tags: [], relay: 'wss://relay.example' },
      { id: 'b-note', kind: 1, pubkey: b, created_at: now - 75 * 86400, tags: [], relay: 'wss://relay.example' }
    ],
    [{ status: 'ok' }],
    me
  );

  assert.equal(analytics[a].followsYou, true);
  assert.equal(analytics[a].activityTier, 'very-active');
  assert.equal(analytics[a].counts.posts30d, 1);
  assert.equal(analytics[a].engagement.counts.posts30d, 1);
  assert.equal(analytics[a].engagement.tier, 'light');
  assert.equal(analytics[b].followsYou, false);
  assert.equal(analytics[b].activityTier, 'inactive');

  const summary = followAnalyticsSummary({ entries: [{ pubkey: a }, { pubkey: b }], analytics });
  assert.equal(summary.followsYou, 1);
  assert.equal(summary.oneWay, 1);
  assert.equal(summary.veryActive, 1);
  assert.equal(summary.inactive, 1);
  assert.equal(summary.engagement.light, 1);
});

test('follow analytics measures general account engagement quality, not engagement with me', () => {
  const analytics = computeFollowAnalytics(
    [{ pubkey: a }, { pubkey: b }],
    [
      { id: 'a-note-1', kind: 1, pubkey: a, created_at: now - 86400, tags: [], relay: 'wss://relay.example' },
      { id: 'a-note-2', kind: 1, pubkey: a, created_at: now - 2 * 86400, tags: [], relay: 'wss://relay.example' },
      { id: 'a-repost', kind: 6, pubkey: a, created_at: now - 3 * 86400, tags: [], relay: 'wss://relay.example' },
      { id: 'a-like-1', kind: 7, pubkey: a, created_at: now - 4 * 86400, tags: [], relay: 'wss://relay.example' },
      { id: 'a-like-2', kind: 7, pubkey: a, created_at: now - 5 * 86400, tags: [], relay: 'wss://relay.example' },
      { id: 'a-zap', kind: 9734, pubkey: a, created_at: now - 6 * 86400, tags: [], relay: 'wss://relay.example' },
      { id: 'b-note-old', kind: 1, pubkey: b, created_at: now - 40 * 86400, tags: [], relay: 'wss://relay.example' }
    ],
    [{ status: 'ok', kinds: [1, 6, 7, 9734] }],
    me
  );

  assert.deepEqual(analytics[a].engagement.counts, { posts30d: 2, reposts30d: 1, reactions30d: 2, zaps30d: 1 });
  assert.equal(analytics[a].engagement.score, 14);
  assert.equal(analytics[a].engagement.tier, 'engaged');
  assert.equal(analytics[b].engagement.score, 0);
  assert.equal(analytics[b].engagement.tier, 'low');

  const summary = followAnalyticsSummary({ entries: [{ pubkey: a }, { pubkey: b }], analytics });
  assert.equal(summary.engagement.engaged, 1);
  assert.equal(summary.engagement.low, 1);
});

test('follow analytics separates inactive after 60 days from dormant after 90 days', () => {
  const analytics = computeFollowAnalytics(
    [{ pubkey: a }, { pubkey: b }],
    [
      { id: 'a-contact', kind: 3, pubkey: a, created_at: now - 100, tags: [['p', me]], relay: 'wss://relay.example' },
      { id: 'b-contact', kind: 3, pubkey: b, created_at: now - 100, tags: [], relay: 'wss://relay.example' },
      { id: 'a-note', kind: 1, pubkey: a, created_at: now - 70 * 86400, tags: [], relay: 'wss://relay.example' },
      { id: 'b-note', kind: 1, pubkey: b, created_at: now - 95 * 86400, tags: [], relay: 'wss://relay.example' }
    ],
    [{ status: 'ok', kinds: [1, 6, 7] }],
    me
  );

  assert.equal(analytics[a].activityTier, 'inactive');
  assert.equal(analytics[b].activityTier, 'dormant');

  const summary = followAnalyticsSummary({ entries: [{ pubkey: a }, { pubkey: b }], analytics });
  assert.equal(summary.inactive, 1);
  assert.equal(summary.dormant, 1);
});

test('follow analytics does not call missing recent events dormant without per-author activity evidence', () => {
  const analytics = computeFollowAnalytics(
    [{ pubkey: a }],
    [{ id: 'a-contact', kind: 3, pubkey: a, created_at: now - 100, tags: [['p', me]], relay: 'wss://relay.example' }],
    [{ status: 'ok', kinds: [3] }, { status: 'ok', kinds: [1, 6, 7] }],
    me
  );

  assert.equal(analytics[a].activityStatus, 'not-observed');
  assert.equal(analytics[a].activityTier, 'unknown');

  const summary = followAnalyticsSummary({ entries: [{ pubkey: a }], analytics });
  assert.equal(summary.dormant, 0);
  assert.equal(summary.unknownActivity, 1);
});

test('follow analytics merges targeted fallback activity without changing reciprocity', () => {
  const initial = computeFollowAnalytics(
    [{ pubkey: a }, { pubkey: b }],
    [
      { id: 'a-contact', kind: 3, pubkey: a, created_at: now - 100, tags: [['p', me]], relay: 'wss://relay.example' },
      { id: 'b-contact', kind: 3, pubkey: b, created_at: now - 100, tags: [], relay: 'wss://relay.example' }
    ],
    [{ status: 'ok', kinds: [3] }, { status: 'ok', kinds: [1, 6, 7] }],
    me
  );

  const merged = mergeFollowActivityAnalytics(
    initial,
    [{ pubkey: a }],
    [{ id: 'a-note', kind: 1, pubkey: a, created_at: now - 2 * 86400, tags: [], relay: 'wss://relay.example' }],
    [{ status: 'ok', kinds: [1, 6, 7] }],
    me
  );

  assert.equal(merged[a].followsYou, true);
  assert.equal(merged[a].activityStatus, 'known');
  assert.equal(merged[a].activityTier, 'very-active');
  assert.equal(merged[a].lastPostAt, now - 2 * 86400);
  assert.equal(merged[b].followsYou, false);
  assert.equal(merged[b].activityTier, 'unknown');
});
