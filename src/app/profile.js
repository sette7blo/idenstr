import { fetchCurrentRelayState, publishEventToRelays } from './nostrRelay.js';
import { signNostrEvent } from './nostrSigner.js';
import { addAudit, buildCanonicalEvent, cleanString, getRequiredPubkey, loadState, newestEvent, normalizeRelays, parseJsonObject, saveState } from './state.js';
import { storeEventLocally } from './localVault.js';

export async function getProfile() {
  return (await loadState()).profile;
}

export async function saveProfile(profile) {
  const state = await loadState();
  const normalized = {
    ...state.profile,
    name: cleanString(profile.name, 80),
    displayName: cleanString(profile.displayName, 120),
    about: cleanString(profile.about, 500),
    website: cleanString(profile.website, 200),
    picture: cleanString(profile.picture, 500),
    banner: cleanString(profile.banner, 500),
    nip05: cleanString(profile.nip05, 140),
    lud16: cleanString(profile.lud16, 140),
    lud06: cleanString(profile.lud06, 500),
    updatedAt: new Date().toISOString()
  };
  state.profile = { ...normalized, event: buildCanonicalEvent(0, profileContent(normalized)), truth: null };
  addAudit(state, 'profile.updated', 'Canonical kind:0 profile draft updated; profile truth scan reset');
  await saveState(state);
  return state.profile;
}

export async function scanProfile() {
  const state = await loadState();
  const all = [...new Set([...state.relays.read, ...state.relays.write])];
  const relayState = await fetchCurrentRelayState(getRequiredPubkey(), all, { timeoutMs: 6500 });
  state.profile.truth = profileTruth(state.profile, relayState.relays);
  addAudit(state, 'profile.scanned', `Scanned profile truth on ${all.length} configured public relays`);
  await saveState(state);
  return { truth: state.profile.truth };
}

export async function publishProfile() {
  const state = await loadState();
  const nsec = process.env.IDENSTR_NSEC ?? '';
  if (!nsec) throw new Error('IDENSTR_NSEC is required to publish profile');
  const event = signNostrEvent(nsec, {
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(profileContent(state.profile))
  });
  const relays = state.relays.write?.length ? state.relays.write : state.relays.read;
  const local = await storeEventLocally(event);
  if (!local.accepted) {
    state.profile.event = { id: event.id, kind: event.kind, created_at: event.created_at, status: 'local-write-failed', signed: true, event, localVault: local };
    state.profile.lastPublish = { at: new Date().toISOString(), ...state.profile.event };
    addAudit(state, 'profile.publish_failed', `Local vault rejected/unreachable: ${local.message}`);
    await saveState(state);
    return { error: 'vault_unavailable', profile: state.profile, published: null };
  }
  const published = await publishEventToRelays(event, relays, { timeoutMs: 6500 });
  state.profile.event = {
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
  state.profile.lastPublish = { at: new Date().toISOString(), ...state.profile.event };
  addAudit(state, published.ok ? 'profile.published' : 'profile.publish_failed', `${published.results.filter((result) => result.accepted).length}/${published.results.length} write relays accepted kind:0 profile`);
  await saveState(state);
  return { profile: state.profile, published };
}

export function profileContent(profile) {
  // extra holds published kind:0 fields Idenstr does not manage; spreading it
  // first means a publish can never silently drop them
  return {
    ...(profile.extra ?? {}),
    name: profile.name || '',
    display_name: profile.displayName || profile.name || '',
    about: profile.about || '',
    website: profile.website || '',
    picture: profile.picture || '',
    banner: profile.banner || '',
    ...(profile.nip05 ? { nip05: profile.nip05 } : {}),
    ...(profile.lud16 ? { lud16: profile.lud16 } : {}),
    ...(profile.lud06 ? { lud06: profile.lud06 } : {})
  };
}

export async function verifyNip05() {
  const state = await loadState();
  const check = await checkNip05(state.profile.nip05 || '', getRequiredPubkey());
  state.profile.nip05Check = { ...check, checkedAt: new Date().toISOString() };
  addAudit(state, 'profile.nip05_checked', `NIP-05 ${state.profile.nip05 || 'unset'}: ${check.status}`);
  await saveState(state);
  return state.profile.nip05Check;
}

async function checkNip05(identifier, pubkey) {
  if (!identifier) return { status: 'unset', detail: 'No NIP-05 identifier configured on the profile.' };
  const at = identifier.lastIndexOf('@');
  const name = at > 0 ? identifier.slice(0, at) : '_';
  const domain = identifier.slice(at + 1);
  if (at < 0 || !domain.includes('.')) return { status: 'invalid', detail: 'NIP-05 identifier must look like name@domain.' };
  try {
    const response = await fetch(`https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(6500),
      headers: { accept: 'application/json' }
    });
    if (!response.ok) return { status: 'error', detail: `HTTP ${response.status} from https://${domain}/.well-known/nostr.json` };
    const mapped = (await response.json())?.names?.[name];
    if (!mapped) return { status: 'missing', detail: `nostr.json on ${domain} has no entry for "${name}".` };
    if (String(mapped).toLowerCase() !== pubkey.toLowerCase()) return { status: 'mismatch', detail: `nostr.json on ${domain} maps "${name}" to a different pubkey.` };
    return { status: 'verified', detail: `${identifier} resolves to this identity's pubkey.` };
  } catch (error) {
    return { status: 'error', detail: error.name === 'TimeoutError' ? `Timed out fetching nostr.json from ${domain}.` : error.message };
  }
}

export function profileTruth(profile, relayResults = []) {
  const local = normalizeProfileContent(profileContent(profile));
  const localCreatedAt = profile.event?.created_at ?? Math.floor(new Date(profile.updatedAt ?? Date.now()).getTime() / 1000);
  const rows = relayResults.map((result) => profileTruthRow(result, local, localCreatedAt));
  const responding = rows.filter((row) => row.relayStatus === 'ok' || row.relayStatus?.startsWith('partial') || row.eventId).length;
  const matching = rows.filter((row) => row.status === 'match').length;
  const score = responding ? Math.round((matching / responding) * 100) : 0;
  const counts = rows.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {});
  return {
    scannedAt: new Date().toISOString(),
    status: responding ? (score === 100 ? 'match' : 'review') : 'unknown',
    score,
    summary: responding
      ? `${matching}/${responding} responding relays match local profile.`
      : 'No responding relays had enough data to compare profile truth.',
    localCreatedAt,
    responding,
    matching,
    counts,
    rows
  };
}

function profileTruthRow(result, local, localCreatedAt) {
  const event = newestEvent((result.events ?? []).filter((item) => item.kind === 0));
  const base = {
    relay: result.relay,
    relayStatus: result.status,
    latencyMs: result.latencyMs,
    error: result.error || '',
    scannedAt: new Date().toISOString()
  };
  if (!event) {
    return { ...base, status: result.status === 'ok' || result.status?.startsWith('partial') ? 'missing' : 'error', detail: result.error || 'No kind:0 profile event found on this relay.' };
  }
  const published = normalizeProfileContent(parseJsonObject(event.content));
  const changedFields = profileDiffFields(local, published);
  const createdAt = event.created_at ?? 0;
  if (!changedFields.length) {
    return { ...base, status: 'match', eventId: event.id, created_at: createdAt, detail: 'Published profile content matches local profile.' };
  }
  const status = createdAt > localCreatedAt ? 'newer-public' : createdAt < localCreatedAt ? 'stale' : 'mismatch';
  return {
    ...base,
    status,
    eventId: event.id,
    created_at: createdAt,
    changedFields,
    diff: changedFields.map((field) => ({ field, local: local[field], published: published[field] })),
    detail: status === 'newer-public'
      ? 'Relay has newer public profile content than local draft.'
      : status === 'stale'
        ? 'Relay profile differs and is older than local draft.'
        : 'Relay profile differs from local draft.'
  };
}

function normalizeProfileContent(content = {}) {
  return {
    name: cleanString(content.name, 80),
    display_name: cleanString(content.display_name ?? content.displayName ?? content.name, 120),
    about: cleanString(content.about, 500),
    website: cleanString(content.website, 200),
    picture: cleanString(content.picture, 500),
    banner: cleanString(content.banner, 500),
    nip05: cleanString(content.nip05, 140),
    lud16: cleanString(content.lud16, 140),
    lud06: cleanString(content.lud06, 500)
  };
}

function profileDiffFields(local, published) {
  return Object.keys(local).filter((field) => local[field] !== published[field]);
}
