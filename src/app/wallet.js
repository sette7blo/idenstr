import { updateEnvVar } from './envFile.js';
import { getStateValue, setStateValue } from './db.js';
import { nip04Decrypt, nip04Encrypt, signEventWithSecret, signNostrEvent } from './nostrSigner.js';
import { storeEventLocally } from './localVault.js';
import { nwcRequest } from './nostrRelay.js';
import { addAudit, loadState, saveState } from './state.js';

const HEX64 = /^[0-9a-f]{64}$/i;
const NWC_KIND_REQUEST = 23194;
const LNURL_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const LNURL_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const DEFAULT_ZAP_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

// Parse a NIP-47 connection string:
//   nostr+walletconnect://<wallet-pubkey-hex>?relay=wss://...&secret=<hex>[&lud16=...]
// Throws on anything malformed so callers never persist a broken connection.
export function parseNwcUri(uri) {
  const raw = String(uri ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^nostr\+walletconnect:\/\/([0-9a-f]{64})\/?\?(.+)$/i);
  if (!match) throw new Error('invalid NWC connection string');
  const walletPubkey = match[1].toLowerCase();
  const params = new URLSearchParams(match[2]);
  const relay = (params.get('relay') ?? '').trim();
  const secret = (params.get('secret') ?? '').trim();
  const lud16 = (params.get('lud16') ?? '').trim();
  if (!/^wss?:\/\//i.test(relay)) throw new Error('NWC connection string is missing a valid relay');
  if (!HEX64.test(secret)) throw new Error('NWC connection string is missing a valid secret');
  return { walletPubkey, relay, secret: secret.toLowerCase(), lud16 };
}

// The full connection string (with the spending secret) lives only in .env and is
// never returned to the browser. Non-secret metadata is cached in the db.
function loadConnection() {
  const uri = process.env.IDENSTR_NWC_URI ?? '';
  if (!uri) return null;
  try {
    return parseNwcUri(uri);
  } catch {
    return null;
  }
}

function meta() {
  return getStateValue('wallet') ?? {};
}

export function getWallet() {
  const conn = loadConnection();
  const m = meta();
  return {
    configured: Boolean(conn),
    walletPubkey: conn?.walletPubkey ?? null,
    relay: conn?.relay ?? null,
    lud16: conn?.lud16 || m.lud16 || null,
    alias: m.alias ?? null,
    methods: m.methods ?? null,
    info: m.info ?? null,
    balanceMsat: m.balanceMsat ?? null,
    balanceAt: m.balanceAt ?? null,
    lastCheckedAt: m.lastCheckedAt ?? null
  };
}

export async function saveWallet(body = {}) {
  const uri = String(body.uri ?? '').trim();
  if (!uri) return clearWallet();
  const conn = parseNwcUri(uri);
  await updateEnvVar('IDENSTR_NWC_URI', uri);
  setStateValue('wallet', { walletPubkey: conn.walletPubkey, relay: conn.relay, lud16: conn.lud16 || null });
  const state = await loadState();
  addAudit(state, 'wallet.connected', `NWC wallet connected via ${conn.relay}`);
  await saveState(state);
  return getWallet();
}

export async function clearWallet() {
  await updateEnvVar('IDENSTR_NWC_URI', '');
  setStateValue('wallet', {});
  const state = await loadState();
  addAudit(state, 'wallet.disconnected', 'NWC wallet disconnected');
  await saveState(state);
  return getWallet();
}

// Encrypt {method, params} to the wallet (NIP-04), sign the kind:23194 request
// with the connection secret, await the kind:23195 response, decrypt and unwrap.
async function callWallet(method, params = {}, options = {}) {
  const conn = loadConnection();
  if (!conn) throw new Error('no NWC wallet configured');
  const content = nip04Encrypt(conn.secret, conn.walletPubkey, JSON.stringify({ method, params }));
  const request = signEventWithSecret(conn.secret, {
    kind: NWC_KIND_REQUEST,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', conn.walletPubkey]],
    content
  });
  const result = await nwcRequest(conn.relay, request, conn.walletPubkey, options.timeoutMs);
  if (!result.ok) throw new Error(result.error || 'wallet request failed');
  let parsed;
  try {
    parsed = JSON.parse(nip04Decrypt(conn.secret, conn.walletPubkey, result.response.content));
  } catch {
    throw new Error('could not decrypt or parse the wallet response');
  }
  if (parsed.error) throw new Error(`${parsed.error.code || 'wallet_error'}: ${parsed.error.message || 'wallet returned an error'}`);
  return parsed.result ?? {};
}

export async function walletInfo() {
  const result = await callWallet('get_info');
  setStateValue('wallet', {
    ...meta(),
    alias: result.alias ?? meta().alias ?? null,
    methods: Array.isArray(result.methods) ? result.methods : meta().methods ?? null,
    info: { network: result.network ?? null, pubkey: result.pubkey ?? null, blockHeight: result.block_height ?? null },
    lastCheckedAt: new Date().toISOString()
  });
  return getWallet();
}

export async function walletBalance() {
  const result = await callWallet('get_balance');
  const now = new Date().toISOString();
  setStateValue('wallet', { ...meta(), balanceMsat: Number.isFinite(result.balance) ? result.balance : null, balanceAt: now, lastCheckedAt: now });
  return getWallet();
}

export async function payInvoice(body = {}, options = {}) {
  const invoice = String(body.invoice ?? '').trim();
  if (!/^ln[a-z0-9]+$/i.test(invoice)) throw new Error('a bolt11 lightning invoice is required');
  const params = { invoice };
  const amountMsat = Number(body.amountMsat);
  if (Number.isFinite(amountMsat) && amountMsat > 0) params.amount = Math.round(amountMsat);
  const result = await callWallet('pay_invoice', params, { timeoutMs: 30000 });
  // The zap path logs its own zap.payment entry, so skip the generic line there
  // to avoid two audit rows for a single payment.
  if (!options.skipAudit) {
    const state = await loadState();
    addAudit(state, 'wallet.payment', `Paid a lightning invoice via NWC${Number.isFinite(result.fees_paid) ? ` (fee ${result.fees_paid} msat)` : ''}`);
    await saveState(state);
  }
  return { preimage: result.preimage ?? null, feesPaid: Number.isFinite(result.fees_paid) ? result.fees_paid : null };
}

export async function payZap(body = {}, options = {}) {
  const nsec = process.env.IDENSTR_NSEC ?? '';
  if (!nsec) throw new Error('IDENSTR_NSEC is required to sign zap requests');
  const targetPubkey = String(body.pubkey ?? body.targetPubkey ?? '').trim().toLowerCase();
  if (!HEX64.test(targetPubkey)) throw new Error('target pubkey must be 32-byte hex');
  const amountSats = Number(body.amountSats ?? body.amount);
  if (!Number.isFinite(amountSats) || amountSats < 1 || amountSats > 100000) throw new Error('zap amount must be between 1 and 100000 sats');
  const amountMsat = Math.round(amountSats * 1000);
  const comment = String(body.comment ?? '').slice(0, 500);
  const eventId = String(body.eventId ?? '').trim().toLowerCase();
  if (eventId && !HEX64.test(eventId)) throw new Error('event id must be 32-byte hex');
  const relays = normalizeZapRelays(body.relays);
  const lnurl = lnurlFromZapTarget(body.lnurl ?? body.lud16 ?? body.lud06);
  if (!lnurl) throw new Error('recipient profile has no lud16/lud06 zap address');

  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = await fetchLnurlPayEndpoint(lnurl, fetchImpl);
  if (!endpoint.allowsNostr) throw new Error('recipient LNURL endpoint does not support Nostr zaps');
  // NIP-57 LNURL metadata `nostrPubkey` is the zap service / receipt signer key.
  // Hosted/custodial Lightning Address providers commonly use a service key that
  // differs from the profile pubkey being zapped. The profile pubkey belongs in
  // the signed zap request `p` tag; do not reject valid endpoints just because
  // their receipt signer is different.
  if (endpoint.nostrPubkey && !HEX64.test(endpoint.nostrPubkey)) throw new Error('recipient LNURL endpoint returned an invalid nostrPubkey');
  if (Number.isFinite(endpoint.minSendable) && amountMsat < endpoint.minSendable) throw new Error(`zap amount is below recipient minimum (${Math.ceil(endpoint.minSendable / 1000)} sats`);
  if (Number.isFinite(endpoint.maxSendable) && amountMsat > endpoint.maxSendable) throw new Error(`zap amount is above recipient maximum (${Math.floor(endpoint.maxSendable / 1000)} sats)`);

  const tags = [['p', targetPubkey], ['amount', String(amountMsat)], ['lnurl', encodeLnurl(lnurl)], ['relays', ...relays]];
  if (eventId) tags.splice(1, 0, ['e', eventId]);
  const zapRequest = signNostrEvent(nsec, { kind: 9734, created_at: Math.floor(Date.now() / 1000), content: comment, tags });
  const local = await storeEventLocally(zapRequest);
  if (!local.accepted) throw new Error('vault_unavailable');

  const invoice = await requestZapInvoice(endpoint.callback, amountMsat, zapRequest, fetchImpl);
  // The recipient's LNURL server controls the invoice it hands back; the wallet
  // would pay whatever amount that invoice encodes. Refuse to pay anything that
  // doesn't commit to exactly the sats the user chose.
  const invoiceMsat = bolt11AmountMsat(invoice);
  if (invoiceMsat == null) throw new Error('recipient invoice does not commit to an amount; refusing to pay');
  if (invoiceMsat !== amountMsat) throw new Error(`recipient invoice is for ${Math.round(invoiceMsat / 1000)} sats, not the ${amountSats} you chose; refusing to pay`);
  const payment = options.payInvoiceImpl ? await options.payInvoiceImpl({ invoice }) : await payInvoice({ invoice }, { skipAudit: true });
  const state = await loadState();
  addAudit(state, 'zap.payment', `Zapped ${amountSats} sats to ${targetPubkey.slice(0, 12)}…${eventId ? ` for note ${eventId.slice(0, 12)}…` : ''}`);
  await saveState(state);
  return {
    ok: true,
    amountSats,
    amountMsat,
    targetPubkey,
    targetEventId: eventId || null,
    zapRequest: { id: zapRequest.id, pubkey: zapRequest.pubkey, created_at: zapRequest.created_at, tags: zapRequest.tags, content: zapRequest.content },
    invoice,
    preimage: payment.preimage ?? null,
    feesPaid: payment.feesPaid ?? null
  };
}

// Decode the amount committed in a bolt11 invoice's human-readable part, e.g.
// `lnbc2500u1...` -> 250000000 msat. Returns the amount in msat, or null when the
// invoice carries no amount (an "any amount" invoice). Bech32's separator is the
// last '1', and the amount can itself contain '1' digits, so split on lastIndexOf.
export function bolt11AmountMsat(invoice) {
  const value = String(invoice ?? '').trim().toLowerCase();
  const sep = value.lastIndexOf('1');
  if (sep < 1) return null;
  const hrp = value.slice(0, sep);
  const match = hrp.match(/^ln[a-z]+?(\d+)([munp]?)$/);
  if (!match) return null; // no amount encoded
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  // 1 BTC = 1e11 msat; multipliers scale that base down.
  const msatPerUnit = { '': 1e11, m: 1e8, u: 1e5, n: 1e2, p: 1e-1 }[match[2]];
  return Math.round(amount * msatPerUnit);
}

export function lnurlFromZapTarget(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^https:\/\//i.test(raw)) return raw;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    const [name, domain] = raw.split('@');
    return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
  }
  if (/^lnurl/i.test(raw)) return decodeLnurl(raw);
  throw new Error('unsupported zap address; expected lud16, lud06/LNURL, or https URL');
}

export function normalizeZapRelays(relays) {
  const values = Array.isArray(relays) ? relays : [];
  // NIP-57 zap receipts are published by the recipient's LNURL service to the
  // relays in this tag. Feedstr may send only the user's/private read/write
  // relays, which can make a paid zap invisible to the receiver. Always merge a
  // small public baseline so receipts have somewhere broadly discoverable to land.
  const requested = values.map(r => String(r ?? '').trim()).filter(r => /^wss?:\/\//i.test(r));
  return [...new Set([...requested, ...DEFAULT_ZAP_RELAYS])].slice(0, 12);
}

async function fetchLnurlPayEndpoint(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`could not fetch recipient LNURL metadata (${response.status})`);
  const data = await response.json();
  if (!/^https:\/\//i.test(data.callback ?? '')) throw new Error('recipient LNURL metadata has no HTTPS callback');
  return {
    callback: data.callback,
    allowsNostr: Boolean(data.allowsNostr),
    nostrPubkey: typeof data.nostrPubkey === 'string' ? data.nostrPubkey.toLowerCase() : null,
    minSendable: Number(data.minSendable),
    maxSendable: Number(data.maxSendable)
  };
}

async function requestZapInvoice(callback, amountMsat, zapRequest, fetchImpl) {
  const url = new URL(callback);
  url.searchParams.set('amount', String(amountMsat));
  url.searchParams.set('nostr', JSON.stringify(zapRequest));
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`recipient LNURL callback failed (${response.status})`);
  const data = await response.json();
  if (data.status === 'ERROR') throw new Error(data.reason || 'recipient LNURL callback returned an error');
  const invoice = String(data.pr ?? '').trim();
  if (!/^ln[a-z0-9]+$/i.test(invoice)) throw new Error('recipient LNURL callback did not return a bolt11 invoice');
  return invoice;
}

function decodeLnurl(value) {
  const { hrp, data } = bech32Decode(String(value).toLowerCase());
  if (hrp !== 'lnurl') throw new Error('invalid LNURL prefix');
  return Buffer.from(convertBits(data, 5, 8, false)).toString('utf8');
}

function encodeLnurl(url) {
  return bech32Encode('lnurl', convertBits([...Buffer.from(String(url), 'utf8')], 8, 5, true));
}

function bech32Decode(value) {
  const pos = value.lastIndexOf('1');
  if (pos < 1) throw new Error('invalid bech32 value');
  const hrp = value.slice(0, pos);
  const data = [...value.slice(pos + 1)].map((char) => LNURL_CHARSET.indexOf(char));
  if (data.some((item) => item < 0)) throw new Error('invalid bech32 data');
  if (bech32Polymod([...hrpExpand(hrp), ...data]) !== 1) throw new Error('invalid bech32 checksum');
  return { hrp, data: data.slice(0, -6) };
}

function bech32Polymod(values) {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) if ((top >> i) & 1) chk ^= LNURL_GEN[i];
  }
  return chk;
}

function bech32Encode(hrp, data) {
  const values = [...hrpExpand(hrp), ...data];
  const polymod = bech32Polymod([...values, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (polymod >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((item) => LNURL_CHARSET[item]).join('')}`;
}

function hrpExpand(hrp) {
  return [...hrp].map((char) => char.charCodeAt(0) >> 5).concat([0], [...hrp].map((char) => char.charCodeAt(0) & 31));
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1;
  for (const value of data) {
    if (value < 0 || value >> fromBits) throw new Error('invalid bech32 value');
    acc = ((acc << fromBits) | value) & maxAcc;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    throw new Error('invalid bech32 padding');
  }
  return ret;
}
