/**
 * F5: search-section HTML builder + step HTML embeds it.
 * Contract: the search section is ALWAYS visible (no display:none gating);
 * the renderer script shows/hides it based on catalog state.
 */
const { buildModelSearchHTML, buildModelStepHTML } =
  require('../../electron/setup-ui-model');

// Local fixture — v2 resolved-row shape (MODEL_CHOICES no longer exported).
const FIXTURE_CHOICES = [
  { alias: 'gemini', label: 'Gemini Flash-class', blurb: 'fast, large context',
    source: 'live',
    routes: { openrouter: 'openrouter/google/gemini-3.5-flash', google: 'google/gemini-3.5-flash' } },
  { alias: 'deepseek', label: 'DeepSeek flagship', blurb: 'open-source',
    source: 'fallback',
    routes: { openrouter: 'openrouter/deepseek/deepseek-v4-pro' } },
];

describe('buildModelSearchHTML', () => {
  it('renders the search input, results container and refresh control', () => {
    const html = buildModelSearchHTML();
    expect(html).toContain('id="model-search-input"');
    expect(html).toContain('id="model-search-results"');
    expect(html).toContain('id="model-search-refresh"');
    expect(html).toContain('id="model-search-section"');
    // Section is always present and visible — no display:none gating
    expect(html).not.toContain('style="display:none"');
  });
});

describe('buildModelStepHTML embeds the search section', () => {
  it('includes the search section after the quick-pick cards', () => {
    const html = buildModelStepHTML(FIXTURE_CHOICES);
    const cards = html.indexOf('model-list');
    const search = html.indexOf('model-search-section');
    expect(cards).toBeGreaterThan(-1);
    expect(search).toBeGreaterThan(cards);
  });
});

describe('wizard script round-trips a custom default', () => {
  it('restores window.customDefaultModel from a full-id cfg.default', () => {
    const { buildSetupHTML } = require('../../electron/setup-ui');
    const script = buildSetupHTML().match(/<script>([\s\S]*)<\/script>/)[1];
    expect(script).toContain("cfg.default.indexOf('/') !== -1");
    expect(script).toContain('window.customDefaultModel = cfg.default');
  });
});

describe('Step 3 consumes the shared catalog cache (B33 / #12)', () => {
  let script;

  beforeAll(() => {
    const { buildSetupHTML } = require('../../electron/setup-ui');
    script = buildSetupHTML().match(/<script>([\s\S]*)<\/script>/)[1];
  });

  it('never invokes the live sidecar:fetch-models channel', () => {
    const invoked = [...script.matchAll(/invoke\('([^']+)'/g)].map(m => m[1]);
    expect(invoked).not.toContain('sidecar:fetch-models');
    // get-catalog is invoked exactly once in the source (inside
    // ensureCatalogLoaded) — Step 2 and Step 3 share that single call site.
    expect(invoked.filter(c => c === 'sidecar:get-catalog')).toHaveLength(1);
  });

  it('no longer defines a separate fetchAvailableModels live-fetch function', () => {
    expect(script).not.toMatch(/function fetchAvailableModels/);
  });

  it('Step 3 entry calls the same ensureCatalogLoaded used by Step 2 (single shared load)', () => {
    // The step===3 branch of showStep must reuse ensureCatalogLoaded rather
    // than a second, independent fetch path.
    const stepThreeIdx = script.indexOf('if (step === 3)');
    const nextBranchIdx = script.indexOf('updateNextState();', stepThreeIdx);
    const stepThreeBranch = script.slice(stepThreeIdx, nextBranchIdx);
    expect(stepThreeBranch).toContain('ensureCatalogLoaded()');
  });

  it('derives window.availableModels (grouped) from the flat catalog rows via a family-grouping helper', () => {
    expect(script).toMatch(/function groupCatalogByFamily/);
    expect(script).toContain('window.availableModels = groupCatalogByFamily(catalogRows)');
  });

  it('groups flat catalog rows into the same {family, models} shape buildModelSelect expects', () => {
    // Extract groupCatalogByFamily and PROVIDER_FAMILY_NAMES, evaluate in a sandbox.
    const familyNamesMatch = script.match(/var PROVIDER_FAMILY_NAMES = (\{[^;]*\});/);
    expect(familyNamesMatch).toBeTruthy();
    const fnMatch = script.match(/function groupCatalogByFamily\(rows\) \{[\s\S]*?\n  \}/);
    expect(fnMatch).toBeTruthy();

    // eslint-disable-next-line no-new-func
    const groupCatalogByFamily = new Function(
      'PROVIDER_FAMILY_NAMES',
      `${fnMatch[0]}; return groupCatalogByFamily;`
    )(JSON.parse(familyNamesMatch[1].replace(/'/g, '"')));

    const rows = [
      { id: 'openrouter/google/gemini-3.5-flash', name: 'Gemini 3.5 Flash', contextLength: 1000000, pricing: null },
      { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', contextLength: null, pricing: null },
      { id: 'openrouter/google/gemini-3-pro', name: 'Gemini 3 Pro', contextLength: 2000000, pricing: null },
    ];
    const grouped = groupCatalogByFamily(rows);
    expect(Array.isArray(grouped)).toBe(true);
    const openrouterGroup = grouped.find(g => g.family === 'OpenRouter');
    expect(openrouterGroup.models).toHaveLength(2);
    expect(openrouterGroup.models.map(m => m.id)).toEqual([
      'openrouter/google/gemini-3.5-flash', 'openrouter/google/gemini-3-pro'
    ]);
    const anthropicGroup = grouped.find(g => g.family === 'Anthropic');
    expect(anthropicGroup.models).toHaveLength(1);
  });

  it('empty catalog rows produce an empty availableModels array (buildModelSelect falls back to defaultAliases)', () => {
    const fnMatch = script.match(/function groupCatalogByFamily\(rows\) \{[\s\S]*?\n  \}/);
    // eslint-disable-next-line no-new-func
    const groupCatalogByFamily = new Function(
      'PROVIDER_FAMILY_NAMES',
      `${fnMatch[0]}; return groupCatalogByFamily;`
    )({});
    expect(groupCatalogByFamily([])).toEqual([]);
  });
});
