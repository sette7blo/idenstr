import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
let db = null;
let dbPath = null;
const stmtCache = new Map();

// Compile each SQL once and reuse the prepared statement (cleared whenever the
// database handle is (re)opened so statements never outlive their db).
export function prep(sql) {
  // Always resolve the db first: getDb() detects a path change and clears the
  // statement cache, so a cached statement can never outlive its database.
  const database = getDb();
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = database.prepare(sql);
    stmtCache.set(sql, stmt);
  }
  return stmt;
}

export function getDbPath() {
  if (process.env.IDENSTR_DB_STORE) return process.env.IDENSTR_DB_STORE;
  if (process.env.IDENSTR_STATE_STORE) return process.env.IDENSTR_STATE_STORE.replace(/\.json$/i, '.db');
  return join(root, 'data', 'idenstr.db');
}

export function getDb() {
  const nextPath = getDbPath();
  if (db && dbPath === nextPath) return db;
  if (db) db.close();
  stmtCache.clear();
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
    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id TEXT PRIMARY KEY,
      kind INTEGER NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL,
      publish_at INTEGER NOT NULL,
      timezone TEXT,
      scheduled_local TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_event_id TEXT,
      last_error TEXT,
      relay_results TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status_publish_at ON scheduled_posts(status, publish_at);
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
  const row = prep('SELECT value FROM state WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

export function setStateValue(key, value) {
  prep(`
    INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), new Date().toISOString());
}

export function closeDbForTests() {
  if (db) db.close();
  db = null;
  dbPath = null;
  stmtCache.clear();
}
