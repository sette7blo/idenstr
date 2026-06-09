# Idenstr Data Model

## Boundary Rule

Nostr-native signed events are canonical where the protocol already defines the object.

App metadata is only for local/private state and operational bookkeeping.

## Canonical Nostr Events

### `kind:0` profile metadata

Canonical source for public profile fields:

- name
- display name
- about/bio
- picture/avatar URL
- banner URL
- website
- NIP-05
- Lightning address / `lud16` where used

Store the complete signed event in the private relay/local vault.

### `kind:3` following/contact list

Canonical source for public following/contact entries:

- followed pubkey
- relay hint
- petname

Do not publish private local annotations.

### `kind:10002` relay list metadata

Canonical source for relay list preferences:

- relay URL
- read/write marker

Private/local relay classification can exist in app metadata when it should not be public.

## App Metadata Tables

Initial schema direction, subject to implementation stack choice:

```text
identities
- id
- public_key_hex
- npub
- display_name
- key_mode              # env_nsec; key is read from .env/IDENSTR_NSEC
- created_at
- updated_at

canonical_events
- id
- identity_id
- event_id
- kind
- pubkey
- created_at_nostr
- event_json
- source                # generated | imported | restored | fetched
- is_current
- created_at

following_entries
- id
- identity_id
- pubkey
- relay_hint
- petname
- local_notes           # private, never publish
- local_tags_json       # private, never publish
- trust_level           # private, never publish
- added_at
- updated_at

relay_configs
- id
- identity_id
- relay_url
- read_enabled
- write_enabled
- private_enabled
- local_only_notes
- created_at
- updated_at

relay_observations
- id
- identity_id
- relay_url
- kind
- event_id
- status                # current | stale | missing | error
- observed_event_json
- observed_at
- error_message

publish_attempts
- id
- identity_id
- relay_url
- event_id
- kind
- status                # pending | success | failed
- attempted_at
- error_message

backup_manifests
- id
- identity_id
- backup_type           # public_events | encrypted_secret | full_app
- file_path
- encrypted
- created_at
- notes

api_tokens
- id
- name
- token_hash            # never store plaintext token
- scopes_json
- created_at
- last_used_at
- revoked_at

api_token_audit_log
- id
- api_token_id
- action
- resource
- created_at
- metadata_json         # never include secrets
```

## Future-Proofing Without Scope Creep

Use `identity_id` everywhere internally, but enforce one visible identity in v0.1.

Do not add:

- identity switcher
- multi-user accounts
- roles/permissions
- team features

until the v0.1 single-identity workflows are stable.

## Sync / Comparison Model

For each canonical event, compare selected relays:

```text
canonical event in local vault
  -> fetch latest matching replaceable event from relay
  -> compare event id / created_at / content
  -> classify relay status
```

Status values:

- `current`: relay has the canonical event.
- `stale`: relay has an older/different event.
- `missing`: relay has no relevant event.
- `error`: relay could not be checked.

## Restore Safety

Restore should be staged:

1. Load backup manifest.
2. Validate event signatures.
3. Show restore preview.
4. Ask for confirmation.
5. Save restored state locally.
6. Optionally publish/repair selected public relays.

Never silently overwrite canonical local state or public relay state.
