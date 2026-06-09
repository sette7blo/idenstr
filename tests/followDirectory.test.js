import test from 'node:test';
import assert from 'node:assert/strict';
import { followDirectorySummary } from '../src/app/identity.js';

test('follow directory summary counts cached and missing profiles', () => {
  const following = {
    entries: [{ pubkey: 'a'.repeat(64) }, { pubkey: 'b'.repeat(64) }, { pubkey: 'c'.repeat(64) }],
    directory: {
      ['a'.repeat(64)]: { status: { profileFetch: 'ok' } },
      ['b'.repeat(64)]: { status: { profileFetch: 'missing' } },
      ['c'.repeat(64)]: { status: { profileFetch: 'error' } }
    },
    directoryUpdatedAt: '2026-01-01T00:00:00.000Z'
  };
  assert.deepEqual(followDirectorySummary(following), { total: 3, cached: 1, missing: 2, errors: 1, updatedAt: '2026-01-01T00:00:00.000Z' });
});
