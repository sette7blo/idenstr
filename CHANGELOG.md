# Changelog

All notable changes to Idenstr will be documented here.
Versions follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`

- **MAJOR** — breaking changes (e.g. DB schema requires migration)
- **MINOR** — new features, backwards compatible
- **PATCH** — bug fixes, visual tweaks

---

## [Unreleased]

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

[Unreleased]: https://github.com/sette7blo/idenstr/compare/v0.1.0...HEAD
[v0.1.0]: https://github.com/sette7blo/idenstr/releases/tag/v0.1.0
