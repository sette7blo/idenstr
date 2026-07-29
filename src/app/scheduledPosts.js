import { randomBytes } from 'node:crypto';
import { prep } from './db.js';
import { publishEvent } from './identity.js';

const SCHEDULER_INTERVAL_MS = 60_000;
const MAX_CONTENT_BYTES = 64 * 1024;
let worker = null;
let workerRunning = false;

export function listScheduledPosts() {
  return prep(`
    SELECT * FROM scheduled_posts
    ORDER BY
      CASE status WHEN 'pending' THEN 0 WHEN 'publishing' THEN 1 WHEN 'failed' THEN 2 WHEN 'published' THEN 3 ELSE 4 END,
      publish_at ASC,
      created_at DESC
  `).all().map(rowToPost);
}

export function getScheduledPost(id) {
  const row = prep('SELECT * FROM scheduled_posts WHERE id = ?').get(id);
  return row ? rowToPost(row) : null;
}

export function createScheduledPost(body, options = {}) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const input = validateScheduledPostInput(body, { now, partial: false });
  const id = `sched_${randomBytes(12).toString('hex')}`;
  const iso = new Date().toISOString();
  prep(`
    INSERT INTO scheduled_posts (id, kind, content, tags, publish_at, timezone, scheduled_local, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, input.kind, input.content, JSON.stringify(input.tags), input.publishAt, input.timezone, input.scheduledLocal, iso, iso);
  return getScheduledPost(id);
}

export function updateScheduledPost(id, body, options = {}) {
  const existing = getScheduledPost(id);
  if (!existing) return null;
  if (existing.status !== 'pending') {
    const error = new Error('only pending scheduled posts can be edited');
    error.code = 'not_editable';
    throw error;
  }
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const merged = {
    kind: body.kind ?? existing.kind,
    content: body.content ?? existing.content,
    tags: body.tags ?? existing.tags,
    publish_at: body.publish_at ?? existing.publishAt,
    timezone: body.timezone ?? existing.timezone,
    scheduled_local: body.scheduled_local ?? existing.scheduledLocal
  };
  const input = validateScheduledPostInput(merged, { now, partial: false });
  prep(`
    UPDATE scheduled_posts
    SET kind = ?, content = ?, tags = ?, publish_at = ?, timezone = ?, scheduled_local = ?, updated_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(input.kind, input.content, JSON.stringify(input.tags), input.publishAt, input.timezone, input.scheduledLocal, new Date().toISOString(), id);
  return getScheduledPost(id);
}

export function cancelScheduledPost(id) {
  const result = prep(`
    UPDATE scheduled_posts
    SET status = 'cancelled', updated_at = ?
    WHERE id = ? AND status IN ('pending', 'failed')
  `).run(new Date().toISOString(), id);
  return result.changes > 0 ? getScheduledPost(id) : null;
}

export async function publishScheduledPostNow(id) {
  return publishOneScheduledPost(id, { force: true });
}

export async function publishDueScheduledPosts(options = {}) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const limit = options.limit ?? 10;
  const rows = prep(`
    SELECT id FROM scheduled_posts
    WHERE status = 'pending' AND publish_at <= ?
    ORDER BY publish_at ASC
    LIMIT ?
  `).all(now, limit);
  const results = [];
  for (const row of rows) results.push(await publishOneScheduledPost(row.id));
  return results;
}

export function startScheduledPostWorker(options = {}) {
  if (worker) return worker;
  const intervalMs = options.intervalMs ?? SCHEDULER_INTERVAL_MS;
  worker = setInterval(async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await publishDueScheduledPosts();
    } catch (error) {
      console.warn(`scheduled post worker failed: ${error.message}`);
    } finally {
      workerRunning = false;
    }
  }, intervalMs);
  worker.unref?.();
  return worker;
}

export function stopScheduledPostWorker() {
  if (worker) clearInterval(worker);
  worker = null;
  workerRunning = false;
}

async function publishOneScheduledPost(id, options = {}) {
  const existing = getScheduledPost(id);
  if (!existing) return null;
  if (existing.status === 'published') return existing;
  if (!options.force && existing.status !== 'pending') return existing;
  if (options.force && !['pending', 'failed'].includes(existing.status)) return existing;

  const locked = prep(`
    UPDATE scheduled_posts
    SET status = 'publishing', updated_at = ?
    WHERE id = ? AND status IN ('pending', 'failed')
  `).run(new Date().toISOString(), id);
  if (!locked.changes) return getScheduledPost(id);

  try {
    const result = await publishEvent({
      kind: existing.kind,
      content: existing.content,
      tags: existing.tags,
      created_at: Math.floor(Date.now() / 1000)
    });
    const ok = Boolean(result?.ok);
    prep(`
      UPDATE scheduled_posts
      SET status = ?, updated_at = ?, published_event_id = ?, last_error = ?, relay_results = ?
      WHERE id = ?
    `).run(
      ok ? 'published' : 'failed',
      new Date().toISOString(),
      result?.event?.id ?? null,
      ok ? null : (result?.error || 'publish failed'),
      JSON.stringify(result?.relayResults ?? []),
      id
    );
  } catch (error) {
    prep(`
      UPDATE scheduled_posts
      SET status = 'failed', updated_at = ?, last_error = ?, relay_results = ?
      WHERE id = ?
    `).run(new Date().toISOString(), error.message, JSON.stringify([]), id);
  }
  return getScheduledPost(id);
}

function validateScheduledPostInput(body, options = {}) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const kind = Number(body?.kind ?? 1);
  if (kind !== 1) throwInput('invalid_event', 'scheduled posts currently support kind 1 notes only');
  const content = body?.content;
  if (typeof content !== 'string' || !content.trim()) throwInput('invalid_event', 'content is required');
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) throwInput('invalid_event', 'content is too large');
  const tags = Array.isArray(body?.tags) ? body.tags : [];
  if (!tags.every((tag) => Array.isArray(tag) && tag.every((item) => typeof item === 'string'))) {
    throwInput('invalid_event', 'tags must be an array of string arrays');
  }
  const publishAt = Number(body?.publish_at ?? body?.publishAt);
  if (!Number.isInteger(publishAt)) throwInput('invalid_schedule', 'publish_at must be a Unix timestamp in seconds');
  if (publishAt <= now) throwInput('invalid_schedule', 'publish_at must be in the future');
  const timezone = cleanOptional(body?.timezone, 100);
  const scheduledLocal = cleanOptional(body?.scheduled_local ?? body?.scheduledLocal, 80);
  return { kind, content, tags, publishAt, timezone, scheduledLocal };
}

function cleanOptional(value, max) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

function throwInput(error, detail) {
  const err = new Error(detail);
  err.code = error;
  throw err;
}

function rowToPost(row) {
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    tags: JSON.parse(row.tags || '[]'),
    publishAt: row.publish_at,
    timezone: row.timezone || null,
    scheduledLocal: row.scheduled_local || null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedEventId: row.published_event_id || null,
    lastError: row.last_error || null,
    relayResults: row.relay_results ? JSON.parse(row.relay_results) : []
  };
}
