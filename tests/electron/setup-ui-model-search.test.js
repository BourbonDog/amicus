/** F5: search-section HTML builder + step HTML embeds it when the catalog may exist. */
const { buildModelSearchHTML, buildModelStepHTML, MODEL_CHOICES } =
  require('../../electron/setup-ui-model');

describe('buildModelSearchHTML', () => {
  it('renders the search input, results container and refresh control', () => {
    const html = buildModelSearchHTML();
    expect(html).toContain('id="model-search-input"');
    expect(html).toContain('id="model-search-results"');
    expect(html).toContain('id="model-search-refresh"');
    expect(html).toContain('id="model-search-section"');
    expect(html).toContain('style="display:none"');
  });
});

describe('buildModelStepHTML embeds the search section', () => {
  it('includes the search section after the quick-pick cards', () => {
    const html = buildModelStepHTML(MODEL_CHOICES);
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
