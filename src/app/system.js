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
  const url = config.privateRelayUrl ?? privateRelayUrl();
  const keyMode = config.keyMode ?? process.env.IDENSTR_KEY_MODE ?? 'env_nsec';
  return {
    status: 'ok',
    app: 'idenstr',
    version: APP_VERSION,
    keyMode,
    services: {
      app: 'ok',
      privateRelay: {
        configured: Boolean(url),
        url: url || null
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
      'mutes.read',
      'mutes.write',
      'relays.read',
      'relays.write',
      'relays.scan',
      'relays.import',
      'vault.read',
      'zaps.write',
      'backups.create',
      'dashboard.interactive'
    ]
  };
}

export function getStackTopology() {
  const url = privateRelayUrl();
  return {
    app: 'idenstr',
    version: APP_VERSION,
    topology: {
      privateRelay: {
        configured: Boolean(url),
        url: url || null,
        role: 'write-ahead-vault'
      },
      signing: {
        endpoint: '/api/v1/sign',
        transport: 'rest',
        nip46: false
      }
    },
    capabilities: getCapabilities().capabilities
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
      private: privateRelayUrl() || null
    },
    vault: { status: privateRelayUrl() ? 'configured' : 'not-configured' },
    backups: { lastBackup: null, encryptedSecretsRequired: process.env.IDENSTR_REQUIRE_ENCRYPTED_SECRET_BACKUPS !== 'false' }
  };
}

function splitRelays(value = '') {
  return value.split(',').map((relay) => relay.trim()).filter(Boolean);
}

// The single source of truth for where the private relay lives. Prefers the
// explicitly configured URL; otherwise derives the LAN URL from the detected
// host IP and relay port. Returns '' when neither is known.
export function privateRelayUrl() {
  const explicit = process.env.IDENSTR_PRIVATE_RELAY_URL ?? '';
  if (explicit) return explicit.replace(/\/$/, '');

  const lanIp = process.env.IDENSTR_LAN_IP ?? '';
  const port = process.env.IDENSTR_PRIVATE_RELAY_PORT ?? '7777';
  if (lanIp) return `ws://${lanIp}:${port}`;
  return '';
}
