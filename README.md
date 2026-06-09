# Idenstr

Self-hosted Nostr identity dashboard. Own your profile, following list, relay policy, and backups — without trusting a third-party client or cloud service.

Idenstr is the first module of the [*str stack](https://github.com/sette7blo): a sovereignty-focused, modular Nostr ecosystem inspired by the *arr stack (Sonarr, Radarr, etc.) but built for Nostr identity and data ownership.

## What it does

- **Identity** — import an existing Nostr keypair or generate a new one
- **Profile** — edit and publish your kind:0 profile, compare state across relays
- **Following** — manage your kind:3 contact list as an intentional address book
- **Relays** — manage your kind:10002 relay list, see which relays are current/stale/missing
- **Private vault** — keep a canonical local copy of all your signed events
- **Backups** — export and restore your identity, profile, following list, and relay config
- **API tokens** — scoped tokens for connecting other *str apps (Feedstr, Relaystr, etc.)

Idenstr is not a Nostr client. It does not show feeds, trending content, or engagement stats. It is a control panel for your Nostr identity.

## Install

### Docker Compose (recommended)

```bash
git clone https://github.com/sette7blo/idenstr.git
cd idenstr
cp .env.example .env
# edit .env — add your IDENSTR_NSEC and IDENSTR_NPUB
docker compose up -d
```

Open `http://localhost:3000`

### Docker run

```bash
docker run -d \
  --name idenstr \
  -p 3000:3000 \
  -v idenstr-data:/data \
  -e IDENSTR_KEY_MODE=env_nsec \
  -e IDENSTR_NPUB=your-npub-here \
  -e IDENSTR_NSEC=your-nsec-here \
  dockersette/idenstr:latest
```

### From source

Requires Node.js 22+.

```bash
git clone https://github.com/sette7blo/idenstr.git
cd idenstr
cp .env.example .env
# edit .env
npm start
```

## Configuration

All configuration is in `.env`. See `.env.example` for all available options.

| Variable | Required | Description |
|---|---|---|
| `IDENSTR_NSEC` | Yes | Your Nostr private key (nsec format) |
| `IDENSTR_NPUB` | Yes | Your Nostr public key (npub format) |
| `IDENSTR_HOST_PORT` | No | Host port (default: 3000) |
| `IDENSTR_DB_PASSWORD` | No | Postgres password (default: idenstr-dev-password) |
| `IDENSTR_DEFAULT_READ_RELAYS` | No | Comma-separated relay URLs for reading |
| `IDENSTR_DEFAULT_WRITE_RELAYS` | No | Comma-separated relay URLs for writing |

Your private key never leaves the server. It is read from `.env` at startup, used to sign events server-side, and never exposed through the API, logs, or UI.

## iOS / iPad

Idenstr works as an installable PWA:

1. Expose Idenstr over HTTPS (reverse proxy, Tailscale, etc.)
2. Open in Safari on your device
3. Share > Add to Home Screen
4. Launch as a standalone app

## The *str stack

Idenstr is designed to work standalone or as part of a larger self-hosted Nostr stack. Each *str app is independent and connects to others via URL + API token — just like Sonarr connects to Prowlarr.

| App | Purpose | Status |
|---|---|---|
| **Idenstr** | Identity, profile, following, relay state, backups | v0.1.0 |
| Relaystr | Relay policy, health monitoring, routing | Planned |
| Feedstr | Calm feed engine, no trending or engagement bait | Planned |
| Mediastr | Avatar/banner hosting, media ownership | Planned |
| Archivstr | Personal archive and event preservation | Planned |
| Liststr | Mutes, bookmarks, topic groups | Planned |
| Publishstr | Composer, drafts, scheduled publishing | Planned |
| Searchstr | Local search over owned Nostr data | Planned |
| Discoverstr | Trust-based discovery without clickbait | Planned |

## License

[MIT](LICENSE)
