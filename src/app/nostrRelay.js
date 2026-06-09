export async function fetchCurrentRelayState(pubkey, relays, options = {}) {
  const uniqueRelays = [...new Set(relays.filter(Boolean))];
  const timeoutMs = options.timeoutMs ?? 4500;
  const perRelay = await Promise.all(uniqueRelays.map((relay) => fetchRelayEvents(relay, pubkey, timeoutMs)));
  const events = perRelay.flatMap((result) => result.events.map((event) => ({ ...event, relay: result.relay })));
  const latest = {
    profile: newest(events.filter((event) => event.kind === 0)),
    following: newest(events.filter((event) => event.kind === 3)),
    relayList: newest(events.filter((event) => event.kind === 10002))
  };
  return { relays: perRelay, latest };
}

export async function fetchAuthorProfiles(pubkeys, relays, options = {}) {
  const uniqueRelays = [...new Set(relays.filter(Boolean))];
  const authors = [...new Set(pubkeys.filter((pubkey) => /^[0-9a-f]{64}$/i.test(pubkey)))];
  if (!authors.length || !uniqueRelays.length) return { relays: [], events: [] };
  const timeoutMs = options.timeoutMs ?? 6500;
  const batchSize = options.batchSize ?? 80;
  const batches = [];
  for (let index = 0; index < authors.length; index += batchSize) batches.push(authors.slice(index, index + batchSize));
  const perRelay = (await Promise.all(uniqueRelays.flatMap((relay) => batches.map((batch) => fetchRelayEvents(relay, batch, timeoutMs, [0], options.limit ?? batch.length))))).flat();
  const events = perRelay.flatMap((result) => result.events.map((event) => ({ ...event, relay: result.relay })));
  return { relays: perRelay, events };
}

export async function fetchFollowRelayLists(pubkeys, relays, options = {}) {
  const uniqueRelays = [...new Set(relays.filter(Boolean))];
  const authors = [...new Set(pubkeys.filter((pubkey) => /^[0-9a-f]{64}$/i.test(pubkey)))];
  if (!authors.length || !uniqueRelays.length) return { relays: [], events: [] };
  const timeoutMs = options.timeoutMs ?? 6500;
  const perRelay = await Promise.all(uniqueRelays.map((relay) => fetchRelayEvents(relay, authors, timeoutMs, [10002], options.limit ?? Math.max(100, authors.length * 2))));
  const events = perRelay.flatMap((result) => result.events.map((event) => ({ ...event, relay: result.relay })));
  return { relays: perRelay, events };
}

export async function fetchFollowCurationEvents(pubkeys, relays, options = {}) {
  const uniqueRelays = [...new Set(relays.filter(Boolean))];
  const authors = [...new Set(pubkeys.filter((pubkey) => /^[0-9a-f]{64}$/i.test(pubkey)))];
  if (!authors.length || !uniqueRelays.length) return { relays: [], events: [] };
  const timeoutMs = options.timeoutMs ?? 7500;
  const contactBatchSize = options.contactBatchSize ?? options.batchSize ?? 60;
  const activityBatchSize = options.activityBatchSize ?? 12;
  const since = options.since ?? Math.floor(Date.now() / 1000) - 90 * 86400;
  const contactBatches = batchesOf(authors, contactBatchSize);
  const activityBatches = batchesOf(authors, activityBatchSize);
  const includeContacts = options.includeContacts ?? true;

  const contactResults = includeContacts ? (await Promise.all(uniqueRelays.flatMap((relay) =>
    contactBatches.map((batch) => fetchRelayEvents(relay, batch, timeoutMs, [3], Math.max(24, batch.length * 3)))
  ))).flat() : [];
  const activityKinds = options.activityKinds ?? [1, 6, 7, 9734];
  const activityResults = (await Promise.all(uniqueRelays.flatMap((relay) =>
    activityBatches.map((batch) => fetchRelayEvents(relay, batch, timeoutMs, activityKinds, options.limit ?? Math.max(120, batch.length * 16), { since }))
  ))).flat();
  const perRelay = [...contactResults, ...activityResults];
  const events = perRelay.flatMap((result) => result.events.map((event) => ({ ...event, relay: result.relay })));
  return { relays: perRelay, events };
}

export async function publishEventToRelays(event, relays, options = {}) {
  const uniqueRelays = [...new Set(relays.filter(Boolean))];
  const timeoutMs = options.timeoutMs ?? 4500;
  const results = await Promise.all(uniqueRelays.map((relay) => publishRelayEvent(relay, event, timeoutMs)));
  return { event, results, ok: results.some((result) => result.accepted) };
}

async function publishRelayEvent(relay, event, timeoutMs) {
  if (typeof WebSocket === 'undefined') {
    return { relay, status: 'error', accepted: false, error: 'WebSocket unavailable in this Node runtime' };
  }

  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let socket;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.close(); } catch {}
      resolve({ relay, latencyMs: Date.now() - started, ...result });
    };
    const timer = setTimeout(() => finish({ status: 'timeout', accepted: false }), timeoutMs);
    try {
      socket = new WebSocket(relay);
      socket.addEventListener('open', () => socket.send(JSON.stringify(['EVENT', event])));
      socket.addEventListener('message', (message) => {
        const parsed = parseRelayMessage(message.data);
        if (!parsed || parsed[0] !== 'OK' || parsed[1] !== event.id) return;
        finish({ status: parsed[2] ? 'accepted' : 'rejected', accepted: Boolean(parsed[2]), message: parsed[3] ?? '' });
      });
      socket.addEventListener('error', () => finish({ status: 'error', accepted: false, error: 'relay websocket error' }));
      socket.addEventListener('close', () => finish({ status: 'closed', accepted: false }));
    } catch (error) {
      finish({ status: 'error', accepted: false, error: error.message });
    }
  });
}

async function fetchRelayEvents(relay, pubkeys, timeoutMs, kinds = [0, 3, 10002], limit = 12, extraFilter = {}) {
  if (typeof WebSocket === 'undefined') {
    return { relay, status: 'error', error: 'WebSocket unavailable in this Node runtime', events: [] };
  }

  return new Promise((resolve) => {
    const started = Date.now();
    const events = [];
    const subscriptionId = `idenstr-${Math.random().toString(36).slice(2)}`;
    let settled = false;
    let socket;

    const finish = (status, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.close(); } catch {}
      resolve({ relay, status, error, events, latencyMs: Date.now() - started, kinds });
    };

    const timer = setTimeout(() => finish(events.length ? 'partial-timeout' : 'timeout'), timeoutMs);

    try {
      socket = new WebSocket(relay);
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify(['REQ', subscriptionId, { authors: Array.isArray(pubkeys) ? pubkeys : [pubkeys], kinds, limit, ...extraFilter }]));
      });
      socket.addEventListener('message', (message) => {
        const parsed = parseRelayMessage(message.data);
        if (!parsed) return;
        const [type, subId, payload] = parsed;
        if (subId !== subscriptionId) return;
        if (type === 'EVENT' && isNostrEvent(payload, pubkeys, kinds)) events.push(payload);
        if (type === 'EOSE') finish('ok');
      });
      socket.addEventListener('error', () => finish(events.length ? 'partial-error' : 'error', 'relay websocket error'));
      socket.addEventListener('close', () => finish(events.length ? 'ok' : 'closed'));
    } catch (error) {
      finish('error', error.message);
    }
  });
}

function batchesOf(values, size) {
  const batches = [];
  for (let index = 0; index < values.length; index += size) batches.push(values.slice(index, index + size));
  return batches;
}

function parseRelayMessage(value) {
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isNostrEvent(value, pubkeys, kinds) {
  const authors = new Set(Array.isArray(pubkeys) ? pubkeys : [pubkeys]);
  return value && typeof value === 'object' && authors.has(value.pubkey) && kinds.includes(value.kind);
}

function newest(events) {
  return events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0] ?? null;
}
