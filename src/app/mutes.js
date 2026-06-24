import { publishEventToRelays } from './nostrRelay.js';
import { signNostrEvent } from './nostrSigner.js';
import { addAudit, buildCanonicalEvent, cleanString, loadState, normalizePubkey, randomUUID, saveState } from './state.js';
import { storeEventLocally } from './localVault.js';

export async function getMutes() {
  return (await loadState()).mutes;
}

export async function addMute(entry = {}) {
  const state = await loadState();
  const item = normalizeMuteEntry(entry);
  if (!item.value) throw new Error('mute value is required');
  const exists = (state.mutes.entries ?? []).some((m) => m.type === item.type && m.value === item.value);
  if (!exists) {
    state.mutes.entries.unshift(item);
    state.mutes.updatedAt = item.addedAt;
    state.mutes.event = buildCanonicalEvent(10000, state.mutes.entries);
    state.mutes.truth = null;
    addAudit(state, 'mutes.added', `Muted ${item.type}:${item.value}`);
    await saveState(state);
  }
  return { added: exists ? null : item, already: exists, mutes: state.mutes };
}

export async function removeMute(idOrValue) {
  const state = await loadState();
  const before = state.mutes.entries.length;
  const target = cleanString(idOrValue, 512).toLowerCase();
  state.mutes.entries = (state.mutes.entries ?? []).filter((entry) => entry.id !== idOrValue && `${entry.type}:${entry.value}` !== target && entry.value !== target);
  state.mutes.updatedAt = new Date().toISOString();
  state.mutes.event = buildCanonicalEvent(10000, state.mutes.entries);
  state.mutes.truth = null;
  addAudit(state, 'mutes.removed', before === state.mutes.entries.length ? 'No matching mute entry' : 'Mute entry removed');
  await saveState(state);
  return before !== state.mutes.entries.length;
}

export async function saveMutes(body = {}) {
  const state = await loadState();
  const entries = Array.isArray(body.entries) ? body.entries.map(normalizeMuteEntry).filter((e) => e.value) : state.mutes.entries ?? [];
  state.mutes.entries = dedupeMutes(entries);
  state.mutes.updatedAt = new Date().toISOString();
  state.mutes.event = buildCanonicalEvent(10000, state.mutes.entries);
  state.mutes.truth = null;
  addAudit(state, 'mutes.saved', 'Local kind:10000 mute list draft saved');
  await saveState(state);
  return { mutes: state.mutes };
}

export async function publishMutes() {
  const state = await loadState();
  const nsec = process.env.IDENSTR_NSEC ?? '';
  if (!nsec) throw new Error('IDENSTR_NSEC is required to publish mutes');
  const event = signNostrEvent(nsec, {
    kind: 10000,
    created_at: Math.floor(Date.now() / 1000),
    tags: muteListTags(state.mutes.entries ?? []),
    content: ''
  });
  const relays = state.relays.write?.length ? state.relays.write : state.relays.read;
  const local = await storeEventLocally(event);
  if (!local.accepted) {
    state.mutes.event = { id: event.id, kind: event.kind, created_at: event.created_at, status: 'local-write-failed', signed: true, event, localVault: local };
    state.mutes.lastPublish = { at: new Date().toISOString(), ...state.mutes.event };
    addAudit(state, 'mutes.publish_failed', `Local vault rejected/unreachable: ${local.message}`);
    await saveState(state);
    return { error: 'vault_unavailable', mutes: state.mutes, published: null };
  }
  const published = await publishEventToRelays(event, relays, { timeoutMs: 6500 });
  state.mutes.event = {
    id: event.id,
    kind: event.kind,
    created_at: event.created_at,
    status: published.ok ? 'published' : 'publish-attempted',
    signed: true,
    acceptedRelays: published.results.filter((r) => r.accepted).map((r) => r.relay),
    rejectedRelays: published.results.filter((r) => !r.accepted).map((r) => ({ relay: r.relay, status: r.status, message: r.message || r.error || '' })),
    relayResults: published.results.map((r) => ({ relay: r.relay, status: r.status, accepted: Boolean(r.accepted), latencyMs: r.latencyMs, message: r.message || r.error || '' })),
    event,
    localVault: local
  };
  state.mutes.lastPublish = { at: new Date().toISOString(), ...state.mutes.event };
  addAudit(state, published.ok ? 'mutes.published' : 'mutes.publish_failed', `${published.results.filter((r) => r.accepted).length}/${published.results.length} write relays accepted kind:10000 mute list`);
  await saveState(state);
  return { mutes: state.mutes, published };
}

export async function muteAndPublish(entry) {
  await addMute(entry);
  return publishMutes();
}

export async function unmuteAndPublish(idOrValue) {
  const removed = await removeMute(idOrValue);
  const published = await publishMutes();
  return { removed, ...published };
}

export function muteListTags(entries = []) {
  return dedupeMutes(entries).map((entry) => {
    if (entry.type === 'pubkey') return ['p', entry.value];
    if (entry.type === 'thread' || entry.type === 'event') return ['e', entry.value];
    if (entry.type === 'hashtag') return ['t', entry.value.replace(/^#/, '')];
    return ['word', entry.value];
  });
}

export function normalizeMuteEntry(entry = {}) {
  const rawType = cleanString(entry.type || inferMuteType(entry.value), 20).toLowerCase();
  const type = ['keyword', 'pubkey', 'thread', 'event', 'hashtag'].includes(rawType) ? rawType : 'keyword';
  const rawValue = cleanString(entry.value ?? entry.pubkey ?? entry.eventId ?? entry.keyword ?? '', 512);
  let value = rawValue;
  if (type === 'pubkey') value = normalizePubkey(rawValue) || rawValue.toLowerCase();
  else if (type === 'hashtag') value = rawValue.replace(/^#/, '').toLowerCase();
  else value = rawValue.toLowerCase();
  return {
    id: cleanString(entry.id, 80) || randomUUID(),
    type,
    value,
    label: cleanString(entry.label, 160),
    note: cleanString(entry.note, 240),
    addedAt: entry.addedAt || new Date().toISOString()
  };
}

function inferMuteType(value) {
  const raw = String(value ?? '').trim();
  if (/^(npub1|[0-9a-fA-F]{64}$)/.test(raw)) return 'pubkey';
  if (/^#/.test(raw)) return 'hashtag';
  return 'keyword';
}

function dedupeMutes(entries = []) {
  const seen = new Set();
  const out = [];
  for (const entry of entries.map(normalizeMuteEntry)) {
    const key = `${entry.type}:${entry.value}`;
    if (!entry.value || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}
