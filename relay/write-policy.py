#!/usr/bin/env python3
# Vault write policy: the vault never forgets, and only the owner may write.
#
# The relay is intentionally read-reachable (other *str apps and devices read
# cached events directly for speed), so network isolation can no longer be the
# write control. Instead the owner pubkey is pinned here: every accepted event
# must be signed by the identity Idenstr holds the key for. Idenstr is the only
# component with the nsec, so in practice only Idenstr can produce a writable
# event. We also reject the two things that would erase history: kind 5 deletion
# requests and events carrying a NIP-40 expiration tag.
#
# The owner identity is read from IDENSTR_OWNER_PUBKEY (npub or 64-char hex).
# If it is missing or unparseable the policy fails closed and rejects every
# write, so a misconfigured deployment can never silently accept foreign events.
import json
import os
import sys

CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'


def bech32_polymod(values):
    generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    chk = 1
    for value in values:
        top = chk >> 25
        chk = ((chk & 0x1ffffff) << 5) ^ value
        for i in range(5):
            chk ^= generator[i] if ((top >> i) & 1) else 0
    return chk


def bech32_hrp_expand(hrp):
    return [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]


def bech32_decode(value):
    if any(ord(c) < 33 or ord(c) > 126 for c in value):
        return (None, None)
    if value.lower() != value and value.upper() != value:
        return (None, None)
    value = value.lower()
    pos = value.rfind('1')
    if pos < 1 or pos + 7 > len(value):
        return (None, None)
    hrp = value[:pos]
    data = []
    for c in value[pos + 1:]:
        d = CHARSET.find(c)
        if d == -1:
            return (None, None)
        data.append(d)
    if bech32_polymod(bech32_hrp_expand(hrp) + data) != 1:
        return (None, None)
    return (hrp, data[:-6])


def convert_bits(data, from_bits, to_bits, pad=True):
    acc = 0
    bits = 0
    result = []
    maxv = (1 << to_bits) - 1
    max_acc = (1 << (from_bits + to_bits - 1)) - 1
    for value in data:
        if value < 0 or (value >> from_bits):
            return None
        acc = ((acc << from_bits) | value) & max_acc
        bits += from_bits
        while bits >= to_bits:
            bits -= to_bits
            result.append((acc >> bits) & maxv)
    if pad:
        if bits:
            result.append((acc << (to_bits - bits)) & maxv)
    elif bits >= from_bits or ((acc << (to_bits - bits)) & maxv):
        return None
    return result


def to_hex_pubkey(value):
    value = (value or '').strip()
    if not value:
        return None
    lowered = value.lower()
    if len(lowered) == 64 and all(c in '0123456789abcdef' for c in lowered):
        return lowered
    hrp, data = bech32_decode(value)
    if hrp != 'npub' or data is None:
        return None
    decoded = convert_bits(data, 5, 8, False)
    if decoded is None or len(decoded) != 32:
        return None
    return bytes(decoded).hex()


def respond(event_id, action, msg=''):
    out = {'id': event_id, 'action': action}
    if msg:
        out['msg'] = msg
    print(json.dumps(out, separators=(',', ':')), flush=True)


OWNER_PUBKEY = to_hex_pubkey(os.environ.get('IDENSTR_OWNER_PUBKEY', ''))
if OWNER_PUBKEY is None:
    print('write-policy: IDENSTR_OWNER_PUBKEY is missing or invalid; rejecting all writes', file=sys.stderr, flush=True)

for line in sys.stdin:
    try:
        request = json.loads(line)
    except json.JSONDecodeError:
        continue
    if request.get('type') != 'new':
        continue
    event = request.get('event') or {}
    event_id = event.get('id', '')
    if not event_id:
        continue
    if OWNER_PUBKEY is None:
        respond(event_id, 'reject', 'blocked: owner pubkey not configured')
        continue
    if str(event.get('pubkey', '')).lower() != OWNER_PUBKEY:
        respond(event_id, 'reject', 'blocked: only the Idenstr owner key may write to the vault')
        continue
    try:
        kind = int(event.get('kind', 0))
    except (TypeError, ValueError):
        respond(event_id, 'reject', 'blocked: invalid kind')
        continue
    if kind == 5:
        respond(event_id, 'reject', 'blocked: the vault never forgets (kind 5 deletion)')
        continue
    if any(tag and tag[0] == 'expiration' for tag in event.get('tags', []) if isinstance(tag, list)):
        respond(event_id, 'reject', 'blocked: the vault never forgets (expiration tag)')
        continue
    respond(event_id, 'accept')
