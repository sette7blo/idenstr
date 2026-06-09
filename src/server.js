import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCapabilities, getHealth, getOverview, getSystemInfo } from './app/system.js';
import { addFollowing, createBackup, discoverFollowSuggestions, getBackups, getDashboard, getFollowing, getIdentity, getProfile, getRelays, publishFollowing, publishProfile, publishRelays, refreshFollowingAnalytics, refreshFollowingAnalyticsStreaming, refreshFollowingProfiles, refreshFollowingProfilesStreaming, removeFollowing, saveFollowing, saveProfile, saveRelays, scanFollowing, scanProfile, scanRelays } from './app/identity.js';
import { TokenStore } from './app/tokenStore.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');
const tokenStore = new TokenStore(process.env.IDENSTR_TOKEN_STORE ?? join(root, 'data', 'api-tokens.json'));

const port = Number(process.env.IDENSTR_BIND_PORT ?? process.env.PORT ?? 3000);
const host = process.env.IDENSTR_BIND_HOST ?? '0.0.0.0';

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (error) {
      sendJson(res, 500, { error: 'internal_error', message: error.message });
    }
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/v1/system/info') return sendJson(res, 200, getSystemInfo());
  if (req.method === 'GET' && url.pathname === '/api/v1/system/health') return sendJson(res, 200, getHealth());
  if (req.method === 'GET' && url.pathname === '/api/v1/capabilities') return sendJson(res, 200, getCapabilities());
  if (req.method === 'GET' && url.pathname === '/api/v1/overview') return sendJson(res, 200, getOverview());
  if (req.method === 'GET' && url.pathname === '/api/v1/dashboard') return sendJson(res, 200, await getDashboard());
  if (req.method === 'GET' && url.pathname === '/api/v1/identity') return sendJson(res, 200, getIdentity());
  if (req.method === 'GET' && url.pathname === '/api/v1/profile') return sendJson(res, 200, await getProfile());
  if (req.method === 'PUT' && url.pathname === '/api/v1/profile') return sendJson(res, 200, await saveProfile(await readJson(req)));
  if (req.method === 'POST' && url.pathname === '/api/v1/profile/publish') return sendJson(res, 200, await publishProfile());
  if (req.method === 'POST' && url.pathname === '/api/v1/profile/scan') return sendJson(res, 200, await scanProfile());
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

  if (req.method === 'GET' && url.pathname === '/api/v1/backups') return sendJson(res, 200, { backups: await getBackups() });
  if (req.method === 'POST' && url.pathname === '/api/v1/backups') return sendJson(res, 201, await createBackup());
  if (req.method === 'GET' && url.pathname === '/api/v1/api-tokens') return sendJson(res, 200, { tokens: await tokenStore.listTokens() });
  if (req.method === 'POST' && url.pathname === '/api/v1/api-tokens') {
    const body = await readJson(req);
    const created = await tokenStore.createToken(body.name, body.scopes ?? ['read:identity']);
    return sendJson(res, 201, created);
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/v1/api-tokens/')) {
    const id = decodeURIComponent(url.pathname.split('/').at(-1));
    return sendJson(res, (await tokenStore.revokeToken(id)) ? 200 : 404, { revoked: true });
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(url.pathname, res, req.method === 'HEAD');
  sendJson(res, 404, { error: 'not_found' });
}

async function serveStatic(pathname, res, headOnly = false) {
  const normalized = pathname === '/' ? '/index.html' : pathname;
  if (normalized.includes('..')) return sendJson(res, 400, { error: 'bad_path' });
  const filePath = join(publicDir, normalized);
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': cacheControl(filePath) });
    if (headOnly) return res.end();
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
    '.svg': 'image/svg+xml; charset=utf-8'
  }[ext] ?? 'application/octet-stream';
}

function cacheControl(filePath) {
  const ext = extname(filePath);
  if (['.html', '.css', '.js', '.json'].includes(ext)) return 'no-store';
  return 'public, max-age=3600';
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
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
  });
}
