import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDb } from './db.js';

export class TokenStore {
  constructor(_filePath) {}

  async createToken(name, scopes = []) {
    if (!name || typeof name !== 'string') throw new Error('token name is required');
    if (!Array.isArray(scopes)) throw new Error('scopes must be an array');

    const token = `idstr_${randomBytes(32).toString('base64url')}`;
    const record = {
      id: `tok_${randomBytes(12).toString('hex')}`,
      name,
      tokenHash: hashToken(token),
      scopes: [...new Set(scopes)].sort(),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      rateLimit: 60,
      type: 'api'
    };
    getDb().prepare(`
      INSERT INTO tokens (id, name, token_hash, scopes, created_at, last_used_at, revoked_at, rate_limit, type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.name, record.tokenHash, JSON.stringify(record.scopes), record.createdAt, record.lastUsedAt, record.revokedAt, record.rateLimit, record.type);
    return { id: record.id, name: record.name, scopes: record.scopes, token, createdAt: record.createdAt };
  }

  async listTokens() {
    return getDb().prepare('SELECT id, name, scopes, created_at, last_used_at, revoked_at, rate_limit, type FROM tokens ORDER BY created_at DESC').all()
      .map(rowToSafeToken);
  }

  async revokeToken(id) {
    const result = getDb().prepare('UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  async verifyToken(token, requiredScope = null) {
    const principal = await this.authenticate(token);
    if (!principal) return false;
    if (!requiredScope) return true;
    return hasScope(principal.scopes, requiredScope);
  }

  async authenticate(token) {
    if (!token || typeof token !== 'string') return null;
    if (process.env.IDENSTR_ADMIN_TOKEN && safeEqual(hashToken(process.env.IDENSTR_ADMIN_TOKEN), hashToken(token))) {
      return { id: 'env_admin', name: 'env-admin', scopes: ['admin'], rateLimit: 600, type: 'env' };
    }
    const candidateHash = hashToken(token);
    const rows = getDb().prepare('SELECT * FROM tokens WHERE revoked_at IS NULL').all();
    for (const record of rows) {
      if (!safeEqual(record.token_hash, candidateHash)) continue;
      const now = new Date();
      const last = record.last_used_at ? new Date(record.last_used_at) : null;
      if (!last || now.getTime() - last.getTime() > 60_000) {
        getDb().prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(now.toISOString(), record.id);
        record.last_used_at = now.toISOString();
      }
      return {
        id: record.id,
        name: record.name,
        scopes: parseScopes(record.scopes),
        rateLimit: record.rate_limit ?? 60,
        type: record.type ?? 'api'
      };
    }
    return null;
  }
}

export function hashToken(token) {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

export function hasScope(scopes = [], requiredScope) {
  return scopes.includes('admin') || scopes.includes(requiredScope);
}

function rowToSafeToken(row) {
  return {
    id: row.id,
    name: row.name,
    scopes: parseScopes(row.scopes),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    rateLimit: row.rate_limit,
    type: row.type
  };
}

function parseScopes(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
