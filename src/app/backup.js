import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addAudit, loadState, randomUUID, saveState } from './state.js';

const BACKUP_DIR = process.env.IDENSTR_BACKUP_DIR || join(process.env.IDENSTR_STATE_STORE ? join(process.env.IDENSTR_STATE_STORE, '..') : 'data', 'backups');

export async function getBackups() {
  await mkdir(BACKUP_DIR, { recursive: true });
  const files = (await readdir(BACKUP_DIR)).filter((f) => f.endsWith('.json')).sort().reverse();
  const backups = [];
  for (const file of files) {
    try {
      const raw = await readFile(join(BACKUP_DIR, file), 'utf8');
      const data = JSON.parse(raw);
      backups.push({
        id: data.id,
        filename: file,
        createdAt: data.createdAt,
        followingCount: (data.following?.entries ?? []).length,
        relayCount: (data.relays?.read ?? []).length + (data.relays?.write ?? []).length,
        sizeBytes: Buffer.byteLength(raw)
      });
    } catch { /* skip corrupt files */ }
  }
  return backups;
}

export async function createBackup() {
  const state = await loadState();
  const id = randomUUID();
  const now = new Date().toISOString();
  const payload = {
    version: 1,
    app: 'idenstr',
    id,
    createdAt: now,
    profile: state.profile,
    following: state.following,
    relays: state.relays
  };
  const json = JSON.stringify(payload, null, 2);
  const filename = `idenstr-${now.slice(0, 10)}-${id.slice(0, 8)}.json`;
  await mkdir(BACKUP_DIR, { recursive: true });
  await writeFile(join(BACKUP_DIR, filename), json);
  addAudit(state, 'backup.created', `Backup ${filename} saved (${Buffer.byteLength(json)} bytes)`);
  await saveState(state);
  return { id, filename, createdAt: now, followingCount: (state.following.entries ?? []).length, sizeBytes: Buffer.byteLength(json) };
}

export async function getBackupFile(filename) {
  if (!filename || filename.includes('..') || !filename.endsWith('.json')) return null;
  try {
    return await readFile(join(BACKUP_DIR, filename), 'utf8');
  } catch { return null; }
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
