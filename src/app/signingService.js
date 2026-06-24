import { getDb } from './db.js';
import { storeEventLocally } from './localVault.js';
import { signNostrEvent } from './nostrSigner.js';
import { hasScope } from './tokenStore.js';

const IDENSTR_OWNED_KINDS = new Set([0, 3, 10000, 10002]);
const rateBuckets = new Map();

export async function authorizeAndSign({ principal, unsignedEvent }) {
  const kind = Number(unsignedEvent?.kind);
  const required = `sign:kind:${kind}`;
  if (!hasScope(principal?.scopes ?? [], required)) return { status: 403, body: { error: 'scope_denied', required } };
  const validation = validateUnsignedEvent(unsignedEvent);
  if (validation) return { status: 400, body: validation };
  const limited = checkRateLimit(principal);
  if (limited) return { status: 429, body: { error: 'rate_limited' } };
  const nsec = process.env.IDENSTR_NSEC ?? '';
  if (!nsec) return { status: 503, body: { error: 'signer_unavailable' } };
  const event = signNostrEvent(nsec, {
    kind,
    created_at: Number.isInteger(unsignedEvent.created_at) ? unsignedEvent.created_at : Math.floor(Date.now() / 1000),
    tags: unsignedEvent.tags,
    content: unsignedEvent.content
  });
  const local = await storeEventLocally(event);
  if (!local.accepted) return { status: 503, body: { error: 'vault_unavailable' } };
  appendSigningLog(principal, event);
  return { status: 200, body: { event } };
}

function validateUnsignedEvent(event) {
  const kind = Number(event?.kind);
  if (!Number.isInteger(kind) || kind < 0) return { error: 'invalid_event', detail: 'kind must be a non-negative integer' };
  if (IDENSTR_OWNED_KINDS.has(kind)) return { error: 'owned_kind_denied', detail: 'Idenstr-owned replaceable identity kinds must use dedicated endpoints' };
  const createdAt = Number.isInteger(event.created_at) ? event.created_at : Math.floor(Date.now() / 1000);
  if (Math.abs(createdAt - Math.floor(Date.now() / 1000)) > 600) return { error: 'invalid_event', detail: 'created_at must be within 10 minutes of server time' };
  if (!Array.isArray(event.tags) || !event.tags.every((tag) => Array.isArray(tag) && tag.every((item) => typeof item === 'string'))) return { error: 'invalid_event', detail: 'tags must be an array of string arrays' };
  if (typeof event.content !== 'string') return { error: 'invalid_event', detail: 'content must be a string' };
  if ('pubkey' in event || 'id' in event || 'sig' in event) return { error: 'invalid_event', detail: 'submit unsigned events without pubkey, id, or sig' };
  return null;
}

function checkRateLimit(principal) {
  const limit = principal?.rateLimit ?? 60;
  const now = Date.now();
  const key = principal?.id ?? 'anonymous';
  const bucket = rateBuckets.get(key) ?? [];
  const fresh = bucket.filter((at) => now - at < 60_000);
  if (fresh.length >= limit) {
    rateBuckets.set(key, fresh);
    return true;
  }
  fresh.push(now);
  rateBuckets.set(key, fresh);
  return false;
}

function appendSigningLog(principal, event) {
  getDb().prepare(`
    INSERT INTO signing_log (at, token_id, token_name, type, kind, event_id, detail)
    VALUES (?, ?, ?, 'sign', ?, ?, ?)
  `).run(new Date().toISOString(), principal?.id ?? null, principal?.name ?? null, event.kind, event.id, 'REST /api/v1/sign');
}
