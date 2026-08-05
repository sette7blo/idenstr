import { fetchAuthorProfiles, fetchCurrentRelayState, fetchFollowCurationEvents, fetchFollowRelayLists, publishEventToRelays, searchRelayProfiles } from './nostrRelay.js';
import { signNostrEvent } from './nostrSigner.js';
import { addAudit, buildCanonicalEvent, cleanString, DEFAULT_TUNING, getRequiredPubkey, loadState, newestEvent, normalizePubkey, normalizeRelayUrl, parseJsonObject, pubkeyToNpub, randomUUID, saveState } from './state.js';
import { storeEventLocally } from './localVault.js';

export async function getFollowing() {
  return (await loadState()).following;
}

export async function searchPeople(query, options = {}) {
  const state = await loadState();
  const q = cleanString(query, 140);
  if (!q || q.length < 2) return { query: q, results: [], message: 'Type at least 2 characters to search.' };
  const entries = state.following.entries ?? [];
  const followed = new Set(entries.map((entry) => normalizePubkey(entry.pubkey)).filter(Boolean));
  const relayHints = entries.map((entry) => normalizeRelayUrl(entry.relayHint)).filter(Boolean);
  const relays = [...new Set([...relayHints, ...(state.relays.read ?? []), ...(state.relays.write ?? [])])];
  const candidates = new Map();

  addDirectoryMatches(candidates, q, state.following.directory ?? {}, followed);

  const exactPubkey = normalizePubkey(q);
  if (exactPubkey) {
    addCandidate(candidates, exactPubkey, { source: q.toLowerCase().startsWith('npub1') ? 'npub' : 'hex', confidence: 'exact', followed: followed.has(exactPubkey) });
  }

  if (looksLikeNip05(q)) {
    const resolved = await resolveNip05(q, options.nip05TimeoutMs ?? 5000);
    if (resolved.pubkey) addCandidate(candidates, resolved.pubkey, { source: 'nip05', confidence: 'exact', nip05: resolved.nip05, followed: followed.has(resolved.pubkey) });
  }

  if (!exactPubkey && relays.length) {
    const searched = await searchRelayProfiles(q, relays, { timeoutMs: options.timeoutMs ?? 5500, limit: options.limit ?? 20 });
    mergeProfileEvents(candidates, searched.events, followed, 'relay-search');
  }

  const needsProfile = [...candidates.values()].filter((row) => !row.profile).map((row) => row.pubkey);
  if (needsProfile.length && relays.length) {
    const profiles = await fetchAuthorProfiles(needsProfile, relays, { timeoutMs: options.timeoutMs ?? 5500, batchSize: 40, limit: needsProfile.length });
    mergeProfileEvents(candidates, profiles.events, followed, 'profile-fetch');
  }

  const results = [...candidates.values()]
    .map((row) => ({ ...row, npub: pubkeyToNpub(row.pubkey), followed: followed.has(row.pubkey) || row.followed, score: candidateScore(row, q) }))
    .sort((a, b) => b.score - a.score || (b.profileEvent?.created_at ?? 0) - (a.profileEvent?.created_at ?? 0))
    .slice(0, options.results ?? 20);

  return { query: q, searchedRelays: exactPubkey ? 0 : relays.length, results, message: results.length ? `Found ${results.length} candidate${results.length === 1 ? '' : 's'}.` : 'No matching people found on configured relays.' };
}

export async function addFollowing(entry) {
  const state = await loadState();
  const rawPubkey = cleanString(entry.pubkey, 140);
  const pubkey = normalizePubkey(rawPubkey);
  if (!rawPubkey) throw new Error('pubkey is required');
  if (!pubkey) throw new Error('valid npub or 64-character hex pubkey is required');
  const existing = (state.following.entries ?? []).find((item) => normalizePubkey(item.pubkey) === pubkey);
  if (existing) return { ...existing, already: true };
  const item = {
    id: randomUUID(),
    pubkey,
    petname: cleanString(entry.petname, 80),
    relayHint: cleanString(entry.relayHint, 200),
    note: cleanString(entry.note, 240),
    addedAt: new Date().toISOString()
  };
  state.following.entries.unshift(item);
  state.following.directory = state.following.directory ?? {};
  const previous = state.following.directory[pubkey] ?? {};
  state.following.directory[pubkey] = { pubkey, npub: pubkeyToNpub(pubkey), profile: previous.profile ?? entry.profile ?? null, profileEvent: previous.profileEvent ?? null, follow: { relayHint: item.relayHint, petname: item.petname, addedAt: item.addedAt }, local: previous.local ?? { note: item.note || '', tags: [], favorite: false, hidden: false }, status: previous.status ?? { profileFetch: entry.profile ? 'ok' : 'pending', lastFetchedAt: entry.profile ? new Date().toISOString() : null, error: '' } };
  state.following.updatedAt = item.addedAt;
  state.following.event = buildCanonicalEvent(3, state.following.entries);
  state.following.truth = null;
  addAudit(state, 'following.added', `Added ${item.petname || pubkeyToNpub(pubkey) || pubkey}`);
  await saveState(state, { directory: true });
  return item;
}

export async function removeFollowing(idOrPubkey) {
  const state = await loadState();
  const before = state.following.entries.length;
  // Match by internal id (Idenstr's own UI) or by pubkey (scoped apps like Feedstr,
  // which only ever see pubkeys via the directory).
  const target = normalizePubkey(idOrPubkey) || idOrPubkey;
  const matches = (entry) => entry.id === idOrPubkey || (normalizePubkey(entry.pubkey) || entry.pubkey) === target;
  const removed = state.following.entries.find(matches);
  state.following.entries = state.following.entries.filter((entry) => !matches(entry));
  if (removed && state.following.directory) delete state.following.directory[normalizePubkey(removed.pubkey) || removed.pubkey];
  state.following.updatedAt = new Date().toISOString();
  state.following.event = buildCanonicalEvent(3, state.following.entries);
  state.following.truth = null;
  addAudit(state, 'following.removed', before === state.following.entries.length ? 'No matching follow entry' : 'Follow entry removed');
  await saveState(state, { directory: true });
  return before !== state.following.entries.length;
}

export async function saveFollowing() {
  const state = await loadState();
  state.following.updatedAt = new Date().toISOString();
  state.following.event = buildCanonicalEvent(3, state.following.entries ?? []);
  state.following.truth = null;
  addAudit(state, 'following.saved', 'Local kind:3 following list draft saved; follow truth scan reset');
  await saveState(state);
  return { following: state.following };
}

export async function publishFollowing() {
  const state = await loadState();
  const nsec = process.env.IDENSTR_NSEC ?? '';
  if (!nsec) throw new Error('IDENSTR_NSEC is required to publish following');
  const event = signNostrEvent(nsec, {
    kind: 3,
    created_at: Math.floor(Date.now() / 1000),
    tags: followingListTags(state.following.entries ?? []),
    content: ''
  });
  const relays = state.relays.write?.length ? state.relays.write : state.relays.read;
  const local = await storeEventLocally(event);
  if (!local.accepted) {
    state.following.event = { id: event.id, kind: event.kind, created_at: event.created_at, status: 'local-write-failed', signed: true, event, localVault: local };
    state.following.lastPublish = { at: new Date().toISOString(), ...state.following.event };
    addAudit(state, 'following.publish_failed', `Local vault rejected/unreachable: ${local.message}`);
    await saveState(state);
    return { error: 'vault_unavailable', following: state.following, published: null };
  }
  const published = await publishEventToRelays(event, relays, { timeoutMs: 6500 });
  state.following.event = {
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
      latencyMs: result.latencyMs,
      message: result.message || result.error || ''
    })),
    event,
    localVault: local
  };
  state.following.lastPublish = { at: new Date().toISOString(), ...state.following.event };
  addAudit(state, published.ok ? 'following.published' : 'following.publish_failed', `${published.results.filter((result) => result.accepted).length}/${published.results.length} write relays accepted kind:3 following list`);
  await saveState(state);
  return { following: state.following, published };
}

// One-shot follow for scoped apps: add to the local-truth kind:3 (deduped) then sign
// and broadcast it to the private vault + public relays. Idenstr stays the sole author
// of the contact list, so a partial client view can never clobber it.
export async function followAndPublish(entry) {
  const pubkey = cleanString(entry?.pubkey, 140);
  if (!pubkey) throw new Error('pubkey is required');
  const norm = normalizePubkey(pubkey) || pubkey;
  const state = await loadState();
  const already = (state.following.entries ?? []).some((e) => (normalizePubkey(e.pubkey) || e.pubkey) === norm);
  const added = already ? null : await addFollowing(entry);
  const published = await publishFollowing();
  return { added, already, ...published };
}

// One-shot unfollow: remove by pubkey then republish the kind:3.
export async function unfollowAndPublish(pubkey) {
  const clean = cleanString(pubkey, 140);
  if (!clean) throw new Error('pubkey is required');
  const removed = await removeFollowing(clean);
  const published = await publishFollowing();
  return { removed, ...published };
}

export async function scanFollowing() {
  const state = await loadState();
  const all = [...new Set([...(state.relays.read ?? []), ...(state.relays.write ?? [])])];
  const relayState = await fetchCurrentRelayState(getRequiredPubkey(), all, { timeoutMs: 6500 });
  state.following.truth = followListTruth(state.following, relayState.relays);
  addAudit(state, 'following.scanned', `Scanned follow truth on ${all.length} configured public relays`);
  await saveState(state);
  return { truth: state.following.truth };
}

export async function refreshFollowingProfiles() {
  const state = await loadState();
  const entries = state.following.entries ?? [];
  const pubkeys = entries.map((entry) => normalizePubkey(entry.pubkey)).filter(Boolean);
  const relayHints = entries.map((entry) => normalizeRelayUrl(entry.relayHint)).filter(Boolean);
  const relays = [...new Set([...relayHints, ...(state.relays.read ?? []), ...(state.relays.write ?? [])])];
  const fetched = await fetchAuthorProfiles(pubkeys, relays, { timeoutMs: 7500, batchSize: 80 });
  state.following.directory = updateFollowDirectory(state.following.directory ?? {}, entries, fetched.events, fetched.relays);
  state.following.directoryUpdatedAt = new Date().toISOString();
  const summary = followDirectorySummary(state.following);
  addAudit(state, 'following.profiles_refreshed', `Refreshed follow profile cache: ${summary.cached}/${summary.total} cached, ${summary.missing} missing`);
  await saveState(state, { directory: true });
  return { following: { totalCount: entries.length, directorySummary: summary, entries: enrichedFollowingEntries(state.following) } };
}

export async function* refreshFollowingProfilesStreaming() {
  const state = await loadState();
  const entries = state.following.entries ?? [];
  const pubkeys = entries.map((entry) => normalizePubkey(entry.pubkey)).filter(Boolean);
  const relayHints = entries.map((entry) => normalizeRelayUrl(entry.relayHint)).filter(Boolean);
  const relays = [...new Set([...relayHints, ...(state.relays.read ?? []), ...(state.relays.write ?? [])])];
  const total = pubkeys.length;
  const batchSize = 40;
  let completed = 0;
  const allEvents = [];
  const allRelayResults = [];
  yield { type: 'progress', completed: 0, total, phase: 'profiles' };
  for (let i = 0; i < pubkeys.length; i += batchSize) {
    const batch = pubkeys.slice(i, i + batchSize);
    const fetched = await fetchAuthorProfiles(batch, relays, { timeoutMs: 7500, batchSize: batch.length });
    allEvents.push(...fetched.events);
    allRelayResults.push(...fetched.relays);
    completed = Math.min(total, i + batchSize);
    yield { type: 'progress', completed, total, phase: 'profiles' };
  }
  state.following.directory = updateFollowDirectory(state.following.directory ?? {}, entries, allEvents, allRelayResults);
  state.following.directoryUpdatedAt = new Date().toISOString();
  const summary = followDirectorySummary(state.following);
  addAudit(state, 'following.profiles_refreshed', `Refreshed follow profile cache: ${summary.cached}/${summary.total} cached, ${summary.missing} missing`);
  await saveState(state, { directory: true });
  yield { type: 'done', following: { totalCount: entries.length, directorySummary: summary, entries: enrichedFollowingEntries(state.following) } };
}

export async function refreshFollowingAnalytics() {
  const state = await loadState();
  const entries = state.following.entries ?? [];
  const pubkeys = entries.map((entry) => normalizePubkey(entry.pubkey)).filter(Boolean);
  const relayHints = entries.map((entry) => normalizeRelayUrl(entry.relayHint)).filter(Boolean);
  const relays = [...new Set([...relayHints, ...(state.relays.read ?? []), ...(state.relays.write ?? [])])];
  const fetched = await fetchFollowCurationEvents(pubkeys, relays, { timeoutMs: 8000, batchSize: 60 });
  state.following.analytics = computeFollowAnalytics(entries, fetched.events, fetched.relays, getRequiredPubkey(), state.tuning);
  const notObservedEntries = entries.filter((entry) => state.following.analytics[normalizePubkey(entry.pubkey)]?.activityTier === 'unknown');
  if (notObservedEntries.length) {
    const extraRelays = await discoverFollowWriteRelays(notObservedEntries, relays);
    const fallbackRelays = [...new Set([...relays, ...extraRelays])];
    for (let index = 0; index < notObservedEntries.length; index += 40) {
      const fallbackEntries = notObservedEntries.slice(index, index + 40);
      const fallbackPubkeys = fallbackEntries.map((entry) => normalizePubkey(entry.pubkey)).filter(Boolean);
      const fallback = await fetchFollowCurationEvents(fallbackPubkeys, fallbackRelays, { timeoutMs: 5000, activityBatchSize: 4, includeContacts: false });
      state.following.analytics = mergeFollowActivityAnalytics(state.following.analytics, fallbackEntries, fallback.events, fallback.relays, getRequiredPubkey(), state.tuning);
    }
  }
  state.following.analyticsUpdatedAt = new Date().toISOString();
  const summary = followAnalyticsSummary(state.following);
  addAudit(state, 'following.analytics_refreshed', `Refreshed follow quality analytics: ${summary.engagement.high} high quality, ${summary.engagement.engaged} engaged, ${summary.active + summary.veryActive} active`);
  await saveState(state);
  return { following: { totalCount: entries.length, analyticsSummary: summary, entries: enrichedFollowingEntries(state.following) } };
}

export async function* refreshFollowingAnalyticsStreaming() {
  const state = await loadState();
  const entries = state.following.entries ?? [];
  const pubkeys = entries.map((entry) => normalizePubkey(entry.pubkey)).filter(Boolean);
  const relayHints = entries.map((entry) => normalizeRelayUrl(entry.relayHint)).filter(Boolean);
  const relays = [...new Set([...relayHints, ...(state.relays.read ?? []), ...(state.relays.write ?? [])])];
  const total = pubkeys.length;
  yield { type: 'progress', completed: 0, total, phase: 'activity' };
  const fetched = await fetchFollowCurationEvents(pubkeys, relays, { timeoutMs: 8000, batchSize: 60 });
  state.following.analytics = computeFollowAnalytics(entries, fetched.events, fetched.relays, getRequiredPubkey(), state.tuning);
  const observed = entries.filter((entry) => state.following.analytics[normalizePubkey(entry.pubkey)]?.activityTier !== 'unknown').length;
  yield { type: 'progress', completed: observed, total, phase: 'activity' };
  const notObservedEntries = entries.filter((entry) => state.following.analytics[normalizePubkey(entry.pubkey)]?.activityTier === 'unknown');
  if (notObservedEntries.length) {
    const extraRelays = await discoverFollowWriteRelays(notObservedEntries, relays);
    const fallbackRelays = [...new Set([...relays, ...extraRelays])];
    for (let index = 0; index < notObservedEntries.length; index += 40) {
      const fallbackEntries = notObservedEntries.slice(index, index + 40);
      const fallbackPubkeys = fallbackEntries.map((entry) => normalizePubkey(entry.pubkey)).filter(Boolean);
      const fallback = await fetchFollowCurationEvents(fallbackPubkeys, fallbackRelays, { timeoutMs: 5000, activityBatchSize: 4, includeContacts: false });
      state.following.analytics = mergeFollowActivityAnalytics(state.following.analytics, fallbackEntries, fallback.events, fallback.relays, getRequiredPubkey(), state.tuning);
      const nowObserved = entries.filter((entry) => state.following.analytics[normalizePubkey(entry.pubkey)]?.activityTier !== 'unknown').length;
      yield { type: 'progress', completed: nowObserved, total, phase: 'fallback' };
    }
  }
  state.following.analyticsUpdatedAt = new Date().toISOString();
  const summary = followAnalyticsSummary(state.following);
  addAudit(state, 'following.analytics_refreshed', `Refreshed follow quality analytics: ${summary.engagement.high} high quality, ${summary.engagement.engaged} engaged, ${summary.active + summary.veryActive} active`);
  await saveState(state);
  yield { type: 'done', following: { totalCount: entries.length, analyticsSummary: summary, entries: enrichedFollowingEntries(state.following) } };
}

export async function discoverFollowSuggestions() {
  const state = await loadState();
  const entries = state.following.entries ?? [];
  const analytics = state.following.analytics ?? {};
  const myPubkey = getRequiredPubkey();
  const myFollowPubkeys = new Set(entries.map((entry) => normalizePubkey(entry.pubkey)).filter(Boolean));

  const mutuals = entries
    .map((entry) => normalizePubkey(entry.pubkey))
    .filter((pubkey) => pubkey && analytics[pubkey]?.followsYou === true);

  if (!mutuals.length) {
    return { suggestions: [], message: 'No mutual follows found. Run refresh activity data first to detect who follows you back.' };
  }

  const relayHints = entries.map((entry) => normalizeRelayUrl(entry.relayHint)).filter(Boolean);
  const relays = [...new Set([...relayHints, ...(state.relays.read ?? []), ...(state.relays.write ?? [])])];

  const fetched = await fetchFollowCurationEvents(mutuals, relays, { timeoutMs: 8000, batchSize: 60, activityKinds: [], includeContacts: true });

  const candidateCounts = new Map();
  const latestKind3 = new Map();
  for (const event of fetched.events) {
    if (event.kind !== 3) continue;
    const author = normalizePubkey(event.pubkey);
    if (!author) continue;
    const prev = latestKind3.get(author);
    if (!prev || (event.created_at ?? 0) > (prev.created_at ?? 0)) latestKind3.set(author, event);
  }

  for (const [, contactList] of latestKind3) {
    const follows = (contactList.tags ?? [])
      .filter((tag) => tag[0] === 'p' && tag[1])
      .map((tag) => normalizePubkey(tag[1]))
      .filter(Boolean);
    for (const pubkey of follows) {
      if (pubkey === myPubkey || myFollowPubkeys.has(pubkey)) continue;
      candidateCounts.set(pubkey, (candidateCounts.get(pubkey) ?? 0) + 1);
    }
  }

  const tuning = state.tuning ?? DEFAULT_TUNING;
  const discoverCandidates = tuning.discover?.candidates ?? 20;
  const discoverResults = tuning.discover?.results ?? 10;

  const ranked = [...candidateCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, discoverCandidates);

  if (!ranked.length) {
    return { suggestions: [], message: 'No new suggestions found among mutual follow lists.' };
  }

  const candidatePubkeys = ranked.map(([pubkey]) => pubkey);
  const profiles = await fetchAuthorProfiles(candidatePubkeys, relays, { timeoutMs: 7500, batchSize: discoverCandidates });
  const profileMap = new Map();
  for (const event of profiles.events) {
    const pk = normalizePubkey(event.pubkey);
    if (!pk) continue;
    const existing = profileMap.get(pk);
    if (!existing || (event.created_at ?? 0) > (existing.created_at ?? 0)) profileMap.set(pk, event);
  }

  const suggestions = ranked.slice(0, discoverResults).map(([pubkey, mutualCount]) => {
    const profileEvent = profileMap.get(pubkey);
    const profile = profileEvent ? normalizeDiscoverProfile(parseJsonObject(profileEvent.content)) : null;
    return {
      pubkey,
      npub: pubkeyToNpub(pubkey),
      mutualCount,
      totalMutuals: mutuals.length,
      profile
    };
  });

  state.following.discover = { suggestions, scannedAt: new Date().toISOString(), mutualCount: mutuals.length };
  addAudit(state, 'following.discover', `Discovered ${suggestions.length} follow suggestions from ${mutuals.length} mutual follows`);
  await saveState(state);
  return { suggestions, mutualCount: mutuals.length };
}

function looksLikeNip05(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value ?? '').trim());
}

async function resolveNip05(value, timeoutMs = 5000) {
  const nip05 = String(value ?? '').trim().toLowerCase();
  const [name, domain] = nip05.split('@');
  if (!name || !domain) return { nip05, pubkey: '' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) return { nip05, pubkey: '', error: `${response.status} ${response.statusText}` };
    const body = await response.json();
    const pubkey = normalizePubkey(body?.names?.[name] || body?.names?.[name.toLowerCase()]);
    return { nip05, pubkey };
  } catch (error) {
    return { nip05, pubkey: '', error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

function addDirectoryMatches(candidates, query, directory, followed) {
  const q = query.toLowerCase();
  for (const row of Object.values(directory ?? {})) {
    const pubkey = normalizePubkey(row?.pubkey);
    if (!pubkey) continue;
    const profile = row.profile ?? {};
    const haystack = [row.npub, pubkey, profile.name, profile.displayName, profile.nip05, profile.about, row.follow?.petname].join(' ').toLowerCase();
    if (!haystack.includes(q)) continue;
    addCandidate(candidates, pubkey, { profile, profileEvent: row.profileEvent, source: 'local-cache', confidence: 'cached', followed: followed.has(pubkey), relays: row.profileEvent?.relay ? [row.profileEvent.relay] : [] });
  }
}

function mergeProfileEvents(candidates, events, followed, source) {
  for (const event of events ?? []) {
    const pubkey = normalizePubkey(event.pubkey);
    if (!pubkey) continue;
    const existing = candidates.get(pubkey);
    if (existing?.profileEvent && (existing.profileEvent.created_at ?? 0) > (event.created_at ?? 0)) {
      addCandidate(candidates, pubkey, { source, followed: followed.has(pubkey), relays: [event.relay].filter(Boolean) });
      continue;
    }
    addCandidate(candidates, pubkey, { profile: normalizeFollowProfile(parseJsonObject(event.content)), profileEvent: { id: event.id, created_at: event.created_at, relay: event.relay }, source, confidence: source === 'relay-search' ? 'relay-search' : 'profile', followed: followed.has(pubkey), relays: [event.relay].filter(Boolean) });
  }
}

function addCandidate(candidates, pubkey, data = {}) {
  const existing = candidates.get(pubkey) ?? { pubkey, sources: [], relays: [], confidence: 'candidate', followed: false };
  const sources = new Set([...(existing.sources ?? []), data.source].filter(Boolean));
  const relays = new Set([...(existing.relays ?? []), ...(data.relays ?? [])].filter(Boolean));
  candidates.set(pubkey, {
    ...existing,
    ...data,
    pubkey,
    sources: [...sources],
    relays: [...relays],
    followed: Boolean(existing.followed || data.followed),
    confidence: bestConfidence(existing.confidence, data.confidence)
  });
}

function bestConfidence(a = 'candidate', b = 'candidate') {
  const rank = { exact: 5, cached: 4, profile: 3, 'relay-search': 2, candidate: 1 };
  return (rank[b] ?? 0) > (rank[a] ?? 0) ? b : a;
}

function candidateScore(row, query) {
  const q = String(query ?? '').toLowerCase();
  const profile = row.profile ?? {};
  let score = ({ exact: 1000, cached: 800, profile: 650, 'relay-search': 500, candidate: 100 })[row.confidence] ?? 100;
  if (row.followed) score += 75;
  if (profile.nip05?.toLowerCase() === q) score += 220;
  if ([profile.name, profile.displayName].some((value) => String(value ?? '').toLowerCase() === q)) score += 180;
  if ([profile.name, profile.displayName, profile.nip05].some((value) => String(value ?? '').toLowerCase().includes(q))) score += 80;
  score += Math.min(60, (row.relays?.length ?? 0) * 8);
  return score;
}

function normalizeDiscoverProfile(content = {}) {
  return {
    name: cleanString(content.name, 80),
    displayName: cleanString(content.display_name ?? content.displayName ?? content.name, 120),
    about: cleanString(content.about, 500),
    picture: cleanString(content.picture, 500),
    nip05: cleanString(content.nip05, 200)
  };
}

export function enrichedFollowingEntries(following = {}) {
  const directory = following.directory ?? {};
  return (following.entries ?? []).map((entry) => {
    const pubkey = normalizePubkey(entry.pubkey) || entry.pubkey;
    const cached = directory[pubkey] ?? {};
    return {
      ...entry,
      pubkey,
      npub: cached.npub || pubkeyToNpub(pubkey),
      profile: cached.profile ?? null,
      profileEvent: cached.profileEvent ?? null,
      local: cached.local ?? { note: entry.note || '', tags: [], favorite: false, hidden: false },
      status: cached.status ?? { profileFetch: 'pending', lastFetchedAt: null, error: '' },
      analytics: following.analytics?.[pubkey] ?? defaultFollowAnalytics(pubkey)
    };
  });
}

export function followDirectorySummary(following = {}) {
  const entries = following.entries ?? [];
  const directory = following.directory ?? {};
  const total = entries.length;
  const rows = entries.map((entry) => directory[normalizePubkey(entry.pubkey) || entry.pubkey]).filter(Boolean);
  const cached = rows.filter((row) => row.status?.profileFetch === 'ok').length;
  const missing = total - cached;
  const errors = rows.filter((row) => row.status?.profileFetch === 'error').length;
  return { total, cached, missing, errors, updatedAt: following.directoryUpdatedAt ?? null };
}

export function followAnalyticsSummary(following = {}) {
  const entries = following.entries ?? [];
  const analytics = following.analytics ?? {};
  const rows = entries.map((entry) => analytics[normalizePubkey(entry.pubkey)]).filter(Boolean);
  const count = (fn) => rows.filter(fn).length;
  return {
    total: entries.length,
    analyzed: rows.length,
    followsYou: count((row) => row.followsYou === true),
    oneWay: count((row) => row.followsYou === false),
    unknownReciprocity: entries.length - count((row) => row.followsYou === true) - count((row) => row.followsYou === false),
    veryActive: count((row) => row.activityTier === 'very-active'),
    active: count((row) => row.activityTier === 'active'),
    quiet: count((row) => row.activityTier === 'quiet'),
    inactive: count((row) => row.activityTier === 'inactive'),
    dormant: count((row) => row.activityTier === 'dormant'),
    unknownActivity: entries.length - count((row) => ['very-active', 'active', 'quiet', 'inactive', 'dormant'].includes(row.activityTier)),
    engagement: {
      high: count((row) => row.engagement?.tier === 'high'),
      engaged: count((row) => row.engagement?.tier === 'engaged'),
      light: count((row) => row.engagement?.tier === 'light'),
      low: count((row) => row.engagement?.tier === 'low'),
      unknown: entries.length - count((row) => ['high', 'engaged', 'light', 'low'].includes(row.engagement?.tier))
    },
    updatedAt: following.analyticsUpdatedAt ?? null
  };
}

export function computeFollowAnalytics(entries = [], events = [], relayResults = [], myPubkey = '', tuning = null) {
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - 30 * 86400;
  const latestKind3 = new Map();
  const activity = new Map();
  for (const event of events) {
    const author = normalizePubkey(event.pubkey);
    if (!author) continue;
    if (event.kind === 3) {
      const previous = latestKind3.get(author);
      if (!previous || (event.created_at ?? 0) > (previous.created_at ?? 0)) latestKind3.set(author, event);
      continue;
    }
    const row = activity.get(author) ?? defaultActivityStats();
    const created = event.created_at ?? 0;
    row.lastActivityAt = Math.max(row.lastActivityAt ?? 0, created) || null;
    if (event.kind === 1) { row.lastPostAt = Math.max(row.lastPostAt ?? 0, created) || null; if (created >= thirtyDaysAgo) row.counts.posts30d += 1; }
    if (event.kind === 6) { row.lastRepostAt = Math.max(row.lastRepostAt ?? 0, created) || null; if (created >= thirtyDaysAgo) row.counts.reposts30d += 1; }
    if (event.kind === 7) { row.lastReactionAt = Math.max(row.lastReactionAt ?? 0, created) || null; if (created >= thirtyDaysAgo) row.counts.reactions30d += 1; }
    if (event.kind === 9734) { row.lastZapAt = Math.max(row.lastZapAt ?? 0, created) || null; if (created >= thirtyDaysAgo) row.counts.zaps30d += 1; }
    activity.set(author, row);
  }
  const anyRelayAnswered = relayResults.some((row) => row.status === 'ok' || row.status?.startsWith('partial'));
  const anyActivityRelayAnswered = relayResults.some((row) => (row.status === 'ok' || row.status?.startsWith('partial')) && (row.kinds ?? []).some((kind) => [1, 6, 7, 9734].includes(kind)));
  const updatedAt = new Date().toISOString();
  return Object.fromEntries(entries.map((entry) => {
    const pubkey = normalizePubkey(entry.pubkey);
    const contactList = latestKind3.get(pubkey);
    const followsYou = contactList ? (contactList.tags ?? []).some((tag) => tag[0] === 'p' && normalizePubkey(tag[1]) === myPubkey) : null;
    const stats = activity.get(pubkey) ?? defaultActivityStats();
    const engagement = engagementQuality(stats.counts, stats.lastActivityAt, tuning);
    return [pubkey, {
      pubkey,
      followsYou,
      followsYouStatus: contactList ? 'known' : (anyRelayAnswered ? 'unknown' : 'error'),
      contactListEvent: contactList ? { id: contactList.id, created_at: contactList.created_at, relay: contactList.relay } : null,
      activityStatus: stats.lastActivityAt ? 'known' : (anyActivityRelayAnswered ? 'not-observed' : 'unknown'),
      activityTier: activityTier(stats.lastActivityAt, tuning),
      lastActivityAt: stats.lastActivityAt,
      lastPostAt: stats.lastPostAt,
      lastRepostAt: stats.lastRepostAt,
      lastReactionAt: stats.lastReactionAt,
      lastZapAt: stats.lastZapAt,
      counts: stats.counts,
      engagement,
      updatedAt
    }];
  }).filter(([pubkey]) => pubkey));
}

export function mergeFollowActivityAnalytics(existingAnalytics = {}, entries = [], events = [], relayResults = [], myPubkey = '', tuning = null) {
  const fallbackAnalytics = computeFollowAnalytics(entries, events, relayResults, myPubkey, tuning);
  const merged = { ...existingAnalytics };
  for (const [pubkey, fallback] of Object.entries(fallbackAnalytics)) {
    if (fallback.activityTier === 'unknown' || !fallback.lastActivityAt) continue;
    const existing = merged[pubkey] ?? defaultFollowAnalytics(pubkey);
    merged[pubkey] = {
      ...existing,
      activityStatus: fallback.activityStatus,
      activityTier: fallback.activityTier,
      lastActivityAt: fallback.lastActivityAt,
      lastPostAt: fallback.lastPostAt,
      lastRepostAt: fallback.lastRepostAt,
      lastReactionAt: fallback.lastReactionAt,
      lastZapAt: fallback.lastZapAt,
      counts: fallback.counts,
      engagement: fallback.engagement,
      updatedAt: fallback.updatedAt
    };
  }
  return merged;
}

export function followListTruth(following = {}, relayResults = []) {
  const localEntries = following.entries ?? [];
  const localPubkeys = new Set(localEntries.map((entry) => normalizePubkey(entry.pubkey)).filter(Boolean));
  const localCreatedAt = following.event?.created_at ?? Math.floor(new Date(following.updatedAt ?? Date.now()).getTime() / 1000);
  const rows = relayResults.map((result) => followTruthRow(result, localPubkeys, localCreatedAt));
  const responding = rows.filter((row) => row.relayStatus === 'ok' || row.relayStatus?.startsWith('partial') || row.eventId).length;
  const matching = rows.filter((row) => row.status === 'match').length;
  const score = responding ? Math.round((matching / responding) * 100) : 0;
  const counts = rows.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {});
  const newestPublished = newestEvent(relayResults.flatMap((result) => (result.events ?? []).filter((event) => event.kind === 3).map((event) => ({ ...event, relay: result.relay }))));
  const latestComparison = newestPublished ? followComparison(localPubkeys, followingPubkeysFromEvent(newestPublished)) : null;
  return {
    scannedAt: new Date().toISOString(),
    status: responding ? (score === 100 ? 'match' : 'review') : 'unknown',
    score,
    summary: responding
      ? `${matching}/${responding} responding relays match local kind:3 follow truth.`
      : 'No responding relays had enough data to compare follow truth.',
    localCount: localPubkeys.size,
    localCreatedAt,
    responding,
    matching,
    counts,
    newestPublished: newestPublished ? { id: newestPublished.id, relay: newestPublished.relay, created_at: newestPublished.created_at, count: latestComparison?.publishedCount ?? 0 } : null,
    latestComparison,
    rows
  };
}

function followTruthRow(result, localPubkeys, localCreatedAt) {
  const event = newestEvent((result.events ?? []).filter((item) => item.kind === 3));
  const base = {
    relay: result.relay,
    relayStatus: result.status,
    latencyMs: result.latencyMs,
    error: result.error || '',
    scannedAt: new Date().toISOString()
  };
  if (!event) {
    return { ...base, status: result.status === 'ok' || result.status?.startsWith('partial') ? 'missing' : 'error', localCount: localPubkeys.size, publishedCount: 0, detail: result.error || 'No kind:3 following event found on this relay.' };
  }
  const comparison = followComparison(localPubkeys, followingPubkeysFromEvent(event));
  const createdAt = event.created_at ?? 0;
  if (comparison.matches) {
    return { ...base, status: 'match', eventId: event.id, created_at: createdAt, localCount: comparison.localCount, publishedCount: comparison.publishedCount, detail: 'Published kind:3 follows match local follow truth.' };
  }
  const status = createdAt > localCreatedAt ? 'newer-public' : createdAt < localCreatedAt ? 'stale' : 'mismatch';
  return {
    ...base,
    status,
    eventId: event.id,
    created_at: createdAt,
    ...comparison,
    detail: status === 'newer-public'
      ? 'Relay has a newer public following list than the local draft.'
      : status === 'stale'
        ? 'Relay following list differs and is older than local draft.'
        : 'Relay following list differs from local draft.'
  };
}

function followingPubkeysFromEvent(event) {
  return new Set((event.tags ?? []).filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => normalizePubkey(tag[1])).filter(Boolean));
}

function followComparison(localPubkeys, publishedPubkeys) {
  const localOnly = [...localPubkeys].filter((pubkey) => !publishedPubkeys.has(pubkey)).sort();
  const publishedOnly = [...publishedPubkeys].filter((pubkey) => !localPubkeys.has(pubkey)).sort();
  return {
    matches: localOnly.length === 0 && publishedOnly.length === 0,
    localCount: localPubkeys.size,
    publishedCount: publishedPubkeys.size,
    localOnlyCount: localOnly.length,
    publishedOnlyCount: publishedOnly.length,
    localOnly: localOnly.slice(0, 20).map((pubkey) => ({ pubkey, npub: pubkeyToNpub(pubkey) })),
    publishedOnly: publishedOnly.slice(0, 20).map((pubkey) => ({ pubkey, npub: pubkeyToNpub(pubkey) }))
  };
}

function followingListTags(entries = []) {
  return entries
    .map((entry) => {
      const pubkey = normalizePubkey(entry.pubkey);
      if (!pubkey) return null;
      const tag = ['p', pubkey];
      const relayHint = normalizeRelayUrl(entry.relayHint);
      const petname = cleanString(entry.petname, 80);
      if (relayHint || petname) tag.push(relayHint || '');
      if (petname) tag.push(petname);
      return tag;
    })
    .filter(Boolean);
}

function updateFollowDirectory(existing, entries, events, sourceRelayResults = []) {
  const directory = { ...existing };
  const latestByPubkey = new Map();
  for (const event of events) {
    const pubkey = normalizePubkey(event.pubkey);
    if (!pubkey) continue;
    const current = latestByPubkey.get(pubkey);
    if (!current || (event.created_at ?? 0) > (current.created_at ?? 0)) latestByPubkey.set(pubkey, event);
  }
  const now = new Date().toISOString();
  for (const entry of entries) {
    const pubkey = normalizePubkey(entry.pubkey) || entry.pubkey;
    const event = latestByPubkey.get(pubkey);
    const previous = directory[pubkey] ?? {};
    if (event) {
      directory[pubkey] = {
        pubkey,
        npub: pubkeyToNpub(pubkey),
        profile: normalizeFollowProfile(parseJsonObject(event.content)),
        profileEvent: { id: event.id, created_at: event.created_at, relay: event.relay },
        follow: { relayHint: entry.relayHint || '', petname: entry.petname || '', addedAt: entry.addedAt || '' },
        local: previous.local ?? { note: entry.note || '', tags: [], favorite: false, hidden: false },
        status: { profileFetch: 'ok', lastFetchedAt: now, error: '' }
      };
    } else {
      directory[pubkey] = {
        pubkey,
        npub: previous.npub || pubkeyToNpub(pubkey),
        profile: previous.profile ?? null,
        profileEvent: previous.profileEvent ?? null,
        follow: { relayHint: entry.relayHint || '', petname: entry.petname || '', addedAt: entry.addedAt || '' },
        local: previous.local ?? { note: entry.note || '', tags: [], favorite: false, hidden: false },
        status: { profileFetch: previous.profile ? 'stale' : 'missing', lastFetchedAt: now, error: sourceRelayResults.some((row) => row.status === 'ok' || row.status?.startsWith('partial')) ? '' : 'No profile events returned from scanned relays' }
      };
    }
  }
  return directory;
}

function normalizeFollowProfile(content = {}) {
  return {
    name: cleanString(content.name, 80),
    displayName: cleanString(content.display_name ?? content.displayName ?? content.name, 120),
    about: cleanString(content.about, 500),
    website: cleanString(content.website, 200),
    picture: cleanString(content.picture, 500),
    banner: cleanString(content.banner, 500),
    nip05: cleanString(content.nip05, 200),
    lud16: cleanString(content.lud16, 200)
  };
}

async function discoverFollowWriteRelays(entries, baseRelays, maxRelays = 8) {
  const pubkeys = entries.map((entry) => normalizePubkey(entry.pubkey)).filter(Boolean);
  if (!pubkeys.length || !baseRelays.length) return [];
  const fetched = await fetchFollowRelayLists(pubkeys, baseRelays, { timeoutMs: 6000 });
  const latestByAuthor = new Map();
  for (const event of fetched.events) {
    const author = normalizePubkey(event.pubkey);
    if (!author) continue;
    const existing = latestByAuthor.get(author);
    if (!existing || (event.created_at ?? 0) > (existing.created_at ?? 0)) latestByAuthor.set(author, event);
  }
  const baseSet = new Set(baseRelays);
  const counts = new Map();
  for (const event of latestByAuthor.values()) {
    for (const tag of event.tags ?? []) {
      if (tag[0] !== 'r' || !tag[1]) continue;
      const url = normalizeRelayUrl(tag[1]);
      if (url && !baseSet.has(url)) counts.set(url, (counts.get(url) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxRelays).map(([url]) => url);
}

function defaultFollowAnalytics(pubkey) {
  return { pubkey, followsYou: null, followsYouStatus: 'unknown', activityStatus: 'unknown', activityTier: 'unknown', lastActivityAt: null, lastPostAt: null, lastRepostAt: null, lastReactionAt: null, lastZapAt: null, counts: { posts30d: 0, reposts30d: 0, reactions30d: 0, zaps30d: 0 }, engagement: defaultEngagement(), updatedAt: null };
}

function defaultEngagement() {
  return { score: 0, tier: 'unknown', counts: { posts30d: 0, reposts30d: 0, reactions30d: 0, zaps30d: 0 } };
}

function defaultActivityStats() {
  return { lastActivityAt: null, lastPostAt: null, lastRepostAt: null, lastReactionAt: null, lastZapAt: null, counts: { posts30d: 0, reposts30d: 0, reactions30d: 0, zaps30d: 0 } };
}

function activityTier(lastActivityAt, tuning = null, now = Math.floor(Date.now() / 1000)) {
  if (!lastActivityAt) return 'unknown';
  const t = tuning?.activity ?? DEFAULT_TUNING.activity;
  const ageDays = (now - lastActivityAt) / 86400;
  if (ageDays <= t.veryActive) return 'very-active';
  if (ageDays <= t.active) return 'active';
  if (ageDays <= t.quiet) return 'quiet';
  if (ageDays <= t.inactive) return 'inactive';
  return 'dormant';
}

function engagementQuality(counts = {}, lastActivityAt = null, tuning = null) {
  const w = tuning?.engagement?.weights ?? DEFAULT_TUNING.engagement.weights;
  const th = tuning?.engagement?.thresholds ?? DEFAULT_TUNING.engagement.thresholds;
  const normalized = {
    posts30d: counts.posts30d ?? 0,
    reposts30d: counts.reposts30d ?? 0,
    reactions30d: counts.reactions30d ?? 0,
    zaps30d: counts.zaps30d ?? 0
  };
  const rawScore = normalized.posts30d * w.post + normalized.reposts30d * w.repost + normalized.reactions30d * w.reaction + normalized.zaps30d * w.zap;
  const score = Math.min(100, rawScore);
  let tier = 'unknown';
  if (lastActivityAt) {
    if (score >= th.high) tier = 'high';
    else if (score >= th.engaged) tier = 'engaged';
    else if (score > 0) tier = 'light';
    else tier = 'low';
  }
  return { score, tier, counts: normalized };
}
