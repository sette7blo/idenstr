import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('following section uses the same save publish scan state model as profile and relays', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(html, /id="save-following"/);
  assert.match(html, /Publish/);
  assert.match(html, /Scan truth/);

  assert.match(html, /id="following-state" class="terminal-mini following-terminal empty"/);
  assert.match(html, /id="following-truth" class="following-truth empty"/);
  assert.match(html, /id="following-directory-summary"/);
  assert.doesNotMatch(html, /following-publish-status/);

  assert.match(html, /Refresh profiles/);
  assert.match(html, /Refresh activity/);

  const addForm = html.indexOf('id="follow-form"');
  const filterTools = html.indexOf('id="following-search"');
  const directoryList = html.indexOf('following-scroll-window');
  const actionBar = html.indexOf('following-action-bar');
  const statePanel = html.indexOf('id="following-state"');
  const truthPanel = html.indexOf('id="following-truth"');
  assert.ok(addForm !== -1, 'add form should exist');
  assert.ok(addForm < filterTools, 'add form should appear before filter tools');
  assert.ok(filterTools < directoryList, 'filter tools should appear before the directory list');
  assert.ok(directoryList < actionBar, 'action bar should appear after the list');
  assert.ok(actionBar < statePanel, 'state terminal should appear after the action bar');
  assert.ok(statePanel < truthPanel, 'truth badge should appear after the terminal');

  assert.match(html, /<option value="high-engagement">High engagement<\/option>/);
  assert.match(html, /<option value="engaged">Engaged<\/option>/);
  assert.match(html, /<option value="follows-you">Follows me<\/option>/);
  assert.match(html, /<option value="one-way">One-way<\/option>/);
  assert.match(html, /<option value="quality">Sort: engagement quality<\/option>/);
  assert.match(html, /id="following-sort-direction"/);
  assert.match(html, /<option value="desc">Highest first<\/option>/);
  assert.match(html, /<option value="asc">Lowest first<\/option>/);

  assert.match(app, /followingSortDirection/);
  assert.match(app, /sortFollowing\([^,]+, followingSort, followingSortDirection\)/);
  assert.match(app, /function sortFollowing\(entries, sort, direction = 'desc'\)/);
  assert.match(app, /direction === 'asc'/);
  assert.match(app, /let followingVisibleLimit = 50/);
  assert.match(app, /data-following-load-more/);
  assert.match(app, /data-following-show-all/);
  assert.match(app, /Load 50 more/);
  assert.match(app, /Show all/);
  assert.match(html, /id="following-selection-bar"/);
  assert.match(app, /followingSelectedIds/);
  assert.match(app, /data-follow-select/);
  assert.match(app, /Select visible/);
  assert.match(app, /Review removal/);
  assert.match(app, /Confirm remove/);
  assert.doesNotMatch(app, /confirm\(/);

  assert.match(app, /qualityLabel/);
  assert.match(app, /relationshipLabel/);
  assert.match(app, /zaps \$\{analytics\.engagement\?\.counts\?\.zaps30d/);
  assert.match(app, /relationship\.label/);
  assert.match(app, /one-way/);

  assert.match(app, /renderFollowingTerminalLog/);
  assert.match(app, /\$ idenstr following scan/);
  assert.match(app, /\$ idenstr following profiles refresh/);
  assert.match(app, /\$ idenstr following analytics refresh/);
  assert.match(app, /#save-following/);
  assert.match(app, /renderFollowingState/);
  assert.match(app, /renderFollowingTruth/);
  assert.match(app, /following-scan-details/);
  assert.match(app, /Relay scan details/);
  assert.doesNotMatch(app, /followingPublishStatus/);
});
