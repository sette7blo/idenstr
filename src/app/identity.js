import { createHash } from 'node:crypto';
import { bech32Decode, convertBits, derivePubkeyHexFromNsec, deriveNpubFromNsec, fingerprint, loadState, normalizePubkey, pubkeyToNpub } from './state.js';
import { profileContent } from './profile.js';
import { enrichedFollowingEntries, followAnalyticsSummary, followDirectorySummary } from './following.js';
import { muteListTags } from './mutes.js';
import { getBackups } from './backup.js';
import { signNostrEvent } from './nostrSigner.js';
import { publishEventToRelays } from './nostrRelay.js';
import { storeEventLocally } from './localVault.js';
import { getWallet } from './wallet.js';

// Re-export all domain functions for server.js
export { getProfile, saveProfile, scanProfile, publishProfile, profileTruth, verifyNip05 } from './profile.js';
export { getFollowing, addFollowing, removeFollowing, followAndPublish, unfollowAndPublish, saveFollowing, publishFollowing, scanFollowing, refreshFollowingProfiles, refreshFollowingProfilesStreaming, refreshFollowingAnalytics, refreshFollowingAnalyticsStreaming, discoverFollowSuggestions, followDirectorySummary, followAnalyticsSummary, computeFollowAnalytics, mergeFollowActivityAnalytics, followListTruth } from './following.js';
export { getMutes, addMute, removeMute, saveMutes, publishMutes, muteAndPublish, unmuteAndPublish, muteListTags } from './mutes.js';
export { getRelays, saveRelays, publishRelays, scanRelays, computeFollowingRelayPopularity, getPrivateRelay, savePrivateRelay, inspectPrivateRelay } from './relays.js';
export { getBackups, createBackup, getBackupFile, restoreBackup } from './backup.js';
export { getWallet, saveWallet, clearWallet, walletInfo, walletBalance, payInvoice, payZap } from './wallet.js';
export { loadState } from './state.js';

export function getIdentity() {
  const nsec = process.env.IDENSTR_NSEC ?? '';
  const configuredNpub = process.env.IDENSTR_NPUB ?? '';
  const derivedNpub = nsec ? deriveNpubFromNsec(nsec) : '';
  return {
    mode: process.env.IDENSTR_KEY_MODE ?? 'env_nsec',
    status: nsec ? 'configured' : 'awaiting-onboarding',
    npub: configuredNpub || derivedNpub || null,
    pubkey: nsec ? derivePubkeyHexFromNsec(nsec) : null,
    npubMatchesNsec: Boolean(nsec && configuredNpub && configuredNpub === derivedNpub),
    nsecConfigured: Boolean(nsec),
    nsecFingerprint: nsec ? fingerprint(nsec) : null,
    custody: '.env nsec server-side custody',
    secretExposed: false
  };
}

export async function getFollowingDirectory() {
  const state = await loadState();
  const entries = state.following.entries ?? [];
  const directory = state.following.directory ?? {};
  return entries.map(e => {
    const cached = directory[e.pubkey];
    const profile = cached?.profile ?? cached ?? {};
    return {
      pubkey: e.pubkey,
      petname: e.petname ?? '',
      name: profile.name ?? profile.displayName ?? e.petname ?? '',
      picture: profile.picture ?? ''
    };
  });
}

export async function publishEvent(body) {
  const nsec = process.env.IDENSTR_NSEC ?? '';
  if (!nsec) throw new Error('IDENSTR_NSEC is required to sign events');
  const kind = Number(body.kind);
  if (!Number.isInteger(kind) || kind < 0) throw new Error('kind must be a non-negative integer');
  const content = typeof body.content === 'string' ? body.content : '';
  const tags = Array.isArray(body.tags) ? body.tags : [];
  const created_at = Number.isInteger(body.created_at) ? body.created_at : Math.floor(Date.now() / 1000);
  const event = signNostrEvent(nsec, { kind, created_at, tags, content });
  const local = await storeEventLocally(event);
  if (!local.accepted) return { error: 'vault_unavailable', event: null, ok: false, relayResults: [], localVault: local };
  const state = await loadState();
  const relays = state.relays.write?.length ? state.relays.write : state.relays.read;
  if (!relays.length) throw new Error('no write relays configured');
  const published = await publishEventToRelays(event, relays, { timeoutMs: 6500 });
  return {
    event: { id: event.id, kind: event.kind, pubkey: event.pubkey, created_at: event.created_at, tags: event.tags, content: event.content },
    ok: published.ok,
    relayResults: published.results.map((r) => ({ relay: r.relay, accepted: Boolean(r.accepted), status: r.status, message: r.message || r.error || '' }))
  };
}

export async function getDashboard() {
  const state = await loadState();
  const followingEntries = state.following.entries ?? [];
  const muteEntries = state.mutes.entries ?? [];
  return {
    identity: getIdentity(),
    profile: state.profile,
    following: {
      ...state.following,
      totalCount: followingEntries.length,
      directorySummary: followDirectorySummary(state.following),
      analyticsSummary: followAnalyticsSummary(state.following),
      entries: enrichedFollowingEntries(state.following)
    },
    mutes: {
      ...state.mutes,
      totalCount: muteEntries.length,
      summary: muteSummary(state.mutes),
      tags: muteListTags(muteEntries)
    },
    relays: state.relays,
    wallet: getWallet(),
    tuning: state.tuning,
    backups: await getBackups(),
    audit: state.audit.slice(0, 20)
  };
}

function muteSummary(mutes = {}) {
  const counts = { keyword: 0, pubkey: 0, thread: 0, event: 0, hashtag: 0 };
  for (const entry of mutes.entries ?? []) counts[entry.type] = (counts[entry.type] ?? 0) + 1;
  return counts;
}
