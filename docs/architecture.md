# Idenstr Architecture

> **For Hermes:** Idenstr v0.1 is a self-hosted identity/control dashboard, not a Nostr client or feed app.

## Product Boundary

Idenstr manages one primary Nostr identity in v0.1 and is the first independent app in the modular `*str` ecosystem.

Idenstr should expose versioned APIs and scoped API-token access so later apps can link to it without sharing its database.

Idenstr owns:

- one `.env`-stored `nsec` and derived `npub`
- one `kind:0` profile
- one `kind:3` following/contact list
- one `kind:10002` relay list
- one private relay connection
- backup/restore for identity state
- relay comparison and repair for identity events

It does **not** include feeds, trending, recommendations, followers dashboard, public relay hosting, or multi-user hosting.

## API / App Linking Boundary

Idenstr must be linkable from later apps by base URL + API token.

Minimum app-linking endpoints:

```text
GET /api/v1/system/info
GET /api/v1/system/health
GET /api/v1/capabilities
POST /api/v1/api-tokens
DELETE /api/v1/api-tokens/{id}
```

Implemented token scopes (`requiredScope()` in `src/server.js`):

```text
admin                  everything: dashboard, token CRUD, backups, tuning, mutations
sign:kind:<N>          POST /api/v1/sign for event kind N (one scope per kind)
profile:read           GET /api/v1/profile, GET /api/v1/identity
relays:read            GET /api/v1/relays
following:read         GET /api/v1/following, GET /api/v1/following/directory
```

Planned with their endpoints: `nip44:encrypt`, `nip44:decrypt`, `mutes:read`, `mutes:write`, `vault:write`. Tokens created without explicit scopes get none.

Never expose plaintext `nsec` through app-linking APIs.

## Internal Layers

```text
UI / Dashboard
   |
Application API / Actions
   |
Domain services
   |-- Identity service
   |-- Profile service
   |-- Following service
   |-- Relay service
   |-- Vault service
   |-- Backup service
   |-- Publish/repair service
   |
Adapters
   |-- Nostr relay client
   |-- Private relay adapter
   |-- App metadata DB adapter
   |-- Backup/export adapter
   |-- Secret/key custody adapter
```

## Domain Services

### Identity service

Handles:

- import/generate primary identity
- derive/display `npub`
- read `nsec` from `.env` / `IDENSTR_NSEC`
- safe one-time `nsec` handling during onboarding
- no signer/NIP-46 path; same-host signer is redundant for this self-hosted app

### Profile service

Handles:

- build canonical `kind:0` event
- fetch profile events from configured relays
- compare relay versions
- save canonical local version
- publish/repair selected relays

### Following service

Handles:

- build canonical `kind:3` event
- add/remove follows
- petnames and relay hints
- local-only follow notes/tags in app DB
- relay comparison
- backup/restore following history

### Relay service

Handles:

- manage `kind:10002` relay list metadata
- separate read/write/private relays
- check relay health
- compare relay state for profile/following/relay-list events
- queue publish/repair attempts

### Vault service

Handles:

- store canonical signed Nostr events
- store historical event versions
- expose private relay status
- support backup/export

### Backup service

Handles:

- public event JSON exports
- encrypted key/secret backups
- full identity restore manifests
- restore preview before destructive overwrite
- republish restored canonical state to selected relays

## Data Model Direction

Use `identity_id` internally even though v0.1 exposes only one identity.

This keeps future multi-identity support possible without complicating the UI early.

Core entities:

```text
identities
profiles
following_entries
relay_configs
canonical_events
relay_observations
publish_attempts
backup_manifests
```

See `docs/data-model.md` for the app DB / Nostr event boundary.

## API Shape

Prefer explicit action endpoints or handlers over generic CRUD where safety matters.

Idenstr also needs a stable app-to-app API because future modules will link to it the way Prowlarr/Sonarr/Lidarr link with API keys.

System/linking endpoints:

```text
GET    /api/v1/system/info
GET    /api/v1/system/health
GET    /api/v1/capabilities
GET    /api/v1/api-tokens
POST   /api/v1/api-tokens
DELETE /api/v1/api-tokens/{id}
```

Domain endpoints:

```text
POST /api/v1/onboarding/import
POST /api/v1/onboarding/generate
GET  /api/v1/overview
GET  /api/v1/identity
GET  /api/v1/profile
POST /api/v1/profile/save-canonical
POST /api/v1/profile/publish
GET  /api/v1/following
POST /api/v1/following/add
POST /api/v1/following/remove
POST /api/v1/following/publish
GET  /api/v1/relays
POST /api/v1/relays/check
POST /api/v1/relays/repair
GET  /api/v1/backups
POST /api/v1/backups/export
POST /api/v1/backups/restore-preview
POST /api/v1/backups/restore-apply
```

Destructive operations should have preview/confirm flows.

## Security Rules

- Never send plaintext `nsec` to the browser after onboarding reveal.
- Always load the signing key from `.env` (`IDENSTR_NSEC`) for v0.1.
- No signer/NIP-46 layer: a same-host signer is redundant and should not be added.
- Never log `nsec`.
- Never include `nsec` in normal JSON backups.
- Never publish local-only follow notes/tags.
- Warn before overwriting canonical local state.
- Warn before republishing older restored state to public relays.

## Implementation Order

1. Infra skeleton.
2. Nostr domain/event library tests.
3. Key import/generation tests.
4. Local private relay integration.
5. App metadata DB schema.
6. Relay fetch/compare for `kind:0`.
7. Profile editor/publish.
8. Following manager/publish.
9. Relay list manager/publish.
10. Backup/restore.
11. Dashboard polish.
