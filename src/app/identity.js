import { createHash } from 'node:crypto';
import { bech32Decode, convertBits, derivePubkeyHexFromNsec, deriveNpubFromNsec, fingerprint, loadState, normalizePubkey, pubkeyToNpub } from './state.js';
import { profileContent } from './profile.js';
import { enrichedFollowingEntries, followAnalyticsSummary, followDirectorySummary } from './following.js';
import { getBackups } from './backup.js';

// Re-export all domain functions for server.js
export { getProfile, saveProfile, scanProfile, publishProfile, profileTruth } from './profile.js';
export { getFollowing, addFollowing, removeFollowing, saveFollowing, publishFollowing, scanFollowing, refreshFollowingProfiles, refreshFollowingProfilesStreaming, refreshFollowingAnalytics, refreshFollowingAnalyticsStreaming, discoverFollowSuggestions, followDirectorySummary, followAnalyticsSummary, computeFollowAnalytics, mergeFollowActivityAnalytics, followListTruth } from './following.js';
export { getRelays, saveRelays, publishRelays, scanRelays, computeFollowingRelayPopularity } from './relays.js';
export { getBackups, createBackup, getBackupFile, restoreBackup } from './backup.js';
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

export async function getDashboard() {
  const state = await loadState();
  const followingEntries = state.following.entries ?? [];
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
    relays: state.relays,
    backups: await getBackups(),
    audit: state.audit.slice(0, 20)
  };
}
