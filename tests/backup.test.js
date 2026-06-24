import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TokenStore } from '../src/app/tokenStore.js';

async function withTempEnv(env, fn) {
  const previous = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function freshBackupModule() {
  return import(`../src/app/backup.js?fresh=${Date.now()}-${Math.random()}`);
}

test('backup v2 includes tuning, tokens, signing log, and vault status', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'idenstr-backup-'));
  await withTempEnv({
    IDENSTR_DB_STORE: join(tempDir, 'idenstr.db'),
    IDENSTR_BACKUP_DIR: join(tempDir, 'backups'),
    IDENSTR_PRIVATE_RELAY_URL: ''
  }, async () => {
    const store = new TokenStore(join(tempDir, 'ignored.json'));
    await store.createToken('feedstr', ['relays:read']);
    const { createBackup } = await freshBackupModule();
    const result = await createBackup();
    assert.equal(result.tokenCount, 1);
    assert.equal(result.vaultIncluded, false);
    const files = await readdir(join(tempDir, 'backups'));
    const data = JSON.parse(await readFile(join(tempDir, 'backups', files[0]), 'utf8'));
    assert.equal(data.version, 2);
    assert.ok(Array.isArray(data.tokens));
    assert.equal(data.tokens[0].name, 'feedstr');
    assert.ok(data.tokens[0].token_hash.startsWith('sha256:'));
    assert.ok(Array.isArray(data.signingLog));
    assert.ok('tuning' in data);
    assert.equal(data.vault.included, false);
  });
});

test('restoring a v2 backup brings tokens back to life on a fresh database', async () => {
  const sourceDir = await mkdtemp(join(tmpdir(), 'idenstr-restore-src-'));
  const targetDir = await mkdtemp(join(tmpdir(), 'idenstr-restore-dst-'));
  let secret;
  let backupData;
  await withTempEnv({
    IDENSTR_DB_STORE: join(sourceDir, 'idenstr.db'),
    IDENSTR_BACKUP_DIR: join(sourceDir, 'backups'),
    IDENSTR_PRIVATE_RELAY_URL: ''
  }, async () => {
    const store = new TokenStore(join(sourceDir, 'ignored.json'));
    secret = (await store.createToken('feedstr', ['relays:read'])).token;
    const { createBackup } = await freshBackupModule();
    await createBackup();
    const files = await readdir(join(sourceDir, 'backups'));
    backupData = JSON.parse(await readFile(join(sourceDir, 'backups', files[0]), 'utf8'));
  });
  await withTempEnv({
    IDENSTR_DB_STORE: join(targetDir, 'idenstr.db'),
    IDENSTR_BACKUP_DIR: join(targetDir, 'backups'),
    IDENSTR_PRIVATE_RELAY_URL: ''
  }, async () => {
    const { restoreBackup } = await freshBackupModule();
    const result = await restoreBackup(backupData);
    assert.ok(result.restored.some((entry) => entry.startsWith('tokens (1')));
    const store = new TokenStore(join(targetDir, 'ignored.json'));
    const principal = await store.authenticate(secret);
    assert.equal(principal.name, 'feedstr');
    assert.deepEqual(principal.scopes, ['relays:read']);
  });
});

test('v1 backups still restore and unknown versions are rejected', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'idenstr-backup-v1-'));
  await withTempEnv({
    IDENSTR_DB_STORE: join(tempDir, 'idenstr.db'),
    IDENSTR_BACKUP_DIR: join(tempDir, 'backups'),
    IDENSTR_PRIVATE_RELAY_URL: ''
  }, async () => {
    const { restoreBackup } = await freshBackupModule();
    const result = await restoreBackup({ app: 'idenstr', version: 1, profile: { name: 'legacy' } });
    assert.ok(result.restored.includes('profile'));
    await assert.rejects(() => restoreBackup({ app: 'idenstr', version: 3 }), /v1 or v2/);
  });
});
