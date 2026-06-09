import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export class TokenStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async createToken(name, scopes = []) {
    if (!name || typeof name !== 'string') throw new Error('token name is required');
    if (!Array.isArray(scopes)) throw new Error('scopes must be an array');

    const token = `ids_${randomBytes(32).toString('base64url')}`;
    const record = {
      id: randomBytes(12).toString('hex'),
      name,
      tokenHash: hashToken(token),
      scopes: [...new Set(scopes)].sort(),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null
    };
    const tokens = await this.#readTokens();
    tokens.push(record);
    await this.#writeTokens(tokens);
    return { id: record.id, name: record.name, scopes: record.scopes, token, createdAt: record.createdAt };
  }

  async listTokens() {
    const tokens = await this.#readTokens();
    return tokens.map(({ tokenHash, ...safe }) => safe);
  }

  async revokeToken(id) {
    const tokens = await this.#readTokens();
    const token = tokens.find((entry) => entry.id === id);
    if (!token) return false;
    token.revokedAt = new Date().toISOString();
    await this.#writeTokens(tokens);
    return true;
  }

  async verifyToken(token, requiredScope) {
    if (!token || typeof token !== 'string') return false;
    const tokens = await this.#readTokens();
    const candidateHash = hashToken(token);
    for (const record of tokens) {
      if (record.revokedAt) continue;
      if (!record.scopes.includes(requiredScope) && !record.scopes.includes('admin:app')) continue;
      if (safeEqual(record.tokenHash, candidateHash)) {
        record.lastUsedAt = new Date().toISOString();
        await this.#writeTokens(tokens);
        return true;
      }
    }
    return false;
  }

  async #readTokens() {
    try {
      const data = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(data);
      return Array.isArray(parsed.tokens) ? parsed.tokens : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async #writeTokens(tokens) {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ tokens }, null, 2));
  }
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
