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
