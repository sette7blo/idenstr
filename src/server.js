import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCapabilities, getHealth, getOverview, getStackTopology, getSystemInfo } from './app/system.js';
import { addFollowing, addMute, followAndPublish, muteAndPublish, unmuteAndPublish, unfollowAndPublish, createBackup, discoverFollowSuggestions, getBackupFile, getBackups, getDashboard, getFollowing, getFollowingDirectory, getIdentity, getMutes, getPrivateRelay, getProfile, getRelays, getWallet, inspectPrivateRelay, payInvoice, payZap, publishEvent, publishFollowing, publishMutes, publishProfile, publishRelays, refreshFollowingAnalytics, refreshFollowingAnalyticsStreaming, refreshFollowingProfiles, refreshFollowingProfilesStreaming, removeFollowing, removeMute, restoreBackup, saveFollowing, saveMutes, savePrivateRelay, saveProfile, saveRelays, saveWallet, scanFollowing, scanProfile, scanRelays, verifyNip05, walletBalance, walletInfo } from './app/identity.js';
import { TokenStore, hasScope } from './app/tokenStore.js';
import { authorizeAndSign } from './app/signingService.js';
import { loadState, saveState, addAudit, DEFAULT_TUNING } from './app/state.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');
const tokenStore = new TokenStore(process.env.IDENSTR_TOKEN_STORE ?? join(root, 'data', 'api-tokens.json'));

const port = Number(process.env.IDENSTR_BIND_PORT ?? process.env.PORT ?? 3000);
const host = process.env.IDENSTR_BIND_HOST ?? '0.0.0.0';

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      res.gzipOk = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
      await route(req, res);
    } catch (error) {
      sendJson(res, 500, { error: 'internal_error', message: error.message });
    }
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const auth = await authorizeRequest(req, url);
  if (!auth.ok) {
    return sendJson(res, auth.status, auth.body);
  }
  req.principal = auth.principal;
  if (req.method === 'GET' && url.pathname === '/api/v1/system/health') return sendJson(res, 200, getHealth());
  if (req.method === 'GET' && url.pathname === '/api/v1/whoami') return sendJson(res, 200, { principal: publicPrincipal(req.principal) });
  if (req.method === 'POST' && url.pathname === '/api/v1/sign') {
    const result = await authorizeAndSign({ principal: req.principal, unsignedEvent: await readJson(req) });
    return sendJson(res, result.status, result.body);
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/system/info') return sendJson(res, 200, getSystemInfo());
  if (req.method === 'GET' && url.pathname === '/api/v1/capabilities') return sendJson(res, 200, getCapabilities());
  if (req.method === 'GET' && url.pathname === '/api/v1/stack') return sendJson(res, 200, getStackTopology());
  if (req.method === 'GET' && url.pathname === '/api/v1/overview') return sendJson(res, 200, getOverview());
  if (req.method === 'GET' && url.pathname === '/api/v1/dashboard') return sendJson(res, 200, await getDashboard());
  if (req.method === 'GET' && url.pathname === '/api/v1/identity') return sendJson(res, 200, getIdentity());
  if (req.method === 'GET' && url.pathname === '/api/v1/profile') return sendJson(res, 200, await getProfile());
  if (req.method === 'PUT' && url.pathname === '/api/v1/profile') return sendJson(res, 200, await saveProfile(await readJson(req)));
  if (req.method === 'POST' && url.pathname === '/api/v1/profile/publish') return sendJson(res, 200, await publishProfile());
  if (req.method === 'POST' && url.pathname === '/api/v1/profile/scan') return sendJson(res, 200, await scanProfile());
  if (req.method === 'POST' && url.pathname === '/api/v1/profile/nip05/verify') return sendJson(res, 200, await verifyNip05());
  if (req.method === 'GET' && url.pathname === '/api/v1/following') return sendJson(res, 200, await getFollowing());
  if (req.method === 'POST' && url.pathname === '/api/v1/following') return sendJson(res, 201, await addFollowing(await readJson(req)));
  if (req.method === 'POST' && url.pathname === '/api/v1/following/save') return sendJson(res, 200, await saveFollowing());
  if (req.method === 'POST' && url.pathname === '/api/v1/following/profiles/refresh') {
    if (url.searchParams.get('stream') === '1') return streamGenerator(res, refreshFollowingProfilesStreaming());
    return sendJson(res, 200, await refreshFollowingProfiles());
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/following/analytics/refresh') {
    if (url.searchParams.get('stream') === '1') return streamGenerator(res, refreshFollowingAnalyticsStreaming());
    return sendJson(res, 200, await refreshFollowingAnalytics());
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/following/follow') return sendJson(res, 200, await followAndPublish(await readJson(req)));
  if (req.method === 'POST' && url.pathname === '/api/v1/following/unfollow') return sendJson(res, 200, await unfollowAndPublish((await readJson(req))?.pubkey));
  if (req.method === 'POST' && url.pathname === '/api/v1/following/publish') return sendJson(res, 200, await publishFollowing());
  if (req.method === 'POST' && url.pathname === '/api/v1/following/scan') return sendJson(res, 200, await scanFollowing());
  if (req.method === 'POST' && url.pathname === '/api/v1/following/discover') return sendJson(res, 200, await discoverFollowSuggestions());
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/v1/following/')) {
    const id = decodeURIComponent(url.pathname.split('/').at(-1));
    return sendJson(res, (await removeFollowing(id)) ? 200 : 404, { removed: true });
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/relays') return sendJson(res, 200, await getRelays());
  if (req.method === 'PUT' && url.pathname === '/api/v1/relays') return sendJson(res, 200, await saveRelays(await readJson(req)));
  if (req.method === 'POST' && url.pathname === '/api/v1/relays/publish') return sendJson(res, 200, await publishRelays());
  if (req.method === 'POST' && url.pathname === '/api/v1/relays/scan') return sendJson(res, 200, await scanRelays());
  if (req.method === 'GET' && url.pathname === '/api/v1/private-relay') return sendJson(res, 200, await getPrivateRelay());
  if (req.method === 'PUT' && url.pathname === '/api/v1/private-relay') return sendJson(res, 200, await savePrivateRelay(await readJson(req)));
  if (req.method === 'POST' && url.pathname === '/api/v1/private-relay/inspect') return sendJson(res, 200, await inspectPrivateRelay());

  if (req.method === 'GET' && url.pathname === '/api/v1/following/directory') return sendJson(res, 200, await getFollowingDirectory());
  if (req.method === 'GET' && url.pathname === '/api/v1/mutes') return sendJson(res, 200, await getMutes());
  if (req.method === 'POST' && url.pathname === '/api/v1/mutes') return sendJson(res, 201, await addMute(await readJson(req)));
  if (req.method === 'PUT' && url.pathname === '/api/v1/mutes') return sendJson(res, 200, await saveMutes(await readJson(req)));
  if (req.method === 'POST' && url.pathname === '/api/v1/mutes/mute') return sendJson(res, 200, await muteAndPublish(await readJson(req)));
  if (req.method === 'POST' && url.pathname === '/api/v1/mutes/unmute') return sendJson(res, 200, await unmuteAndPublish((await readJson(req))?.idOrValue));
  if (req.method === 'POST' && url.pathname === '/api/v1/mutes/publish') return sendJson(res, 200, await publishMutes());
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/v1/mutes/')) {
    const id = decodeURIComponent(url.pathname.split('/').at(-1));
    return sendJson(res, (await removeMute(id)) ? 200 : 404, { removed: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/events/publish') {
    const payload = await readJson(req);
    const denied = denyPublish(req.principal, payload);
    if (denied) return sendJson(res, denied.status, denied.body);
    return sendJson(res, 200, await publishEvent(payload));
  }

  if (req.method === 'GET' && url.pathname === '/api/v1/wallet') return sendJson(res, 200, getWallet());
  if (req.method === 'PUT' && url.pathname === '/api/v1/wallet') return sendJson(res, 200, await saveWallet(await readJson(req)));
  if (req.method === 'POST' && url.pathname === '/api/v1/wallet/info') return sendJson(res, 200, await walletInfo());
  if (req.method === 'POST' && url.pathname === '/api/v1/wallet/balance') return sendJson(res, 200, await walletBalance());
  if (req.method === 'POST' && url.pathname === '/api/v1/wallet/pay') return sendJson(res, 200, await payInvoice(await readJson(req)));
  if (req.method === 'POST' && url.pathname === '/api/v1/zaps/pay') return sendJson(res, 200, await payZap(await readJson(req)));

  if (req.method === 'GET' && url.pathname === '/api/v1/tuning') { const state = await loadState(); return sendJson(res, 200, state.tuning); }
  if (req.method === 'PUT' && url.pathname === '/api/v1/tuning') {
    const dt = DEFAULT_TUNING;
    const state = await loadState();
    const body = await readJson(req);
    state.tuning = {
      discover: { candidates: clampInt(body.discover?.candidates, 5, 100, dt.discover.candidates), results: clampInt(body.discover?.results, 1, 50, dt.discover.results) },
      relaySuggestions: clampInt(body.relaySuggestions, 1, 20, dt.relaySuggestions),
      engagement: {
        weights: { post: clampInt(body.engagement?.weights?.post, 0, 20, dt.engagement.weights.post), repost: clampInt(body.engagement?.weights?.repost, 0, 20, dt.engagement.weights.repost), reaction: clampInt(body.engagement?.weights?.reaction, 0, 20, dt.engagement.weights.reaction), zap: clampInt(body.engagement?.weights?.zap, 0, 20, dt.engagement.weights.zap) },
        thresholds: { high: clampInt(body.engagement?.thresholds?.high, 1, 100, dt.engagement.thresholds.high), engaged: clampInt(body.engagement?.thresholds?.engaged, 1, 100, dt.engagement.thresholds.engaged) }
      },
      activity: { veryActive: clampInt(body.activity?.veryActive, 1, 30, dt.activity.veryActive), active: clampInt(body.activity?.active, 1, 60, dt.activity.active), quiet: clampInt(body.activity?.quiet, 1, 180, dt.activity.quiet), inactive: clampInt(body.activity?.inactive, 1, 365, dt.activity.inactive) }
    };
    addAudit(state, 'tuning.updated', 'Tuning parameters updated');
    await saveState(state);
    return sendJson(res, 200, state.tuning);
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/backups') return sendJson(res, 200, { backups: await getBackups() });
  if (req.method === 'POST' && url.pathname === '/api/v1/backups') return sendJson(res, 201, await createBackup());
  if (req.method === 'GET' && url.pathname.startsWith('/api/v1/backups/download/')) {
    const filename = decodeURIComponent(url.pathname.split('/').at(-1));
    const content = await getBackupFile(filename);
    if (!content) return sendJson(res, 404, { error: 'backup_not_found' });
    return sendDownload(res, filename, content);
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/backups/restore') return sendJson(res, 200, await restoreBackup(await readJson(req)));
  if (req.method === 'POST' && url.pathname.startsWith('/api/v1/backups/restore/')) {
    const filename = decodeURIComponent(url.pathname.split('/').at(-1));
    const content = await getBackupFile(filename);
    if (!content) return sendJson(res, 404, { error: 'backup_not_found' });
    return sendJson(res, 200, await restoreBackup(JSON.parse(content)));
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/api-tokens') return sendJson(res, 200, { tokens: await tokenStore.listTokens() });
  if (req.method === 'POST' && url.pathname === '/api/v1/api-tokens') {
    const body = await readJson(req);
    const created = await tokenStore.createToken(body.name, body.scopes ?? []);
    return sendJson(res, 201, created);
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/v1/api-tokens/')) {
    const id = decodeURIComponent(url.pathname.split('/').at(-1));
    return sendJson(res, (await tokenStore.revokeToken(id)) ? 200 : 404, { revoked: true });
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(url.pathname, res, req.method === 'HEAD');
  sendJson(res, 404, { error: 'not_found' });
}

async function authorizeRequest(req, url) {
  // Health is always reachable without credentials: Docker healthchecks and
  // linked apps probe it to confirm the service is up.
  if (req.method === 'GET' && url.pathname === '/api/v1/system/health') {
    return { ok: true, principal: { id: 'anonymous', name: 'anonymous', scopes: [] } };
  }

  const header = req.headers.authorization ?? '';

  // App-to-app callers (Feedstr and other *str apps) present a scoped bearer
  // token. Scope checks apply to the versioned API surface. If a bearer token is
  // supplied it must be valid; dashboard openness does not turn bad app tokens
  // into anonymous admin access.
  const token = bearerToken(header);
  if (token) {
    const principal = await tokenStore.authenticate(token);
    if (!principal) return { ok: false, status: 401, body: { error: 'unauthorized' } };
    if (url.pathname.startsWith('/api/v1/')) {
      const required = requiredScope(req.method, url.pathname);
      if (required && !hasScope(principal.scopes, required)) {
        return { ok: false, status: 403, body: { error: 'scope_denied', required } };
      }
    }
    return { ok: true, principal };
  }

  // The human dashboard is intentionally open on the user's safe server/mesh.
  // Same-origin dashboard requests carry no Authorization header and run as the
  // dashboard admin principal. Linked apps should still use scoped bearer tokens
  // so signatures/actions are attributable and scope-limited.
  if (url.pathname === '/api/v1/sign') {
    return { ok: false, status: 401, body: { error: 'unauthorized', detail: 'signing requires a bearer token with a sign:kind scope' } };
  }
  return { ok: true, principal: { id: 'dashboard', name: 'dashboard', scopes: ['admin'], type: 'dashboard' } };
}

function bearerToken(header) {
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function publicPrincipal(principal) {
  if (!principal) return null;
  return { id: principal.id, name: principal.name, scopes: principal.scopes, rateLimit: principal.rateLimit, type: principal.type };
}

function requiredScope(method, pathname) {
  if (pathname === '/api/v1/whoami') return null;
  if (pathname === '/api/v1/sign') return null;
  if (pathname === '/api/v1/system/info' || pathname === '/api/v1/capabilities' || pathname === '/api/v1/overview' || pathname === '/api/v1/dashboard') return 'admin';
  if (pathname === '/api/v1/stack') return 'relays:read';
  if (pathname.startsWith('/api/v1/api-tokens')) return 'admin';
  if (pathname.startsWith('/api/v1/backups')) return 'admin';
  if (pathname === '/api/v1/tuning') return 'admin';
  if (pathname === '/api/v1/identity' || pathname === '/api/v1/profile') return method === 'GET' ? 'profile:read' : 'admin';
  if (pathname.startsWith('/api/v1/profile/')) return 'admin';
  if (pathname === '/api/v1/relays') return method === 'GET' ? 'relays:read' : 'admin';
  if (pathname.startsWith('/api/v1/relays/')) return 'admin';
  if (pathname === '/api/v1/following/directory') return 'following:read';
  if (pathname === '/api/v1/following') return method === 'GET' ? 'following:read' : 'admin';
  // Scoped apps (e.g. Feedstr) may follow/unfollow with following:write; the heavier
  // identity operations (scan, discover, analytics, save, bulk profile refresh) stay admin.
  if (pathname === '/api/v1/following/follow' || pathname === '/api/v1/following/unfollow') return 'following:write';
  if (pathname.startsWith('/api/v1/following/')) return 'admin';
  if (pathname === '/api/v1/mutes') return method === 'GET' ? 'mutes:read' : 'admin';
  if (pathname === '/api/v1/mutes/mute' || pathname === '/api/v1/mutes/unmute') return 'mutes:write';
  if (pathname.startsWith('/api/v1/mutes/')) return 'admin';
  // Publishing is authorized per-kind inside the route (denyPublish), mirroring
  // how /sign authorizes per sign:kind scope, so scoped apps can publish without admin.
  if (pathname === '/api/v1/events/publish') return null;
  // The NWC wallet is a spending surface: connecting it and moving arbitrary
  // invoices stays admin-only. Scoped apps get only the narrow NIP-57 zap endpoint.
  if (pathname === '/api/v1/zaps/pay') return 'zaps:write';
  if (pathname.startsWith('/api/v1/wallet')) return 'admin';
  return 'admin';
}

// Sign-and-publish authorization for app tokens. Admin bypasses. Scoped tokens
// need publish:events or publish:kind:<n>, and may not publish Idenstr-owned
// identity kinds (those have dedicated endpoints).
const PUBLISH_OWNED_KINDS = new Set([0, 3, 10000, 10002]);
function denyPublish(principal, payload) {
  const scopes = principal?.scopes ?? [];
  if (scopes.includes('admin')) return null;
  const kind = Number(payload?.kind);
  if (!Number.isInteger(kind) || kind < 0) return { status: 400, body: { error: 'invalid_event', detail: 'kind must be a non-negative integer' } };
  if (PUBLISH_OWNED_KINDS.has(kind)) return { status: 403, body: { error: 'owned_kind_denied', detail: 'identity kinds must use their dedicated endpoints' } };
  if (scopes.includes('publish:events') || scopes.includes(`publish:kind:${kind}`)) return null;
  return { status: 403, body: { error: 'scope_denied', required: `publish:kind:${kind}` } };
}

async function serveStatic(pathname, res, headOnly = false) {
  const normalized = pathname === '/' ? '/index.html' : pathname;
  if (normalized.includes('..')) return sendJson(res, 400, { error: 'bad_path' });
  const filePath = join(publicDir, normalized);
  try {
    const data = await readFile(filePath);
    const type = contentType(filePath);
    const headers = { 'Content-Type': type, 'Cache-Control': cacheControl(filePath), 'Vary': 'Accept-Encoding' };
    const compressible = /^(text\/|application\/(javascript|json)|image\/svg)/.test(type);
    if (headOnly) {
      res.writeHead(200, headers);
      return res.end();
    }
    if (res.gzipOk && compressible && data.length > 1024) {
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      return res.end(gzipSync(data));
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') return sendJson(res, 404, { error: 'not_found' });
    throw error;
  }
}

function contentType(filePath) {
  const ext = extname(filePath);
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  }[ext] ?? 'application/octet-stream';
}

function cacheControl(filePath) {
  const ext = extname(filePath);
  if (['.html', '.css', '.js', '.json'].includes(ext)) return 'no-store';
  return 'public, max-age=3600';
}

async function readJson(req, maxBytes = 16 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const err = new Error('Request body too large');
      err.code = 'body_too_large';
      throw err;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Vary': 'Accept-Encoding' };
  if (res.gzipOk && body.length > 1024) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(status, headers);
    return res.end(gzipSync(body));
  }
  res.writeHead(status, headers);
  res.end(body);
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function sendDownload(res, filename, content) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`
  });
  res.end(content);
}

async function streamGenerator(res, generator) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  for await (const chunk of generator) {
    res.write(JSON.stringify(chunk) + '\n');
  }
  res.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(port, host, () => {
    console.log(`Idenstr listening on http://${host}:${port}`);
    console.log('Dashboard is open on this trusted server/mesh. Apps authenticate with scoped bearer tokens.');
  });
}
