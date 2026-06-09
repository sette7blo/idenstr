import test from 'node:test';
import assert from 'node:assert/strict';
import { profileTruth } from '../src/app/identity.js';

test('profile truth classifies matching, stale, missing, and newer public profile state', () => {
  const localProfile = {
    name: 'sette',
    displayName: 'Sette',
    about: 'local bio',
    website: '',
    picture: 'https://example.com/new.jpg',
    banner: '',
    event: { created_at: 100 }
  };
  const results = [
    { relay: 'wss://match.example', status: 'ok', events: [{ kind: 0, id: 'a'.repeat(64), created_at: 90, content: JSON.stringify({ name: 'sette', display_name: 'Sette', about: 'local bio', picture: 'https://example.com/new.jpg' }) }] },
    { relay: 'wss://stale.example', status: 'ok', events: [{ kind: 0, id: 'b'.repeat(64), created_at: 80, content: JSON.stringify({ name: 'sette', display_name: 'Sette', about: 'old bio' }) }] },
    { relay: 'wss://missing.example', status: 'ok', events: [] },
    { relay: 'wss://newer.example', status: 'ok', events: [{ kind: 0, id: 'c'.repeat(64), created_at: 120, content: JSON.stringify({ name: 'sette', display_name: 'Sette', about: 'new public bio' }) }] }
  ];
  const truth = profileTruth(localProfile, results);
  assert.equal(truth.score, 25);
  assert.equal(truth.matching, 1);
  assert.deepEqual(truth.rows.map((row) => row.status), ['match', 'stale', 'missing', 'newer-public']);
  assert.deepEqual(truth.rows[1].changedFields.sort(), ['about', 'picture']);
});
