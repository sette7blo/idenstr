const DEFAULT_TIMEOUT_MS = 5000;

export async function storeEventLocally(event, options = {}) {
  const relayUrl = options.relayUrl ?? process.env.IDENSTR_PRIVATE_RELAY_URL ?? '';
  if (!relayUrl) return { accepted: true, skipped: true, message: 'private relay not configured' };
  if (!event?.id || !event?.sig) return { accepted: false, message: 'event must be signed before vault write' };
  if (typeof WebSocket !== 'function') return { accepted: false, message: 'WebSocket client unavailable in this Node runtime' };
  return sendEvent(relayUrl, event, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}

function sendEvent(relayUrl, event, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => settle({ accepted: false, message: 'private relay write timed out' }), timeoutMs);
    let socket;
    try {
      socket = new WebSocket(relayUrl);
    } catch (error) {
      clearTimeout(timer);
      resolve({ accepted: false, message: error.message });
      return;
    }
    socket.addEventListener('open', () => {
      try {
        socket.send(JSON.stringify(['EVENT', event]));
      } catch (error) {
        settle({ accepted: false, message: error.message });
      }
    });
    socket.addEventListener('message', (message) => {
      const parsed = parseRelayMessage(message.data);
      if (!Array.isArray(parsed) || parsed[0] !== 'OK' || parsed[1] !== event.id) return;
      settle({ accepted: Boolean(parsed[2]), message: String(parsed[3] ?? '') });
    });
    socket.addEventListener('error', () => settle({ accepted: false, message: 'private relay connection failed' }));
    socket.addEventListener('close', () => settle({ accepted: false, message: 'private relay connection closed before OK' }));
  });
}

// Write many events over a single connection instead of one socket per event.
// Used by restore, where a large vault would otherwise mean thousands of serial
// connect/OK/close round-trips.
export async function storeEventsLocally(events, options = {}) {
  const relayUrl = options.relayUrl ?? process.env.IDENSTR_PRIVATE_RELAY_URL ?? '';
  const list = Array.isArray(events) ? events : [];
  if (!relayUrl) return { accepted: 0, failed: 0, skipped: true, message: 'private relay not configured' };
  if (typeof WebSocket !== 'function') return { accepted: 0, failed: list.length, message: 'WebSocket client unavailable in this Node runtime' };
  const signed = list.filter((event) => event?.id && event?.sig);
  const unsigned = list.length - signed.length;
  if (!signed.length) return { accepted: 0, failed: unsigned, message: 'no signed events to write' };
  return sendEvents(relayUrl, signed, unsigned, options.timeoutMs ?? Math.max(DEFAULT_TIMEOUT_MS, signed.length * 40));
}

function sendEvents(relayUrl, events, unsigned, timeoutMs) {
  return new Promise((resolve) => {
    const pending = new Set(events.map((event) => event.id));
    let accepted = 0;
    let rejected = 0;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      resolve({ accepted, failed: rejected + pending.size + unsigned, timedOut: pending.size > 0 });
    };
    const timer = setTimeout(settle, timeoutMs);
    let socket;
    try {
      socket = new WebSocket(relayUrl);
    } catch (error) {
      clearTimeout(timer);
      resolve({ accepted: 0, failed: events.length + unsigned, message: error.message });
      return;
    }
    socket.addEventListener('open', () => {
      for (const event of events) {
        try { socket.send(JSON.stringify(['EVENT', event])); } catch { /* counted as pending on settle */ }
      }
    });
    socket.addEventListener('message', (message) => {
      const parsed = parseRelayMessage(message.data);
      if (!Array.isArray(parsed) || parsed[0] !== 'OK' || !pending.has(parsed[1])) return;
      pending.delete(parsed[1]);
      if (parsed[2]) accepted += 1; else rejected += 1;
      if (pending.size === 0) settle();
    });
    socket.addEventListener('error', settle);
    socket.addEventListener('close', settle);
  });
}

function parseRelayMessage(data) {
  try {
    return JSON.parse(String(data));
  } catch {
    return null;
  }
}

export async function fetchAllEvents(options = {}) {
  const relayUrl = options.relayUrl ?? process.env.IDENSTR_PRIVATE_RELAY_URL ?? '';
  if (!relayUrl) return { ok: false, message: 'private relay not configured', events: [] };
  if (typeof WebSocket !== 'function') return { ok: false, message: 'WebSocket client unavailable in this Node runtime', events: [] };
  const pageSize = 500;
  const seen = new Set();
  const events = [];
  // Paginate with `until` and dedupe by id: relays cap REQ results, and
  // same-second events make a strict until cursor lossy without the overlap.
  let until = Math.floor(Date.now() / 1000) + 600;
  for (;;) {
    const page = await fetchPage(relayUrl, { until, limit: pageSize }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS * 2);
    if (!page.ok) return { ok: false, message: page.message, events };
    let oldest = until;
    let added = 0;
    for (const event of page.events) {
      if (!event?.id || seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
      added += 1;
      if (event.created_at < oldest) oldest = event.created_at;
    }
    if (page.events.length < pageSize || added === 0) return { ok: true, events };
    until = oldest;
  }
}

function fetchPage(relayUrl, filter, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const events = [];
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => settle({ ok: false, message: 'private relay read timed out' }), timeoutMs);
    let socket;
    try {
      socket = new WebSocket(relayUrl);
    } catch (error) {
      clearTimeout(timer);
      resolve({ ok: false, message: error.message });
      return;
    }
    socket.addEventListener('open', () => {
      try {
        socket.send(JSON.stringify(['REQ', 'vault-export', filter]));
      } catch (error) {
        settle({ ok: false, message: error.message });
      }
    });
    socket.addEventListener('message', (message) => {
      const parsed = parseRelayMessage(message.data);
      if (!Array.isArray(parsed) || parsed[1] !== 'vault-export') return;
      if (parsed[0] === 'EVENT') events.push(parsed[2]);
      if (parsed[0] === 'EOSE') settle({ ok: true, events });
    });
    socket.addEventListener('error', () => settle({ ok: false, message: 'private relay connection failed' }));
    socket.addEventListener('close', () => settle({ ok: false, message: 'private relay connection closed before EOSE' }));
  });
}
