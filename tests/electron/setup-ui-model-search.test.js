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
