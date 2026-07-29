import test from 'node:test';
import assert from 'node:assert/strict';
import { getSystemInfo, getHealth, getCapabilities, getStackTopology } from '../src/app/system.js';

test('system info identifies Idenstr as the first modular *str app', () => {
  const info = getSystemInfo();
  assert.equal(info.app, 'idenstr');
  assert.equal(info.name, 'Idenstr');
  assert.equal(info.ecosystem, '*str');
  assert.equal(info.modular, true);
  assert.match(info.description, /self-hosted Nostr identity dashboard/i);
});

test('health endpoint exposes service status without leaking secrets', () => {
  const health = getHealth({ privateRelayUrl: 'ws://idenstr-relay.local:7777', keyMode: 'env_nsec' });
  assert.equal(health.status, 'ok');
  assert.equal(health.services.app, 'ok');
  assert.equal(health.services.privateRelay.configured, true);
  assert.equal(health.keyMode, 'env_nsec');
  assert.equal(JSON.stringify(health).includes('secret-test-value'), false);
});

test('capabilities include API-token-linkable identity scopes', () => {
  const capabilities = getCapabilities();
  assert.equal(capabilities.app, 'idenstr');
  assert.ok(capabilities.capabilities.includes('identity.read'));
  assert.ok(capabilities.capabilities.includes('profile.write'));
  assert.ok(capabilities.capabilities.includes('following.read'));
  assert.ok(capabilities.capabilities.includes('relays.write'));
  assert.ok(capabilities.capabilities.includes('relays.import'));
  assert.ok(capabilities.capabilities.includes('zaps.write'));
});

test('stack topology exposes the private relay URL without secrets', () => {
  const previousUrl = process.env.IDENSTR_PRIVATE_RELAY_URL;
  try {
    process.env.IDENSTR_PRIVATE_RELAY_URL = 'ws://idenstr-relay.local:7777';
    const stack = getStackTopology();
    assert.equal(stack.topology.privateRelay.url, 'ws://idenstr-relay.local:7777');
    assert.equal(stack.topology.signing.endpoint, '/api/v1/sign');
    assert.equal(stack.topology.signing.nip46, false);
    assert.equal(JSON.stringify(stack).includes('nsec'), false);
  } finally {
    restoreEnv('IDENSTR_PRIVATE_RELAY_URL', previousUrl);
  }
});

test('stack topology derives the private relay URL from the LAN IP when no URL is set', () => {
  const previousUrl = process.env.IDENSTR_PRIVATE_RELAY_URL;
  const previousIp = process.env.IDENSTR_LAN_IP;
  const previousPort = process.env.IDENSTR_PRIVATE_RELAY_PORT;
  try {
    delete process.env.IDENSTR_PRIVATE_RELAY_URL;
    process.env.IDENSTR_LAN_IP = 'idenstr-host.local';
    process.env.IDENSTR_PRIVATE_RELAY_PORT = '7777';
    const stack = getStackTopology();
    assert.equal(stack.topology.privateRelay.url, 'ws://idenstr-host.local:7777');
  } finally {
    restoreEnv('IDENSTR_PRIVATE_RELAY_URL', previousUrl);
    restoreEnv('IDENSTR_LAN_IP', previousIp);
    restoreEnv('IDENSTR_PRIVATE_RELAY_PORT', previousPort);
  }
});

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
