import { addAudit, loadState, randomUUID, saveState } from './state.js';

export async function getBackups() {
  return (await loadState()).backups;
}

export async function createBackup() {
  const state = await loadState();
  const payload = {
    version: 1,
    app: 'idenstr',
    createdAt: new Date().toISOString(),
    profile: state.profile,
    following: state.following,
    relays: state.relays
  };
  const json = JSON.stringify(payload, null, 2);
  const backup = {
    id: randomUUID(),
    createdAt: payload.createdAt,
    profileIncluded: true,
    followingIncluded: true,
    relaysIncluded: true,
    followingCount: (state.following.entries ?? []).length,
    relayCount: (state.relays.read ?? []).length + (state.relays.write ?? []).length,
    sizeBytes: Buffer.byteLength(json)
  };
  state.backups.unshift(backup);
  addAudit(state, 'backup.created', `Backup ${backup.id} created (${backup.sizeBytes} bytes)`);
  await saveState(state);
  return { backup, data: payload };
}

export async function restoreBackup(data) {
  if (!data || data.app !== 'idenstr' || data.version !== 1) {
    throw new Error('Invalid backup: must be an Idenstr v1 backup file');
  }
  const state = await loadState();
  const changes = [];
  if (data.profile) {
    state.profile = data.profile;
    changes.push('profile');
  }
  if (data.following) {
    state.following = data.following;
    changes.push(`following (${(data.following.entries ?? []).length} entries)`);
  }
  if (data.relays) {
    state.relays = data.relays;
    changes.push('relays');
  }
  addAudit(state, 'backup.restored', `Restored from backup: ${changes.join(', ')}`);
  await saveState(state);
  return { restored: changes, restoredAt: new Date().toISOString() };
}
