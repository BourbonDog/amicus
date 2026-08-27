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
