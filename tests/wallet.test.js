import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { nip04Decrypt, nip04Encrypt, signEventWithSecret } from '../src/app/nostrSigner.js';
import { parseNwcUri, lnurlFromZapTarget, normalizeZapRelays, bolt11AmountMsat } from '../src/app/wallet.js';

function randomSecretHex() {
  return randomBytes(32).toString('hex');
}

function pubkeyOf(secretHex) {
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(secretHex, 'hex'));
  return ecdh.getPublicKey(null, 'compressed').subarray(1, 33).toString('hex');
}

test('parseNwcUri extracts wallet pubkey, relay, secret and optional lud16', () => {
  const wallet = pubkeyOf(randomSecretHex());
  const secret = randomSecretHex();
  const uri = `nostr+walletconnect://${wallet}?relay=wss://relay.example.com&secret=${secret}&lud16=me@example.com`;
  const parsed = parseNwcUri(uri);
  assert.equal(parsed.walletPubkey, wallet);
  assert.equal(parsed.relay, 'wss://relay.example.com');
  assert.equal(parsed.secret, secret);
  assert.equal(parsed.lud16, 'me@example.com');
});

test('parseNwcUri returns null for empty input and throws on malformed input', () => {
  assert.equal(parseNwcUri(''), null);
  assert.equal(parseNwcUri('   '), null);
  assert.throws(() => parseNwcUri('https://example.com'), /invalid NWC/);
  assert.throws(() => parseNwcUri(`nostr+walletconnect://${pubkeyOf(randomSecretHex())}?secret=${randomSecretHex()}`), /relay/);
  assert.throws(() => parseNwcUri(`nostr+walletconnect://${pubkeyOf(randomSecretHex())}?relay=wss://r.example`), /secret/);
});

test('zap target parsing supports lud16 and direct HTTPS LNURL endpoints', () => {
  assert.equal(lnurlFromZapTarget('alice@example.com'), 'https://example.com/.well-known/lnurlp/alice');
  assert.equal(lnurlFromZapTarget('https://ln.example.com/u/alice'), 'https://ln.example.com/u/alice');
  assert.throws(() => lnurlFromZapTarget('ftp://example.com'), /unsupported zap address/);
});

test('zap relay tags keep requested relays and add public receipt fallbacks', () => {
  const relays = normalizeZapRelays(['ws://private-relay:7777', 'wss://custom.example', 'not a relay']);
  assert.ok(relays.includes('ws://private-relay:7777'));
  assert.ok(relays.includes('wss://custom.example'));
  assert.ok(relays.includes('wss://relay.damus.io'));
  assert.ok(relays.includes('wss://nos.lol'));
  assert.ok(relays.includes('wss://relay.primal.net'));
});

test('wallet zap validation allows LNURL service receipt pubkeys distinct from profile pubkeys', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../src/app/wallet.js', import.meta.url), 'utf8'));
  assert.match(source, /nostrPubkey` is the zap service \/ receipt signer key/);
  assert.doesNotMatch(source, /endpoint\.nostrPubkey && endpoint\.nostrPubkey !== targetPubkey/);
  assert.match(source, /endpoint\.nostrPubkey && !HEX64\.test\(endpoint\.nostrPubkey\)/);
});

test('bolt11AmountMsat decodes the amount committed in the invoice HRP', () => {
  // Data part uses bech32 charset (no '1'), so the last '1' is always the separator.
  assert.equal(bolt11AmountMsat('lnbc2500u1pqqqqpp'), 250000000); // 2500 micro-BTC = 250k sats
  assert.equal(bolt11AmountMsat('lnbc20m1pqqqqpp'), 2000000000);  // 20 milli-BTC = 2M sats
  assert.equal(bolt11AmountMsat('lnbc100n1pqqqqpp'), 10000);      // 100 nano-BTC = 10 sats
  assert.equal(bolt11AmountMsat('lntb21u1pqqqqpp'), 2100000);     // testnet prefix, 21 micro-BTC
  // Amount digits can themselves contain '1' without confusing the separator.
  assert.equal(bolt11AmountMsat('lnbc100u1pqqqqpp'), 10000000);
  // Amountless invoice -> null so the zap path refuses to pay.
  assert.equal(bolt11AmountMsat('lnbc1pqqqqpp'), null);
  assert.equal(bolt11AmountMsat(''), null);
});

test('NIP-04 round-trips between two parties (shared key is symmetric)', () => {
  const aSecret = randomSecretHex();
  const bSecret = randomSecretHex();
  const aPub = pubkeyOf(aSecret);
  const bPub = pubkeyOf(bSecret);
  const message = JSON.stringify({ method: 'pay_invoice', params: { invoice: 'lnbc1...', amount: 1000 } });

  // A encrypts to B; B decrypts with its own secret against A's pubkey.
  const ciphertext = nip04Encrypt(aSecret, bPub, message);
  assert.match(ciphertext, /\?iv=/, 'payload must carry the iv');
  assert.equal(nip04Decrypt(bSecret, aPub, ciphertext), message);

  // And the reverse direction works too.
  const reply = nip04Encrypt(bSecret, aPub, 'ok');
  assert.equal(nip04Decrypt(aSecret, bPub, reply), 'ok');
});

test('signEventWithSecret derives the matching pubkey and signs a kind:23194 request', () => {
  const secret = randomSecretHex();
  const event = signEventWithSecret(secret, { kind: 23194, created_at: 1700000000, tags: [['p', pubkeyOf(secret)]], content: 'x' });
  assert.equal(event.pubkey, pubkeyOf(secret), 'event pubkey must derive from the connection secret');
  assert.match(event.id, /^[0-9a-f]{64}$/);
  assert.match(event.sig, /^[0-9a-f]{128}$/);
});

test('signEventWithSecret rejects non-32-byte secrets', () => {
  assert.throws(() => signEventWithSecret('abcd', { kind: 23194, created_at: 1, tags: [], content: '' }), /32 bytes/);
});


test('scoped zap apps can read safe wallet balance without wallet admin access', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../src/server.js', import.meta.url), 'utf8'));
  assert.match(source, /url\.pathname === '\/api\/v1\/zaps\/wallet'/);
  assert.match(source, /url\.pathname === '\/api\/v1\/zaps\/wallet\/balance'/);
  assert.match(source, /pathname === '\/api\/v1\/zaps\/wallet' \|\| pathname === '\/api\/v1\/zaps\/wallet\/balance'\) return 'zaps:write'/);
  assert.match(source, /pathname\.startsWith\('\/api\/v1\/wallet'\)\) return 'admin'/);
});
