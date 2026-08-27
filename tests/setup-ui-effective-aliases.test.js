'use strict';

/**
 * Issue #213, second half: the wizard must render the aliases the user ACTUALLY
 * has, not just the 21 built-in defaults.
 *
 * Fixing buildAliasEditorHTML's grouping (the first half) guarantees "every
 * alias passed in renders exactly once" — but the shipped app never passed the
 * user's aliases in. `buildSetupHTML` called `buildAliasEditorHTML(getDefaultAliases())`,
 * and the config arriving later over IPC only rewrites the model text of rows
 * that already exist (`applyAliasEditsToUI`: `if (!row) { return; }`). So every
 * alias outside the defaults had no row to rewrite and was invisible — measured
 * on the reporter's own config as exactly the 12 names #213 lists.
 *
 * The primitive already existed: `getEffectiveAliases()` (src/utils/config.js)
 * is defaults-merged-with-config and carries the `__proto__: null` discipline.
 * Same theme as the rest of #213/#208/#214 — reuse it, don't hand-roll a merge.
 */

const fs = require('fs');
const path = require('path');
const { buildSetupHTML } = require('../electron/setup-ui');
const { getDefaultAliases } = require('../src/utils/config');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf-8');

/** Alias names that have a rendered row in the page. */
function renderedAliases(html) {
  return [...html.matchAll(/class="alias-row" data-alias="([^"]*)"/g)].map((m) => m[1]);
}

/** Text of the balanced `(...)` call whose opening paren is at openParenIdx. */
function balancedParens(text, openParenIdx) {
  let depth = 0;
  for (let i = openParenIdx; i < text.length; i++) {
    if (text[i] === '(') { depth++; }
    else if (text[i] === ')') { depth--; if (depth === 0) { return text.slice(openParenIdx, i + 1); } }
  }
  throw new Error('unbalanced parens');
}

/** Body of a named function in main.js, bounded by the next top-level banner comment. */
function fnBlock(name) {
  const start = MAIN.indexOf(`function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = MAIN.indexOf('// ====', start);
  return MAIN.slice(start, end > start ? end : MAIN.length);
}

describe('#213: buildSetupHTML renders the user\'s effective aliases', () => {
  it('renders a row for a custom alias that is in NO default and NO name whitelist', () => {
    const aliases = {
      ...getDefaultAliases(),
      lmstudio: 'lmstudio/qwen2.5-coder-7b-instruct',
      'free-google-gemma-4-31b-it': 'openrouter/google/gemma-4-31b-it:free',
      GLM: 'openrouter/z-ai/glm-5.2',
    };
    const rendered = renderedAliases(buildSetupHTML({ aliases }));
    expect(rendered).toContain('lmstudio');
    expect(rendered).toContain('free-google-gemma-4-31b-it');
    expect(rendered).toContain('GLM');
  });

  it('renders EVERY passed alias exactly once — no drops, no duplicates', () => {
    const aliases = {
      ...getDefaultAliases(),
      lmstudio: 'lmstudio/qwen2.5-coder-7b-instruct',
      openai: 'openai/gpt-5.6-terra',
      anthropic: 'anthropic/claude-sonnet-5',
      Inkling: 'openrouter/thinkingmachines/inkling',
      devstral: 'openrouter/mistralai/voxtral-small-24b-2507',
    };
    const rendered = renderedAliases(buildSetupHTML({ aliases }));
    const names = Object.keys(aliases);
    expect(rendered.slice().sort()).toEqual(names.slice().sort());
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it('defaults to the built-in aliases when none are passed (back-compat)', () => {
    const rendered = renderedAliases(buildSetupHTML());
    expect(rendered.slice().sort()).toEqual(Object.keys(getDefaultAliases()).slice().sort());
  });
});

describe('#213: main.js threads the effective aliases into both windows', () => {
  // Source-level, like main-settings-catalog-wiring.test.js: main.js runs heavy
  // Electron side effects at import and exports nothing, so the construction
  // sites cannot be invoked from a test.
  for (const fn of ['createSetupWindow', 'createSettingsChildWindow']) {
    it(`${fn} passes aliases into buildSetupHTML`, () => {
      const block = fnBlock(fn);
      const idx = block.indexOf('buildSetupHTML(');
      expect(idx).toBeGreaterThan(-1);
      const call = balancedParens(block, idx + 'buildSetupHTML'.length);
      expect(call).toMatch(/\baliases\b/);
    });

    it(`${fn} resolves them via getEffectiveAliases, not a hand-rolled merge`, () => {
      const block = fnBlock(fn);
      expect(block).toMatch(/getEffectiveAliases\(\)/);
      // A hand-rolled `{...getDefaultAliases(), ...cfg.aliases}` drops the
      // `__proto__: null` discipline getEffectiveAliases exists to carry.
      expect(block).not.toMatch(/\.\.\.\s*\w*[Cc]onfig\.aliases/);
    });
  }

  it('Settings stays synchronous — getEffectiveAliases must not make it async', () => {
    expect(MAIN).not.toMatch(/async function createSettingsChildWindow/);
  });

  it('an unreadable config never blocks either window', () => {
    for (const fn of ['createSetupWindow', 'createSettingsChildWindow']) {
      const block = fnBlock(fn);
      const idx = block.indexOf('getEffectiveAliases()');
      expect(idx).toBeGreaterThan(-1);
      // The call sits inside a try/catch (loadConfig touches disk).
      expect(block.slice(0, idx)).toMatch(/try\s*\{/);
    }
  });
});
