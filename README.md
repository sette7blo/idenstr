# Idenstr

Self-hosted Nostr identity dashboard for managing one primary identity, profile, following list, relay state, private event vault, and backups.

Read `AGENT.md` before implementation work.

## Current build

This is the first runnable Idenstr skeleton:

- dependency-free Node 22 app/API
- mysterious sovereign cyberpunk dashboard UI
- system/capabilities/health API endpoints
- interactive dashboard for profile drafts, profile truth scans, enriched following directory, following entries, relay policy, relay scans, follow-based relay popularity, top missing relay suggestions, backups, and audit state
- scoped API token creation/list/revocation
- Docker image release path
- iOS/PWA installability path

## Architecture docs

- `docs/architecture.md` — Idenstr service boundaries and implementation order.
- `docs/data-model.md` — Nostr canonical event vs local app metadata boundary.
- `docs/ios-strategy.md` — iOS/PWA path, limits, and native-app decision gate.

## Local development

```bash
npm test
npm run check
npm start
```

Then open:

```text
http://localhost:3000
```

## iOS / iPhone / iPad

The first iOS-compatible version is an installable PWA:

1. Expose Idenstr over HTTPS or VPN-accessible URL.
2. Open it in Safari on iPhone/iPad.
3. Use Share → Add to Home Screen.
4. Launch it as a standalone app.

For v0.1, iOS uses the same server-side `.env` key model as the web app. Do not store plaintext `nsec` in browser local storage and do not add a signer layer.

See `docs/ios-strategy.md`.

## API endpoints

```text
GET    /api/v1/system/info
GET    /api/v1/system/health
GET    /api/v1/capabilities
GET    /api/v1/overview
GET    /api/v1/dashboard
GET    /api/v1/identity
GET    /api/v1/profile
PUT    /api/v1/profile
GET    /api/v1/following
POST   /api/v1/following
POST   /api/v1/following/profiles/refresh
DELETE /api/v1/following/{id}
GET    /api/v1/relays
PUT    /api/v1/relays
POST   /api/v1/relays/publish
POST   /api/v1/relays/scan
GET    /api/v1/backups
POST   /api/v1/backups
GET    /api/v1/api-tokens
POST   /api/v1/api-tokens
DELETE /api/v1/api-tokens/{id}
```

Create an API token:

```bash
curl -s http://localhost:3000/api/v1/api-tokens   -H 'content-type: application/json'   -d '{"name":"Feedstr link","scopes":["read:identity","read:following"]}'
```

Tokens are returned once and stored only as SHA-256 hashes in the development JSON token store.

## Docker image

Build:

```bash
docker build -t idenstr:dev .
```

Run:

```bash
docker run --rm   -p 3000:3000   -v idenstr-data:/data   -e IDENSTR_KEY_MODE=env_nsec   -e IDENSTR_NSEC=replace-with-your-nsec   -e IDENSTR_PRIVATE_RELAY_URL=ws://private-relay:8080   idenstr:dev
```

The long-term release artifact should be a published Docker/OCI image. Compose files are orchestration examples, not the product.

## UX direction

The visual language intentionally blends:

- mysterious sovereign control room
- cyberpunk dark surfaces
- Monero orange privacy signal
- Bitcoin gold self-custody signal
- purple decentralized identity glow
- `*arr`/torrent-style operational dashboard density

Idenstr is not a social feed. It is the key room.
