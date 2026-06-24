# Idenstr

Self-hosted Nostr identity dashboard. Own your profile, following list, relay policy, and backups — without trusting a third-party client or cloud service.

Idenstr is the first module of the [*str stack](https://github.com/sette7blo): a sovereignty-focused, modular Nostr ecosystem inspired by the *arr stack (Sonarr, Radarr, etc.) but built for Nostr identity and data ownership.

## What it does

- **Identity** — import an existing Nostr keypair or generate a new one
- **Profile** — edit and publish your kind:0 profile, compare state across relays
- **Following** — manage your kind:3 contact list as an intentional address book
- **Public Relays** — manage your kind:10002 relay list, see which relays are current/stale/missing
- **Private Relay** — your canonical vault: a local copy of every signed event, with a connection test and event inspector
- **Backups** — export and restore your profile, following list, relay config, API tokens, tuning, and the vault's signed events in one file
- **API tokens** — scoped tokens for connecting other *str apps (Feedstr, Relaystr, etc.)

Idenstr is not a Nostr client. It does not show feeds, trending content, or engagement stats. It is a control panel for your Nostr identity.

## Install

### Docker Compose (recommended)

Create a directory for Idenstr, download the relay write policy, and add two files:

```bash
mkdir -p relay
curl -o relay/write-policy.py https://raw.githubusercontent.com/sette7blo/idenstr/main/relay/write-policy.py
chmod +x relay/write-policy.py
```

The write policy makes the private relay behave as a permanent, owner-only vault: it accepts only events signed by your identity (`IDENSTR_NPUB`) and rejects deletions and expirations. This is what lets the relay be read-reachable by your other devices while only Idenstr can write to it. Without the policy, the strfry image's bundled sample policy silently rejects almost every event and publishing will fail with `vault_unavailable`.

**compose.yaml**
```yaml
services:
  idenstr:
    image: dockersette/idenstr:latest
    container_name: idenstr
    restart: unless-stopped
    env_file: .env
    environment:
      IDENSTR_PRIVATE_RELAY_URL: ${IDENSTR_PRIVATE_RELAY_URL:-ws://private-relay:7777}
      IDENSTR_ENV_FILE: /app/.env
    ports:
      - "${IDENSTR_HOST_BIND:-0.0.0.0}:${IDENSTR_HOST_PORT:-3000}:3000"
    volumes:
      - idenstr-data:/data
      # Writable so saving the private relay URL in the dashboard persists to .env.
      - ./.env:/app/.env
    depends_on:
      - private-relay

  private-relay:
    image: dockurr/strfry:latest
    container_name: idenstr-private-relay
    restart: unless-stopped
    environment:
      IDENSTR_OWNER_PUBKEY: ${IDENSTR_NPUB:-}
    ports:
      - "${IDENSTR_PRIVATE_RELAY_BIND:-0.0.0.0}:${IDENSTR_PRIVATE_RELAY_PORT:-7777}:7777"
    volumes:
      - idenstr-relay-data:/app/strfry-db
      - ./relay/write-policy.py:/app/write-policy.py:ro

volumes:
  idenstr-data:
  idenstr-relay-data:
```

**.env**
```bash
IDENSTR_KEY_MODE=env_nsec
IDENSTR_NPUB=your-npub-here
IDENSTR_NSEC=your-nsec-here
IDENSTR_HOST_PORT=3000
IDENSTR_HOST_BIND=0.0.0.0
IDENSTR_AUTH_USER=admin
IDENSTR_AUTH_PASSWORD=choose-a-long-password
# The private relay is LAN-by-default so your other *str apps (on this host or
# another on the same LAN) can reach it. Run scripts/detect-lan-ip.sh to fill
# these from your host's LAN IP, or set them by hand.
IDENSTR_LAN_IP=
IDENSTR_PRIVATE_RELAY_URL=ws://private-relay:7777
IDENSTR_PRIVATE_RELAY_BIND=0.0.0.0
IDENSTR_PRIVATE_RELAY_PORT=7777
```

The `idenstr` service runs as your host user (`user: "${UID:-1000}:${GID:-1000}"`), so the bind-mounted `.env` it owns stays writable when the dashboard saves the relay URL. Detect your LAN IP, then start it:
```bash
./scripts/detect-lan-ip.sh   # writes IDENSTR_LAN_IP + ws://<LAN_IP>:7777 into .env
docker compose up -d --build
```

The **private relay** is the embedded Strfry write-ahead vault. There is one URL for it (`IDENSTR_PRIVATE_RELAY_URL`): Idenstr writes its own canonical events there, advertises it to your other *str apps, and prefills it in the dashboard's relay panel. You can edit it there and save — that rewrites `.env`; recreate the container (`docker compose up -d`) to apply.

Open `http://<host>:3000` and log in with the username and password you set in `IDENSTR_AUTH_USER` / `IDENSTR_AUTH_PASSWORD`. The default bind is `0.0.0.0`, so the dashboard is reachable across your LAN or Tailscale/WireGuard mesh; set `IDENSTR_HOST_BIND=127.0.0.1` if you want it local-only. Idenstr refuses to start when bound beyond localhost without credentials. For access from outside your LAN/mesh, put it behind an HTTPS reverse proxy — Basic credentials are not encrypted on their own.

Other *str apps connect the other way around: generate a scoped token in the dashboard (API tokens section), then enter Idenstr's address and that token in the app's settings — they live in the app's `.env`.

### Docker run
Docker Compose is recommended because Idenstr uses a private relay. If you use `docker run`, also run a private relay and set `IDENSTR_PRIVATE_RELAY_URL` to its `ws://` URL. Without a configured private relay, Idenstr can run for local development, but write-ahead vault enforcement is skipped.

## Configuration

All configuration is in `.env`. See `.env.example` for all available options.

| Variable | Required | Description |
|---|---|---|
| `IDENSTR_NSEC` | Yes | Your Nostr private key (nsec format), held only by Idenstr |
| `IDENSTR_NPUB` | Yes | Your Nostr public key (npub format) |
| `IDENSTR_AUTH_USER` | Yes* | Dashboard login username (HTTP Basic). *Required unless bound to `127.0.0.1` |
| `IDENSTR_AUTH_PASSWORD` | Yes* | Dashboard login password (HTTP Basic). *Required unless bound to `127.0.0.1`; Idenstr refuses to start without it when exposed beyond localhost |
| `IDENSTR_ADMIN_TOKEN` | No | Optional admin bearer token for scripts and curl |
| `IDENSTR_HOST_BIND` | No | Host/IP for Docker to expose the dashboard on, default `0.0.0.0` (LAN/mesh reachable); set `127.0.0.1` for local-only |
| `IDENSTR_HOST_PORT` | No | Host port, default `3000` |
| `IDENSTR_PRIVATE_RELAY_URL` | Recommended | Private relay WebSocket URL — the write-ahead signed-event vault. One URL serves Idenstr's own writes, what it advertises to linked apps, and the dashboard prefill; writes pinned to `IDENSTR_NPUB`. Editable and saved from the dashboard |
| `IDENSTR_LAN_IP` | No | Host LAN IP used to derive the private relay URL when one is not set; filled by `scripts/detect-lan-ip.sh` |
| `IDENSTR_PRIVATE_RELAY_BIND` | No | Host/IP Docker publishes the private relay on, default `0.0.0.0` (LAN reachable) |
| `IDENSTR_PRIVATE_RELAY_PORT` | No | Private relay host port, default `7777` |
| `IDENSTR_DEFAULT_READ_RELAYS` | No | Comma-separated relay URLs for reading |
| `IDENSTR_DEFAULT_WRITE_RELAYS` | No | Comma-separated relay URLs for writing |

State is stored in SQLite at `/data/idenstr.db`. Existing JSON state is imported once on startup and renamed to `.migrated`. API tokens are shown once, then stored only as hashes.

Your private key never leaves Idenstr. It is read from `.env` at startup, used to sign events server-side, and never exposed through the API, logs, UI, Feedstr, or other modules. Inter-module signing uses scoped REST tokens in Phase 1; NIP-46 is deferred to Phase 2 for external clients.

## iOS / iPad

Idenstr works as an installable PWA:

1. Expose Idenstr over HTTPS (reverse proxy, Tailscale, etc.)
2. Open in Safari on your device
3. Share > Add to Home Screen
4. Launch as a standalone app

## DB vs vault

Idenstr keeps two stores with a clean split: **signed Nostr events go in the private relay (the vault); everything else goes in the app DB.** The vault holds your canonical `kind:0`, `kind:3`, and `kind:10002` events — portable, republishable objects. The DB holds app/private state that must never be published: follow notes and labels, relay health checks, publish attempts, backup manifests, and UI prefs. Neither is the other's backup; the backup flow exports both. See `docs/architecture.md` → Storage Boundary for the full rule.

These are three distinct stores, and the dashboard names them as such. Each canonical object (profile, follows, relay list) carries a **Draft → Private relay → Public relays** state strip showing where it currently lives. Your public relay policy lives under **Public Relays** (distribution); your vault lives under **Private Relay** (canonical ownership). Save writes a Draft to the DB; Publish signs it, writes it to your Private Relay, then pushes it to your Public Relays.

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
