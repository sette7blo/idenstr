import { createECDH, createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStateValue, maybeMigrateJsonState, setStateValue } from './db.js';
import { privateRelayUrl } from './system.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

export { randomUUID };

export async function loadState() {
  const migrated = maybeMigrateJsonState((statePath) => JSON.parse(readFileSync(statePath, 'utf8')));
  const saved = migrated ?? getStateValue('app');
  if (saved) return mergeDefaults(saved);
  const state = defaultState();
  await saveState(state);
  return state;
}

export async function saveState(state) {
  setStateValue('app', state);
}

function getStatePath() {
  return process.env.IDENSTR_STATE_STORE ?? join(root, 'data', 'idenstr-state.json');
}

export const DEFAULT_TUNING = {
  discover: { candidates: 20, results: 10 },
  relaySuggestions: 3,
  engagement: {
    weights: { post: 3, repost: 2, reaction: 1, zap: 4 },
    thresholds: { high: 40, engaged: 10 }
  },
  activity: { veryActive: 3, active: 14, quiet: 60, inactive: 90 }
};

function defaultState() {
  const now = new Date().toISOString();
  const read = normalizeRelays(process.env.IDENSTR_DEFAULT_READ_RELAYS || 'wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net');
  const write = normalizeRelays(process.env.IDENSTR_DEFAULT_WRITE_RELAYS || 'wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net');
  return {
    profile: { name: 'primary', displayName: 'Primary Nostr Identity', about: 'Canonical profile draft held by Idenstr.', website: '', picture: '', banner: '', updatedAt: now, event: buildCanonicalEvent(0, { name: 'primary' }) },
    following: { entries: [], directory: {}, directoryUpdatedAt: null, updatedAt: now, event: buildCanonicalEvent(3, []) },
    mutes: { entries: [], updatedAt: now, event: buildCanonicalEvent(10000, []) },
    relays: { read, write, private: privateRelayUrl() || null, updatedAt: now, event: buildCanonicalEvent(10002, { read, write }), scan: [] },
    tuning: { ...DEFAULT_TUNING },
    backups: [],
    audit: [{ at: now, type: 'system.ready', message: 'Idenstr local vault initialized' }]
  };
}

function mergeDefaults(state) {
  const defaults = defaultState();
  return { ...defaults, ...state, mutes: { ...defaults.mutes, ...(state.mutes ?? {}) }, tuning: { ...defaults.tuning, ...state.tuning }, audit: state.audit ?? [] };
}

export function buildCanonicalEvent(kind, content) {
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ kind, created_at: now, content });
  return {
    kind,
    created_at: now,
    status: 'draft-local',
    id: createHash('sha256').update(payload).digest('hex'),
    signed: false
  };
}

export function addAudit(state, type, message) {
  state.audit.unshift({ at: new Date().toISOString(), type, message });
  // Cap the trail: it lives inside the single state blob, so an uncapped list
  // would grow without bound and get re-serialized on every save.
  state.audit = state.audit.slice(0, 80);
}

export function cleanString(value, limit) {
  return String(value ?? '').trim().slice(0, limit);
}

export function normalizeRelays(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[\n,]/);
  return [...new Set(list.map((relay) => normalizeRelayUrl(relay)).filter(Boolean))];
}

export function normalizeRelayUrl(value) {
  const trimmed = cleanString(value, 200);
  if (!trimmed) return '';
  const withScheme = /^wss?:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`;
  return withScheme.replace(/^wss?:\/\//i, (scheme) => scheme.toLowerCase()).replace(/\/+$/, '');
}

export function normalizePubkey(value) {
  const cleaned = cleanString(value, 140).toLowerCase();
  if (/^[0-9a-f]{64}$/.test(cleaned)) return cleaned;
  if (cleaned.startsWith('npub1')) {
    try {
      const { hrp, data } = bech32Decode(cleaned);
      if (hrp !== 'npub') return '';
      const bytes = Buffer.from(convertBits(data, 5, 8, false));
      return bytes.length === 32 ? bytes.toString('hex') : '';
    } catch {
      return '';
    }
  }
  return '';
}

export function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function pubkeyToNpub(pubkey) {
  return /^[0-9a-f]{64}$/i.test(pubkey || '') ? bech32Encode('npub', convertBits([...Buffer.from(pubkey, 'hex')], 8, 5, true)) : '';
}

export function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function newestEvent(events) {
  return events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0] ?? null;
}

export function bech32Decode(value) {
  const input = String(value).toLowerCase();
  const pos = input.lastIndexOf('1');
  if (pos < 1) throw new Error('invalid bech32 value');
  const hrp = input.slice(0, pos);
  const data = [...input.slice(pos + 1)].map((char) => CHARSET.indexOf(char));
  if (data.some((item) => item < 0)) throw new Error('invalid bech32 data');
  if (bech32Polymod([...hrpExpand(hrp), ...data]) !== 1) throw new Error('invalid bech32 checksum');
  return { hrp, data: data.slice(0, -6) };
}

export function bech32Encode(hrp, data) {
  const values = [...hrpExpand(hrp), ...data];
  const polymod = bech32Polymod([...values, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (polymod >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((item) => CHARSET[item]).join('')}`;
}

function bech32Polymod(values) {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if ((top >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function hrpExpand(hrp) {
  return [...hrp].map((char) => char.charCodeAt(0) >> 5).concat([0], [...hrp].map((char) => char.charCodeAt(0) & 31));
}

export function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1;
  for (const value of data) {
    if (value < 0 || (value >> fromBits) !== 0) throw new Error('invalid bit group');
    acc = ((acc << fromBits) | value) & maxAcc;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) ret.push((acc << (toBits - bits)) & maxv);
  if (!pad && (bits >= fromBits || ((acc << (toBits - bits)) & maxv))) throw new Error('invalid padding');
  return ret;
}

export function derivePubkeyHexFromNsec(nsec) {
  const { hrp, data } = bech32Decode(nsec);
  if (hrp !== 'nsec') throw new Error('IDENSTR_NSEC must be an nsec value');
  const secret = Buffer.from(convertBits(data, 5, 8, false));
  if (secret.length !== 32) throw new Error('IDENSTR_NSEC must decode to 32 bytes');
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(secret);
  const publicKey = ecdh.getPublicKey(null, 'compressed');
  return publicKey.subarray(1, 33).toString('hex');
}

export function deriveNpubFromNsec(nsec) {
  return pubkeyToNpub(derivePubkeyHexFromNsec(nsec));
}

export function getRequiredPubkey() {
  const nsec = process.env.IDENSTR_NSEC ?? '';
  if (!nsec) throw new Error('IDENSTR_NSEC is required to import relay state');
  return derivePubkeyHexFromNsec(nsec);
}
