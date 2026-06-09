import { addAudit, loadState, randomUUID, saveState } from './state.js';

export async function getBackups() {
  return (await loadState()).backups;
}

export async function createBackup() {
  const state = await loadState();
  const backup = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    containsSecrets: false,
    encryptedSecretsRequired: process.env.IDENSTR_REQUIRE_ENCRYPTED_SECRET_BACKUPS !== 'false',
    profileIncluded: true,
    followingIncluded: true,
    relaysIncluded: true,
    nsecIncluded: false,
    sizeBytes: Buffer.byteLength(JSON.stringify({ profile: state.profile, following: state.following, relays: state.relays }))
  };
  state.backups.unshift(backup);
  addAudit(state, 'backup.created', 'Created public-event backup manifest without nsec');
  await saveState(state);
  return backup;
}
