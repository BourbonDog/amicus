'use strict';

/**
 * issue 238 D9 (Phase 3): the wizard's "Needs review" section. Pure helpers
 * are tested on data; the DOM layer runs against tests/helpers/fake-dom.js
 * with a fake `window.sidecarSetup.invoke`. Proposals are hand-built to the
 * alias-proposals.js docblock shape; `defaultAliases` is synthetic (#53).
 */

const { buildAliasReviewHTML, buildAliasReviewScript } = require('../../electron/setup-ui-alias-review');
const { buildAliasStateScript } = require('../../electron/setup-ui-alias-state');
const { buildAliasScript } = require('../../electron/setup-ui-alias-script');
const { NEW_ROUTES_GROUP_LABEL } = require('../../electron/setup-ui-alias-groups');
const { createFakeDocument } = require('../helpers/fake-dom');

const HOUR = 60 * 60 * 1000;
const DEFAULTS = { gemini: 'google/gemini-x', glm: 'openrouter/z-ai/glm-5.3' };

const SIBLING = { alias: 'glm', state: 'pinned', current: 'openrouter/z-ai/glm-5.2', shipped: 'openrouter/z-ai/glm-5.3', curated: true,
  reasons: ['newer-sibling', 'differs-from-shipped'],
  candidates: [{ id: 'openrouter/z-ai/glm-5.4', why: 'newer-sibling', evidence: {} }, { id: 'openrouter/z-ai/glm-5.3', why: 'follow', evidence: {} }],
  dismissKey: 'glm@openrouter/z-ai/glm-5.4' };
const STALE = { alias: 'mine', state: 'pinned', current: 'openrouter/x/gone-1', shipped: null, curated: false,
  reasons: ['stale'], candidates: [{ id: 'openrouter/x/gone-2', why: 'replacement', evidence: {} }], dismissKey: 'mine@openrouter/x/gone-2' };
const NOTABLE = { alias: 'atlas', state: 'unmapped', current: null, shipped: null, curated: false,
  reasons: ['notable-unmapped'], candidates: [{ id: 'openrouter/x/atlas-1', why: 'notable', evidence: { note: 'new frontier entrant' } }], dismissKey: 'atlas@openrouter/x/atlas-1' };

const NOW = 5_000_000;
const view = (over = {}) => ({ proposals: [SIBLING], catalogAvailable: true, fetchedAt: NOW - HOUR, fresh: true,
  gatedIds: ['openrouter/z-ai/glm-5.2', 'openrouter/z-ai/glm-5.3', 'openrouter/z-ai/glm-5.4', 'openrouter/z-ai/glm-4.9'], ...over });

/** Build the page: skeleton + the alias/state/review fragments, with a fake IPC. */
function loadPage({ proposals = [SIBLING], doc = view({ proposals }), rows = [], invoke } = {}) {
  const { document, body } = createFakeDocument();
  // Skeleton from the real builder, parsed into fake elements by id/class.
  const section = document.createElement('section'); section.className = 'alias-review'; section.setAttribute('id', 'alias-review'); section.hidden = true;
  const head = document.createElement('div'); head.className = 'alias-review-head';
  const count = document.createElement('span'); count.setAttribute('id', 'alias-review-count');
  const refresh = document.createElement('button'); refresh.setAttribute('id', 'alias-review-refresh');
  head.appendChild(count); head.appendChild(refresh);
  const banner = document.createElement('div'); banner.setAttribute('id', 'alias-review-banner'); banner.hidden = true;
  const list = document.createElement('div'); list.setAttribute('id', 'alias-review-list');
  section.appendChild(head); section.appendChild(banner); section.appendChild(list);
  body.appendChild(section);
  const editor = document.createElement('div'); editor.className = 'alias-editor';
  const group = document.createElement('details'); group.className = 'alias-group';
  rows.forEach(r => {
    const row = document.createElement('div'); row.className = 'alias-row'; row.setAttribute('data-alias', r.alias); row.setAttribute('data-state', r.state);
    const m = document.createElement('span'); m.className = 'alias-model'; m.textContent = r.model;
    const s = document.createElement('span'); s.className = 'alias-state'; s.textContent = r.state;
    const b = document.createElement('button'); b.className = 'alias-delete'; b.setAttribute('data-kind', r.curated ? 'unpin' : 'delete');
    row.appendChild(m); row.appendChild(s); row.appendChild(b); group.appendChild(row);
  });
  editor.appendChild(group);
  const addBtn = document.createElement('button'); addBtn.setAttribute('id', 'alias-add-btn'); editor.appendChild(addBtn);
  body.appendChild(editor);

  const calls = [];
  const sidecarSetup = { invoke: invoke || ((channel) => { calls.push(channel); return Promise.resolve(channel === 'sidecar:get-alias-review' ? doc : { models: [], fetchedAt: null }); }) };
  const window = { sidecarSetup, availableModels: [{ family: 'OpenRouter', models: [
    { id: 'openrouter/z-ai/glm-5.2', name: 'GLM 5.2' }, { id: 'openrouter/z-ai/glm-5.4', name: 'GLM 5.4' }, { id: 'openrouter/z-ai/glm-4.9', name: 'GLM 4.9' }, { id: 'openrouter/z-ai/glm-6.0-preview', name: 'GLM 6 preview' },
  ] }] };
  const aliasEdits = Object.create(null);
  const defaultAliases = Object.assign(Object.create(null), DEFAULTS);
  const aliasSrc = buildAliasScript();
  const pieces = ['filterModels', 'buildModelSelect', 'placeRowInNewRoutesGroup', 'refreshAliasCounts']
    .map(name => aliasSrc.match(new RegExp(` {2}function ${name}\\([\\s\\S]*?\\n {2}\\}`))[0]).join('\n');
  const stateSrc = buildAliasStateScript();
  const reviewSrc = buildAliasReviewScript();
  // Every function the two fragments declare is returned, so a test can reach
  // the state helpers (aliasRowFor) as well as the section's own.
  const names = [...(stateSrc + '\n' + reviewSrc).matchAll(/^ {2}function (\w+)\(/gm)].map(m => m[1]);
  const fakeCSS = { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
  // eslint-disable-next-line no-new-func
  const factory = new Function('aliasEdits', 'defaultAliases', 'document', 'window', 'CSS', '$', 'applyCatalog', 'Date', 'NEW_ROUTES_GROUP_LABEL',
    `${pieces}\n${stateSrc}\n${reviewSrc}\nreturn { ${names.join(', ')}, stagedDismissals: function() { return stagedDismissals; } };`);
  const fakeDate = { now: () => NOW };
  const fns = factory(aliasEdits, defaultAliases, document, window, fakeCSS, (id) => document.getElementById(id), () => {}, fakeDate, NEW_ROUTES_GROUP_LABEL);
  return { fns, document, section, list, count, banner, refresh, aliasEdits, calls, group };
}

const flush = () => new Promise(r => setImmediate(r));

describe('buildAliasReviewHTML', () => {
  it('is a data-free skeleton: hidden section, title, count, refresh, hidden banner, empty list', () => {
    const html = buildAliasReviewHTML();
    expect(html).toContain('<section class="alias-review" id="alias-review" hidden>');
    expect(html).toContain('Needs review');
    expect(html).toContain('id="alias-review-count"');
    expect(html).toContain('id="alias-review-refresh"');
    expect(html).toContain('<div class="alias-review-banner" id="alias-review-banner" hidden></div>');
    expect(html).toContain('<div class="alias-review-list" id="alias-review-list"></div>');
  });
});

describe('reviewBanner — why the section cannot be acted on', () => {
  const { fns } = loadPage();
  it('fresh → null; stale → the age and the rule; future → clock skew; missing → no timestamp', () => {
    expect(fns.reviewBanner(view(), NOW)).toBeNull();
    expect(fns.reviewBanner(view({ fresh: false, fetchedAt: NOW - 3 * 24 * HOUR }), NOW)).toBe('catalog is 3 days old and could not be refreshed — accepting is disabled until ↻ succeeds (following the shipped pin is always allowed)');
    expect(fns.reviewBanner(view({ fresh: false, fetchedAt: NOW - 25 * HOUR }), NOW)).toMatch(/^catalog is 1 day old/);
    expect(fns.reviewBanner(view({ fresh: false, fetchedAt: NOW - 2 * HOUR }), NOW)).toMatch(/^catalog is 2 hours old/);
    expect(fns.reviewBanner(view({ fresh: false, fetchedAt: NOW + 1 }), NOW)).toMatch(/^catalog timestamp is in the future \(clock skew\?\)/);
    expect(fns.reviewBanner(view({ fresh: false, fetchedAt: null }), NOW)).toMatch(/^no catalog timestamp/);
  });
  it('unavailable and error come first (R-P3-10)', () => {
    expect(fns.reviewBanner(view({ catalogAvailable: false, fresh: false, fetchedAt: null }), NOW)).toBe('catalog unavailable — cannot check for updates (↻ to retry)');
    expect(fns.reviewBanner(view({ error: 'disk on fire', catalogAvailable: false, fresh: false }), NOW)).toBe('could not check for updates — disk on fire');
  });
});

describe('candidateText / proposalWhy — the CLI menu\'s words', () => {
  const { fns } = loadPage();
  it('labels by why', () => {
    expect(fns.candidateText(SIBLING, SIBLING.candidates[0])).toBe('accept openrouter/z-ai/glm-5.4');
    expect(fns.candidateText(SIBLING, SIBLING.candidates[1])).toBe('follow the shipped pin (openrouter/z-ai/glm-5.3)');
    expect(fns.candidateText(STALE, STALE.candidates[0])).toBe('use openrouter/x/gone-2');
    expect(fns.candidateText(NOTABLE, NOTABLE.candidates[0])).toBe('add atlas → openrouter/x/atlas-1');
  });
  it('explains the top candidate', () => {
    expect(fns.proposalWhy(SIBLING)).toBe('newer: openrouter/z-ai/glm-5.4 · newer sibling, same tier');
    expect(fns.proposalWhy({ ...SIBLING, candidates: [SIBLING.candidates[1]] })).toBe('differs from the shipped pin openrouter/z-ai/glm-5.3');
    expect(fns.proposalWhy(STALE)).toBe('gone from the catalog · replacement: openrouter/x/gone-2');
    expect(fns.proposalWhy(NOTABLE)).toBe('new frontier entrant');
    expect(fns.proposalWhy({ ...STALE, candidates: [] })).toBe('stale');
  });
});

describe('renderAliasReview', () => {
  it('renders one row per proposal with a button per candidate, choose… and dismiss; count and visibility follow', async () => {
    const { fns, section, list, count, banner } = loadPage({ proposals: [SIBLING, STALE, NOTABLE] });
    await fns.loadAliasReview(); await flush();
    expect(section.hidden).toBe(false);
    expect(banner.hidden).toBe(true);
    expect(count.textContent).toBe('(3)');
    const rows = list.querySelectorAll('.alias-review-row');
    expect(rows.map(r => r.getAttribute('data-alias'))).toEqual(['glm', 'mine', 'atlas']);
    const glm = rows[0];
    expect(glm.querySelector('.alias-name').textContent).toBe('glm');
    expect(glm.querySelector('.alias-model').textContent).toBe('openrouter/z-ai/glm-5.2');
    expect(glm.querySelector('.alias-review-why').textContent).toBe('newer: openrouter/z-ai/glm-5.4 · newer sibling, same tier');
    const buttons = glm.querySelectorAll('.alias-review-actions button');
    expect(buttons.map(b => b.textContent)).toEqual(['✓ accept openrouter/z-ai/glm-5.4', '↩ follow the shipped pin (openrouter/z-ai/glm-5.3)', '⌄ choose…', '× dismiss']);
    expect(buttons.every(b => !b.disabled)).toBe(true);
    expect(rows[2].querySelector('.alias-model')).toBeNull();               // unmapped: no current id
    expect(rows[2].querySelectorAll('.alias-review-accept')[0].textContent).toBe('✓ add atlas → openrouter/x/atlas-1');
  });

  it('zero proposals with a catalog → hidden; no catalog → banner alone, visible (mutant SILENTNOTHING)', async () => {
    const a = loadPage({ proposals: [] });
    await a.fns.loadAliasReview(); await flush();
    expect(a.section.hidden).toBe(true);
    const b = loadPage({ doc: view({ proposals: [], catalogAvailable: false, fetchedAt: null, fresh: false }) });
    await b.fns.loadAliasReview(); await flush();
    expect(b.section.hidden).toBe(false);
    expect(b.banner.hidden).toBe(false);
    expect(b.banner.textContent).toBe('catalog unavailable — cannot check for updates (↻ to retry)');
    expect(b.count.textContent).toBe('(0)');
  });

  it('a rejected invoke renders as a banner, never a throw', async () => {
    const p = loadPage({ invoke: () => Promise.reject(new Error('ipc down')) });
    await p.fns.loadAliasReview(); await flush();
    expect(p.section.hidden).toBe(false);
    expect(p.banner.textContent).toBe('could not check for updates — ipc down');
  });

  it('a proposal for an alias already staged this session is not shown (R-P3-5)', async () => {
    const p = loadPage({ proposals: [SIBLING, STALE] });
    p.aliasEdits.glm = 'openrouter/z-ai/glm-6.0-preview';
    await p.fns.loadAliasReview(); await flush();
    expect(p.list.querySelectorAll('.alias-review-row').map(r => r.getAttribute('data-alias'))).toEqual(['mine']);
    expect(p.count.textContent).toBe('(1)');
  });

  it('stale catalog: every catalog-vouched button and choose… are disabled with the banner as title; follow and dismiss stay enabled (mutant STALEACCEPT)', async () => {
    const p = loadPage({ doc: view({ proposals: [SIBLING], fresh: false, fetchedAt: NOW - 3 * 24 * HOUR }) });
    await p.fns.loadAliasReview(); await flush();
    const [accept, follow, choose, dismiss] = p.list.querySelectorAll('.alias-review-actions button');
    expect(accept.disabled).toBe(true);
    expect(accept.title).toMatch(/^catalog is 3 days old/);
    expect(follow.disabled).toBe(false);
    expect(choose.disabled).toBe(true);
    expect(dismiss.disabled).toBe(false);
    expect(p.banner.hidden).toBe(false);
  });
});

describe('acting on a proposal (everything is STAGED — R-P3-1)', () => {
  it('accept stages the id, updates the list row, removes the proposal, hides the section at zero', async () => {
    const p = loadPage({ rows: [{ alias: 'glm', model: 'openrouter/z-ai/glm-5.2', state: 'pinned', curated: true }] });
    await p.fns.loadAliasReview(); await flush();
    p.list.querySelector('.alias-review-accept').click();
    expect(p.aliasEdits.glm).toBe('openrouter/z-ai/glm-5.4');
    expect(p.fns.aliasRowFor('glm').querySelector('.alias-model').textContent).toBe('openrouter/z-ai/glm-5.4');
    expect(p.fns.aliasRowFor('glm').getAttribute('data-state')).toBe('pinned');
    expect(p.group.open).toBe(true);
    expect(p.list.querySelectorAll('.alias-review-row')).toHaveLength(0);
    expect(p.count.textContent).toBe('(0)');
    expect(p.section.hidden).toBe(true);
  });

  it('follow stages null (Q4) and the list row reads following', async () => {
    const p = loadPage({ rows: [{ alias: 'glm', model: 'openrouter/z-ai/glm-5.2', state: 'pinned', curated: true }] });
    await p.fns.loadAliasReview(); await flush();
    p.list.querySelectorAll('.alias-review-accept')[1].click();
    expect(p.aliasEdits.glm).toBeNull();
    const row = p.fns.aliasRowFor('glm');
    expect(row.querySelector('.alias-model').textContent).toBe('openrouter/z-ai/glm-5.3');
    expect(row.getAttribute('data-state')).toBe('following');
    expect(row.querySelector('.alias-delete').hidden).toBe(true);
  });

  it('add (notable) stages a pinned custom alias under a free name and appends a row to the New routes group', async () => {
    const p = loadPage({ proposals: [NOTABLE], rows: [{ alias: 'atlas', model: 'openrouter/other/atlas', state: 'pinned', curated: false }] });
    await p.fns.loadAliasReview(); await flush();
    p.list.querySelector('.alias-review-accept').click();
    expect(p.aliasEdits['atlas-2']).toBe('openrouter/x/atlas-1');     // 'atlas' is taken → the CLI's numeric suffix
    expect(p.aliasEdits.atlas).toBeUndefined();
    const added = p.fns.aliasRowFor('atlas-2');
    expect(added).not.toBeNull();
    expect(added.closest('[data-new-routes]')).not.toBeNull();
    expect(added.querySelector('.alias-state').textContent).toBe('pinned');
    expect(added.querySelector('.alias-delete').getAttribute('data-kind')).toBe('delete');
    // ↻ must not re-offer a proposal already accepted under a free name this
    // session (R-P3-11); undoing the add (× on the New-routes row) returns it.
    await p.fns.loadAliasReview(); await flush();
    expect(p.list.querySelectorAll('.alias-review-row')).toHaveLength(0);
    delete p.aliasEdits['atlas-2'];
    await p.fns.loadAliasReview(); await flush();
    expect(p.list.querySelectorAll('.alias-review-row')).toHaveLength(1);
  });

  it('the notable-add row is shaped for the production remove handler: data-alias on the row AND its button, under [data-new-routes]', async () => {
    const p = loadPage({ proposals: [NOTABLE], rows: [{ alias: 'atlas', model: 'openrouter/other/atlas', state: 'pinned', curated: false }] });
    await p.fns.loadAliasReview(); await flush();
    p.list.querySelector('.alias-review-accept').click();
    const added = p.fns.aliasRowFor('atlas-2');
    expect(added.getAttribute('data-alias')).toBe('atlas-2');
    expect(added.querySelector('.alias-delete').getAttribute('data-alias')).toBe('atlas-2');
    expect(added.closest('[data-new-routes]')).not.toBeNull();
  });

  it('dismiss stages the dismissKey (written by Finish) and removes the proposal (mutant DISMISSNOW: write immediately)', async () => {
    const p = loadPage();
    await p.fns.loadAliasReview(); await flush();
    p.list.querySelector('.alias-review-dismiss').click();
    expect(p.fns.stagedDismissals()).toEqual(['glm@openrouter/z-ai/glm-5.4']);
    expect(p.calls.filter(c => c !== 'sidecar:get-alias-review')).toEqual([]);   // no IPC write
    expect(p.list.querySelectorAll('.alias-review-row')).toHaveLength(0);
    // ↻ must not resurrect a dismissed proposal, and dismissing twice must
    // not duplicate the staged key (R-P3-11).
    await p.fns.loadAliasReview(); await flush();
    expect(p.list.querySelectorAll('.alias-review-row')).toHaveLength(0);
    p.fns.dismissProposal(SIBLING);
    expect(p.fns.stagedDismissals()).toEqual(['glm@openrouter/z-ai/glm-5.4']);
  });

  it('choose… offers the candidates first, then only §5-gated catalog ids (plus current and shipped); picking stages, picking current cancels (mutant UNGATEDCHOOSE)', async () => {
    const p = loadPage({ rows: [{ alias: 'glm', model: 'openrouter/z-ai/glm-5.2', state: 'pinned', curated: true }] });
    await p.fns.loadAliasReview(); await flush();
    const actions = p.list.querySelector('.alias-review-actions');
    const chooseBtn = actions.querySelector('.alias-review-choose');
    chooseBtn.click();
    const select = actions.querySelector('.alias-review-select');
    expect(select).not.toBeNull();
    const values = select.querySelectorAll('option').map(o => o.value);
    expect(values.slice(0, 2)).toEqual(['openrouter/z-ai/glm-5.4', 'openrouter/z-ai/glm-5.3']);   // Proposed group first
    expect(values).toContain('openrouter/z-ai/glm-4.9');                                          // gated, older: offered (the user's call)
    expect(values).not.toContain('openrouter/z-ai/glm-6.0-preview');                              // in the catalog, NOT gated: pruned
    expect(values).toContain('openrouter/z-ai/glm-5.2');                                          // current: kept
    select.value = 'openrouter/z-ai/glm-5.2';
    select.dispatch('change');
    expect(actions.querySelector('.alias-review-choose')).not.toBeNull();                          // cancelled: the button is back
    expect(Object.keys(p.aliasEdits)).toEqual([]);
    actions.querySelector('.alias-review-choose').click();
    const select2 = actions.querySelector('.alias-review-select');
    select2.value = 'openrouter/z-ai/glm-4.9';
    select2.dispatch('change');
    expect(p.aliasEdits.glm).toBe('openrouter/z-ai/glm-4.9');
    expect(p.list.querySelectorAll('.alias-review-row')).toHaveLength(0);
  });

  it('↻ refreshes the catalog through sidecar:refresh-catalog and re-fetches the review', async () => {
    const p = loadPage();
    await flush();                                            // the fragment's own load-time fetch
    expect(p.calls).toEqual(['sidecar:get-alias-review']);
    p.refresh.click();
    await flush(); await flush(); await flush();
    expect(p.calls.slice(1)).toEqual(['sidecar:refresh-catalog', 'sidecar:get-alias-review']);
    expect(p.refresh.disabled).toBe(false);
  });
});

describe('page hygiene', () => {
  it('the fragment carries no routing policy and no innerHTML', () => {
    const src = buildAliasReviewScript();
    expect(src).not.toContain('innerHTML');
    expect(src).not.toContain("slice('openrouter/'.length)");
    expect(src).not.toContain('openrouter/');
    expect(src).toContain("invoke('sidecar:get-alias-review')");
  });
});
