import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createHash, randomBytes } from 'node:crypto';
import { signNostrEvent } from '../src/app/nostrSigner.js';
import { bech32Encode, convertBits } from '../src/app/state.js';

// secp256k1 / BIP-340 constants
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n
};

const mod = (a, m) => ((a % m) + m) % m;
function inv(a, m) {
  let [oldR, r] = [mod(a, m), m];
  let [oldS, s] = [1n, 0n];
  while (r) { const q = oldR / r; [oldR, r] = [r, oldR - q * r]; [oldS, s] = [s, oldS - q * s]; }
  return mod(oldS, m);
}
function add(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.x === b.x && mod(a.y + b.y, P) === 0n) return null;
  const m = a.x === b.x ? mod(3n * a.x * a.x * inv(2n * a.y, P), P) : mod((b.y - a.y) * inv(b.x - a.x, P), P);
  const x = mod(m * m - a.x - b.x, P);
  return { x, y: mod(m * (a.x - x) - a.y, P) };
}
function mul(point, k) {
  let result = null;
  let addend = point;
  while (k > 0n) { if (k & 1n) result = add(result, addend); addend = add(addend, addend); k >>= 1n; }
  return result;
}
function modpow(base, exp, m) {
  let b = mod(base, m); let r = 1n;
  while (exp > 0n) { if (exp & 1n) r = mod(r * b, m); b = mod(b * b, m); exp >>= 1n; }
  return r;
}
function liftX(x) {
  const y2 = mod(x * x * x + 7n, P);
  let y = modpow(y2, (P + 1n) / 4n, P);
  if (y % 2n !== 0n) y = P - y;
  return { x, y };
}
const tagged = (tag, data) => {
  const h = createHash('sha256').update(tag).digest();
  return createHash('sha256').update(Buffer.concat([h, h, data])).digest();
};
const b2n = (b) => BigInt('0x' + Buffer.from(b).toString('hex'));
const n2b = (v) => Buffer.from(v.toString(16).padStart(64, '0'), 'hex');

// Independent BIP-340 verify: s*G == R + e*P, R.x == rx, R has even y.
function schnorrVerify(pxHex, msg, sigHex) {
  const px = BigInt('0x' + pxHex);
  const sig = Buffer.from(sigHex, 'hex');
  if (sig.length !== 64) return false;
  const rx = b2n(sig.subarray(0, 32));
  const s = b2n(sig.subarray(32, 64));
  if (rx >= P || s >= N) return false;
  const pub = liftX(px);
  const e = b2n(tagged('BIP0340/challenge', Buffer.concat([n2b(rx), n2b(px), msg]))) % N;
  const R = add(mul(G, s), mul(pub, mod(-e, N)));
  return Boolean(R) && R.y % 2n === 0n && R.x === rx;
}

function randomNsec() {
  return bech32Encode('nsec', convertBits([...randomBytes(32)], 8, 5, true));
}

test('signNostrEvent produces BIP-340-valid signatures over the NIP-01 event id', () => {
  for (let i = 0; i < 8; i++) {
    const secret = randomBytes(32);
    const nsec = bech32Encode('nsec', convertBits([...secret], 8, 5, true));
    const event = signNostrEvent(nsec, { kind: 1, created_at: 1700000000 + i, tags: [['t', `x${i}`]], content: `note ${i} éàü 🚀 "quote" \\slash` });

    // pubkey matches Node's native secp256k1
    const ecdh = createECDH('secp256k1');
    ecdh.setPrivateKey(secret);
    const nativePub = ecdh.getPublicKey(null, 'compressed').subarray(1, 33).toString('hex');
    assert.equal(event.pubkey, nativePub, 'pubkey must match native secp256k1');

    // event id matches NIP-01 serialization
    const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
    const id = createHash('sha256').update(serialized).digest('hex');
    assert.equal(event.id, id, 'id must be sha256 of the NIP-01 serialization');

    // signature verifies under BIP-340
    assert.ok(schnorrVerify(event.pubkey, Buffer.from(event.id, 'hex'), event.sig), `signature ${i} must be BIP-340 valid`);
  }
});

test('a tampered message fails verification (verifier is sound)', () => {
  const event = signNostrEvent(randomNsec(), { kind: 1, created_at: 1700000000, tags: [], content: 'hello' });
  const wrongMsg = createHash('sha256').update('different').digest();
  assert.equal(schnorrVerify(event.pubkey, wrongMsg, event.sig), false);
});
