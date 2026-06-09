export const APP_VERSION = '0.1.0';

export function getSystemInfo() {
  return {
    app: 'idenstr',
    name: 'Idenstr',
    version: APP_VERSION,
    ecosystem: '*str',
    modular: true,
    description: 'Self-hosted Nostr identity dashboard for sovereign profile, following, relay state, vault, and backups.',
    links: {
      docs: '/docs',
      health: '/api/v1/system/health',
      capabilities: '/api/v1/capabilities'
    }
  };
}

export function getHealth(config = {}) {
  const privateRelayUrl = config.privateRelayUrl ?? process.env.IDENSTR_PRIVATE_RELAY_URL ?? '';
  const keyMode = config.keyMode ?? process.env.IDENSTR_KEY_MODE ?? 'env_nsec';
  return {
    status: 'ok',
    app: 'idenstr',
    version: APP_VERSION,
    keyMode,
    services: {
      app: 'ok',
      privateRelay: {
        configured: Boolean(privateRelayUrl),
        url: privateRelayUrl || null
      },
      metadataStore: 'local-json-dev'
    }
  };
}

export function getCapabilities() {
  return {
    app: 'idenstr',
    version: APP_VERSION,
    capabilities: [
      'system.info',
      'system.health',
      'api-tokens.manage',
      'identity.read',
      'identity.write',
      'profile.read',
      'profile.write',
      'following.read',
      'following.write',
      'relays.read',
      'relays.write',
      'relays.scan',
      'relays.import',
      'vault.read',
      'backups.create',
      'dashboard.interactive'
    ]
  };
}

export function getOverview() {
  return {
    identity: {
      mode: process.env.IDENSTR_KEY_MODE ?? 'env_nsec',
      npubConfigured: Boolean(process.env.IDENSTR_NPUB),
      status: process.env.IDENSTR_NPUB ? 'configured' : 'awaiting-onboarding'
    },
    profile: { status: 'not-published', relayState: 'unknown' },
    following: { count: 0, relayState: 'unknown' },
    relays: {
      read: splitRelays(process.env.IDENSTR_DEFAULT_READ_RELAYS),
      write: splitRelays(process.env.IDENSTR_DEFAULT_WRITE_RELAYS),
      private: process.env.IDENSTR_PRIVATE_RELAY_URL ?? null
    },
    vault: { status: process.env.IDENSTR_PRIVATE_RELAY_URL ? 'configured' : 'not-configured' },
    backups: { lastBackup: null, encryptedSecretsRequired: process.env.IDENSTR_REQUIRE_ENCRYPTED_SECRET_BACKUPS !== 'false' }
  };
}

function splitRelays(value = '') {
  return value.split(',').map((relay) => relay.trim()).filter(Boolean);
}
