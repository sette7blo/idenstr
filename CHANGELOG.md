# Changelog

All notable changes to Idenstr will be documented here.
Versions follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`

- **MAJOR** — breaking changes (e.g. DB schema requires migration)
- **MINOR** — new features, backwards compatible
- **PATCH** — bug fixes, visual tweaks

---

## [Unreleased]

## [v1.0.0] — 2026-06-24
### Added
- First-class kind:10000 mute-list management: Idenstr now has a dedicated Muted section, `GET/POST/PUT/DELETE /api/v1/mutes` draft APIs, scoped `mutes:read` / `mutes:write` token permissions, and publish support that signs the mute list, writes it to the private relay, and broadcasts it to public write relays. Entries cover keywords, pubkeys, threads/events, and hashtags.
- Scoped follow/unfollow for linked apps: `POST /api/v1/following/follow` and `POST /api/v1/following/unfollow` (both keyed by pubkey) add or remove a contact in the local-truth kind:3 and then sign and broadcast it to the private vault and public relays in one call. Authorized with the new `following:write` scope (selectable in the token UI) instead of admin, so apps like Feedstr can manage follows without holding admin or the ability to sign kind:3 directly. `removeFollowing` now also matches by pubkey (not just internal id), and the token scope picker gained a "Follow / unfollow" checkbox.
- Phase 1 distributed architecture foundation: SQLite state/token store with JSON migration, scoped `idstr_` API tokens for app-to-app calls, `GET /api/v1/whoami`, and `POST /api/v1/sign` for internal REST signing
- Auth model: the dashboard authenticates with HTTP Basic credentials (`IDENSTR_AUTH_USER`/`IDENSTR_AUTH_PASSWORD`) so access no longer depends on how the port is bound; linked apps continue to use scoped bearer tokens, validated and scope-checked, and `POST /api/v1/sign` requires a token so every signature is attributed in the signing log. Idenstr refuses to start if it is bound beyond localhost without credentials set
- Private relay write-ahead vault support: signed events are written to the private relay (`IDENSTR_PRIVATE_RELAY_URL`) before external relay publication, compose includes a `private-relay` service, and `GET /api/v1/stack` exposes non-secret topology so downstream apps can discover the private relay URL
- API token management in the dashboard: create scoped tokens with a one-time value reveal, list with scopes and last use, revoke; tokens created without explicit scopes now default to none instead of the unused read:identity scope
- Backup format v2: backups now include the vault events from the private relay, API tokens (hashes only — consuming apps keep working after a restore), tuning settings, and the signing log; restore writes vault events back to the relay and reinstates tokens, and v1 backup files still restore
- Scoped publishing for linked apps: `POST /api/v1/events/publish` is now authorized per-kind (`publish:events` or `publish:kind:<n>`) instead of admin-only, so apps like Workstr can have Idenstr sign and publish on their behalf without admin rights; scoped tokens still cannot publish Idenstr-owned identity kinds. New token-UI checkboxes for `sign:kind:30078` and `publish:kind:1`
- Profile now supports NIP-05 identifier and lightning address (lud16/lud06): editable in the profile form, shown on the overview card, covered by the truth scan
- Server-side NIP-05 verification: checks .well-known/nostr.json on the configured domain against the identity pubkey
- Private Relay is now its own dashboard section, separate from Public Relays: configure the vault URL, run a connection test, and inspect the canonical signed events stored in your vault, shown as a total plus per-kind stat cards with friendly names. New endpoints `GET/PUT /api/v1/private-relay` and `POST /api/v1/private-relay/inspect`
- The Backups section now states plainly what a backup contains — the app database **and** every signed event in the private relay vault — with a colour-keyed legend and a per-backup vault-event count, so the vault's inclusion is no longer hidden
### Changed
- The Relays section is split into **Public Relays** (kind:10002 distribution policy) and **Private Relay** (your canonical vault); the private relay URL field moved out of the public relay form into its own section
- Action buttons now show pressed, working, and done states instead of staying static (all sections)
- Relay actions (save policy, add, remove, adopt suggestion) now confirm what changed in the relay activity log, with an explicit "nothing was published" note
- Storage layers are now legible in the UI: the three stores are named distinctly and consistently — **Draft** (app database), **Private relay** (your signed vault), **Public relays** (the network). Each canonical object (profile, follows, relay list) shows a **Draft → Private relay → Public relays** state strip indicating where it currently lives, with a colour per store. The word "local" is gone — both the database and the private relay are local, so it was ambiguous. Save buttons read "Save draft"; publish logs now show the private-relay write as an explicit hop before public relays
- New Idenstr app icon, redesigned to sit cohesively in the *str suite alongside Feedstr: the shared dark-purple squircle, glowing crescent orbit, and rounded lowercase monogram, with a glowing key as Idenstr's own accent for the sovereign nsec / single primary identity. All sizes (header logo, favicon, PWA and iOS home-screen icons) are regenerated from one vector source via `scripts/generate-icon.py`, rendered on an opaque backdrop so the iOS apple-touch-icon masks correctly instead of showing through as black
- Tuning moved from the overview page to its own view, reached from a new topbar link; each parameter group now has a short explanation
- Default bind is now `0.0.0.0` so the dashboard and linked apps are reachable over a LAN or Tailscale/WireGuard mesh out of the box; set `IDENSTR_HOST_BIND=127.0.0.1` for a local-only install
- The private relay is read-reachable for fast reads by linked apps, with write authority enforced by pinning the relay write policy to the owner key (`IDENSTR_NPUB`) instead of relying on network isolation
- Settled the relay naming: the embedded Strfry vault is now consistently the **private relay**. One URL, `IDENSTR_PRIVATE_RELAY_URL`, is the single source of truth — Idenstr's own vault writes, the address advertised to other *str apps, and the dashboard prefill all use it. **Breaking config change:** `IDENSTR_LOCAL_RELAY`, `IDENSTR_LOCAL_RELAY_BIND`, `IDENSTR_LOCAL_RELAY_PORT`, and the unused `IDENSTR_PRIVATE_RELAY_HOST_PORT` are removed and replaced by `IDENSTR_PRIVATE_RELAY_URL` / `IDENSTR_PRIVATE_RELAY_BIND` / `IDENSTR_PRIVATE_RELAY_PORT`; the compose service `localrelay` is renamed to `private-relay`. Regenerate your `.env` from `.env.example`
- Private relay is LAN-by-default: published on `0.0.0.0` so apps on other hosts on the same LAN can reach it, advertised as `ws://<LAN_IP>:7777`. New `scripts/detect-lan-ip.sh` detects the host LAN IP and writes `IDENSTR_LAN_IP` + the URL into `.env`
- The private relay URL is now editable and saved from the dashboard relay panel: it prefills with the detected LAN URL, and saving rewrites `IDENSTR_PRIVATE_RELAY_URL` in `.env` (mount `.env` writable, `chmod 660 .env`) with a notice to recreate the container to apply
- The Private Relay section now connects automatically when opened: the connection status and vault contents load on entering the section (and after saving a URL), instead of staying hidden behind a manual click. The former "Test connection" button is now "Refresh" for re-reading the vault on demand
- Dashboard navigation is now one consistent card model. The overview groups its cards under two labels — **Identity** (Profile, Following, Public relays, Private relay) and **Settings** (Connected apps, Backups, Activity log, Tuning) — and every section is reached by tapping a card. The overloaded Backups view is split into three focused views: **Backups**, **Connected apps** (API token management, promoted out of Backups and reframed around authorising your other *str apps), and **Activity log** (the former audit trail). Tuning is now a Settings card and the lone "Tuning" topbar link is replaced by a persistent "Overview" home link. Overview cards show live counts for connected apps and activity-log entries
### Fixed
- The favicon, PWA manifest, and home-screen icons now load without authentication, so the app icon actually appears (previously the auth gate returned 401 for these assets, and iOS fell back to a generated letter tile instead of the Idenstr icon). Static assets are also served with correct MIME types (`image/png`, `image/x-icon`, `application/manifest+json`); the dashboard and API remain authenticated
- Private relay vault now mounts a custom strfry write policy that pins writes to the owner key and rejects kind 5 deletions and NIP-40 expirations; the policy fails closed (rejects all writes) if the owner key is not configured, and the image's bundled sample policy was silently rejecting every kind except 10002, which blocked all signing and profile/following publishes
- Much faster page load: API and static responses are now gzip-compressed and JSON is no longer pretty-printed (dashboard payload dropped from 2.3 MB to ~400 KB on the wire)
- Publishing the profile no longer strips kind:0 fields Idenstr does not manage; unknown fields are preserved and round-tripped

---

## [v0.1.1] — 2026-06-09
### Changed
- New logo and branding: violet crescent with golden star, replacing old star icon
- PWA icons now use PNG assets (512, 192, 180) instead of SVG
- Added favicon for browser tab
- Header displays new logo mark
- Softer purple background gradients replacing orange accents
- Faster fallback relay discovery with ranked relay selection

---

## [v0.1.0] — 2026-06-09
### Added
- Project scaffolding: Node.js server, Dockerfile, compose stack
- Identity module: import existing nsec from env, derive npub
- Nostr event signing and relay publishing
- Profile management (kind:0)
- Following list management (kind:3)
- Relay list management (kind:10002)
- Private relay / local vault integration
- Backup and restore support
- API token authentication
- System health and info endpoints
- Calm admin dashboard UI
- Relay state comparison (current/stale/missing)

---

[Unreleased]: https://github.com/sette7blo/idenstr/compare/v1.0.0...HEAD
[v1.0.0]: https://github.com/sette7blo/idenstr/compare/v0.1.1...v1.0.0
[v0.1.1]: https://github.com/sette7blo/idenstr/compare/v0.1.0...v0.1.1
[v0.1.0]: https://github.com/sette7blo/idenstr/releases/tag/v0.1.0
