import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../src/server.js';
import { cleanMoneroAddress, isPaymentTargetManaged, moneroTargetFromEvent, paymentTargetRelayState, paymentTargetRelayStatus, paymentTargetTags, updateMoneroTargetTags } from '../src/app/paymentTargets.js';

const VALID_XMR = `8${'A'.repeat(94)}`;
const OTHER_XMR = `4${'B'.repeat(94)}`;

async function withServer(assertions) {
  const tempDir = await mkdtemp(join(tmpdir(), 'idenstr-payment-targets-'));
  process.env.IDENSTR_STATE_STORE = join(tempDir, 'state.json');
  process.env.IDENSTR_DB_STORE = join(tempDir, 'idenstr.db');
  process.env.IDENSTR_ADMIN_TOKEN = 'admin-secret';
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await assertions(`http://127.0.0.1:${port}`, { authorization: 'Bearer admin-secret', 'content-type': 'application/json' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Monero payment-target helpers parse and preserve NIP-A3 payto tags', () => {
  assert.equal(cleanMoneroAddress(VALID_XMR), VALID_XMR);
  assert.equal(cleanMoneroAddress('not-a-monero-address'), '');
  assert.deepEqual(paymentTargetTags({ moneroAddress: VALID_XMR }), [['payto', 'monero', VALID_XMR]]);
  assert.deepEqual(paymentTargetTags({ moneroAddress: VALID_XMR, extraTags: [['payto', 'bitcoin', 'bc1qabc']] }), [['payto', 'bitcoin', 'bc1qabc'], ['payto', 'monero', VALID_XMR]]);
  assert.deepEqual(paymentTargetTags({ moneroAddress: 'bad' }), []);

  const event = { kind: 10133, tags: [['payto', 'bitcoin', 'bc1qabc'], ['payto', 'xmr', OTHER_XMR]] };
  assert.deepEqual(moneroTargetFromEvent(event), { type: 'xmr', address: OTHER_XMR });

  assert.deepEqual(
    updateMoneroTargetTags([['payto', 'bitcoin', 'bc1qabc'], ['payto', 'monero', OTHER_XMR]], VALID_XMR),
    [['payto', 'bitcoin', 'bc1qabc'], ['payto', 'monero', VALID_XMR]]
  );
});

test('payment-target dashboard API saves kind:10133 Monero draft without leaking secrets', async () => {
  await withServer(async (baseUrl, headers) => {
    const getInitial = await fetch(`${baseUrl}/api/v1/payment-targets`, { headers });
    const initial = await getInitial.json();
    assert.equal(getInitial.status, 200);
    assert.equal(initial.event.kind, 10133);
    assert.equal(initial.moneroAddress, '');

    const invalidResponse = await fetch(`${baseUrl}/api/v1/payment-targets`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ moneroAddress: 'definitely-invalid' })
    });
    const invalid = await invalidResponse.json();
    assert.equal(invalidResponse.status, 200);
    assert.equal(invalid.moneroAddress, '');
    assert.equal(invalid.event.kind, 10133);

    const saveResponse = await fetch(`${baseUrl}/api/v1/payment-targets`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ moneroAddress: VALID_XMR })
    });
    const saved = await saveResponse.json();
    assert.equal(saveResponse.status, 200);
    assert.equal(saved.moneroAddress, VALID_XMR);
    assert.equal(saved.event.kind, 10133);
    assert.equal(Object.hasOwn(saved, 'nsec'), false);
  });
});

function relayResult(url, status, events = []) {
  return { relay: url, status, events, latencyMs: 12 };
}

function paymentTargetEvent(address, id = 'abc123') {
  return { id, kind: 10133, created_at: 1_700_000_000, tags: [['payto', 'monero', address]] };
}

test('relay state stays silent while no Monero payment target is managed', () => {
  const empty = { moneroAddress: '', event: { kind: 10133, signed: false } };
  assert.equal(isPaymentTargetManaged(empty), false);
  assert.equal(paymentTargetRelayState(empty, relayResult('wss://a.example', 'ok', [])), 'none');

  const status = paymentTargetRelayStatus(empty, [relayResult('wss://a.example', 'ok', []), relayResult('wss://b.example', 'timeout')]);
  assert.equal(status.managed, false);
  assert.deepEqual([status.current, status.stale, status.missing, status.unknown], [0, 0, 0, 0]);
  assert.deepEqual(status.relays.map((row) => row.state), ['none', 'none']);
  assert.equal(status.publishedElsewhere, 0);

  // An unmanaged identity whose relays still hold a kind:10133 is reported as
  // importable, never as a missing or stale target.
  const withPublished = paymentTargetRelayStatus(empty, [relayResult('wss://a.example', 'ok', [paymentTargetEvent(VALID_XMR, 'published-elsewhere')])]);
  assert.equal(withPublished.publishedElsewhere, 1);
  assert.deepEqual([withPublished.stale, withPublished.missing], [0, 0]);
  assert.equal(withPublished.relays[0].state, 'none');
});

test('relay state reports current, stale, missing, and unreachable per relay', () => {
  const managed = { moneroAddress: VALID_XMR, event: { id: 'signed-event-id', kind: 10133, signed: true, created_at: 1_700_000_100 } };

  assert.equal(paymentTargetRelayState(managed, relayResult('wss://same.example', 'ok', [paymentTargetEvent(VALID_XMR, 'signed-event-id')])), 'current');
  // A different event id still counts as current when it serves the same address.
  assert.equal(paymentTargetRelayState(managed, relayResult('wss://other.example', 'ok', [paymentTargetEvent(VALID_XMR, 'older-event-id')])), 'current');
  assert.equal(paymentTargetRelayState(managed, relayResult('wss://stale.example', 'ok', [paymentTargetEvent(OTHER_XMR, 'stale-event-id')])), 'stale');
  assert.equal(paymentTargetRelayState(managed, relayResult('wss://missing.example', 'ok', [{ id: 'x', kind: 0, tags: [] }])), 'missing');
  // A relay that never answered is unknown, not missing.
  assert.equal(paymentTargetRelayState(managed, relayResult('wss://down.example', 'timeout')), 'unknown');

  const status = paymentTargetRelayStatus(managed, [
    relayResult('wss://same.example', 'ok', [paymentTargetEvent(VALID_XMR, 'signed-event-id')]),
    relayResult('wss://stale.example', 'ok', [paymentTargetEvent(OTHER_XMR, 'stale-event-id')]),
    relayResult('wss://missing.example', 'ok', []),
    relayResult('wss://down.example', 'error')
  ]);
  assert.equal(status.managed, true);
  assert.deepEqual([status.current, status.stale, status.missing, status.unknown], [1, 1, 1, 1]);
  assert.equal(status.relays[1].eventId, 'stale-event-id');
  assert.ok(status.checkedAt);
});

test('clearing the Monero target keeps unrelated payment targets and signed state managed', () => {
  const extraTags = [['payto', 'bitcoin', 'bc1qabc'], ['relay', 'wss://a.example']];
  assert.deepEqual(paymentTargetTags({ moneroAddress: '', extraTags }), extraTags);
  assert.deepEqual(updateMoneroTargetTags([...extraTags, ['payto', 'xmr', OTHER_XMR]], ''), extraTags);
  // A published event with the target cleared is still managed: relays must be
  // repaired to drop the old address, so coverage keeps reporting.
  assert.equal(isPaymentTargetManaged({ moneroAddress: '', event: { signed: true, id: 'published' } }), true);
});
