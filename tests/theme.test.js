import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dashboard theme carries mysterious sovereign cyberpunk crypto visual language', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.match(css, /--monero-orange:\s*#ff6600/i);
  assert.match(css, /--bitcoin-gold:\s*#f7931a/i);
  assert.match(css, /--sovereign-purple:\s*#7c3cff/i);
  assert.match(css, /cyber-grid/i);
  assert.match(html, /sovereign/i);
  assert.match(html, /Nostr identity control room/i);
  assert.match(html, /Private vault relay/i);
});
