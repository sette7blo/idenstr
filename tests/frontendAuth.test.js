import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('frontend stores no credentials: HTTP Basic is handled by the browser, not app.js', async () => {
  // Dashboard auth is HTTP Basic. The browser prompts for and caches the
  // credentials, so app.js holds none of its own: no stored credentials, no
  // hand-rolled prompt, no Authorization header.
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(js, /fetch\(`\.\/api\/v1\/\$\{path\}`/);
  assert.match(js, /headers: authHeaders\(options\.headers \|\| \{\}\)/);
  assert.doesNotMatch(js, /localStorage/);
  assert.doesNotMatch(js, /sessionStorage/);
  assert.doesNotMatch(js, /window\.prompt\(/);
  assert.doesNotMatch(js, /authorization/i);
});

test('frontend downloads backups through fetch for consistent error handling', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(js, /data-backup-download/);
  assert.match(js, /backups\/download\/\$\{encodeURIComponent\(filename\)\}/);
  assert.doesNotMatch(js, /href="\.\/api\/v1\/backups\/download/);
});

test('token management UI exists for issuing app tokens', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /href="\.\/api\/v1\/api-tokens"/);
  assert.match(html, /token-create-form/);
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(js, /api\('api-tokens'\)/);
});
