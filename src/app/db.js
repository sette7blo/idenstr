import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
let db = null;
let dbPath = null;

export function getDbPath() {
  if (process.env.IDENSTR_DB_STORE) return process.env.IDENSTR_DB_STORE;
  if (process.env.IDENSTR_STATE_STORE) return process.env.IDENSTR_STATE_STORE.replace(/\.json$/i, '.db');
  return join(root, 'data', 'idenstr.db');
}

export function getDb() {
  const nextPath = getDbPath();
  if (db && dbPath === nextPath) return db;
  if (db) db.close();
  mkdirSync(dirname(nextPath), { recursive: true });
  db = new DatabaseSync(nextPath);
  dbPath = nextPath;
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scopes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      rate_limit INTEGER NOT NULL DEFAULT 60,
      type TEXT NOT NULL DEFAULT 'api'
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(token_hash);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at);
    CREATE TABLE IF NOT EXISTS signing_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      token_id TEXT,
      token_name TEXT,
      type TEXT NOT NULL DEFAULT 'sign',
      kind INTEGER,
      event_id TEXT,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_signing_log_at ON signing_log(at);
    CREATE TABLE IF NOT EXISTS event_snapshots (
      event_id TEXT PRIMARY KEY,
      kind INTEGER NOT NULL,
      created_at INTEGER,
      event_json TEXT NOT NULL,
      replaced_at TEXT NOT NULL
    );
  `);
  return db;
}

export function stateIsEmpty() {
  const row = getDb().prepare('SELECT COUNT(*) AS count FROM state').get();
  return row.count === 0;
}

export function maybeMigrateJsonState(readJsonFile) {
  const statePath = process.env.IDENSTR_STATE_STORE ?? join(root, 'data', 'idenstr-state.json');
  if (!stateIsEmpty() || !existsSync(statePath)) return null;
  const migrated = readJsonFile(statePath);
  setStateValue('app', migrated);
  renameSync(statePath, `${statePath}.migrated`);
  return migrated;
}

export function getStateValue(key) {
  const row = getDb().prepare('SELECT value FROM state WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

export function setStateValue(key, value) {
  getDb().prepare(`
    INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), new Date().toISOString());
}

export function closeDbForTests() {
  if (db) db.close();
  db = null;
  dbPath = null;
}
