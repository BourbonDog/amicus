'use strict';

/**
 * issue 238 D1/D9 (Phase 3): what an alias row MEANS on the wizard page and
 * what its controls stage. The fragment is a page script (no require), so
 * its functions are pulled out of the emitted source and run under
 * `new Function` against tests/helpers/fake-dom.js. `defaultAliases` is a
 * SYNTHETIC map (#53: never the live shipped pins).
 */

const { buildAliasStateScript } = require('../../electron/setup-ui-alias-state');
const { createFakeDocument } = require('../helpers/fake-dom');

const DEFAULTS = { gemini: 'google/gemini-x', glm: 'openrouter/z-ai/glm-5.3' };

/** Extracts every named function declaration of the fragment and binds the page globals. */
function loadStateScript({ aliasEdits = Object.create(null), defaultAliases = DEFAULTS, document } = {}) {
  const src = buildAliasStateScript();
  const names = [...src.matchAll(/^ {2}function (\w+)\(/gm)].map(m => m[1]);
  expect(names).toEqual(expect.arrayContaining(['isCuratedAlias', 'aliasStateFor', 'aliasRowFor', 'stagedValueFor', 'refreshAliasRowState', 'unpinAliasRow', 'stageAliasWrite']));
  // eslint-disable-next-line no-new-func
  const factory = new Function('aliasEdits', 'defaultAliases', 'document', 'window', `${src}\nreturn { ${names.join(', ')} };`);
  const defaults = Object.assign(Object.create(null), defaultAliases);
  return { fns: factory(aliasEdits, defaults, document, {}), aliasEdits };
}

/** A server-shaped row: name, arrow, model, state label, control by kind. */
function makeRow(document, { alias, model, curated, state }) {
  const row = document.createElement('div');
  row.className = 'alias-row';
  row.setAttribute('data-alias', alias);
  row.setAttribute('data-state', state);
  const name = document.createElement('span'); name.className = 'alias-name'; name.textContent = alias;
  const arrow = document.createElement('span'); arrow.className = 'alias-arrow'; arrow.textContent = '→';
  const modelEl = document.createElement('span'); modelEl.className = 'alias-model'; modelEl.textContent = model;
  const label = document.createElement('span'); label.className = `alias-state alias-state-${state}`; label.textContent = state;
  const btn = document.createElement('button'); btn.className = 'alias-delete'; btn.setAttribute('data-alias', alias);
  btn.setAttribute('data-kind', curated ? 'unpin' : 'delete'); btn.textContent = curated ? 'unpin' : '×';
  btn.hidden = curated && state === 'following';
  [name, arrow, modelEl, label, btn].forEach(el => row.appendChild(el));
  return row;
}

function pageWith(rows) {
  const { document, body } = createFakeDocument();
  const group = document.createElement('details'); group.className = 'alias-group';
  body.appendChild(group);
  rows.forEach(r => group.appendChild(makeRow(document, r)));
  return { document, group };
}

describe('aliasStateFor — the state rule (R-P3-2)', () => {
  const { fns } = loadStateScript();
  it('a curated alias holding the shipped id follows; any other value pins', () => {
    expect(fns.aliasStateFor('gemini', 'google/gemini-x')).toEqual({ curated: true, state: 'following' });
    expect(fns.aliasStateFor('gemini', 'google/gemini-y')).toEqual({ curated: true, state: 'pinned' });
    expect(fns.aliasStateFor('gemini', 'openrouter/google/gemini-x')).toEqual({ curated: true, state: 'pinned' }); // exact equality, same as saveConfig's normalizer
  });
  it('a custom alias is always pinned; prototype names are custom', () => {
    expect(fns.aliasStateFor('mine', 'openrouter/x/y')).toEqual({ curated: false, state: 'pinned' });
    expect(fns.aliasStateFor('toString', 'openrouter/x/y')).toEqual({ curated: false, state: 'pinned' });
    expect(fns.isCuratedAlias('constructor')).toBe(false);
  });
});

describe('refreshAliasRowState / stagedValueFor', () => {
  it('reads the staged write over the on-screen text and re-labels the row (mutant STALELABEL: never re-label)', () => {
    const { document } = pageWith([{ alias: 'gemini', model: 'google/gemini-x', curated: true, state: 'following' }]);
    const aliasEdits = Object.create(null);
    const { fns } = loadStateScript({ aliasEdits, document });
    const row = fns.aliasRowFor('gemini');
    expect(row).not.toBeNull();
    expect(row.querySelector('.alias-delete').hidden).toBe(true);               // following: nothing to unpin
    aliasEdits.gemini = 'google/gemini-y';                                       // an inline edit pinned it
    expect(fns.refreshAliasRowState(row)).toBe('pinned');
    expect(row.getAttribute('data-state')).toBe('pinned');
    expect(row.querySelector('.alias-state').textContent).toBe('pinned');
    expect(row.querySelector('.alias-state').className).toBe('alias-state alias-state-pinned');
    expect(row.querySelector('.alias-delete').hidden).toBe(false);              // …so [unpin] appears
    aliasEdits.gemini = null;                                                    // staged removal → follows again
    expect(fns.refreshAliasRowState(row)).toBe('following');
    expect(row.querySelector('.alias-delete').hidden).toBe(true);
  });
  it('aliasRowFor finds by attribute compare, so a quote in a name cannot break it', () => {
    const { document } = pageWith([{ alias: 'a"b', model: 'openrouter/x/y', curated: false, state: 'pinned' }]);
    const { fns } = loadStateScript({ document });
    expect(fns.aliasRowFor('a"b').getAttribute('data-alias')).toBe('a"b');
    expect(fns.aliasRowFor('nope')).toBeNull();
  });
});

describe('unpinAliasRow — [unpin] on a curated pin', () => {
  it('stages null, shows the shipped id, labels the row following, hides the control (mutant STRIKEUNPIN: strike it through instead)', () => {
    const { document } = pageWith([{ alias: 'glm', model: 'openrouter/z-ai/glm-5.2', curated: true, state: 'pinned' }]);
    const aliasEdits = Object.create(null);
    const { fns } = loadStateScript({ aliasEdits, document });
    const row = fns.aliasRowFor('glm');
    fns.unpinAliasRow(row);
    expect(aliasEdits.glm).toBeNull();
    expect(row.querySelector('.alias-model').textContent).toBe('openrouter/z-ai/glm-5.3');
    expect(row.getAttribute('data-state')).toBe('following');
    expect(row.classList.contains('alias-deleted')).toBe(false);               // the alias still exists
    expect(row.querySelector('.alias-delete').hidden).toBe(true);
  });
});

describe('stageAliasWrite — Q4: the shipped id means follow', () => {
  it('a different id pins: aliasEdits holds it, the row shows it, its group opens', () => {
    const { document, group } = pageWith([{ alias: 'glm', model: 'openrouter/z-ai/glm-5.3', curated: true, state: 'following' }]);
    const aliasEdits = Object.create(null);
    const { fns } = loadStateScript({ aliasEdits, document });
    expect(fns.stageAliasWrite('glm', 'openrouter/z-ai/glm-5.4')).toBe('pinned');
    expect(aliasEdits.glm).toBe('openrouter/z-ai/glm-5.4');
    const row = fns.aliasRowFor('glm');
    expect(row.querySelector('.alias-model').textContent).toBe('openrouter/z-ai/glm-5.4');
    expect(row.getAttribute('data-state')).toBe('pinned');
    expect(row.querySelector('.alias-delete').hidden).toBe(false);
    expect(group.open).toBe(true);
  });
  it('the shipped id folds to null (follow) — never a redundant pin (mutant PINSHIPPED)', () => {
    const { document } = pageWith([{ alias: 'glm', model: 'openrouter/z-ai/glm-5.2', curated: true, state: 'pinned' }]);
    const aliasEdits = Object.create(null);
    const { fns } = loadStateScript({ aliasEdits, document });
    expect(fns.stageAliasWrite('glm', 'openrouter/z-ai/glm-5.3')).toBe('following');
    expect(aliasEdits.glm).toBeNull();
    expect(fns.aliasRowFor('glm').getAttribute('data-state')).toBe('following');
  });
  it('a custom alias always pins, and a struck-out row comes back', () => {
    const { document } = pageWith([{ alias: 'mine', model: 'openrouter/x/old', curated: false, state: 'pinned' }]);
    const aliasEdits = Object.create(null);
    const { fns } = loadStateScript({ aliasEdits, document });
    const row = fns.aliasRowFor('mine');
    row.classList.add('alias-deleted');
    expect(fns.stageAliasWrite('mine', 'openrouter/x/new')).toBe('pinned');
    expect(aliasEdits.mine).toBe('openrouter/x/new');
    expect(row.classList.contains('alias-deleted')).toBe(false);
  });
  it('an alias with no row on the page still stages (a notable added this session)', () => {
    const { document } = pageWith([]);
    const aliasEdits = Object.create(null);
    const { fns } = loadStateScript({ aliasEdits, document });
    expect(fns.stageAliasWrite('atlas', 'openrouter/x/atlas-1')).toBe('pinned');
    expect(aliasEdits.atlas).toBe('openrouter/x/atlas-1');
  });
});
