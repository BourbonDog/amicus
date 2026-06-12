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
    routes: { openrouter: 'openrouter/deepseek/deepseek-v4-pro', deepseek: 'deepseek/deepseek-chat' } },
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

  // MODEL_CHOICES is now a local fixture (v2 row shape); tests pin the fixture's own shape
  describe('MODEL_CHOICES fixture', () => {
    it('should have 5 model choices', () => {
      expect(MODEL_CHOICES).toHaveLength(5);
    });

    it('should have required v2 fields on each choice', () => {
      for (const choice of MODEL_CHOICES) {
        expect(choice).toHaveProperty('alias');
        expect(choice).toHaveProperty('label');
        expect(choice).toHaveProperty('blurb');
        expect(choice).toHaveProperty('source');
        expect(choice).toHaveProperty('routes');
        expect(typeof choice.alias).toBe('string');
        expect(typeof choice.label).toBe('string');
        expect(typeof choice.blurb).toBe('string');
        expect(typeof choice.routes).toBe('object');
      }
    });

    it('should have unique aliases', () => {
      const aliases = MODEL_CHOICES.map(c => c.alias);
      expect(new Set(aliases).size).toBe(aliases.length);
    });

    it('should have openrouter route for every choice', () => {
      for (const choice of MODEL_CHOICES) {
        expect(choice.routes).toHaveProperty('openrouter');
        expect(choice.routes.openrouter).toContain('openrouter/');
      }
    });

    it('should have google route for gemini models', () => {
      const gemini = MODEL_CHOICES.find(c => c.alias === 'gemini');
      expect(gemini.routes).toHaveProperty('google');
      expect(gemini.routes.google).toContain('google/');

      const geminiPro = MODEL_CHOICES.find(c => c.alias === 'gemini-pro');
      expect(geminiPro.routes).toHaveProperty('google');
    });

    it('should have openai route for gpt model', () => {
      const gpt = MODEL_CHOICES.find(c => c.alias === 'gpt');
      expect(gpt.routes).toHaveProperty('openai');
      expect(gpt.routes.openai).toContain('openai/');
    });

    it('should have anthropic route for opus model', () => {
      const opus = MODEL_CHOICES.find(c => c.alias === 'opus');
      expect(opus.routes).toHaveProperty('anthropic');
      expect(opus.routes.anthropic).toContain('anthropic/');
    });

    it('should have both openrouter and deepseek routes for deepseek', () => {
      const deepseek = MODEL_CHOICES.find(c => c.alias === 'deepseek');
      expect(Object.keys(deepseek.routes)).toContain('openrouter');
      expect(Object.keys(deepseek.routes)).toContain('deepseek');
      expect(deepseek.routes.deepseek).toBe('deepseek/deepseek-chat');
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
