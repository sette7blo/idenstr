import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../public/index.html', import.meta.url);
const cssUrl = new URL('../public/styles.css', import.meta.url);
const manifestUrl = new URL('../public/manifest.webmanifest', import.meta.url);

test('iOS install metadata is present for add-to-home-screen usage', async () => {
  const html = await readFile(htmlUrl, 'utf8');
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Idenstr"/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/);
  assert.match(html, /<link rel="apple-touch-icon" href="\.\/icons\/apple-touch-icon\.svg"/);
});

test('web app manifest captures the iOS-friendly standalone shell', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  assert.equal(manifest.name, 'Idenstr');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.theme_color, '#7c3cff');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '180x180'));
});

test('mobile CSS accounts for iOS safe areas without an extra bottom dock', async () => {
  const css = await readFile(cssUrl, 'utf8');
  const html = await readFile(htmlUrl, 'utf8');
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(css, /\.mobile-dock/);
  assert.doesNotMatch(html, /mobile-dock/);
  assert.match(css, /@media \(max-width: 900px\)/);
});

test('profile card shows full text and wraps npub on narrow screens', async () => {
  const css = await readFile(cssUrl, 'utf8');
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /white-space:\s*normal/);
  assert.match(css, /\.follow-add-inline\s*\{/);
  assert.match(css, /\.following-action-bar\s*\{/);
  assert.match(css, /\.following-action-group\s*\{/);
  assert.match(css, /\.following-scroll-window\s*\{[^}]*max-height:\s*min\(720px, 62vh\)/s);
  assert.match(css, /\.following-scroll-window\s*\{[^}]*overflow:\s*auto/s);
  assert.doesNotMatch(css, /-webkit-line-clamp/);
});

test('dashboard exposes a clearer information hierarchy for messy early builds', async () => {
  const html = await readFile(htmlUrl, 'utf8');
  assert.match(html, /section id="profile"/);
  assert.match(html, /section id="following"/);
  assert.match(html, /section id="relays"/);
  assert.match(html, /Save local relay policy/);
  assert.match(html, /Publish relay list/);
  assert.match(html, /Scan & compare published state/);
  assert.doesNotMatch(html, /Import from public relays/);
  assert.match(html, /Relay activity log/);
  assert.doesNotMatch(html, /relay-publish-status/);
  assert.doesNotMatch(html, /relay-scan/);
  assert.match(html, /Local relay policy/);
  assert.match(html, /relay-truth/);
  assert.match(html, /Top missing follow relays/);
  assert.doesNotMatch(html, /Popularity among follows/);
  assert.doesNotMatch(html, /relay-popularity/);
  assert.match(html, /profile-banner/);
  assert.match(html, /Banner URL/);
  assert.match(html, /Add relay/);
  assert.match(html, /relay-list/);
  assert.match(html, /relay-role-toggle/);
  assert.doesNotMatch(html, /check-label/);
  assert.doesNotMatch(html, /id="refresh-dashboard"/);
  assert.doesNotMatch(html, /class="section-tabs"/);
  assert.match(html, /← Identity overview/);
  assert.match(html, /Scan profile truth/);
  assert.match(html, /profile-truth/);
  assert.match(html, /Refresh profiles/);
  assert.match(html, /Refresh activity/);
  assert.match(html, /id="save-following"/);
  assert.match(html, /id="publish-following"/);
  assert.match(html, /id="scan-following"/);
  assert.match(html, /follow-add-inline/);
  assert.match(html, /following-action-bar/);
  assert.match(html, /following-directory-summary/);
  assert.match(html, /following-scroll-window/);
  assert.match(html, /following-state/);
  assert.match(html, /following-truth/);
  assert.ok(html.indexOf('following-scroll-window') < html.indexOf('following-action-bar'), 'action bar should appear after the follow list');
  assert.ok(html.indexOf('following-action-bar') < html.indexOf('following-state'), 'terminal should appear after the action bar');
  assert.ok(html.indexOf('following-state') < html.indexOf('following-truth'), 'truth badge should appear after the terminal');
  assert.match(html, /script src="\.\/app\.js\?v=following-bulk-cleanup-1"/);
});
