/**
 * Behavioural tests for the INLINE alias-editor script
 * (electron/setup-ui-alias-script.js), which ships as a JS source string and
 * runs in the wizard page. Same technique as tests/setup-ui.test.js's
 * extractBuildReview(): pull the function source out of the emitted script and
 * run it under `new Function` against a hand-rolled fake DOM (jest runs in the
 * `node` environment — there is no jsdom in this repo).
 *
 * Covers issue #211: the injected current value must sit in a LABELLED
 * <optgroup>, not as a bare child of the <select> where it is
 * indistinguishable from a real catalog offer.
 */

const { buildAliasScript } = require('../electron/setup-ui-alias-script');

// ---------------------------------------------------------------------------
// Minimal fake DOM: enough for buildModelSelect (createElement, appendChild,
// insertBefore, firstChild, and the one `option[value="..."]` querySelector).
// ---------------------------------------------------------------------------
function makeEl(tag) {
  return {
    tagName: tag.toUpperCase(),
    children: [],
    value: '',
    label: '',
    textContent: '',
    className: '',
    selected: false,
    get firstChild() { return this.children[0] || null; },
    appendChild(child) { this.children.push(child); return child; },
    insertBefore(child, ref) {
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i === -1) { this.children.push(child); } else { this.children.splice(i, 0, child); }
      return child;
    },
    querySelector(sel) {
      const m = /^option\[value="(.*)"\]$/.exec(sel);
      if (!m) { return null; }
      const want = m[1].replace(/\\(.)/g, '$1'); // undo CSS.escape
      const walk = (node) => {
        for (const c of node.children) {
          if (c.tagName === 'OPTION' && c.value === want) { return c; }
          const hit = walk(c);
          if (hit) { return hit; }
        }
        return null;
      };
      return walk(this);
    },
  };
}

/** Extract buildModelSelect (+ its filterModels helper) and run it. */
function makeBuildModelSelect({ availableModels = null, defaultAliases = {} } = {}) {
  const script = buildAliasScript();
  const filterMatch = script.match(/ {2}function filterModels\([\s\S]*?\n {2}\}/);
  const selectMatch = script.match(/ {2}function buildModelSelect\([\s\S]*?\n {2}\}/);
  expect(filterMatch).toBeTruthy();
  expect(selectMatch).toBeTruthy();
  const fakeDocument = { createElement: makeEl };
  const fakeCSS = { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'document', 'CSS', 'window', 'defaultAliases',
    `${filterMatch[0]}\n${selectMatch[0]}\nreturn buildModelSelect;`
  );
  return factory(fakeDocument, fakeCSS, { availableModels }, defaultAliases);
}

const CATALOG = [{
  family: 'OpenRouter',
  models: [
    { id: 'openrouter/deepseek/deepseek-v4-pro', name: 'DeepSeek: V4 Pro' },
    { id: 'openrouter/deepseek/deepseek-v4-flash', name: 'DeepSeek: V4 Flash' },
  ],
}];

describe('buildModelSelect - injected current value (issue #211)', () => {
  it('puts an unknown current value in its own LABELLED optgroup', () => {
    const buildModelSelect = makeBuildModelSelect({ availableModels: CATALOG });
    const select = buildModelSelect('deepseek/deepseek-v4-flash-0731', 'alias-model-select', 'deepseek');

    const first = select.children[0];
    expect(first.tagName).toBe('OPTGROUP');
    expect(first.label).toBe('Current \u2014 not found in catalog');
  });

  it('never leaves the injected value as a bare <option> child of the select', () => {
    const buildModelSelect = makeBuildModelSelect({ availableModels: CATALOG });
    const select = buildModelSelect('deepseek/deepseek-v4-flash-0731', 'alias-model-select', 'deepseek');

    const bareOptions = select.children.filter(c => c.tagName === 'OPTION');
    expect(bareOptions).toHaveLength(0);
  });

  it('keeps the injected value selected and byte-identical (nothing saved changes)', () => {
    const stale = 'deepseek/deepseek-v4-flash-0731';
    const buildModelSelect = makeBuildModelSelect({ availableModels: CATALOG });
    const select = buildModelSelect(stale, 'alias-model-select', 'deepseek');

    const opt = select.children[0].children[0];
    expect(opt.value).toBe(stale);
    expect(opt.textContent).toBe(stale);
    expect(opt.selected).toBe(true);
  });

  it('does NOT inject a value that the catalog already offers', () => {
    const known = 'openrouter/deepseek/deepseek-v4-pro';
    const buildModelSelect = makeBuildModelSelect({ availableModels: CATALOG });
    const select = buildModelSelect(known, 'alias-model-select', 'deepseek');

    const labels = select.children.map(c => c.label);
    expect(labels).not.toContain('Current \u2014 not found in catalog');
    const all = select.children.flatMap(g => g.children).filter(o => o.value === known);
    expect(all).toHaveLength(1); // present exactly once, in the real catalog group
    expect(all[0].selected).toBe(true);
  });

  it('labels the injected value in the DEFAULT_ALIASES fallback path too', () => {
    const buildModelSelect = makeBuildModelSelect({
      availableModels: null,
      defaultAliases: { gemini: 'google/gemini-3.6-flash' },
    });
    const select = buildModelSelect('deepseek/ghost-model', 'alias-model-select', 'deepseek');
    expect(select.children[0].tagName).toBe('OPTGROUP');
    expect(select.children[0].label).toBe('Current \u2014 not found in catalog');
  });

  it('injects nothing when there is no current value (the add-custom-route case)', () => {
    const buildModelSelect = makeBuildModelSelect({ availableModels: CATALOG });
    const select = buildModelSelect('', 'alias-model-select');
    expect(select.children.every(c => c.label !== 'Current \u2014 not found in catalog')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The whole emitted script must stay parseable — it is injected verbatim into
// the wizard page, where a syntax error takes the entire wizard down.
// ---------------------------------------------------------------------------
describe('emitted alias script', () => {
  it('parses as valid JavaScript', () => {
    // eslint-disable-next-line no-new-func
    expect(() => new Function(buildAliasScript())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// issue 238 D1/R1 (Phase 3): the remove handler's three shapes of row. Before
// this, the non-default branch ran `delete aliasEdits[alias]`, which stages
// NOTHING -- so × on a SAVED custom alias struck the row through and the
// alias survived Finish (a silent no-op). Mutant CUSTOMDELETE: put `delete`
// back.
// ---------------------------------------------------------------------------
const { createFakeDocument } = require('./helpers/fake-dom');
const { buildAliasStateScript } = require('../electron/setup-ui-alias-state');

function loadRemoveHandler({ aliasEdits, defaultAliases, document }) {
  const aliasSrc = buildAliasScript();
  const stateSrc = buildAliasStateScript();
  const handler = aliasSrc.match(/ {2}\/\/ Alias editor: remove[\s\S]*?\n {2}\}\);/);
  const counts = aliasSrc.match(/ {2}function refreshAliasCounts\(\) \{[\s\S]*?\n {2}\}/);
  expect(handler).toBeTruthy();
  expect(counts).toBeTruthy();
  // eslint-disable-next-line no-new-func
  const factory = new Function('aliasEdits', 'defaultAliases', 'document', 'window', '$',
    `${stateSrc}\n${counts[0]}\n${handler[0]}\nreturn { refreshAliasRowState: refreshAliasRowState };`);
  return factory(aliasEdits, defaultAliases, document, {}, (id) => document.getElementById(id));
}

function rowWith(document, { alias, model, kind, inNewRoutes = false }) {
  const group = document.createElement('details'); group.className = 'alias-group';
  if (inNewRoutes) { group.setAttribute('data-new-routes', '1'); }
  const count = document.createElement('span'); count.className = 'alias-count'; group.appendChild(count);
  const row = document.createElement('div'); row.className = 'alias-row'; row.setAttribute('data-alias', alias); row.setAttribute('data-state', 'pinned');
  const m = document.createElement('span'); m.className = 'alias-model'; m.textContent = model;
  const s = document.createElement('span'); s.className = 'alias-state alias-state-pinned'; s.textContent = 'pinned';
  const b = document.createElement('button'); b.className = 'alias-delete'; b.setAttribute('data-alias', alias); b.setAttribute('data-kind', kind); b.textContent = kind === 'unpin' ? 'unpin' : '×';
  row.appendChild(m); row.appendChild(s); row.appendChild(b);
  group.appendChild(row);
  document.body.appendChild(group);
  return { row, btn: b, group };
}

describe('alias editor remove handler (issue 238 R1)', () => {
  const defaultAliases = Object.assign(Object.create(null), { glm: 'openrouter/z-ai/glm-5.3' });

  it('× on a SAVED custom row stages null (the key is removed at Finish) and strikes the row out', () => {
    const { document } = createFakeDocument();
    const aliasEdits = Object.create(null);
    const { row, btn } = rowWith(document, { alias: 'mine', model: 'openrouter/x/y', kind: 'delete' });
    loadRemoveHandler({ aliasEdits, defaultAliases, document });
    btn.click();
    expect(aliasEdits.mine).toBeNull();                       // CUSTOMDELETE dies here
    expect(Object.prototype.hasOwnProperty.call(aliasEdits, 'mine')).toBe(true);
    expect(row.classList.contains('alias-deleted')).toBe(true);
  });

  it('[unpin] on a curated pin stages null, shows the shipped id and labels the row following — no strike-through', () => {
    const { document } = createFakeDocument();
    const aliasEdits = Object.create(null);
    const { row, btn } = rowWith(document, { alias: 'glm', model: 'openrouter/z-ai/glm-5.2', kind: 'unpin' });
    loadRemoveHandler({ aliasEdits, defaultAliases, document });
    btn.click();
    expect(aliasEdits.glm).toBeNull();
    expect(row.querySelector('.alias-model').textContent).toBe('openrouter/z-ai/glm-5.3');
    expect(row.getAttribute('data-state')).toBe('following');
    expect(row.classList.contains('alias-deleted')).toBe(false);
    expect(btn.hidden).toBe(true);
  });

  it('× on a row added THIS session removes the row and stages nothing (it was never on disk)', () => {
    const { document } = createFakeDocument();
    const aliasEdits = Object.assign(Object.create(null), { fresh: 'openrouter/x/new' });
    const { row, btn, group } = rowWith(document, { alias: 'fresh', model: 'openrouter/x/new', kind: 'delete', inNewRoutes: true });
    loadRemoveHandler({ aliasEdits, defaultAliases, document });
    btn.click();
    expect(Object.prototype.hasOwnProperty.call(aliasEdits, 'fresh')).toBe(false);
    expect(row.parentNode).toBeNull();
    expect(group.parentNode).toBeNull();                      // refreshAliasCounts drops the empty new-routes group
  });

  // Review round 1, IMPORTANT finding: a rename that crosses the curated/
  // custom boundary (commitName rewrites data-alias on the row and button,
  // but not the control's kind/text/title) left the remove control stale
  // until refreshAliasRowState ran. Fixed both halves: the control is made
  // truthful in refreshAliasRowState, and the remove handler now decides by
  // the NAME (isCuratedAlias), never by reading the possibly-stale data-kind.
  it('a curated→custom rename (commitName) leaves the control stale until refreshAliasRowState runs it truthful (repro A)', () => {
    const { document } = createFakeDocument();
    const defaultAliases = Object.assign(Object.create(null), { gemini: 'google/gemini-x' });
    const aliasEdits = Object.create(null);
    const { row, btn } = rowWith(document, { alias: 'gemini', model: 'google/gemini-x', kind: 'unpin' });
    const { refreshAliasRowState } = loadRemoveHandler({ aliasEdits, defaultAliases, document });
    // simulate commitName renaming gemini -> gemini2: it rewrites data-alias
    // on the row AND the button, nothing else.
    row.setAttribute('data-alias', 'gemini2');
    btn.setAttribute('data-alias', 'gemini2');
    refreshAliasRowState(row);
    expect(btn.getAttribute('data-kind')).toBe('delete');
    expect(btn.textContent).toBe('×');
    btn.click();
    expect(aliasEdits.gemini2).toBeNull();
    expect(row.classList.contains('alias-deleted')).toBe(true);
    expect(row.querySelector('.alias-model').textContent).toBe('google/gemini-x'); // untouched
  });

  it('a custom→curated rename (commitName) leaves the control stale until refreshAliasRowState runs it truthful (repro B)', () => {
    const { document } = createFakeDocument();
    const defaultAliases = Object.assign(Object.create(null), { gemini: 'google/gemini-x' });
    const aliasEdits = Object.create(null);
    const { row, btn } = rowWith(document, { alias: 'mine', model: 'openrouter/x/y', kind: 'delete' });
    const { refreshAliasRowState } = loadRemoveHandler({ aliasEdits, defaultAliases, document });
    // simulate commitName renaming mine -> gemini
    row.setAttribute('data-alias', 'gemini');
    btn.setAttribute('data-alias', 'gemini');
    refreshAliasRowState(row);
    expect(btn.getAttribute('data-kind')).toBe('unpin');
    expect(btn.textContent).toBe('unpin');
    btn.click();
    expect(aliasEdits.gemini).toBeNull();
    expect(row.querySelector('.alias-model').textContent).toBe('google/gemini-x'); // shows the shipped id
    expect(row.classList.contains('alias-deleted')).toBe(false);                   // no strike-through
  });

  // A4: the handler must decide by the alias NAME (isCuratedAlias), never by
  // reading data-kind straight off the button -- a curated row can carry a
  // STALE data-kind="delete" (e.g. never refreshed since some earlier state)
  // and must still take the unpin path. Mutant DATAKIND: decide by data-kind.
  it('a curated row with a STALE data-kind="delete" (never refreshed) still takes the unpin path, decided by NAME', () => {
    const { document } = createFakeDocument();
    const curatedDefaults = Object.assign(Object.create(null), { gemini: 'google/gemini-x' });
    const aliasEdits = Object.create(null);
    const { row, btn } = rowWith(document, { alias: 'gemini', model: 'google/gemini-y', kind: 'delete' });
    loadRemoveHandler({ aliasEdits, defaultAliases: curatedDefaults, document });
    btn.click();
    expect(aliasEdits.gemini).toBeNull();
    expect(row.querySelector('.alias-model').textContent).toBe('google/gemini-x'); // shows the shipped id
    expect(row.classList.contains('alias-deleted')).toBe(false);                   // unpin, not a strike-through
  });
});

// C7: the add-custom-flow's committed row must carry the same "pinned" state
// markup appendStagedRow gives a review-accepted "add" row (setup-ui-alias-review.js).
describe('commitNew (add-custom flow) — the committed row is labelled pinned like appendStagedRow\'s', () => {
  it('sets data-state="pinned" and an alias-state-pinned span before the delete button', () => {
    const script = buildAliasScript();
    const commitNewSrc = script.match(/function commitNew\(\) \{[\s\S]*?\n {6}\}/);
    expect(commitNewSrc).toBeTruthy();
    expect(commitNewSrc[0]).toContain("data-state', 'pinned'");
    expect(commitNewSrc[0]).toContain("'alias-state alias-state-pinned'");
  });
});
