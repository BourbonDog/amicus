/**
 * Tests for electron/setup-ui-model.js
 *
 * Verifies Step 2 (Model Selection) HTML contains required elements:
 * model radio cards, pre-selection support, descriptions,
 * provider routing toggles, and PROVIDER_NAMES export.
 */

const { buildModelStepHTML, buildModelSearchHTML, PROVIDER_NAMES } = require('../electron/setup-ui-model');

// Local fixture replacing the deleted MODEL_CHOICES export.
// Matches the v2 resolved-row shape: { alias, label, blurb, source, routes }.
const MODEL_CHOICES = [
  { alias: 'gemini', label: 'Gemini Flash-class', blurb: 'fast, large context',
    source: 'live',
    routes: { openrouter: 'openrouter/google/gemini-3.5-flash', google: 'google/gemini-3.5-flash' } },
  { alias: 'gemini-pro', label: 'Gemini Pro-class', blurb: 'advanced reasoning',
    source: 'live',
    routes: { openrouter: 'openrouter/google/gemini-3.1-pro-preview', google: 'google/gemini-3.1-pro-preview' } },
  { alias: 'gpt', label: 'GPT flagship', blurb: 'strong coding',
    source: 'live',
    routes: { openrouter: 'openrouter/openai/gpt-5.5', openai: 'openai/gpt-5.5' } },
  { alias: 'opus', label: 'Claude Opus-class', blurb: 'deep analysis',
    source: 'live',
    routes: { openrouter: 'openrouter/anthropic/claude-opus-4.8', anthropic: 'anthropic/claude-opus-4-6' } },
  { alias: 'deepseek', label: 'DeepSeek flagship', blurb: 'open-source',
    source: 'live',
    routes: { openrouter: 'openrouter/deepseek/deepseek-v4-pro', deepseek: 'deepseek/deepseek-v4-pro' } },
];

describe('setup-ui-model', () => {
  describe('buildModelStepHTML', () => {
    it('should return an HTML string', () => {
      const html = buildModelStepHTML(MODEL_CHOICES);
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
    });

    it('should contain radio inputs for each model choice', () => {
      const html = buildModelStepHTML(MODEL_CHOICES);
      for (const choice of MODEL_CHOICES) {
        expect(html).toContain(`value="${choice.alias}"`);
      }
    });

    it('should contain model labels', () => {
      const html = buildModelStepHTML(MODEL_CHOICES);
      for (const choice of MODEL_CHOICES) {
        expect(html).toContain(choice.label);
      }
    });

    it('should contain model alias names', () => {
      const html = buildModelStepHTML(MODEL_CHOICES);
      for (const choice of MODEL_CHOICES) {
        expect(html).toContain(choice.alias);
      }
    });

    it('should support pre-selecting a model via selectedAlias', () => {
      const html = buildModelStepHTML(MODEL_CHOICES, 'opus');
      // The opus radio should be checked
      expect(html).toContain('value="opus"');
      // Should have a checked attribute near opus
      const opusIdx = html.indexOf('value="opus"');
      const contextStart = Math.max(0, opusIdx - 100);
      const context = html.slice(contextStart, opusIdx + 50);
      expect(context).toContain('checked');
    });

    it('should default to first choice when no selectedAlias given', () => {
      const html = buildModelStepHTML(MODEL_CHOICES);
      // First choice should be checked
      const firstAlias = MODEL_CHOICES[0].alias;
      const firstIdx = html.indexOf(`value="${firstAlias}"`);
      const contextStart = Math.max(0, firstIdx - 100);
      const context = html.slice(contextStart, firstIdx + 50);
      expect(context).toContain('checked');
    });

    it('should fall back to first choice for unknown selectedAlias', () => {
      const html = buildModelStepHTML(MODEL_CHOICES, 'nonexistent');
      const firstAlias = MODEL_CHOICES[0].alias;
      const firstIdx = html.indexOf(`value="${firstAlias}"`);
      const contextStart = Math.max(0, firstIdx - 100);
      const context = html.slice(contextStart, firstIdx + 50);
      expect(context).toContain('checked');
    });

    describe('provider routing', () => {
      it('should show route-toggle for models with multiple providers when keys configured', () => {
        const configuredKeys = { openrouter: true, google: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        // gemini has both openrouter and google routes
        expect(html).toContain('route-toggle');
      });

      it('should show route-pill buttons for each available provider', () => {
        const configuredKeys = { openrouter: true, google: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        expect(html).toContain('route-pill');
        expect(html).toContain('OpenRouter');
        expect(html).toContain('Google AI');
      });

      it('should show static "via OpenRouter" when only openrouter key configured', () => {
        const configuredKeys = { openrouter: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        expect(html).toContain('route-static');
        expect(html).toContain('via OpenRouter');
      });

      it('should show route-toggle for deepseek when deepseek key is configured', () => {
        // deepseek now has openrouter + deepseek direct routes — toggle shown when key present
        const configuredKeys = { openrouter: true, google: true, openai: true, deepseek: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        const deepseekIdx = html.indexOf('value="deepseek"');
        const cardEnd = html.indexOf('</label>', deepseekIdx);
        const cardHtml = html.slice(deepseekIdx, cardEnd);
        expect(cardHtml).toContain('route-toggle');
      });

      it('should hide toggles when configuredKeys not provided', () => {
        const html = buildModelStepHTML(MODEL_CHOICES);
        // Toggles exist but are hidden; static text is visible
        expect(html).toContain('route-toggle');
        expect(html).toContain('style="display:none"');
      });

      it('should include data-alias and data-provider attributes on pills', () => {
        const configuredKeys = { openrouter: true, google: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        expect(html).toContain('data-alias="gemini"');
        expect(html).toContain('data-provider="openrouter"');
        expect(html).toContain('data-provider="google"');
      });

      it('should mark openrouter pill as active by default', () => {
        const configuredKeys = { openrouter: true, google: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        // The first route-toggle should have the first pill with 'active' class
        const toggleIdx = html.indexOf('route-toggle');
        const toggleEnd = html.indexOf('</span>', toggleIdx);
        const toggleHtml = html.slice(toggleIdx, toggleEnd);
        expect(toggleHtml).toContain('route-pill active');
      });

      it('should disable model when no configured key matches any route', () => {
        // only google key — deepseek only has openrouter+deepseek routes → unavailable
        const configuredKeys = { google: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        const deepseekIdx = html.indexOf('value="deepseek"');
        const cardStart = html.lastIndexOf('<label', deepseekIdx);
        const cardEnd = html.indexOf('</label>', deepseekIdx);
        const cardHtml = html.slice(cardStart, cardEnd);
        expect(cardHtml).toContain('model-unavailable');
        expect(cardHtml).toContain('disabled');
      });

      it('should not disable model when at least one route has a configured key', () => {
        // google key configured — gemini has google route → available
        const configuredKeys = { google: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        const geminiIdx = html.indexOf('value="gemini"');
        const cardStart = html.lastIndexOf('<label', geminiIdx);
        const cardEnd = html.indexOf('</label>', geminiIdx);
        const cardHtml = html.slice(cardStart, cardEnd);
        expect(cardHtml).not.toContain('model-unavailable');
        expect(cardHtml).not.toContain('disabled');
      });

      it('should show static text with available provider instead of first provider', () => {
        // only google key — gemini static should say "via Google AI" not "via OpenRouter"
        const configuredKeys = { google: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        const geminiIdx = html.indexOf('value="gemini"');
        const cardEnd = html.indexOf('</label>', geminiIdx);
        const cardHtml = html.slice(geminiIdx, cardEnd);
        expect(cardHtml).toContain('via Google AI');
      });

      it('should auto-select first available model when selectedAlias is unavailable', () => {
        // only google key — gpt has no google route, gemini does
        const configuredKeys = { google: true };
        const html = buildModelStepHTML(MODEL_CHOICES, 'gpt', configuredKeys);
        // gpt should NOT be checked (unavailable)
        const gptIdx = html.indexOf('value="gpt"');
        const gptContext = html.slice(Math.max(0, gptIdx - 100), gptIdx + 50);
        expect(gptContext).not.toContain('checked');
        // gemini (first available) should be checked
        const geminiIdx = html.indexOf('value="gemini"');
        const geminiContext = html.slice(Math.max(0, geminiIdx - 100), geminiIdx + 50);
        expect(geminiContext).toContain('checked');
      });

      it('should show "No API key" message on unavailable models', () => {
        const configuredKeys = { google: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        const gptIdx = html.indexOf('value="gpt"');
        const cardEnd = html.indexOf('</label>', gptIdx);
        const cardHtml = html.slice(gptIdx, cardEnd);
        expect(cardHtml).toContain('no-key-hint');
      });

      it('should mark first available pill as active when openrouter key missing', () => {
        // only google key — gemini pills should have google as active
        const configuredKeys = { google: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        const geminiToggle = html.match(/route-toggle[^>]*data-alias="gemini"[^>]*>(.*?)<\/span>/s);
        if (geminiToggle) {
          const pills = geminiToggle[1];
          // google pill should be active, openrouter pill should not
          expect(pills).toMatch(/data-provider="google"[^>]*>Google AI<\/button>/);
        }
      });

      it('deepseek toggle pill shows DeepSeek label', () => {
        // build HTML for the deepseek card with both openrouter and deepseek keys configured
        const configuredKeys = { openrouter: true, deepseek: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        const deepseekIdx = html.indexOf('value="deepseek"');
        expect(deepseekIdx).toBeGreaterThan(-1);
        const cardEnd = html.indexOf('</label>', deepseekIdx);
        const cardHtml = html.slice(deepseekIdx, cardEnd);
        // assert the HTML contains 'DeepSeek' inside the pill for the deepseek route
        expect(cardHtml).toContain('route-toggle');
        expect(cardHtml).toContain('data-provider="deepseek"');
        expect(cardHtml).toContain('>DeepSeek<');
      });
    });
  });

  describe('quick-pick fallback rows (replaces MODEL_CHOICES shape tests)', () => {
    const { resolveQuickPicks } = require('../src/utils/quick-picks');
    const rows = resolveQuickPicks([]);

    test('five families resolve in wizard display order', () => {
      expect(rows.map(r => r.alias)).toEqual(['gemini', 'gemini-pro', 'gpt', 'opus', 'deepseek']);
    });

    test('every row has label, blurb, source fallback, and a non-empty openrouter route', () => {
      for (const r of rows) {
        expect(typeof r.label).toBe('string');
        expect(typeof r.blurb).toBe('string');
        expect(r.source).toBe('fallback');
        expect(typeof r.routes.openrouter).toBe('string');
        expect(r.routes.openrouter.length).toBeGreaterThan(0);
      }
    });

    test('rows render through buildModelStepHTML without error', () => {
      const html = buildModelStepHTML(rows, 'gemini', { openrouter: true });
      for (const r of rows) {
        expect(html).toContain(`value="${r.alias}"`);
      }
    });
  });

  describe('PROVIDER_NAMES', () => {
    it('should be exported', () => {
      expect(PROVIDER_NAMES).toBeDefined();
      expect(typeof PROVIDER_NAMES).toBe('object');
    });

    it('should have display names for all providers', () => {
      expect(PROVIDER_NAMES.openrouter).toBe('OpenRouter');
      expect(PROVIDER_NAMES.google).toBe('Google AI');
      expect(PROVIDER_NAMES.openai).toBe('OpenAI');
      expect(PROVIDER_NAMES.anthropic).toBe('Anthropic');
    });

    it('should include DeepSeek', () => {
      expect(PROVIDER_NAMES.deepseek).toBe('DeepSeek');
    });
  });

  // New v2 row tests
  const PICKS = [
    { alias: 'gemini', label: 'Gemini Flash-class', blurb: 'fast, large context',
      source: 'live',
      routes: { openrouter: 'openrouter/google/gemini-3.5-flash', google: 'google/gemini-3.5-flash' } },
    { alias: 'deepseek', label: 'DeepSeek flagship', blurb: 'open-source',
      source: 'fallback',
      routes: { openrouter: 'openrouter/deepseek/deepseek-v4-pro' } },
  ];

  describe('buildModelStepHTML (v2 rows)', () => {
    test('renders the resolved model id and a write-preview per row', () => {
      const html = buildModelStepHTML(PICKS, 'gemini', { openrouter: true, google: true });
      expect(html).toContain('openrouter/google/gemini-3.5-flash');
      expect(html).toContain('class="write-preview"');
      expect(html).toContain('data-alias="gemini"');
      expect(html).toContain('will set');
    });
    test('fallback rows carry the offline badge', () => {
      const html = buildModelStepHTML(PICKS, 'gemini', { openrouter: true });
      expect(html).toContain('class="pick-badge"');
      expect(html).toContain('offline list');
    });
    test('search section has no display:none gating and is labeled', () => {
      const html = buildModelSearchHTML();
      expect(html).not.toContain('display:none');
      expect(html).toContain('or pick any model');
    });
  });
});

describe('#138 per-card model drill-down', () => {
  const choices = [{
    alias: 'deepseek', label: 'DeepSeek flagship', blurb: 'open-source',
    source: 'live',
    routes: { openrouter: 'openrouter/deepseek/deepseek-v4-pro',
              deepseek: 'deepseek/deepseek-v4-pro' },
  }];
  const mk = (id, price, rec) => ({
    id, name: id.split('/').pop(), contextLength: 128000,
    pricePerMInput: price, isRecommended: !!rec,
    directId: id, openrouterId: 'openrouter/' + id,
  });
  const shortlists = {
    deepseek: {
      recommendedId: 'deepseek/deepseek-v4-pro',
      suggested: [mk('deepseek/deepseek-v4-pro', 0.52, true),
                  mk('deepseek/deepseek-v4-flash', 0.06)],
      rest: [mk('deepseek/deepseek-r1', 0.70)],
      total: 3,
    },
  };

  test('renders a model <select> for the card', () => {
    const html = buildModelStepHTML(choices, 'deepseek', { deepseek: true }, shortlists);
    expect(html).toContain('class="model-pick" data-alias="deepseek"');
  });

  test('the recommended model is the selected option', () => {
    const html = buildModelStepHTML(choices, 'deepseek', { deepseek: true }, shortlists);
    // R1: data-or is emitted on every <option>, so the recommended option's
    // tag now carries it too — attribute order is value, data-or, selected.
    expect(html).toMatch(/<option value="deepseek\/deepseek-v4-pro" data-or="openrouter\/deepseek\/deepseek-v4-pro" selected>/);
  });

  test('every model is reachable — including one only in `rest`', () => {
    const html = buildModelStepHTML(choices, 'deepseek', { deepseek: true }, shortlists);
    expect(html).toContain('value="deepseek/deepseek-r1"');
    expect(html).toContain('Suggested');
    expect(html).toContain('All 3 models');
  });

  // CONTROLLER RULING R5 (issue 138, 2026-08-24): this proves omitting the
  // 4th arg is equivalent to passing {} explicitly (the default-parameter
  // path) -- that equivalence holds trivially no matter what the template
  // does, so it does NOT by itself prove the no-shortlist card matches the
  // pre-issue-138 HTML byte-for-byte (it doesn't -- see buildModelPickHTML's
  // docstring). The extra assertions below pin the no-shortlist card's
  // actual shape: no <select> at all, and still a well-formed card.
  test('omitting the shortlists argument behaves identically to passing {}', () => {
    const withArg = buildModelStepHTML(choices, 'deepseek', { deepseek: true }, {});
    const without = buildModelStepHTML(choices, 'deepseek', { deepseek: true });
    expect(withArg).toBe(without);
    expect(without).not.toContain('model-pick');
    expect(without).not.toContain('<select');
    expect(without).toContain('class="write-preview"');
  });

  // CONTROLLER RULING R1 (2026-08-24): data-or belongs to Task 3, not Task 4
  // -- emitted on every <option>, suggested and rest alike, so a later task
  // can read the user's chosen route without re-deriving a gateway prefix.
  test('every option carries data-or with the row\'s openrouterId (R1)', () => {
    const html = buildModelStepHTML(choices, 'deepseek', { deepseek: true }, shortlists);
    expect(html).toContain('data-or="openrouter/deepseek/deepseek-v4-pro"');
    expect(html).toContain('data-or="openrouter/deepseek/deepseek-v4-flash"');
    expect(html).toContain('data-or="openrouter/deepseek/deepseek-r1"');
  });

  test('#138 the resolved-id span carries its alias so it can be refreshed', () => {
    const html = buildModelStepHTML(choices, 'deepseek', { deepseek: true }, shortlists);
    expect(html).toContain('class="model-resolved" data-alias="deepseek"');
  });
});
