# Idenstr Documentation

Quick map of what lives where.

## In this folder

| Document | What it covers |
|---|---|
| [architecture.md](architecture.md) | Product boundary, API surface and token scopes, internal layers |
| [data-model.md](data-model.md) | What is canonical (signed Nostr events) vs local app metadata |
| [ios-strategy.md](ios-strategy.md) | Mobile decision: installable PWA first, no native app yet |

## At the repo root

| Document | What it covers |
|---|---|
| [../README.md](../README.md) | User-facing install, configuration, and stack overview |
| [../CHANGELOG.md](../CHANGELOG.md) | Release history and unreleased changes |
| [../AGENT.md](../AGENT.md) | Original v0.1 build brief and product philosophy |

## Reading order

New to the project: `../README.md` for what it is and how to run it, then `architecture.md` for the boundaries, then `data-model.md` before touching state or events. `AGENT.md` explains why the product deliberately excludes feeds, trending, and engagement features.
