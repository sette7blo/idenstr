import { getPublicKey, nip19, nip44, nip17 } from 'nostr-tools';
import { storeEventLocally } from './localVault.js';
import { publishEventToRelays } from './nostrRelay.js';
import { loadState } from './state.js';

export function dmCapabilities() {
  return {
    preferred: 'NIP-17 private DMs using NIP-44 encryption',
    endpoints: {
      encrypt: 'POST /api/v1/dms/nip44/encrypt',
      decrypt: 'POST /api/v1/dms/nip44/decrypt',
      wrap: 'POST /api/v1/dms/wrap',
      unwrap: 'POST /api/v1/dms/unwrap',
      send: 'POST /api/v1/dms/send'
    },
    keyCustody: 'server-side IDENSTR_NSEC only; browser apps never receive raw key material'
  };
}

export async function encryptNip44(body = {}) {
  const { secretKey } = identitySecret();
  const recipientPubkey = normalizePubkey(body.recipientPubkey ?? body.pubkey, 'recipientPubkey');
  const plaintext = requireString(body.plaintext ?? body.content, 'plaintext');
  const conversationKey = nip44.v2.utils.getConversationKey(secretKey, recipientPubkey);
  return { payload: nip44.v2.encrypt(plaintext, conversationKey), recipientPubkey };
}

export async function decryptNip44(body = {}) {
  const { secretKey } = identitySecret();
  const peerPubkey = normalizePubkey(body.senderPubkey ?? body.peerPubkey ?? body.pubkey, 'senderPubkey');
  const payload = requireString(body.payload ?? body.content, 'payload');
  const conversationKey = nip44.v2.utils.getConversationKey(secretKey, peerPubkey);
  return { plaintext: nip44.v2.decrypt(payload, conversationKey), peerPubkey };
}

export async function wrapDm(body = {}) {
  const { secretKey, pubkey } = identitySecret();
  const recipients = normalizeRecipients(body.recipients ?? body.recipient ?? body.recipientPubkey);
  const message = requireString(body.message ?? body.content, 'message');
  const conversationTitle = optionalString(body.conversationTitle ?? body.subject);
  const replyTo = normalizeReplyTo(body.replyTo);
  const events = recipients.length === 1
    ? [nip17.wrapEvent(secretKey, recipients[0], message, conversationTitle, replyTo)]
    : nip17.wrapManyEvents(secretKey, recipients, message, conversationTitle, replyTo);
  return { pubkey, events: events.map(publicEvent), count: events.length };
}

export async function unwrapDm(body = {}) {
  const { secretKey } = identitySecret();
  const event = body.event;
  if (!event || typeof event !== 'object') throw new Error('event is required');
  const unwrapped = nip17.unwrapEvent(event, secretKey);
  return { event: publicEvent(unwrapped) };
}

export async function sendDm(body = {}) {
  const wrapped = await wrapDm(body);
  const relays = await dmWriteRelays(body.relays);
  const results = [];
  for (const event of wrapped.events) {
    const local = await storeEventLocally(event);
    if (!local.accepted) {
      results.push({ event: publicEvent(event), ok: false, localVault: local, relayResults: [] });
      continue;
    }
    const published = await publishEventToRelays(event, relays, { timeoutMs: 6500 });
    results.push({
      event: publicEvent(event),
      ok: published.ok,
      localVault: local,
      relayResults: published.results.map((r) => ({ relay: r.relay, accepted: Boolean(r.accepted), status: r.status, message: r.message || r.error || '' }))
    });
  }
  return { ok: results.some(r => r.ok), relays, results };
}

export async function listDmInbox() {
  // Real relay sync belongs in DMstr's next phase. This endpoint exists so scoped
  // apps can discover that Idenstr is the DM custody boundary without raw nsec.
  return { conversations: [], note: 'DM relay sync is not implemented yet; use /dms/send and /dms/unwrap crypto endpoints first.' };
}

function identitySecret() {
  const nsec = process.env.IDENSTR_NSEC ?? '';
  if (!nsec) throw new Error('IDENSTR_NSEC is required for DM encryption');
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec' || !(decoded.data instanceof Uint8Array) || decoded.data.length !== 32) throw new Error('IDENSTR_NSEC must decode to a 32-byte secret');
  const pubkey = getPublicKey(decoded.data);
  return { secretKey: decoded.data, pubkey };
}

function normalizeRecipients(input) {
  const raw = Array.isArray(input) ? input : [input];
  const recipients = raw.map((item) => {
    if (typeof item === 'string') return { publicKey: normalizePubkey(item, 'recipientPubkey') };
    if (item && typeof item === 'object') return { publicKey: normalizePubkey(item.publicKey ?? item.pubkey ?? item.recipientPubkey, 'recipientPubkey'), relayUrl: optionalString(item.relayUrl ?? item.relay) };
    throw new Error('recipient is required');
  });
  if (!recipients.length) throw new Error('at least one recipient is required');
  return recipients;
}

function normalizeReplyTo(value) {
  if (!value) return undefined;
  if (typeof value !== 'object') throw new Error('replyTo must be an object');
  return { eventId: normalizeEventId(value.eventId ?? value.id), relayUrl: optionalString(value.relayUrl ?? value.relay) };
}

function normalizePubkey(value, field) {
  const text = String(value ?? '').trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(text)) return text;
  if (text.startsWith('npub1')) {
    const decoded = nip19.decode(text);
    if (decoded.type === 'npub' && typeof decoded.data === 'string') return decoded.data;
  }
  throw new Error(`${field} must be a 32-byte hex pubkey or npub`);
}

function normalizeEventId(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) throw new Error('replyTo.eventId must be a 32-byte hex event id');
  return text;
}

function requireString(value, field) {
  const text = String(value ?? '');
  if (!text.trim()) throw new Error(`${field} is required`);
  return text;
}

function optionalString(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

async function dmWriteRelays(input) {
  const explicit = Array.isArray(input) ? input.map(optionalString).filter(Boolean) : [];
  if (explicit.length) return [...new Set(explicit)];
  const state = await loadState();
  const relays = [...(state.relays.write ?? []), ...(state.relays.read ?? [])].filter(Boolean);
  if (!relays.length) throw new Error('no DM relays configured');
  return [...new Set(relays)];
}

function publicEvent(event) {
  return { id: event.id, kind: event.kind, pubkey: event.pubkey, created_at: event.created_at, tags: event.tags ?? [], content: event.content, sig: event.sig };
}
