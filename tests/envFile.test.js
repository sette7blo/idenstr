import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateEnvVar } from '../src/app/envFile.js';

async function withTempEnvFile(initial, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'idenstr-envfile-'));
  const path = join(dir, '.env');
  await writeFile(path, initial);
  try {
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('updateEnvVar replaces an existing key in place and leaves other lines untouched', async () => {
  await withTempEnvFile('# header\nIDENSTR_NSEC=secret123\nIDENSTR_PRIVATE_RELAY_URL=ws://old:7777\nIDENSTR_AUTH_PASSWORD=pw\n', async (path) => {
    await updateEnvVar('IDENSTR_PRIVATE_RELAY_URL', 'ws://192.168.1.50:7777', path);
    const out = await readFile(path, 'utf8');
    assert.ok(out.includes('IDENSTR_NSEC=secret123'));
    assert.ok(out.includes('IDENSTR_AUTH_PASSWORD=pw'));
    assert.equal((out.match(/^IDENSTR_PRIVATE_RELAY_URL=/gm) || []).length, 1);
    assert.ok(out.includes('IDENSTR_PRIVATE_RELAY_URL=ws://192.168.1.50:7777'));
    assert.ok(out.startsWith('# header'));
  });
});

test('updateEnvVar appends a missing key without disturbing existing lines', async () => {
  await withTempEnvFile('IDENSTR_NSEC=secret123\n', async (path) => {
    await updateEnvVar('IDENSTR_LAN_IP', '192.168.1.50', path);
    const out = await readFile(path, 'utf8');
    assert.ok(out.includes('IDENSTR_NSEC=secret123'));
    assert.ok(out.includes('IDENSTR_LAN_IP=192.168.1.50'));
  });
});

test('updateEnvVar also reflects the value into process.env', async () => {
  await withTempEnvFile('IDENSTR_PRIVATE_RELAY_URL=ws://old:7777\n', async (path) => {
    await updateEnvVar('IDENSTR_PRIVATE_RELAY_URL', 'ws://10.0.0.2:7777', path);
    assert.equal(process.env.IDENSTR_PRIVATE_RELAY_URL, 'ws://10.0.0.2:7777');
  });
  delete process.env.IDENSTR_PRIVATE_RELAY_URL;
});
