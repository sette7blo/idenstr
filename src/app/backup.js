import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb } from './db.js';
import { fetchAllEvents, storeEventsLocally } from './localVault.js';
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
        version: data.version,
        followingCount: (data.following?.entries ?? []).length,
        relayCount: (data.relays?.read ?? []).length + (data.relays?.write ?? []).length,
        eventCount: (data.vault?.events ?? []).length,
        tokenCount: (data.tokens ?? []).length,
        vaultIncluded: Boolean(data.vault?.included),
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
  const vault = await fetchAllEvents();
  // token_hash is a sha256 of the secret: safe to export, and restoring it
  // keeps the consuming apps' existing idstr_ secrets working.
  const tokens = getDb().prepare('SELECT * FROM tokens ORDER BY created_at').all();
  const signingLog = getDb().prepare('SELECT at, token_id, token_name, type, kind, event_id, detail FROM signing_log ORDER BY id').all();
  const payload = {
    version: 2,
    app: 'idenstr',
    id,
    createdAt: now,
    profile: state.profile,
    following: state.following,
    relays: state.relays,
    tuning: state.tuning,
    audit: state.audit,
    tokens,
    signingLog,
    vault: { included: vault.ok, message: vault.ok ? '' : vault.message, events: vault.events }
  };
  const json = JSON.stringify(payload, null, 2);
  const filename = `idenstr-${now.slice(0, 10)}-${id.slice(0, 8)}.json`;
  await mkdir(BACKUP_DIR, { recursive: true });
  await writeFile(join(BACKUP_DIR, filename), json);
  const vaultNote = vault.ok ? `${vault.events.length} vault events` : `vault NOT included: ${vault.message}`;
  addAudit(state, 'backup.created', `Backup ${filename} saved (${Buffer.byteLength(json)} bytes, ${tokens.length} tokens, ${vaultNote})`);
  await saveState(state);
  return {
    id,
    filename,
    createdAt: now,
    followingCount: (state.following.entries ?? []).length,
    eventCount: vault.events.length,
    tokenCount: tokens.length,
    vaultIncluded: vault.ok,
    sizeBytes: Buffer.byteLength(json)
  };
}

export async function getBackupFile(filename) {
  if (!filename || filename.includes('..') || !filename.endsWith('.json')) return null;
  try {
    return await readFile(join(BACKUP_DIR, filename), 'utf8');
  } catch { return null; }
}

export async function restoreBackup(data) {
  if (!data || data.app !== 'idenstr' || ![1, 2].includes(data.version)) {
    throw new Error('Invalid backup: must be an Idenstr v1 or v2 backup file');
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
  if (data.tuning) {
    state.tuning = data.tuning;
    changes.push('tuning');
  }
  if (Array.isArray(data.tokens) && data.tokens.length) {
    const insert = getDb().prepare(`
      INSERT OR REPLACE INTO tokens (id, name, token_hash, scopes, created_at, last_used_at, revoked_at, rate_limit, type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let imported = 0;
    for (const token of data.tokens) {
      if (!token?.id || !token?.token_hash || !token?.name) continue;
      insert.run(token.id, token.name, token.token_hash, token.scopes ?? '[]', token.created_at ?? new Date().toISOString(), token.last_used_at ?? null, token.revoked_at ?? null, token.rate_limit ?? 60, token.type ?? 'api');
      imported += 1;
    }
    changes.push(`tokens (${imported})`);
  }
  if (Array.isArray(data.vault?.events) && data.vault.events.length) {
    // One connection, all events — not a fresh socket per event.
    const result = await storeEventsLocally(data.vault.events);
    changes.push(`vault events (${result.accepted} restored${result.failed ? `, ${result.failed} failed` : ''})`);
  }
  // signingLog is archival: kept in the backup file for the record, never
  // merged into a live log on restore.
  addAudit(state, 'backup.restored', `Restored from backup: ${changes.join(', ')}`);
  await saveState(state);
  return { restored: changes, restoredAt: new Date().toISOString() };
}
