import test from 'node:test';
import assert from 'node:assert/strict';
import { getSystemInfo, getHealth, getCapabilities } from '../src/app/system.js';

test('system info identifies Idenstr as the first modular *str app', () => {
  const info = getSystemInfo();
  assert.equal(info.app, 'idenstr');
  assert.equal(info.name, 'Idenstr');
  assert.equal(info.ecosystem, '*str');
  assert.equal(info.modular, true);
  assert.match(info.description, /self-hosted Nostr identity dashboard/i);
});

test('health endpoint exposes service status without leaking secrets', () => {
  const health = getHealth({ privateRelayUrl: 'ws://private-relay:8080', keyMode: 'env_nsec' });
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
});
