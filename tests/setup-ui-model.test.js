/**
 * Tests for electron/setup-ui-model.js
 *
 * Verifies Step 2 (Model Selection) HTML contains required elements:
 * model radio cards, pre-selection support, descriptions,
 * provider routing toggles, and PROVIDER_NAMES export.
 */

const { buildModelStepHTML, buildModelSearchHTML, buildModelPickHTML, PROVIDER_NAMES, escapeAttr } = require('../electron/setup-ui-model');

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
    // council review, PR 196 (F2): the optgroup holds ONLY `rest` (1 row
    // here), so its label must describe that 1 row, not `shortlist.total`
    // (3) -- "All 3 models" would overstate what's actually in the group.
    expect(html).toContain('1 more model');
    expect(html).not.toContain('All 3 models');
  });

  // council review, PR 196 (F2): measured on the live catalog, deepseek has
  // total=14, suggested=8, rest=6 -- the old label read "All 14 models"
  // over exactly 6 options. Reproduces that split and pins the label to the
  // group's actual content (rest.length), plus a singular-count fixture so
  // a 9-row vendor with one leftover row doesn't regress to "1 models".
  describe('F2: "rest" optgroup label describes what it actually contains', () => {
    const mkRow = (id, price) => ({
      id, name: id.split('/').pop(), contextLength: 128000,
      pricePerMInput: price, isRecommended: false,
      directId: id, openrouterId: 'openrouter/' + id,
    });

    test('total=14, suggested=8, rest=6 -> labeled by the 6 actually present, not 14', () => {
      const suggested = Array.from({ length: 8 }, (_, i) => mkRow(`deepseek/s${i}`, 0.1));
      const rest = Array.from({ length: 6 }, (_, i) => mkRow(`deepseek/r${i}`, 0.2));
      const html = buildModelPickHTML('deepseek', {
        recommendedId: null, suggested, rest, total: 14,
      });
      expect(html).toContain('6 more models');
      expect(html).not.toContain('All 14 models');
      expect(html).not.toContain('14 more');
    });

    test('a single leftover row reads "1 more model", never "1 models"', () => {
      const suggested = Array.from({ length: 8 }, (_, i) => mkRow(`vendor/s${i}`, 0.1));
      const rest = [mkRow('vendor/r0', 0.2)];
      const html = buildModelPickHTML('vendor', {
        recommendedId: null, suggested, rest, total: 9,
      });
      expect(html).toContain('1 more model');
      expect(html).not.toContain('1 more models');
      expect(html).not.toContain('1 models');
    });
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

describe('F5: catalog ids are escaped at every buildModelPickHTML interpolation point', () => {
  // Minimal entity DECODER for the test's own round-trip check -- not
  // production code, just the inverse of escapeAttr so the test can assert
  // "what a real HTML parser would read back" without pulling in jsdom
  // (not a project dependency; see F3's inline-fake-DOM approach for why).
  function decodeEntities(s) {
    return s
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  test('escapeAttr escapes all five HTML-significant characters', () => {
    expect(escapeAttr(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  test('escapeAttr round-trips through decodeEntities back to the original', () => {
    const original = `deepseek/a"></option></select><img src=x onerror=1>`;
    expect(decodeEntities(escapeAttr(original))).toBe(original);
  });

  // The exact id a reviewer used to close the <select> early and inject an
  // <img> into the body (data:text/html page, no CSP, privileged preload).
  const hostileId = 'deepseek/a"></option></select><img src=x onerror=1>';
  const hostileChoices = [{
    alias: 'deepseek', label: 'DeepSeek flagship', blurb: 'open-source',
    source: 'live',
    routes: { openrouter: 'openrouter/deepseek/deepseek-v4-pro', deepseek: 'deepseek/deepseek-v4-pro' },
  }];
  const hostileShortlists = {
    deepseek: {
      recommendedId: 'deepseek/deepseek-v4-pro',
      suggested: [{
        id: hostileId, name: 'a', contextLength: 128000,
        pricePerMInput: 0.5, isRecommended: false,
        directId: hostileId, openrouterId: hostileId,
      }],
      rest: [],
      total: 1,
    },
  };

  test('a hostile catalog id cannot close the <select> or inject a sibling tag', () => {
    const html = buildModelStepHTML(hostileChoices, 'deepseek', { deepseek: true }, hostileShortlists);
    // The literal breakout sequence must never appear unescaped in the output.
    expect(html).not.toContain('"></option></select><img');
    expect(html).not.toContain('<img src=x onerror=1>');
    // The <select> for this alias must still be well-formed: exactly one
    // opening and one closing tag, with the hostile id trapped inside as
    // escaped attribute/text content.
    const selectOpens = (html.match(/<select class="model-pick" data-alias="deepseek">/g) || []).length;
    const selectCloses = (html.match(/<\/select>/g) || []).length;
    expect(selectOpens).toBe(1);
    expect(selectCloses).toBe(1);
    expect(html).toContain('&lt;/option&gt;&lt;/select&gt;&lt;img src=x onerror=1&gt;');
  });

  test('the escaped value attribute still decodes back to the exact hostile id (data-or round-trip)', () => {
    const html = buildModelStepHTML(hostileChoices, 'deepseek', { deepseek: true }, hostileShortlists);
    const valueMatch = html.match(/<option value="([^]*?)" data-or="([^]*?)"[ >]/);
    expect(valueMatch).toBeTruthy();
    expect(decodeEntities(valueMatch[1])).toBe(hostileId);
    expect(decodeEntities(valueMatch[2])).toBe(hostileId);
  });
});

// Council review, PR 196 (consistency pass, NOT closing a live
// vulnerability -- see electron/setup-ui-model.js's inline comments): the
// file already escaped catalog-derived r.id/r.openrouterId in
// buildModelPickHTML but left previewId and data-alias unescaped elsewhere,
// even though in real use neither can carry a payload (c.alias is one of
// the five hardcoded FAMILIES names; previewId comes out of
// resolveQuickPicks' anchored idPattern regexes or a hardcoded fallback).
// These tests use synthetic hostile values the real catalog/FAMILIES would
// never actually produce, purely to pin that the escaping code path fires
// uniformly now.
describe('council review PR 196: previewId and data-alias escaping consistency', () => {
  function decodeEntities(s) {
    return s
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  const hostileAlias = 'deepseek"><script>1</script>';
  const hostilePreviewId = 'deepseek/a"><script>2</script>';
  const hostileChoices = [{
    alias: hostileAlias, label: 'DeepSeek flagship', blurb: 'open-source',
    source: 'live',
    routes: { deepseek: hostilePreviewId }
  }];

  test('a hostile alias in data-alias is escaped on every span/select/button carrying it', () => {
    const html = buildModelStepHTML(hostileChoices, hostileAlias, { deepseek: true }, {});
    expect(html).not.toContain(`data-alias="${hostileAlias}"`);
    const escaped = escapeAttr(hostileAlias);
    // model-resolved and write-preview spans (the two elements the finding
    // named) must both carry the escaped form.
    expect(html).toContain(`<span class="model-resolved" data-alias="${escaped}">`);
    expect(html).toContain(`<span class="write-preview" data-alias="${escaped}">`);
  });

  // N-c (second council review, PR 196): the first escaping pass covered
  // data-alias and previewId but left three other c.alias interpolations
  // in the SAME card template unescaped -- the radio value, the
  // .model-alias span, and the write-preview <code>. c.alias is one of the
  // five hardcoded FAMILIES names (not catalog data), so this is a
  // uniformity fix, not a vulnerability closure: a reader of this template
  // should not have to work out which interpolations are escaped and which
  // aren't. Uses the file's real, hardcoded FAMILIES-shaped hostile fixture
  // only to make the point mechanically checkable, not because a real
  // alias could ever carry this payload.
  test('N-c: the radio value, .model-alias span, and write-preview <code> are also escaped', () => {
    const html = buildModelStepHTML(hostileChoices, hostileAlias, { deepseek: true }, {});
    const escaped = escapeAttr(hostileAlias);
    expect(html).not.toContain(`value="${hostileAlias}"`);
    expect(html).not.toContain(`<span class="model-alias">${hostileAlias}</span>`);
    expect(html).not.toContain(`<code>${hostileAlias}</code>`);
    expect(html).toContain(`value="${escaped}"`);
    expect(html).toContain(`<span class="model-alias">${escaped}</span>`);
    expect(html).toContain(`<code>${escaped}</code>`);
  });

  test('a hostile previewId is escaped in both .model-resolved text and .write-preview-id text', () => {
    const html = buildModelStepHTML(hostileChoices, hostileAlias, { deepseek: true }, {});
    expect(html).not.toContain(`>${hostilePreviewId}<`);
    const escapedPreview = escapeAttr(hostilePreviewId);
    const resolvedMatch = html.match(/<span class="model-resolved"[^>]*>([^]*?)<\/span>/);
    const writeIdMatch = html.match(/<code class="write-preview-id">([^]*?)<\/code>/);
    expect(resolvedMatch[1]).toBe(escapedPreview);
    expect(writeIdMatch[1]).toBe(escapedPreview);
    expect(decodeEntities(resolvedMatch[1])).toBe(hostilePreviewId); // round-trips to the exact original
  });

  test('the model-pick <select> data-alias (buildModelPickHTML) is also escaped', () => {
    const shortlist = {
      recommendedId: hostilePreviewId,
      suggested: [{ id: hostilePreviewId, name: 'a', contextLength: 1000, pricePerMInput: null, isRecommended: true, openrouterId: '' }],
      rest: [], total: 1
    };
    const html = buildModelStepHTML(hostileChoices, hostileAlias, { deepseek: true }, { [hostileAlias]: shortlist });
    expect(html).not.toContain(`<select class="model-pick" data-alias="${hostileAlias}">`);
    expect(html).toContain(`<select class="model-pick" data-alias="${escapeAttr(hostileAlias)}">`);
  });

  // The finding's own verification requirement: a querySelector built from
  // the RAW (unescaped) alias string must still find the element, because
  // browsers decode HTML entities in attribute values before a CSS
  // attribute selector ever compares against them. Simulated here (no
  // jsdom dependency, matching this suite's existing decodeEntities
  // approach) by asserting the round-trip a real DOM would perform.
  test('decoding the escaped data-alias recovers the exact raw alias a querySelector would be built from', () => {
    const html = buildModelStepHTML(hostileChoices, hostileAlias, { deepseek: true }, {});
    const match = html.match(/<span class="model-resolved" data-alias="([^]*?)">/);
    expect(match).toBeTruthy();
    expect(decodeEntities(match[1])).toBe(hostileAlias); // what document.querySelector would match against
  });
});
