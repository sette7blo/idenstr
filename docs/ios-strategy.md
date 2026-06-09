# Idenstr iOS Strategy

## Decision

Idenstr should support iOS first as an installable web app / PWA, not as a native Swift app yet.

Reason:

- Idenstr is a self-hosted admin dashboard.
- The first mobile need is access from iPhone/iPad to the user's own Idenstr URL.
- The core Nostr identity flows are not implemented yet, so native key custody decisions would be premature.
- A PWA keeps the same Docker image/API app and avoids fragmenting the project too early.

## What “works on iOS” means for v0.1

Minimum iOS-compatible target:

- Safari can open the Idenstr dashboard.
- The app can be added to the iOS home screen.
- The installed app opens in standalone mode.
- Layout respects iOS safe areas / notches.
- Touch targets are usable.
- The UI has bottom mobile navigation.
- The dashboard clearly distinguishes what works now vs what is missing.

## Current iOS/PWA implementation

Implemented files:

```text
public/index.html
public/styles.css
public/manifest.webmanifest
public/icons/apple-touch-icon.svg
public/icons/icon-512.svg
```

Implemented metadata:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="Idenstr" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.svg" />
```

Implemented mobile UX:

- safe-area-aware top bar
- safe-area-aware bottom dock
- single-column mobile dashboard
- installable app manifest
- app icons
- clearer information board: What works now / What is missing / Decision path

## Important iOS limitations

A PWA on iOS is not the same as a full native app.

Expected limitations:

- User must add it to home screen manually.
- Some offline/service-worker behavior can differ from desktop browsers.
- Browser-based secret storage is not ideal for raw `nsec` custody.
- Deep hardware/security integrations are limited compared with native Swift.
- Push/background behavior is constrained and should not be assumed.

## Security posture for iOS

For this project, the Nostr private key is always stored server-side in `.env` as `IDENSTR_NSEC`.

The iOS/PWA client should never store raw `nsec` in browser local storage. Mobile actions that require signing call the self-hosted Idenstr API, and the server signs using the `.env` key.

There is intentionally no signer/NIP-46 path for v0.1. A signer running on the same host as Idenstr is redundant and should not be added.

Recommended mobile modes:

1. **Read/status mobile**
   - view status, relay comparison, backups, and app health
   - no browser-side key material

2. **Server-side `.env` key mode**
   - app server holds/signs using `IDENSTR_NSEC`
   - mobile UI triggers actions through authenticated API
   - personal self-hosting posture with clear warnings

Do not normalize casual plaintext `nsec` entry/storage in iOS Safari.

## Native app decision gate

Only consider a native iOS app after these are working in the web app:

- identity import/generate
- profile edit/publish
- relay fetch/compare
- following edit/publish
- backup/restore
- API token auth
- clear `.env` key custody model

Native iOS may become useful for:

- secure enclave / keychain custody experiments for a future separate mobile client
- better biometric confirmation for API actions
- local notifications
- richer offline state

Until then, native iOS would add complexity before the product shape is stable.

## Test coverage

Current iOS/PWA tests live at:

```text
tests/ios.test.js
```

They verify:

- iOS install metadata
- manifest shape
- safe-area CSS
- bottom mobile dock
- clearer “what works / what is missing” information hierarchy
