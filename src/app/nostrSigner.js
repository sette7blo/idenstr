import { createCipheriv, createDecipheriv, createECDH, createHash, randomBytes } from 'node:crypto';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n
};

export function signNostrEvent(nsec, event) {
  return signEventWithSecretBytes(secretFromNsec(nsec), event);
}

// Sign with a raw 32-byte hex secret rather than an nsec. NWC (NIP-47) issues a
// separate connection secret that is not the user's identity key, so requests to
// the wallet service are signed with that secret, never IDENSTR_NSEC.
export function signEventWithSecret(secretHex, event) {
  const secret = Buffer.from(String(secretHex), 'hex');
  if (secret.length !== 32) throw new Error('signing secret must be 32 bytes of hex');
  return signEventWithSecretBytes(secret, event);
}

function signEventWithSecretBytes(secret, event) {
  const privateKey = bytesToNumber(secret);
  if (privateKey <= 0n || privateKey >= N) throw new Error('invalid secret scalar');
  // Derive the public key with Node's native (constant-time) secp256k1 rather
  // than a variable-time scalar multiply over the secret key.
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(secret);
  const compressed = ecdh.getPublicKey(null, 'compressed');
  const px = compressed.subarray(1, 33);
  const evenY = compressed[0] === 0x02;
  const pubkey = px.toString('hex');
  const unsigned = { ...event, pubkey };
  const id = eventHash(unsigned);
  const sig = schnorrSign(Buffer.from(id, 'hex'), privateKey, px, evenY);
  return { ...unsigned, id, sig };
}

// NIP-04 encrypted payloads (used by NWC). The shared key is the X coordinate of
// the ECDH point between our secret and the peer's x-only pubkey (prefixed 0x02
// to form a compressed point), AES-256-CBC with a random IV.
function nip04SharedKey(secretHex, peerPubkeyHex) {
  const secret = Buffer.from(String(secretHex), 'hex');
  if (secret.length !== 32) throw new Error('nip04 secret must be 32 bytes of hex');
  if (!/^[0-9a-f]{64}$/i.test(peerPubkeyHex)) throw new Error('nip04 peer pubkey must be 32 bytes of hex');
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(secret);
  const peer = Buffer.concat([Buffer.from([0x02]), Buffer.from(peerPubkeyHex, 'hex')]);
  return ecdh.computeSecret(peer);
}

export function nip04Encrypt(secretHex, peerPubkeyHex, plaintext) {
  const key = nip04SharedKey(secretHex, peerPubkeyHex);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(String(plaintext), 'utf8')), cipher.final()]);
  return `${encrypted.toString('base64')}?iv=${iv.toString('base64')}`;
}

export function nip04Decrypt(secretHex, peerPubkeyHex, payload) {
  const [ciphertext, ivPart] = String(payload).split('?iv=');
  if (!ivPart) throw new Error('invalid nip04 payload: missing iv');
  const key = nip04SharedKey(secretHex, peerPubkeyHex);
  const decipher = createDecipheriv('aes-256-cbc', key, Buffer.from(ivPart, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

export function derivePubkeyHexFromNsec(nsec) {
  const secret = secretFromNsec(nsec);
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(secret);
  const publicKey = ecdh.getPublicKey(null, 'compressed');
  return publicKey.subarray(1, 33).toString('hex');
}

export function deriveNpubFromNsec(nsec) {
  return bech32Encode('npub', convertBits([...Buffer.from(derivePubkeyHexFromNsec(nsec), 'hex')], 8, 5, true));
}

export function eventHash(event) {
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags ?? [], event.content]);
  return createHash('sha256').update(serialized).digest('hex');
}

function schnorrSign(message, privateKey, px, evenY) {
  const d = evenY ? privateKey : N - privateKey;
  const dBytes = numberToBytes(d, 32);
  // BIP-340 recommends fresh randomness for aux_rand (fault / side-channel
  // hardening); a deterministic all-zero aux is valid but weaker.
  const aux = randomBytes(32);
  const t = xor(dBytes, taggedHash('BIP0340/aux', aux));
  let k = bytesToNumber(taggedHash('BIP0340/nonce', Buffer.concat([t, px, message]))) % N;
  if (k === 0n) throw new Error('schnorr nonce was zero');
  const rPoint = pointMultiply(G, k);
  if (!hasEvenY(rPoint)) k = N - k;
  const rx = numberToBytes(rPoint.x, 32);
  const e = bytesToNumber(taggedHash('BIP0340/challenge', Buffer.concat([rx, px, message]))) % N;
  const s = mod(k + e * d, N);
  return Buffer.concat([rx, numberToBytes(s, 32)]).toString('hex');
}

function taggedHash(tag, data) {
  const tagHash = createHash('sha256').update(tag).digest();
  return createHash('sha256').update(Buffer.concat([tagHash, tagHash, data])).digest();
}

function pointMultiply(point, scalar) {
  let n = scalar;
  let result = null;
  let addend = point;
  while (n > 0n) {
    if (n & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    n >>= 1n;
  }
  if (!result) throw new Error('invalid point multiplication');
  return result;
}

function pointAdd(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.x === b.x) {
    if (mod(a.y + b.y, P) === 0n) return null;
    const m = mod(3n * a.x * a.x * invert(2n * a.y, P), P);
    const x = mod(m * m - 2n * a.x, P);
    const y = mod(m * (a.x - x) - a.y, P);
    return { x, y };
  }
  const m = mod((b.y - a.y) * invert(b.x - a.x, P), P);
  const x = mod(m * m - a.x - b.x, P);
  const y = mod(m * (a.x - x) - a.y, P);
  return { x, y };
}

function invert(value, modulo) {
  let a = mod(value, modulo);
  let b = modulo;
  let x = 1n;
  let y = 0n;
  while (a !== 0n) {
    const q = b / a;
    [b, a] = [a, b - q * a];
    [y, x] = [x, y - q * x];
  }
  if (b !== 1n) throw new Error('inverse does not exist');
  return mod(y, modulo);
}

function hasEvenY(point) {
  return point.y % 2n === 0n;
}

function mod(value, modulo) {
  const result = value % modulo;
  return result >= 0n ? result : result + modulo;
}

function bytesToNumber(bytes) {
  return BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
}

function numberToBytes(value, length) {
  return Buffer.from(value.toString(16).padStart(length * 2, '0'), 'hex');
}

function xor(a, b) {
  return Buffer.from(a.map((byte, index) => byte ^ b[index]));
}

function secretFromNsec(nsec) {
  const { hrp, data } = bech32Decode(nsec);
  if (hrp !== 'nsec') throw new Error('IDENSTR_NSEC must be an nsec value');
  const secret = Buffer.from(convertBits(data, 5, 8, false));
  if (secret.length !== 32) throw new Error('IDENSTR_NSEC must decode to 32 bytes');
  return secret;
}

function bech32Decode(value) {
  const input = String(value).toLowerCase();
  const pos = input.lastIndexOf('1');
  if (pos < 1) throw new Error('invalid bech32 value');
  const hrp = input.slice(0, pos);
  const data = [...input.slice(pos + 1)].map((char) => CHARSET.indexOf(char));
  if (data.some((item) => item < 0)) throw new Error('invalid bech32 data');
  if (bech32Polymod([...hrpExpand(hrp), ...data]) !== 1) throw new Error('invalid bech32 checksum');
  return { hrp, data: data.slice(0, -6) };
}

function bech32Encode(hrp, data) {
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
    for (let i = 0; i < 5; i += 1) if ((top >> i) & 1) chk ^= BECH32_GEN[i];
  }
  return chk;
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
