const els = {
  liveStatus: document.querySelector('#live-status'),
  npubValue: document.querySelector('#npub-value'),
  profileBanner: document.querySelector('#profile-banner'),
  profileAvatar: document.querySelector('#profile-avatar'),
  profileDisplayName: document.querySelector('#profile-display-name'),
  profileEvent: document.querySelector('#profile-event'),
  profileSummary: document.querySelector('#profile-summary'),
  followingCount: document.querySelector('#following-count'),
  relayCount: document.querySelector('#relay-count'),
  backupCount: document.querySelector('#backup-count'),
  followingEvent: document.querySelector('#following-event'),
  followingList: document.querySelector('#following-list'),
  followingSearch: document.querySelector('#following-search'),
  followingFilter: document.querySelector('#following-filter'),
  followingSort: document.querySelector('#following-sort'),
  followingSortDirection: document.querySelector('#following-sort-direction'),
  followingSelectionBar: document.querySelector('#following-selection-bar'),
  followingDirectorySummary: document.querySelector('#following-directory-summary'),
  followingState: document.querySelector('#following-state'),
  followingTruth: document.querySelector('#following-truth'),
  followingProgress: document.querySelector('#following-progress'),
  followingProgressFill: document.querySelector('#following-progress-fill'),
  followingProgressText: document.querySelector('#following-progress-text'),
  followingDiscover: document.querySelector('#following-discover'),
  relayAddForm: document.querySelector('#relay-add-form'),
  relayList: document.querySelector('#relay-list'),
  relayActivity: document.querySelector('#relay-activity'),
  relaySuggestions: document.querySelector('#relay-suggestions'),
  relayTruth: document.querySelector('#relay-truth'),
  backupList: document.querySelector('#backup-list'),
  auditLog: document.querySelector('#audit-log'),
  profileForm: document.querySelector('#profile-form'),
  profilePublishStatus: document.querySelector('#profile-publish-status'),
  profileTruth: document.querySelector('#profile-truth'),
  followForm: document.querySelector('#follow-form'),
  relayForm: document.querySelector('#relay-form'),
  views: [...document.querySelectorAll('[data-view]')],
  tabs: [...document.querySelectorAll('[data-tab]')]
};

let dashboard = null;
let followingSearchTerm = '';
let followingFilter = 'all';
let followingSort = 'default';
let followingSortDirection = 'desc';
let followingVisibleLimit = 50;
const followingPageSize = 50;
const followingSelectedIds = new Set();
let followingBulkConfirm = false;
const validViews = new Set(['overview', 'profile', 'following', 'relays', 'backups']);

async function api(path, options = {}) {
  const response = await fetch(`./api/v1/${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function refresh() {
  dashboard = await api('dashboard');
  render(dashboard);
}

function setView(viewName) {
  const next = validViews.has(viewName) ? viewName : 'overview';
  els.views.forEach((view) => view.classList.toggle('active-view', view.dataset.view === next));
  els.tabs.forEach((tab) => tab.classList.toggle('active-tab', tab.dataset.tab === next));
}

function render(data) {
  const { identity, profile, following, relays, backups, audit } = data;
  els.liveStatus.textContent = identity.status;
  els.npubValue.textContent = identity.npub || 'No npub configured';

  const publicName = profile.displayName || profile.name || 'Unnamed identity';
  els.profileDisplayName.textContent = publicName;
  els.profileEvent.textContent = `kind:${profile.event.kind}`;
  els.profileSummary.textContent = profile.about || 'No about text yet.';
  renderProfileBanner(profile.banner, publicName);
  renderProfileAvatar(profile.picture, publicName);
  els.followingCount.textContent = String(following.totalCount ?? following.entries.length);
  els.relayCount.textContent = String(new Set([...relays.read, ...relays.write]).size);
  els.backupCount.textContent = String(backups.length);
  els.followingEvent.textContent = following.event.status;

  fillForm(els.profileForm, profile);
  els.relayForm.elements.read.value = relays.read.join('\n');
  els.relayForm.elements.write.value = relays.write.join('\n');
  els.relayForm.elements.private.value = relays.private || '';
  renderFollowing(following.entries, following.totalCount ?? following.entries.length, following.directorySummary, following.analyticsSummary);
  renderFollowingState(following);
  renderFollowingTruth(following);
  if (following.discover) renderDiscover(following.discover);
  renderRelayList(relays);
  renderRelayActivity(relays);
  renderRelaySuggestions(relays);
  renderRelayTruth(relays);
  renderBackups(backups);
  renderAudit(audit);
  renderProfilePublishStatus(profile);
  renderProfileTruth(profile);
}

function fillForm(form, values) {
  for (const element of form.elements) {
    if (element.name && Object.hasOwn(values, element.name)) element.value = values[element.name] || '';
  }
}

function renderProfileBanner(banner, name) {
  els.profileBanner.style.backgroundImage = banner
    ? `linear-gradient(180deg, rgba(4,2,8,.08), rgba(4,2,8,.68)), url("${cssUrl(banner)}")`
    : 'radial-gradient(circle at 20% 20%, rgba(124,60,255,.66), transparent 36%), radial-gradient(circle at 78% 18%, rgba(255,102,0,.34), transparent 34%), linear-gradient(135deg, rgba(31,19,52,.94), rgba(4,2,8,.94))';
  els.profileBanner.setAttribute('aria-label', `${name} profile banner`);
}

function renderProfileAvatar(picture, name) {
  const fallback = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" rx="36" fill="#140d24"/><circle cx="80" cy="62" r="30" fill="#7c3cff"/><path d="M31 141c8-30 25-45 49-45s41 15 49 45" fill="#b58cff"/><text x="80" y="150" text-anchor="middle" font-family="monospace" font-size="14" fill="#f4efff">${escapeHtml(name.slice(0, 12))}</text></svg>`)}`;
  els.profileAvatar.src = picture || fallback;
  els.profileAvatar.alt = `${name} profile avatar`;
  els.profileAvatar.onerror = () => { els.profileAvatar.src = fallback; };
}

function renderFollowing(entries, totalCount = entries.length, directorySummary = null, analyticsSummary = null) {
  renderFollowingDirectorySummary(directorySummary, totalCount, analyticsSummary);
  pruneFollowingSelection(entries);
  const filteredEntries = filterFollowing(entries, followingSearchTerm, followingFilter);
  const filtered = sortFollowing(filteredEntries, followingSort, followingSortDirection);
  if (!entries.length) {
    renderFollowingSelectionBar([], []);
    els.followingList.textContent = 'No follows yet.';
    els.followingList.className = 'list empty';
    return;
  }
  if (!filtered.length) {
    renderFollowingSelectionBar([], []);
    els.followingList.textContent = 'No follows match this search in the loaded directory rows.';
    els.followingList.className = 'list empty';
    return;
  }
  const visibleLimit = Math.min(followingVisibleLimit, filtered.length);
  const visible = filtered.slice(0, visibleLimit);
  renderFollowingSelectionBar(visible, filtered);
  els.followingList.className = 'list follow-directory';
  els.followingList.innerHTML = visible.map((entry) => renderFollowRow(entry)).join('') + renderFollowingLoadControls(filtered.length, visible.length);
}

function pruneFollowingSelection(entries) {
  const ids = new Set(entries.map((entry) => entry.id));
  for (const id of [...followingSelectedIds]) {
    if (!ids.has(id)) followingSelectedIds.delete(id);
  }
  if (!followingSelectedIds.size) followingBulkConfirm = false;
}

function renderFollowingSelectionBar(visible = [], filtered = []) {
  const selected = followingSelectedIds.size;
  const visibleIds = visible.map((entry) => entry.id);
  const selectedVisible = visibleIds.filter((id) => followingSelectedIds.has(id)).length;
  const filteredCount = filtered.length;
  if (!selected) {
    els.followingSelectionBar.className = 'follow-selection-bar empty';
    els.followingSelectionBar.innerHTML = `
      <span>Select follows for cleanup. Current view: ${filteredCount} matching, ${visible.length} visible.</span>
      <button class="button ghost" type="button" data-follow-select-visible ${visible.length ? '' : 'disabled'}>Select visible</button>
    `;
    return;
  }
  els.followingSelectionBar.className = `follow-selection-bar ${followingBulkConfirm ? 'confirming' : ''}`;
  els.followingSelectionBar.innerHTML = followingBulkConfirm ? `
    <span><strong>Remove ${selected} selected?</strong><small>This updates the local following list draft. Publish later to broadcast kind:3.</small></span>
    <div class="follow-selection-actions">
      <button class="button danger" type="button" data-follow-confirm-remove>Confirm remove</button>
      <button class="button ghost" type="button" data-follow-cancel-remove>Cancel</button>
    </div>
  ` : `
    <span><strong>${selected} selected</strong><small>${selectedVisible}/${visible.length} selected in the visible slice · ${filteredCount} matching current filters.</small></span>
    <div class="follow-selection-actions">
      <button class="button ghost" type="button" data-follow-select-visible>Select visible</button>
      <button class="button ghost" type="button" data-follow-clear-selection>Clear</button>
      <button class="button danger" type="button" data-follow-review-remove>Review removal</button>
    </div>
  `;
}

function renderFollowingLoadControls(total, visible) {
  if (total <= visible) {
    return `<div class="row muted-row follow-load-row"><div><strong>Showing all ${total} matching follows</strong><small>Change filters or sort order to review a different slice.</small></div></div>`;
  }
  const remaining = total - visible;
  return `
    <div class="row muted-row follow-load-row">
      <div><strong>${remaining} more matching follows</strong><small>Showing first ${visible} of ${total}. Load more to reach the middle without changing filters.</small></div>
      <div class="follow-load-actions">
        <button class="button ghost" type="button" data-following-load-more="${Math.min(followingPageSize, remaining)}">Load 50 more</button>
        <button class="button ghost" type="button" data-following-show-all="${total}">Show all</button>
      </div>
    </div>
  `;
}

function renderFollowingDirectorySummary(summary, totalCount, analyticsSummary = null) {
  if (!summary) {
    els.followingDirectorySummary.className = 'following-cache-status empty';
    els.followingDirectorySummary.textContent = 'Profile cache not refreshed yet';
    return;
  }
  const parts = [`${summary.cached}/${summary.total} cached`];
  if (summary.missing) parts.push(`${summary.missing} missing`);
  if (summary.errors) parts.push(`${summary.errors} errors`);
  if (analyticsSummary) {
    const active = (analyticsSummary.veryActive ?? 0) + (analyticsSummary.active ?? 0);
    parts.push(`${analyticsSummary.engagement?.high ?? 0} high quality`);
    parts.push(`${active} active`);
  }
  const allCached = summary.cached === summary.total;
  els.followingDirectorySummary.className = `following-cache-status ${allCached ? 'ok' : 'warn'}`;
  els.followingDirectorySummary.textContent = parts.join(' · ');
}

function filterFollowing(entries, term, filter = 'all') {
  const q = String(term || '').trim().toLowerCase();
  const searched = !q ? entries : entries.filter((entry) => [
    entry.petname,
    entry.pubkey,
    entry.npub,
    entry.relayHint,
    entry.profile?.name,
    entry.profile?.displayName,
    entry.profile?.about,
    entry.profile?.nip05
  ].some((value) => String(value || '').toLowerCase().includes(q)));
  return searched.filter((entry) => matchesFollowFilter(entry, filter));
}

function matchesFollowFilter(entry, filter) {
  const analytics = entry.analytics || {};
  if (filter === 'high-engagement') return analytics.engagement?.tier === 'high';
  if (filter === 'engaged') return ['high', 'engaged'].includes(analytics.engagement?.tier);
  if (filter === 'follows-you') return analytics.followsYou === true;
  if (filter === 'one-way') return analytics.followsYou === false;
  if (filter === 'active') return ['very-active', 'active'].includes(analytics.activityTier);
  if (filter === 'inactive') return analytics.activityTier === 'inactive';
  if (filter === 'dormant') return analytics.activityTier === 'dormant';
  if (filter === 'unknown') return analytics.activityTier === 'unknown' || analytics.engagement?.tier === 'unknown';
  return true;
}

function sortFollowing(entries, sort, direction = 'desc') {
  const copy = [...entries];
  const multiplier = direction === 'asc' ? -1 : 1;
  if (sort === 'quality') return copy.sort((a, b) => multiplier * ((b.analytics?.engagement?.score ?? -1) - (a.analytics?.engagement?.score ?? -1) || (b.analytics?.lastActivityAt ?? 0) - (a.analytics?.lastActivityAt ?? 0)));
  if (sort === 'activity') return copy.sort((a, b) => multiplier * ((b.analytics?.lastActivityAt ?? 0) - (a.analytics?.lastActivityAt ?? 0)));
  if (sort === 'name') return copy.sort((a, b) => multiplier * followName(a).localeCompare(followName(b)));
  return copy;
}

function followName(entry) {
  return entry.profile?.displayName || entry.profile?.name || entry.petname || entry.npub || entry.pubkey || '';
}

function renderFollowRow(entry) {
  const profile = entry.profile || {};
  const title = profile.displayName || profile.name || entry.petname || 'Unknown follow';
  const subtitle = profile.nip05 || profile.name || entry.npub || entry.pubkey;
  const avatar = profile.picture ? `<img class="follow-avatar" src="${escapeHtml(profile.picture)}" alt="${escapeHtml(title)} avatar" loading="lazy" />` : `<div class="follow-avatar fallback">${escapeHtml((title || '?').slice(0, 2).toUpperCase())}</div>`;
  const status = entry.status?.profileFetch || 'pending';
  const about = profile.about ? `<p>${escapeHtml(profile.about)}</p>` : '<p class="empty">No cached profile text yet.</p>';
  const relayHint = entry.relayHint || entry.follow?.relayHint || 'no relay hint';
  const analytics = entry.analytics || {};
  const quality = qualityLabel(analytics);
  const relationship = relationshipLabel(analytics);
  const activity = activityLabel(analytics);
  const activityDetail = analytics.lastActivityAt ? `Last activity ${relativeTime(analytics.lastActivityAt)}` : 'Activity not observed on scanned relays';
  return `
    <div class="row follow-row ${followingSelectedIds.has(entry.id) ? 'is-selected' : ''}">
      <label class="follow-select" aria-label="Select ${escapeHtml(title)} for cleanup">
        <input type="checkbox" data-follow-select="${entry.id}" ${followingSelectedIds.has(entry.id) ? 'checked' : ''} />
        <span aria-hidden="true"></span>
      </label>
      ${avatar}
      <div class="follow-main">
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(subtitle)}</small>
        <code>${escapeHtml(entry.npub || entry.pubkey)}</code>
        ${about}
        <div class="follow-badges"><span class="relay-status ${followStatusClass(status)}">${escapeHtml(status)}</span><span class="relay-status ${quality.className}">${escapeHtml(quality.label)}</span><span class="relay-status ${relationship.className}">${escapeHtml(relationship.label)}</span><span class="relay-status ${activity.className}">${escapeHtml(activity.label)}</span><span>${escapeHtml(relayHint)}</span></div>
        <small class="follow-meta">${escapeHtml(activityDetail)} · score ${analytics.engagement?.score ?? 0}/100 · posts ${analytics.engagement?.counts?.posts30d ?? analytics.counts?.posts30d ?? 0}/30d · reposts ${analytics.engagement?.counts?.reposts30d ?? analytics.counts?.reposts30d ?? 0}/30d · likes ${analytics.engagement?.counts?.reactions30d ?? analytics.counts?.reactions30d ?? 0}/30d · zaps ${analytics.engagement?.counts?.zaps30d ?? analytics.counts?.zaps30d ?? 0}/30d</small>
      </div>
    </div>
  `;
}

function relationshipLabel(analytics = {}) {
  if (analytics.followsYou === true) return { label: 'follows you', className: 'ok' };
  if (analytics.followsYou === false) return { label: 'one-way', className: 'warn' };
  return { label: 'follow-back unknown', className: 'unknown' };
}

function qualityLabel(analytics = {}) {
  const tier = analytics.engagement?.tier || 'unknown';
  if (tier === 'high') return { label: 'high quality', className: 'ok' };
  if (tier === 'engaged') return { label: 'engaged', className: 'ok' };
  if (tier === 'light') return { label: 'light engagement', className: 'warn' };
  if (tier === 'low') return { label: 'low engagement', className: 'warn' };
  return { label: 'quality unknown', className: 'unknown' };
}

function activityLabel(analytics = {}) {
  const tier = analytics.activityTier || 'unknown';
  if (tier === 'very-active') return { label: 'very active', className: 'ok' };
  if (tier === 'active') return { label: 'active', className: 'ok' };
  if (tier === 'quiet') return { label: 'quiet', className: 'warn' };
  if (tier === 'inactive') return { label: 'inactive', className: 'warn' };
  if (tier === 'dormant') return { label: 'dormant', className: 'bad' };
  return { label: 'activity unknown', className: 'unknown' };
}

function relativeTime(seconds) {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - Number(seconds || 0));
  const days = Math.floor(diff / 86400);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 60) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months <= 1 ? '1mo ago' : `${months}mo ago`;
}

function followStatusClass(status) {
  if (status === 'ok') return 'ok';
  if (status === 'missing' || status === 'stale' || status === 'pending') return 'warn';
  return 'bad';
}

function renderFollowingTerminalLog(lines = []) {
  return lines.filter((line) => line != null && line !== '').join('\n');
}

function renderFollowingState(following) {
  const event = following.event || {};
  const hasPublish = event.status === 'published' || event.status === 'publish-attempted';

  if (hasPublish) {
    const results = event.relayResults || [
      ...(event.acceptedRelays || []).map((relay) => ({ relay, accepted: true, status: 'accepted' })),
      ...(event.rejectedRelays || []).map((row) => ({ ...row, accepted: false }))
    ];
    els.followingState.className = 'terminal-mini following-terminal';
    els.followingState.textContent = formatPublishLog(event.id, results, 'kind:3 following list');
  } else {
    els.followingState.className = 'terminal-mini following-terminal empty';
    els.followingState.textContent = renderFollowingTerminalLog([
      '$ idenstr following status',
      'state: local kind:3 following list is saved as a private draft',
      'publish: broadcasts signed kind:3 to write relays',
      'scan: compare local follows against public relays'
    ]);
  }
}

function renderFollowingTruth(following) {
  const truth = following.truth;
  if (!truth) {
    els.followingTruth.className = 'following-truth empty';
    els.followingTruth.textContent = 'Run scan to compare local following list against public relays.';
    return;
  }
  const scoreClass = truth.score === 100 ? 'ok' : truth.score >= 70 ? 'warn' : 'bad';
  const rows = truth.rows || [];
  const newest = truth.newestPublished;
  const newestText = newest ? `Newest public: ${newest.relay} · ${newest.count} follows` : '';
  const deltaText = followTruthDeltaText(truth.latestComparison);
  els.followingTruth.className = `following-truth ${scoreClass}`;
  els.followingTruth.innerHTML = `
    <div class="truth-score ${scoreClass}">
      <strong>${truth.score}%</strong>
      <span>Follow truth match</span>
    </div>
    <div class="truth-copy">
      <div class="subsection-head"><span>${escapeHtml(followTruthTitle(truth))}</span><small>${escapeHtml(truth.summary)}</small></div>
      ${newestText ? `<p>${escapeHtml(newestText)}</p>` : ''}
      ${deltaText !== 'delta: none' ? `<p>${escapeHtml(deltaText)}</p>` : ''}
      <details class="following-scan-details">
        <summary>Relay scan details</summary>
        <div class="relay-list compact-relays profile-truth-rows">
          ${rows.map((row) => renderFollowTruthRow(row)).join('') || '<p class="empty">No follow scan rows yet.</p>'}
        </div>
      </details>
    </div>
  `;
}

function followTruthTitle(truth) {
  if (truth.status === 'unknown') return 'Unknown published follow truth';
  if (truth.score === 100) return 'Local follows match public truth';
  return 'Local follows need review';
}

function followTruthDeltaText(comparison) {
  if (!comparison || comparison.matches) return 'delta: none';
  return `delta: ${comparison.localOnlyCount} local-only · ${comparison.publishedOnlyCount} published-only · local ${comparison.localCount} vs public ${comparison.publishedCount}`;
}

function renderFollowTruthDelta(comparison) {
  if (!comparison || comparison.matches) return '';
  const localRows = (comparison.localOnly || []).slice(0, 8).map((row) => `<code>${escapeHtml(row.npub || row.pubkey)}</code>`).join('');
  const publicRows = (comparison.publishedOnly || []).slice(0, 8).map((row) => `<code>${escapeHtml(row.npub || row.pubkey)}</code>`).join('');
  return `
    <div class="truth-delta">
      <h3>Newest public delta</h3>
      <small>${comparison.localOnlyCount} local-only · ${comparison.publishedOnlyCount} published-only · local ${comparison.localCount} vs public ${comparison.publishedCount}</small>
      ${localRows ? `<p><strong>Local-only sample</strong> ${localRows}</p>` : ''}
      ${publicRows ? `<p><strong>Published-only sample</strong> ${publicRows}</p>` : ''}
    </div>
  `;
}

function renderFollowTruthRow(row) {
  const age = row.created_at ? ` · ${new Date(row.created_at * 1000).toLocaleString()}` : '';
  const event = row.eventId ? ` · event ${row.eventId.slice(0, 12)}…` : '';
  const delta = row.matches === false ? ` · ${row.localOnlyCount} local-only · ${row.publishedOnlyCount} published-only` : '';
  return `
    <div class="relay-row compact-row profile-truth-row">
      <div class="relay-main">
        <span class="relay-status ${profileTruthStatusClass(row.status)}">${escapeHtml(row.status)}</span>
        <code>${escapeHtml(row.relay)}</code>
        <small>${escapeHtml((row.detail || '') + event + age + ` · local ${row.localCount ?? 0} / public ${row.publishedCount ?? 0}` + delta)}</small>
      </div>
    </div>
  `;
}

function renderRelayActivity(relays) {
  const lines = [];
  const event = relays.event || {};
  const scan = relays.scan || [];
  const consistency = relays.consistency;

  if (event.status === 'published' || event.status === 'publish-attempted') {
    const results = event.relayResults || [
      ...(event.acceptedRelays || []).map((relay) => ({ relay, accepted: true, status: 'accepted' })),
      ...(event.rejectedRelays || []).map((row) => ({ ...row, accepted: false }))
    ];
    lines.push(formatPublishLog(event.id, results, 'kind:10002 relay list'));
  } else {
    lines.push('Publish: local relay policy is saved as draft only. Use Publish relay list to broadcast kind:10002.');
  }

  if (scan.length) {
    const ok = scan.filter((row) => row.status === 'ok' || row.status === 'partial-timeout' || row.status === 'partial-error').length;
    lines.push(`Scan: ${ok}/${scan.length} relays responded. Per-relay latency/status is shown in the local policy list above.`);
    if (consistency) lines.push(formatRelayConsistency(consistency));
  } else {
    lines.push('Scan: not run yet. Scan checks configured relays and compares public truth with local policy.');
  }

  els.relayActivity.textContent = lines.join('\n\n');
}

function renderRelayTruth(relays) {
  const consistency = relays.consistency;
  if (!consistency) {
    els.relayTruth.className = 'relay-truth empty';
    els.relayTruth.textContent = 'Run scan to compare local policy against the newest published relay list.';
    return;
  }

  const model = relayTruthModel(consistency);
  const scoreClass = model.score === 100 ? 'ok' : model.score >= 70 ? 'warn' : 'bad';
  els.relayTruth.className = `relay-truth ${scoreClass}`;
  els.relayTruth.innerHTML = `
    <div class="truth-score ${scoreClass}">
      <strong>${model.score}%</strong>
      <span>Truth match</span>
    </div>
    <div class="truth-copy">
      <div class="subsection-head"><span>${escapeHtml(model.title)}</span><small>${escapeHtml(model.subtitle)}</small></div>
      <p>${escapeHtml(model.message)}</p>
      ${model.publicOnly.length ? renderRelayDelta('Published relays missing locally', model.publicOnly, 'Add to local policy', 'data-add-public-relay') : ''}
      ${model.localOnly.length ? renderRelayDelta('Local relays not in published list', model.localOnly, 'Keep local only', null) : ''}
    </div>
  `;
}

function relayTruthModel(consistency) {
  if (consistency.status === 'unknown') {
    return { score: 0, title: 'Unknown public truth', subtitle: 'No published kind:10002 found', message: consistency.message, publicOnly: [], localOnly: [] };
  }
  const local = roleMap(consistency.local);
  const published = roleMap(consistency.published);
  const allRelays = [...new Set([...local.keys(), ...published.keys()])].sort();
  const matched = allRelays.filter((relay) => local.get(relay) === published.get(relay)).length;
  const score = allRelays.length ? Math.round((matched / allRelays.length) * 100) : 100;
  const publicOnly = allRelays.filter((relay) => !local.has(relay) && published.has(relay)).map((relay) => ({ url: relay, roles: published.get(relay) }));
  const localOnly = allRelays.filter((relay) => local.has(relay) && !published.has(relay)).map((relay) => ({ url: relay, roles: local.get(relay) }));
  const roleMismatch = allRelays.filter((relay) => local.has(relay) && published.has(relay) && local.get(relay) !== published.get(relay));
  return {
    score,
    title: score === 100 ? 'Local policy matches public truth' : 'Local policy differs from public truth',
    subtitle: `Source: ${consistency.relay || 'unknown relay'}`,
    message: score === 100
      ? 'The local relay policy and the newest published kind:10002 relay list are aligned.'
      : `${publicOnly.length} published-only, ${localOnly.length} local-only, ${roleMismatch.length} role mismatch. Add published relays you still trust, then publish again to make public truth match local policy.`,
    publicOnly,
    localOnly
  };
}

function renderRelayDelta(title, rows, actionLabel, actionAttr) {
  return `
    <div class="truth-delta">
      <h3>${escapeHtml(title)}</h3>
      <div class="relay-list compact-relays">
        ${rows.map((row) => `
          <div class="relay-row compact-row">
            <div class="relay-main"><code>${escapeHtml(row.url)}</code><small>${escapeHtml(formatRoles(row.roles))}</small></div>
            ${actionAttr ? `<button class="button ghost" ${actionAttr}="${escapeHtml(row.url)}" data-public-roles="${escapeHtml(row.roles)}">${escapeHtml(actionLabel)}</button>` : '<span class="relay-status warn">review</span>'}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function roleMap(relays = {}) {
  const map = new Map();
  for (const relay of relays.read || []) map.set(normalizeRelayUrl(relay), 'read');
  for (const relay of relays.write || []) {
    const normalized = normalizeRelayUrl(relay);
    map.set(normalized, map.get(normalized) === 'read' ? 'read/write' : 'write');
  }
  return map;
}

function formatRoles(roles) {
  return roles === 'read/write' ? 'read + write' : roles;
}

function formatRelayConsistency(consistency) {
  if (consistency.status === 'match') {
    return [
      'Truth check: OK',
      consistency.message,
      `Source relay: ${consistency.relay || 'local publish attempt'}`
    ].join('\n');
  }
  if (consistency.status === 'mismatch') {
    return [
      'Truth check: MISMATCH',
      consistency.message,
      `Local read/write: ${consistency.local?.read?.length ?? 0}/${consistency.local?.write?.length ?? 0}`,
      `Published read/write: ${consistency.published?.read?.length ?? 0}/${consistency.published?.write?.length ?? 0}`,
      `Source relay: ${consistency.relay || 'unknown'}`
    ].join('\n');
  }
  return ['Truth check: UNKNOWN', consistency.message].join('\n');
}

function renderRelayList(relays) {
  const scanByUrl = new Map((relays.scan || []).map((row) => [normalizeRelayUrl(row.url), row]));
  const popularityByUrl = new Map((relays.popularity?.local || []).map((row) => [normalizeRelayUrl(row.url), row]));
  const rows = [...new Set([...relays.read, ...relays.write])].map((url) => ({
    url,
    read: relays.read.includes(url),
    write: relays.write.includes(url),
    scan: scanByUrl.get(normalizeRelayUrl(url)),
    popularity: popularityByUrl.get(normalizeRelayUrl(url))
  })).sort((a, b) => {
    if (a.popularity || b.popularity) return (b.popularity?.count ?? 0) - (a.popularity?.count ?? 0) || a.url.localeCompare(b.url);
    return a.url.localeCompare(b.url);
  });
  if (!rows.length) {
    els.relayList.textContent = 'No relays configured.';
    els.relayList.className = 'relay-list empty';
    return;
  }
  els.relayList.className = 'relay-list';
  els.relayList.innerHTML = rows.map((row) => {
    const status = relayStatus(row.scan);
    return `
      <div class="relay-row">
        <div class="relay-main">
          <span class="relay-status ${status.className}">${status.label}</span>
          <code>${escapeHtml(row.url)}</code>
          <small>${escapeHtml(status.detail)}</small>
          ${renderPopularityBadge(row.popularity)}
        </div>
        <div class="relay-toggles" aria-label="Relay roles for ${escapeHtml(row.url)}">
          <label class="relay-role-toggle ${row.read ? 'is-on' : ''}" data-toggle-relay="read" data-relay-url="${escapeHtml(row.url)}">
            <input type="checkbox" ${row.read ? 'checked' : ''} aria-label="Read enabled for ${escapeHtml(row.url)}" />
            <span class="relay-check" aria-hidden="true"></span>
            <span><strong>Read</strong><small>fetch</small></span>
          </label>
          <label class="relay-role-toggle ${row.write ? 'is-on' : ''}" data-toggle-relay="write" data-relay-url="${escapeHtml(row.url)}">
            <input type="checkbox" ${row.write ? 'checked' : ''} aria-label="Write enabled for ${escapeHtml(row.url)}" />
            <span class="relay-check" aria-hidden="true"></span>
            <span><strong>Write</strong><small>publish</small></span>
          </label>
          <button class="button ghost" data-remove-relay="${escapeHtml(row.url)}">Remove</button>
        </div>
      </div>
    `;
  }).join('');
}


function renderRelaySuggestions(relays) {
  const suggestions = relays.popularity?.suggestions || [];
  if (!relays.popularity) {
    els.relaySuggestions.className = 'relay-suggestions empty';
    els.relaySuggestions.textContent = 'Run scan to discover popular follow relays that are not in your local policy.';
    return;
  }
  if (!suggestions.length) {
    els.relaySuggestions.className = 'relay-suggestions empty';
    els.relaySuggestions.textContent = 'No missing popular relays found among scanned follow relay lists.';
    return;
  }
  els.relaySuggestions.className = 'relay-suggestions relay-list compact-relays';
  els.relaySuggestions.innerHTML = suggestions.map((row, index) => `
    <div class="relay-row compact-row suggestion-row">
      <div class="relay-main">
        <span class="relay-status ${tierClass(row.tier)}">#${index + 1} ${escapeHtml(row.tier)}</span>
        <code>${escapeHtml(row.url)}</code>
        <small>${escapeHtml(row.fraction)} follows · ${row.percent}% popularity</small>
      </div>
      <button class="button ghost" data-add-suggested-relay="${escapeHtml(row.url)}">Add read/write</button>
    </div>
  `).join('');
}

function renderPopularityBadge(row) {
  if (!row) return '<span class="relay-pop-badge empty">popularity unknown</span>';
  return `<span class="relay-pop-badge ${tierClass(row.tier)}">${escapeHtml(row.fraction)} follows · ${row.percent}% · ${escapeHtml(row.tier)}</span>`;
}

function tierClass(tier) {
  if (tier === 'high') return 'ok';
  if (tier === 'common') return 'warn';
  if (tier === 'niche') return 'niche';
  return 'unknown';
}

function relayStatus(scan) {
  if (!scan) return { className: 'unknown', label: 'not scanned', detail: 'Scan to check connectivity and current identity events.' };
  const detail = `profile ${scan.profile}, following ${scan.following}, relay list ${scan.relayList}${Number.isFinite(scan.latencyMs) ? ` · ${scan.latencyMs}ms` : ''}${scan.error ? ` · ${scan.error}` : ''}`;
  if (scan.status === 'ok') return { className: 'ok', label: 'ok', detail };
  if (scan.status?.startsWith('partial')) return { className: 'warn', label: scan.status, detail };
  return { className: 'bad', label: scan.status || 'error', detail };
}


function renderProfileTruth(profile) {
  const truth = profile.truth;
  if (!truth) {
    els.profileTruth.className = 'profile-truth empty';
    els.profileTruth.textContent = 'Run scan to compare local profile against public relays.';
    return;
  }
  const scoreClass = truth.score === 100 ? 'ok' : truth.score >= 70 ? 'warn' : 'bad';
  const rows = truth.rows || [];
  els.profileTruth.className = `profile-truth ${scoreClass}`;
  els.profileTruth.innerHTML = `
    <div class="truth-score ${scoreClass}">
      <strong>${truth.score}%</strong>
      <span>Profile truth match</span>
    </div>
    <div class="truth-copy">
      <div class="subsection-head"><span>${escapeHtml(profileTruthTitle(truth))}</span><small>${escapeHtml(truth.summary)}</small></div>
      <div class="relay-list compact-relays profile-truth-rows">
        ${rows.map((row) => renderProfileTruthRow(row)).join('') || '<p class="empty">No profile scan rows yet.</p>'}
      </div>
    </div>
  `;
}

function profileTruthTitle(truth) {
  if (truth.status === 'unknown') return 'Unknown published profile truth';
  if (truth.score === 100) return 'Local profile matches public truth';
  return 'Local profile needs review';
}

function renderProfileTruthRow(row) {
  const fields = row.changedFields?.length ? ` · differs: ${row.changedFields.join(', ')}` : '';
  const age = row.created_at ? ` · ${new Date(row.created_at * 1000).toLocaleString()}` : '';
  const event = row.eventId ? ` · event ${row.eventId.slice(0, 12)}…` : '';
  return `
    <div class="relay-row compact-row profile-truth-row">
      <div class="relay-main">
        <span class="relay-status ${profileTruthStatusClass(row.status)}">${escapeHtml(row.status)}</span>
        <code>${escapeHtml(row.relay)}</code>
        <small>${escapeHtml((row.detail || '') + event + age + fields)}</small>
        ${row.diff?.length ? `<div class="profile-diff">${row.diff.slice(0, 4).map((item) => `<small><strong>${escapeHtml(item.field)}</strong> local: ${escapeHtml(item.local || 'empty')} · relay: ${escapeHtml(item.published || 'empty')}</small>`).join('')}</div>` : ''}
      </div>
    </div>
  `;
}

function profileTruthStatusClass(status) {
  if (status === 'match') return 'ok';
  if (status === 'missing' || status === 'stale') return 'warn';
  return 'bad';
}

function renderBackups(backups) {
  if (!backups.length) {
    els.backupList.textContent = 'No backups yet.';
    els.backupList.className = 'list empty';
    return;
  }
  els.backupList.className = 'list';
  els.backupList.innerHTML = backups.map((backup) => `
    <div class="row">
      <div>
        <strong>${new Date(backup.createdAt).toLocaleString()}</strong>
        <small>${backup.followingCount} follows, ${(backup.sizeBytes / 1024).toFixed(1)} KB</small>
      </div>
      <div>
        <a class="button ghost" href="./api/v1/backups/download/${encodeURIComponent(backup.filename)}" download="${escapeHtml(backup.filename)}">Download</a>
      </div>
    </div>
  `).join('');
}

function renderAudit(audit) {
  els.auditLog.className = 'list';
  els.auditLog.innerHTML = audit.slice(0, 8).map((entry) => `
    <div class="row"><div><strong>${escapeHtml(entry.type)}</strong><small>${escapeHtml(entry.message)} · ${new Date(entry.at).toLocaleString()}</small></div></div>
  `).join('');
}

function renderProfilePublishStatus(profile) {
  const event = profile.event || {};
  if (event.status === 'published' || event.status === 'publish-attempted') {
    const results = event.relayResults || [
      ...(event.acceptedRelays || []).map((relay) => ({ relay, accepted: true, status: 'accepted' })),
      ...(event.rejectedRelays || []).map((row) => ({ ...row, accepted: false }))
    ];
    els.profilePublishStatus.textContent = formatPublishLog(event.id, results);
    return;
  }
  els.profilePublishStatus.textContent = 'Save creates a local kind:0 draft. Publish signs it server-side and sends it to configured write relays.';
}

function formatPublishLog(eventId, results, label = 'kind:0 profile') {
  const accepted = results.filter((row) => row.accepted).length;
  const header = `Published ${label}\nEvent: ${eventId}\nRelay log: ${accepted}/${results.length} accepted`;
  const rows = results.map((row) => {
    const mark = row.accepted ? 'OK' : 'NO';
    const latency = Number.isFinite(row.latencyMs) ? ` ${row.latencyMs}ms` : '';
    const message = row.message ? ` — ${row.message}` : '';
    return `${mark} ${row.relay} · ${row.status || 'unknown'}${latency}${message}`;
  });
  return [header, ...rows].join('\n');
}

els.profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(els.profileForm));
  await api('profile', { method: 'PUT', body: JSON.stringify(payload) });
  await refresh();
});

document.querySelector('#publish-profile').addEventListener('click', async () => {
  els.profilePublishStatus.textContent = 'Signing current profile and publishing to write relays...';
  const result = await api('profile/publish', { method: 'POST' });
  els.profilePublishStatus.textContent = formatPublishLog(result.published.event.id, result.published.results);
  await refresh();
});

document.querySelector('#scan-profile').addEventListener('click', async () => {
  els.profileTruth.textContent = 'Scanning configured relays for published kind:0 profile truth...';
  await api('profile/scan', { method: 'POST' });
  await refresh();
});

els.followForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(els.followForm));
  await api('following', { method: 'POST', body: JSON.stringify(payload) });
  els.followForm.reset();
  await refresh();
});

document.querySelector('#save-following').addEventListener('click', async () => {
  els.followingState.textContent = renderFollowingTerminalLog([
    '$ idenstr following save',
    'state: writing local kind:3 draft',
    'status: running...'
  ]);
  await api('following/save', { method: 'POST' });
  await refresh();
});

document.querySelector('#refresh-follow-profiles').addEventListener('click', async () => {
  els.followingState.className = 'terminal-mini following-terminal running';
  els.followingState.textContent = renderFollowingTerminalLog([
    '$ idenstr following profiles refresh',
    'status: running...'
  ]);
  showProgress(true);
  await streamRefresh('following/profiles/refresh?stream=1');
  showProgress(false);
  await refresh();
});

document.querySelector('#refresh-follow-analytics').addEventListener('click', async () => {
  els.followingState.className = 'terminal-mini following-terminal running';
  els.followingState.textContent = renderFollowingTerminalLog([
    '$ idenstr following analytics refresh',
    'status: running...'
  ]);
  showProgress(true);
  await streamRefresh('following/analytics/refresh?stream=1');
  showProgress(false);
  await refresh();
});

document.querySelector('#discover-following').addEventListener('click', async () => {
  els.followingDiscover.className = 'following-discover';
  els.followingDiscover.textContent = 'Scanning mutual follow lists for suggestions...';
  const result = await api('following/discover', { method: 'POST' });
  renderDiscover(result);
});

els.followingDiscover.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-discover-add]');
  if (!button) return;
  const pubkey = button.dataset.discoverAdd;
  await api('following', { method: 'POST', body: JSON.stringify({ pubkey }) });
  button.textContent = 'Added';
  button.disabled = true;
  await refresh();
});

function showProgress(visible) {
  els.followingProgress.className = visible ? 'following-progress' : 'following-progress hidden';
  if (!visible) {
    els.followingProgressFill.style.width = '0%';
    els.followingProgressText.textContent = '';
  }
}

function updateProgress(completed, total) {
  const pct = total ? Math.round((completed / total) * 100) : 0;
  els.followingProgressFill.style.width = `${pct}%`;
  els.followingProgressText.textContent = `${completed}/${total}`;
}

async function streamRefresh(path) {
  const response = await fetch(`./api/v1/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' } });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'progress') updateProgress(msg.completed, msg.total);
    }
  }
}

function renderDiscover(result) {
  if (!result.suggestions?.length) {
    els.followingDiscover.className = 'following-discover empty';
    els.followingDiscover.textContent = result.message || 'No suggestions found.';
    return;
  }
  els.followingDiscover.className = 'following-discover';
  els.followingDiscover.innerHTML = `
    <div class="discover-list">
      ${result.suggestions.map((s, i) => {
        const name = s.profile?.displayName || s.profile?.name || 'Unknown';
        const about = s.profile?.about || '';
        const pic = s.profile?.picture;
        const avatar = pic
          ? `<img class="discover-avatar" src="${escapeHtml(pic)}" alt="${escapeHtml(name)}" loading="lazy" />`
          : `<div class="discover-avatar fallback">${escapeHtml(name.slice(0, 2).toUpperCase())}</div>`;
        return `
          <div class="discover-row">
            ${avatar}
            <div class="discover-main">
              <strong>#${i + 1} ${escapeHtml(name)}</strong>
              <small>${escapeHtml(about).slice(0, 120)}</small>
              <code>${escapeHtml(s.npub)}</code>
            </div>
            <div style="display:grid;gap:6px;align-items:center;text-align:center">
              <span class="discover-badge">${s.mutualCount}/${result.mutualCount} mutuals</span>
              <button class="button ghost" data-discover-add="${escapeHtml(s.pubkey)}">Add</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

document.querySelector('#publish-following').addEventListener('click', async () => {
  els.followingState.className = 'terminal-mini following-terminal running';
  els.followingState.textContent = renderFollowingTerminalLog([
    '$ idenstr following publish',
    'event: signing local following list as kind:3',
    'relay: broadcasting to write relays',
    'status: running...'
  ]);
  const result = await api('following/publish', { method: 'POST' });
  els.followingState.textContent = formatPublishLog(result.published.event.id, result.published.results, 'kind:3 following list');
  await refresh();
});

document.querySelector('#scan-following').addEventListener('click', async () => {
  els.followingState.className = 'terminal-mini following-terminal running';
  els.followingState.textContent = renderFollowingTerminalLog([
    '$ idenstr following scan',
    'relay: scanning configured relays for newest published kind:3',
    'compare: local follow set vs public relay truth',
    'status: running... this can take a moment'
  ]);
  await api('following/scan', { method: 'POST' });
  await refresh();
});

function rerenderFollowingDirectory() {
  if (dashboard) renderFollowing(dashboard.following.entries, dashboard.following.totalCount, dashboard.following.directorySummary, dashboard.following.analyticsSummary);
}

els.followingSearch.addEventListener('input', () => {
  followingSearchTerm = els.followingSearch.value;
  followingVisibleLimit = followingPageSize;
  rerenderFollowingDirectory();
});

els.followingFilter.addEventListener('change', () => {
  followingFilter = els.followingFilter.value;
  followingVisibleLimit = followingPageSize;
  rerenderFollowingDirectory();
});

els.followingSort.addEventListener('change', () => {
  followingSort = els.followingSort.value;
  followingVisibleLimit = followingPageSize;
  rerenderFollowingDirectory();
});

els.followingSortDirection.addEventListener('change', () => {
  followingSortDirection = els.followingSortDirection.value;
  followingVisibleLimit = followingPageSize;
  rerenderFollowingDirectory();
});

els.followingSelectionBar.addEventListener('click', async (event) => {
  if (event.target.closest('[data-follow-select-visible]')) {
    for (const checkbox of els.followingList.querySelectorAll('[data-follow-select]')) followingSelectedIds.add(checkbox.dataset.followSelect);
    followingBulkConfirm = false;
    rerenderFollowingDirectory();
    return;
  }
  if (event.target.closest('[data-follow-clear-selection]')) {
    followingSelectedIds.clear();
    followingBulkConfirm = false;
    rerenderFollowingDirectory();
    return;
  }
  if (event.target.closest('[data-follow-review-remove]')) {
    followingBulkConfirm = true;
    rerenderFollowingDirectory();
    return;
  }
  if (event.target.closest('[data-follow-cancel-remove]')) {
    followingBulkConfirm = false;
    rerenderFollowingDirectory();
    return;
  }
  if (event.target.closest('[data-follow-confirm-remove]')) {
    const ids = [...followingSelectedIds];
    els.followingSelectionBar.className = 'follow-selection-bar confirming';
    els.followingSelectionBar.textContent = `Removing ${ids.length} selected follows from local draft...`;
    for (const id of ids) await api(`following/${id}`, { method: 'DELETE' });
    followingSelectedIds.clear();
    followingBulkConfirm = false;
    await refresh();
  }
});

els.followingList.addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-follow-select]');
  if (!checkbox) return;
  checkbox.checked ? followingSelectedIds.add(checkbox.dataset.followSelect) : followingSelectedIds.delete(checkbox.dataset.followSelect);
  followingBulkConfirm = false;
  rerenderFollowingDirectory();
});

els.followingList.addEventListener('click', async (event) => {
  const loadMoreButton = event.target.closest('[data-following-load-more]');
  if (loadMoreButton) {
    followingVisibleLimit += Number(loadMoreButton.dataset.followingLoadMore || followingPageSize);
    rerenderFollowingDirectory();
    return;
  }
  const showAllButton = event.target.closest('[data-following-show-all]');
  if (showAllButton) {
    followingVisibleLimit = Number(showAllButton.dataset.followingShowAll || Number.MAX_SAFE_INTEGER);
    rerenderFollowingDirectory();
    return;
  }
  const button = event.target.closest('[data-remove-follow]');
  if (!button) return;
  await api(`following/${button.dataset.removeFollow}`, { method: 'DELETE' });
  await refresh();
});

els.relayForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(els.relayForm));
  await api('relays', { method: 'PUT', body: JSON.stringify(payload) });
  await refresh();
});

els.relayAddForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(els.relayAddForm);
  const url = normalizeRelayUrl(form.get('url'));
  if (!url) return;
  const read = new Set(els.relayForm.elements.read.value.split('\n').map(normalizeRelayUrl).filter(Boolean));
  const write = new Set(els.relayForm.elements.write.value.split('\n').map(normalizeRelayUrl).filter(Boolean));
  if (form.get('read')) read.add(url);
  if (form.get('write')) write.add(url);
  if (!form.get('read') && !form.get('write')) read.add(url);
  await saveRelayPolicy([...read], [...write]);
  els.relayAddForm.reset();
  els.relayAddForm.elements.read.checked = true;
  els.relayAddForm.elements.write.checked = true;
  await refresh();
});

els.relayList.addEventListener('click', async (event) => {
  const removeButton = event.target.closest('[data-remove-relay]');
  const toggleButton = event.target.closest('[data-toggle-relay]');
  const read = new Set(els.relayForm.elements.read.value.split('\n').map(normalizeRelayUrl).filter(Boolean));
  const write = new Set(els.relayForm.elements.write.value.split('\n').map(normalizeRelayUrl).filter(Boolean));
  if (removeButton) {
    const url = normalizeRelayUrl(removeButton.dataset.removeRelay);
    read.delete(url);
    write.delete(url);
    await saveRelayPolicy([...read], [...write]);
    await refresh();
    return;
  }
  if (toggleButton) {
    const url = normalizeRelayUrl(toggleButton.dataset.relayUrl);
    const target = toggleButton.dataset.toggleRelay === 'write' ? write : read;
    target.has(url) ? target.delete(url) : target.add(url);
    if (!read.has(url) && !write.has(url)) read.add(url);
    await saveRelayPolicy([...read], [...write]);
    await refresh();
  }
});

els.relaySuggestions.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-add-suggested-relay]');
  if (!button) return;
  const url = normalizeRelayUrl(button.dataset.addSuggestedRelay);
  const read = new Set(els.relayForm.elements.read.value.split('\n').map(normalizeRelayUrl).filter(Boolean));
  const write = new Set(els.relayForm.elements.write.value.split('\n').map(normalizeRelayUrl).filter(Boolean));
  read.add(url);
  write.add(url);
  await saveRelayPolicy([...read], [...write]);
  await refresh();
});

els.relayTruth.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-add-public-relay]');
  if (!button) return;
  const url = normalizeRelayUrl(button.dataset.addPublicRelay);
  const roles = String(button.dataset.publicRoles || 'read/write');
  const read = new Set(els.relayForm.elements.read.value.split('\n').map(normalizeRelayUrl).filter(Boolean));
  const write = new Set(els.relayForm.elements.write.value.split('\n').map(normalizeRelayUrl).filter(Boolean));
  if (roles.includes('read')) read.add(url);
  if (roles.includes('write')) write.add(url);
  if (!roles.includes('read') && !roles.includes('write')) read.add(url);
  await saveRelayPolicy([...read], [...write]);
  await refresh();
});

document.querySelector('#scan-relays').addEventListener('click', async () => {
  els.relayActivity.textContent = 'Scanning configured relays and comparing newest published kind:10002 relay list against local policy...';
  await api('relays/scan', { method: 'POST' });
  await refresh();
});

document.querySelector('#publish-relays').addEventListener('click', async () => {
  els.relayActivity.textContent = 'Signing local relay policy as kind:10002 and publishing to write relays...';
  const result = await api('relays/publish', { method: 'POST' });
  els.relayActivity.textContent = formatPublishLog(result.published.event.id, result.published.results, 'kind:10002 relay list');
  await refresh();
});

document.querySelector('#create-backup').addEventListener('click', async () => {
  await api('backups', { method: 'POST' });
  await refresh();
});

const restoreFileInput = document.querySelector('#restore-file');
const restoreStatus = document.querySelector('#restore-status');
let pendingRestore = null;

document.querySelector('#upload-backup').addEventListener('click', () => {
  restoreFileInput.click();
});

restoreFileInput.addEventListener('change', async () => {
  const file = restoreFileInput.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const follows = (data.following?.entries ?? []).length;
    pendingRestore = { type: 'upload', data };
    restoreStatus.innerHTML = `<p>Ready to restore from <strong>${escapeHtml(file.name)}</strong>: ${follows} follows. This overwrites current local state.</p><button class="button caution" id="restore-confirm-yes">Overwrite and restore</button> <button class="button ghost" id="restore-confirm-no">Cancel</button>`;
    restoreFileInput.value = '';
  } catch (err) {
    restoreStatus.textContent = `Failed to read file: ${err.message}`;
    restoreFileInput.value = '';
  }
});

restoreStatus.addEventListener('click', async (e) => {
  if (e.target.id === 'restore-confirm-no') {
    pendingRestore = null;
    restoreStatus.textContent = '';
    return;
  }
  if (e.target.id === 'restore-confirm-yes' && pendingRestore) {
    try {
      const result = await api('backups/restore', { method: 'POST', body: JSON.stringify(pendingRestore.data) });
      restoreStatus.textContent = `Restored: ${result.restored.join(', ')}`;
      pendingRestore = null;
      await refresh();
    } catch (err) {
      restoreStatus.textContent = `Restore failed: ${err.message}`;
      pendingRestore = null;
    }
  }
});

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => setView(tab.dataset.tab));
});

window.addEventListener('hashchange', () => setView(location.hash.slice(1)));
setView(location.hash.slice(1));

function normalizeRelayUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  const withScheme = /^wss?:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`;
  return withScheme.replace(/^wss?:\/\//i, (scheme) => scheme.toLowerCase()).replace(/\/+$/, '');
}

async function saveRelayPolicy(read, write) {
  await api('relays', {
    method: 'PUT',
    body: JSON.stringify({
      read: [...new Set(read)].sort().join('\n'),
      write: [...new Set(write)].sort().join('\n'),
      private: els.relayForm.elements.private.value
    })
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function cssUrl(value) {
  return String(value ?? '').replace(/["\\]/g, '');
}

refresh().catch((error) => {
  els.liveStatus.textContent = 'api error';
  console.error(error);
});
