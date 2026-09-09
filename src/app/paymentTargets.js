import { fetchPaymentTargetEvents, publishEventToRelays } from './nostrRelay.js';
import { signNostrEvent } from './nostrSigner.js';
import { addAudit, buildCanonicalEvent, cleanString, getRequiredPubkey, loadState, newestEvent, saveState } from './state.js';
import { storeEventLocally } from './localVault.js';

export const PAYMENT_TARGETS_KIND = 10133;
export const MONERO_TARGET_TYPES = new Set(['monero', 'xmr']);

export async function getPaymentTargets() {
  return (await loadState()).paymentTargets;
}

export async function savePaymentTargets(body = {}) {
  const state = await loadState();
  const address = cleanMoneroAddress(body.moneroAddress);
  const normalized = normalizePaymentTargets({
    ...state.paymentTargets,
    moneroAddress: address,
    updatedAt: new Date().toISOString()
  });
  state.paymentTargets = { ...normalized, event: buildCanonicalEvent(PAYMENT_TARGETS_KIND, paymentTargetTags(normalized)) };
  addAudit(state, 'payment_targets.updated', address ? 'Canonical kind:10133 Monero payment target draft updated' : 'Canonical kind:10133 Monero payment target cleared');
  await saveState(state);
  return state.paymentTargets;
}

export async function importPaymentTargetsFromRelays() {
  const state = await loadState();
  const all = [...new Set([...state.relays.read, ...state.relays.write])];
  const relayState = await fetchPaymentTargetEvents(getRequiredPubkey(), all, { timeoutMs: 6500 });
  const newest = newestEvent(relayState.events.filter((event) => event.kind === PAYMENT_TARGETS_KIND));
  const target = moneroTargetFromEvent(newest);
  if (target?.address) {
    state.paymentTargets = normalizePaymentTargets({
      ...state.paymentTargets,
      moneroAddress: target.address,
      extraTags: nonMoneroTags(newest.tags),
      importedAt: new Date().toISOString(),
      sourceEvent: publicPaymentTargetEvent(newest),
      event: buildCanonicalEvent(PAYMENT_TARGETS_KIND, updateMoneroTargetTags(newest.tags, target.address))
    });
    addAudit(state, 'payment_targets.imported', `Imported Monero payment target from public relays (${target.type})`);
    await saveState(state);
  }
  return { paymentTargets: state.paymentTargets, found: Boolean(target?.address), relayResults: relayState.relays.map(publicRelayResult), sourceEvent: newest ? publicPaymentTargetEvent(newest) : null };
}

export async function publishPaymentTargets() {
  const state = await loadState();
  const nsec = process.env.IDENSTR_NSEC ?? '';
  if (!nsec) throw new Error('IDENSTR_NSEC is required to publish payment targets');
  const tags = paymentTargetTags(state.paymentTargets);
  const event = signNostrEvent(nsec, {
    kind: PAYMENT_TARGETS_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: ''
  });
  const relays = state.relays.write?.length ? state.relays.write : state.relays.read;
  const local = await storeEventLocally(event);
  if (!local.accepted) {
    state.paymentTargets.event = { id: event.id, kind: event.kind, created_at: event.created_at, status: 'local-write-failed', signed: true, event, localVault: local };
    state.paymentTargets.lastPublish = { at: new Date().toISOString(), ...state.paymentTargets.event };
    addAudit(state, 'payment_targets.publish_failed', `Local vault rejected/unreachable: ${local.message}`);
    await saveState(state);
    return { error: 'vault_unavailable', paymentTargets: state.paymentTargets, published: null };
  }
  const published = await publishEventToRelays(event, relays, { timeoutMs: 6500 });
  state.paymentTargets = normalizePaymentTargets({
    ...state.paymentTargets,
    event: {
      id: event.id,
      kind: event.kind,
      created_at: event.created_at,
      status: published.ok ? 'published' : 'publish-attempted',
      signed: true,
      acceptedRelays: published.results.filter((result) => result.accepted).map((result) => result.relay),
      rejectedRelays: published.results.filter((result) => !result.accepted).map((row) => ({ relay: row.relay, status: row.status, message: row.message || row.error || '' })),
      relayResults: published.results.map((result) => ({ relay: result.relay, status: result.status, accepted: Boolean(result.accepted), latencyMs: result.latencyMs, message: result.message || result.error || '' })),
      event,
      localVault: local
    }
  });
  state.paymentTargets.lastPublish = { at: new Date().toISOString(), ...state.paymentTargets.event };
  addAudit(state, published.ok ? 'payment_targets.published' : 'payment_targets.publish_failed', `${published.results.filter((result) => result.accepted).length}/${published.results.length} write relays accepted kind:10133 payment targets`);
  await saveState(state);
  return { paymentTargets: state.paymentTargets, published };
}

// Relay results only count as evidence when the relay actually answered; a
// timed-out relay is unknown, not missing.
const RESPONSIVE_RELAY_STATUSES = new Set(['ok', 'partial-timeout', 'partial-error']);

// NIP-A3 is optional. An identity with no Monero target is healthy, so relay
// state stays 'none' until a target is actually managed and nothing is reported.
export function isPaymentTargetManaged(paymentTargets = {}) {
  return Boolean(cleanMoneroAddress(paymentTargets.moneroAddress) || paymentTargets.event?.signed);
}

export function paymentTargetRelayState(paymentTargets = {}, relayResult = {}) {
  if (!isPaymentTargetManaged(paymentTargets)) return 'none';
  const published = newestEvent((relayResult.events ?? []).filter((event) => event?.kind === PAYMENT_TARGETS_KIND));
  if (!published) return RESPONSIVE_RELAY_STATUSES.has(relayResult.status) ? 'missing' : 'unknown';
  if (paymentTargets.event?.signed && paymentTargets.event.id && published.id === paymentTargets.event.id) return 'current';
  // Compare the Monero target itself rather than event ids: a relay holding a
  // different event that still serves the same address is serving the truth.
  return moneroTargetFromEvent(published)?.address === cleanMoneroAddress(paymentTargets.moneroAddress) ? 'current' : 'stale';
}

export function paymentTargetRelayStatus(paymentTargets = {}, relayResults = []) {
  const relays = relayResults.map((result) => ({
    url: result.relay,
    state: paymentTargetRelayState(paymentTargets, result),
    status: result.status,
    eventId: newestEvent((result.events ?? []).filter((event) => event?.kind === PAYMENT_TARGETS_KIND))?.id ?? null
  }));
  const count = (state) => relays.filter((row) => row.state === state).length;
  return {
    managed: isPaymentTargetManaged(paymentTargets),
    checkedAt: new Date().toISOString(),
    current: count('current'),
    stale: count('stale'),
    missing: count('missing'),
    unknown: count('unknown'),
    // Relays holding a kind:10133 for this identity even when nothing is managed
    // locally, so an unmanaged published target can be imported rather than lost.
    publishedElsewhere: relays.filter((row) => row.eventId).length,
    relays
  };
}

export function normalizePaymentTargets(value = {}) {
  const extraTags = nonMoneroTags(value.extraTags ?? value.event?.event?.tags ?? value.event?.tags ?? []);
  return {
    moneroAddress: cleanMoneroAddress(value.moneroAddress),
    extraTags,
    updatedAt: value.updatedAt ?? null,
    importedAt: value.importedAt ?? null,
    sourceEvent: value.sourceEvent ?? null,
    event: value.event ?? buildCanonicalEvent(PAYMENT_TARGETS_KIND, paymentTargetTags({ ...value, extraTags })),
    lastPublish: value.lastPublish ?? null
  };
}

export function paymentTargetTags(paymentTargets = {}) {
  return updateMoneroTargetTags(paymentTargets.extraTags ?? [], paymentTargets.moneroAddress);
}

export function moneroTargetFromEvent(event) {
  for (const tag of event?.tags ?? []) {
    if (!Array.isArray(tag) || tag[0] !== 'payto') continue;
    const type = String(tag[1] ?? '').trim().toLowerCase();
    const address = cleanMoneroAddress(tag[2]);
    if (MONERO_TARGET_TYPES.has(type) && address) return { type, address };
  }
  return null;
}

export function updateMoneroTargetTags(existingTags = [], moneroAddress = '') {
  const kept = nonMoneroTags(existingTags);
  const address = cleanMoneroAddress(moneroAddress);
  return address ? [...kept, ['payto', 'monero', address]] : kept;
}

function nonMoneroTags(tags = []) {
  return (Array.isArray(tags) ? tags : []).filter((tag) => {
    if (!Array.isArray(tag) || tag[0] !== 'payto') return true;
    return !MONERO_TARGET_TYPES.has(String(tag[1] ?? '').trim().toLowerCase());
  });
}

export function cleanMoneroAddress(value) {
  const address = cleanString(value, 140);
  if (!address) return '';
  // Standard/subaddresses are 95 chars; integrated addresses are 106. This is
  // intentionally a format guard, not wallet validation.
  return /^[48][1-9A-HJ-NP-Za-km-z]{94}$/.test(address) || /^[48][1-9A-HJ-NP-Za-km-z]{105}$/.test(address) ? address : '';
}

function publicPaymentTargetEvent(event) {
  if (!event) return null;
  return { id: event.id, kind: event.kind, pubkey: event.pubkey, created_at: event.created_at, tags: event.tags, relay: event.relay };
}

function publicRelayResult(result) {
  return { relay: result.relay, status: result.status, latencyMs: result.latencyMs, eventCount: result.events?.length ?? 0, error: result.error || '' };
}
