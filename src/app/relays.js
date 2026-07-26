import { fetchCurrentRelayState, fetchFollowRelayLists, publishEventToRelays } from './nostrRelay.js';
import { signNostrEvent } from './nostrSigner.js';
import { addAudit, buildCanonicalEvent, cleanString, DEFAULT_TUNING, getRequiredPubkey, loadState, normalizeRelays, normalizeRelayUrl, normalizePubkey, saveState } from './state.js';
import { fetchAllEvents, storeEventLocally } from './localVault.js';
import { updateEnvVar } from './envFile.js';

export async function getRelays() {
  const relays = (await loadState()).relays;
  // The .env-configured URL is the source of truth, so it wins over any value
  // persisted in older state (which may hold a stale/legacy default).
  return { ...relays, private: process.env.IDENSTR_PRIVATE_RELAY_URL || relays.private || null };
}

export async function saveRelays(relays) {
  const state = await loadState();
  const previousPrivate = process.env.IDENSTR_PRIVATE_RELAY_URL || '';
  const nextPrivate = cleanString(relays.private, 200) || previousPrivate || null;
  state.relays = {
    read: normalizeRelays(relays.read),
    write: normalizeRelays(relays.write),
    // New field: preserve the existing DM list when a caller omits it (e.g. a
    // read/write-only toggle), rather than wiping it.
    dm: relays.dm !== undefined ? normalizeRelays(relays.dm) : normalizeRelays(state.relays?.dm),
    private: nextPrivate,
    updatedAt: new Date().toISOString()
  };

  // The private relay URL lives in .env (env_file is read once at container
  // start). Persist it there when it changes, then tell the UI a recreate is
  // needed for the running process to pick it up.
  let restartRequired = false;
  if (nextPrivate && nextPrivate !== previousPrivate) {
    try {
      await updateEnvVar('IDENSTR_PRIVATE_RELAY_URL', nextPrivate);
      restartRequired = true;
    } catch (error) {
      addAudit(state, 'relays.env_write_failed', `Could not persist private relay URL to .env: ${error.message}`);
    }
  }
  state.relays.event = buildCanonicalEvent(10002, state.relays);
  state.relays.dmEvent = buildCanonicalEvent(10050, { dm: state.relays.dm });
  state.relays.scan = [];
  state.relays.consistency = null;
  state.relays.popularity = null;
  if (state.profile?.truth) state.profile.truth = null;
  if (state.profile?.event?.relayResults) {
    state.profile.event = buildCanonicalEvent(0, state.profile);
  }
  if (state.following?.event?.relayResults) {
    state.following.event = buildCanonicalEvent(3, []);
  }
  addAudit(state, 'relays.updated', 'Relay policy updated, stale publish results cleared');
  await saveState(state);
  return { ...state.relays, restartRequired };
}

export async function getPrivateRelay() {
  const url = process.env.IDENSTR_PRIVATE_RELAY_URL || (await loadState()).relays.private || null;
  return { url, configured: Boolean(url) };
}

export async function savePrivateRelay(body) {
  const state = await loadState();
  const previous = process.env.IDENSTR_PRIVATE_RELAY_URL || '';
  const next = cleanString(body?.url, 200) || null;
  if (!next) return { url: previous || null, configured: Boolean(previous), restartRequired: false, error: 'empty_url' };
  state.relays.private = next;
  let restartRequired = false;
  if (next !== previous) {
    try {
      await updateEnvVar('IDENSTR_PRIVATE_RELAY_URL', next);
      restartRequired = true;
      addAudit(state, 'private_relay.updated', `Private relay URL set to ${next}`);
    } catch (error) {
      addAudit(state, 'private_relay.env_write_failed', `Could not persist private relay URL to .env: ${error.message}`);
    }
  }
  await saveState(state);
  return { url: next, configured: true, restartRequired };
}

export async function inspectPrivateRelay() {
  const url = process.env.IDENSTR_PRIVATE_RELAY_URL || '';
  if (!url) return { ok: false, configured: false, url: null, message: 'private relay not configured', summary: null, events: [] };
  const result = await fetchAllEvents({ relayUrl: url });
  if (!result.ok) return { ok: false, configured: true, url, message: result.message, summary: null, events: [] };
  const events = result.events.filter((event) => event && Number.isInteger(event.kind));
  const byKind = {};
  let latest = 0;
  for (const event of events) {
    byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;
    if ((event.created_at ?? 0) > latest) latest = event.created_at;
  }
  const rows = events
    .map((event) => ({ id: event.id, kind: event.kind, created_at: event.created_at }))
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
    .slice(0, 100);
  return {
    ok: true,
    configured: true,
    url,
    message: `${events.length} signed events in your private relay`,
    summary: { total: events.length, byKind, latest: latest ? new Date(latest * 1000).toISOString() : null },
    events: rows
  };
}

export async function publishRelays() {
  const state = await loadState();
  const nsec = process.env.IDENSTR_NSEC ?? '';
  if (!nsec) throw new Error('IDENSTR_NSEC is required to publish relay list');
  const event = signNostrEvent(nsec, {
    kind: 10002,
    created_at: Math.floor(Date.now() / 1000),
    tags: relayListTags(state.relays),
    content: ''
  });
  const relays = state.relays.write?.length ? state.relays.write : state.relays.read;
  const local = await storeEventLocally(event);
  if (!local.accepted) {
    state.relays.event = { id: event.id, kind: event.kind, created_at: event.created_at, status: 'local-write-failed', signed: true, event, localVault: local };
    state.relays.lastPublish = { at: new Date().toISOString(), ...state.relays.event };
    addAudit(state, 'relays.publish_failed', `Local vault rejected/unreachable: ${local.message}`);
    await saveState(state);
    return { error: 'vault_unavailable', relays: state.relays, published: null };
  }
  const published = await publishEventToRelays(event, relays, { timeoutMs: 6500 });
  state.relays.event = {
    id: event.id,
    kind: event.kind,
    created_at: event.created_at,
    status: published.ok ? 'published' : 'publish-attempted',
    signed: true,
    acceptedRelays: published.results.filter((result) => result.accepted).map((result) => result.relay),
    rejectedRelays: published.results.filter((result) => !result.accepted).map((result) => ({ relay: result.relay, status: result.status, message: result.message || result.error || '' })),
    relayResults: published.results.map((result) => ({
      relay: result.relay,
      status: result.status,
      accepted: Boolean(result.accepted),
      message: result.message || result.error || '',
      latencyMs: result.latencyMs
    })),
    event,
    localVault: local
  };
  state.relays.lastPublish = { at: new Date().toISOString(), ...state.relays.event };
  state.relays.consistency = relayListConsistency(state.relays, event);
  addAudit(state, published.ok ? 'relays.published' : 'relays.publish_failed', `${published.results.filter((result) => result.accepted).length}/${published.results.length} write relays accepted kind:10002 relay list`);
  const dmPublished = await publishDmList(state, nsec);
  await saveState(state);
  return { relays: state.relays, published, dmPublished };
}

// Publish the NIP-17 DM relay list (kind:10050) so senders know where to deliver
// your gift-wrapped DMs. Announced to your write relays and the DM relays
// themselves. Returns the publish result, or null when no DM relays are set.
async function publishDmList(state, nsec) {
  const dm = normalizeRelays(state.relays.dm);
  if (!dm.length) {
    state.relays.dmEvent = buildCanonicalEvent(10050, { dm });
    return null;
  }
  const event = signNostrEvent(nsec, {
    kind: 10050,
    created_at: Math.floor(Date.now() / 1000),
    tags: dmRelayTags(state.relays),
    content: ''
  });
  const targets = [...new Set([...(state.relays.write ?? []), ...dm])];
  const local = await storeEventLocally(event);
  if (!local.accepted) {
    state.relays.dmEvent = { id: event.id, kind: event.kind, created_at: event.created_at, status: 'local-write-failed', signed: true, event, localVault: local };
    state.relays.dmLastPublish = { at: new Date().toISOString(), ...state.relays.dmEvent };
    addAudit(state, 'relays.dm_publish_failed', `Local vault rejected/unreachable for kind:10050: ${local.message}`);
    return { error: 'vault_unavailable', published: null };
  }
  const published = await publishEventToRelays(event, targets, { timeoutMs: 6500 });
  state.relays.dmEvent = {
    id: event.id,
    kind: event.kind,
    created_at: event.created_at,
    status: published.ok ? 'published' : 'publish-attempted',
    signed: true,
    acceptedRelays: published.results.filter((result) => result.accepted).map((result) => result.relay),
    rejectedRelays: published.results.filter((result) => !result.accepted).map((result) => ({ relay: result.relay, status: result.status, message: result.message || result.error || '' })),
    relayResults: published.results.map((result) => ({ relay: result.relay, status: result.status, accepted: Boolean(result.accepted), message: result.message || result.error || '', latencyMs: result.latencyMs })),
    event,
    localVault: local
  };
  state.relays.dmLastPublish = { at: new Date().toISOString(), ...state.relays.dmEvent };
  addAudit(state, published.ok ? 'relays.dm_published' : 'relays.dm_publish_failed', `${published.results.filter((result) => result.accepted).length}/${published.results.length} relays accepted kind:10050 DM relay list`);
  return published;
}

export async function scanRelays() {
  const state = await loadState();
  const all = [...new Set([...state.relays.read, ...state.relays.write])];
  const relayState = await fetchCurrentRelayState(getRequiredPubkey(), all);
  const followPubkeys = state.following.entries.map((entry) => normalizePubkey(entry.pubkey)).filter(Boolean);
  const followRelayState = await fetchFollowRelayLists(followPubkeys, all, { timeoutMs: 7500 });
  state.relays.scan = scanRows(relayState.relays);
  state.relays.consistency = relayListConsistency(state.relays, relayState.latest.relayList);
  state.relays.popularity = computeFollowingRelayPopularity(state.relays, state.following.entries, followRelayState.events, followRelayState.relays, state.tuning);
  addAudit(state, 'relays.scanned', `Scanned ${all.length} configured public relays and checked relay lists for ${followPubkeys.length} follows`);
  await saveState(state);
  return { scan: state.relays.scan, consistency: state.relays.consistency, popularity: state.relays.popularity };
}

export function computeFollowingRelayPopularity(localRelays, followingEntries = [], relayListEvents = [], sourceRelayResults = [], tuning = null) {
  const relaySuggestionLimit = tuning?.relaySuggestions ?? DEFAULT_TUNING.relaySuggestions;
  const local = new Set(normalizeRelays([...(localRelays.read ?? []), ...(localRelays.write ?? [])]));
  const follows = followingEntries.map((entry) => normalizePubkey(entry.pubkey)).filter(Boolean);
  const total = follows.length;
  const latestByAuthor = new Map();
  for (const event of relayListEvents) {
    const author = normalizePubkey(event.pubkey);
    if (!author) continue;
    const existing = latestByAuthor.get(author);
    if (!existing || (event.created_at ?? 0) > (existing.created_at ?? 0)) latestByAuthor.set(author, event);
  }
  const counts = new Map();
  for (const author of follows) {
    const event = latestByAuthor.get(author);
    if (!event) continue;
    const parsed = parseRelayListEvent(event);
    const used = new Set([...parsed.read, ...parsed.write]);
    for (const relay of used) counts.set(relay, (counts.get(relay) ?? 0) + 1);
  }
  const rows = [...new Set([...local, ...counts.keys()])].sort().map((url) => popularityRow(url, counts.get(url) ?? 0, total, local.has(url)));
  return {
    scannedAt: new Date().toISOString(),
    totalFollows: followingEntries.length,
    queryableFollows: total,
    followsWithRelayLists: latestByAuthor.size,
    sourceRelays: sourceRelayResults.map((result) => ({ url: result.relay, status: result.status, eventCount: result.events?.length ?? 0, latencyMs: result.latencyMs, error: result.error })),
    local: rows.filter((row) => row.local).sort(sortPopularityRows),
    suggestions: rows.filter((row) => !row.local && row.count > 0).sort(sortPopularityRows).slice(0, relaySuggestionLimit)
  };
}

function relayListTags(relays) {
  const read = new Set(normalizeRelays(relays.read));
  const write = new Set(normalizeRelays(relays.write));
  const tags = [];
  for (const relay of read) tags.push(['r', relay, 'read']);
  for (const relay of write) tags.push(['r', relay, 'write']);
  return tags;
}

// NIP-17 kind:10050 uses plain `relay` tags (no read/write marker).
function dmRelayTags(relays) {
  const dm = new Set(normalizeRelays(relays.dm));
  return [...dm].map((relay) => ['relay', relay]);
}

function parseRelayListEvent(event) {
  const read = [];
  const write = [];
  for (const tag of event?.tags ?? []) {
    if (tag[0] !== 'r' || !tag[1]) continue;
    if (!tag[2] || tag[2] === 'read') read.push(tag[1]);
    if (!tag[2] || tag[2] === 'write') write.push(tag[1]);
  }
  return { read: normalizeRelays(read), write: normalizeRelays(write) };
}

function relayListConsistency(localRelays, relayListEvent) {
  if (!relayListEvent) return { status: 'unknown', message: 'No published kind:10002 relay list found on scanned relays yet.' };
  const published = parseRelayListEvent(relayListEvent);
  const readMatches = sameSet(localRelays.read, published.read);
  const writeMatches = sameSet(localRelays.write, published.write);
  return {
    status: readMatches && writeMatches ? 'match' : 'mismatch',
    message: readMatches && writeMatches ? 'Published relay list matches local policy.' : 'Published relay list differs from local policy.',
    relay: relayListEvent.relay,
    eventId: relayListEvent.id,
    created_at: relayListEvent.created_at,
    local: { read: normalizeRelays(localRelays.read), write: normalizeRelays(localRelays.write) },
    published
  };
}

function sameSet(a, b) {
  const left = normalizeRelays(a).sort();
  const right = normalizeRelays(b).sort();
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function scanRows(results) {
  const scannedAt = new Date().toISOString();
  return results.map((result) => ({
    url: result.relay,
    status: result.status,
    profile: result.events.some((event) => event.kind === 0) ? 'found' : 'missing',
    following: result.events.some((event) => event.kind === 3) ? 'found' : 'missing',
    relayList: result.events.some((event) => event.kind === 10002) ? 'found' : 'missing',
    eventCount: result.events.length,
    latencyMs: result.latencyMs,
    error: result.error,
    scannedAt
  }));
}

function sortPopularityRows(a, b) {
  return b.count - a.count || a.url.localeCompare(b.url);
}

function popularityRow(url, count, total, local) {
  const percent = total ? Math.round((count / total) * 100) : 0;
  return { url, count, total, percent, fraction: `${count}/${total}`, tier: popularityTier(percent, count), local };
}

function popularityTier(percent, count) {
  if (!count) return 'unseen';
  if (percent >= 50) return 'high';
  if (percent >= 25) return 'common';
  return 'niche';
}
