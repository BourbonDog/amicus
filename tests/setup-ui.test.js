/**
 * Tests for electron/setup-ui.js (Wizard Orchestrator)
 *
 * Verifies the unified wizard HTML contains all 3 steps:
 * Step 1 (API Keys), Step 2 (Model Selection), Step 3 (Review).
 * Also tests progress bar, navigation, routing state, and shared CSS.
 */

const { buildSetupHTML, PROVIDERS } = require('../electron/setup-ui');

const PICKS = [
  { alias: 'gemini', label: 'Gemini Flash-class', blurb: 'fast, large context',
    source: 'live',
    routes: { openrouter: 'openrouter/google/gemini-9.9-flash' } },
];

describe('setup-ui wizard', () => {
  let html;

  beforeAll(() => {
    html = buildSetupHTML();
  });

  describe('buildSetupHTML', () => {
    it('should return a complete HTML document', () => {
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('should contain the amicus branding', () => {
      expect(html).toContain('Amicus');
    });

    it('should show plain "Amicus" for cowork client', () => {
      const coworkHtml = buildSetupHTML({ client: 'cowork' });
      expect(coworkHtml).toContain('Amicus Setup');
      expect(coworkHtml).not.toContain('Openwork');
    });

    it('should ride the shared clay/gold token layer (no warm-brown ramp)', () => {
      const { TOKENS } = require('../src/design/tokens');
      expect(html).toContain(TOKENS.accent);   // '#d97757' from the injected :root
      expect(html).toContain('var(--bg)');      // wizard rules reference tokens
      expect(html).toContain('var(--accent)');
      expect(html).not.toContain('#2D2B2A');    // the old warm-brown background is gone
    });
  });

  describe('progress bar', () => {
    it('should contain 4 step indicators', () => {
      expect(html).toContain('step-1');
      expect(html).toContain('step-2');
      expect(html).toContain('step-3');
      expect(html).toContain('step-4');
    });

    it('should contain step labels', () => {
      expect(html).toContain('API Keys');
      expect(html).toContain('Models');
      expect(html).toContain('Routing');
      expect(html).toContain('Review');
    });

    it('should use "Models" instead of "Default Model" for step 2', () => {
      // Extract the progress bar section
      const progStart = html.indexOf('progress-bar');
      const progEnd = html.indexOf('</div>', html.indexOf('step-4') + 10);
      const progHtml = html.slice(progStart, progEnd);
      expect(progHtml).toContain('Models');
      expect(progHtml).not.toContain('Default Model');
    });
  });

  describe('Step 1 - API Keys', () => {
    it('should contain the keys step container', () => {
      expect(html).toContain('id="wizard-step-1"');
    });

    it('should contain provider options', () => {
      expect(html).toContain('data-provider="openrouter"');
      expect(html).toContain('data-provider="google"');
      expect(html).toContain('data-provider="openai"');
      expect(html).toContain('data-provider="anthropic"');
    });

    it('should contain an API key input field', () => {
      expect(html).toContain('api-key-input');
    });

    it('should contain a Save & Test button', () => {
      expect(html).toContain('Save &amp; Test');
    });

    it('should mark OpenRouter as recommended', () => {
      expect(html).toContain('Recommended');
    });

    it('should contain a password type input for masking', () => {
      expect(html).toContain('type="password"');
    });
  });

  describe('Step 2 - Model Selection', () => {
    it('should contain the model step container', () => {
      expect(html).toContain('id="wizard-step-2"');
    });

    it('should contain model choices', () => {
      expect(html).toContain('gemini');
      expect(html).toContain('gemini-pro');
      expect(html).toContain('gpt');
      expect(html).toContain('opus');
      expect(html).toContain('deepseek');
    });
  });

  describe('Step 3 - Aliases', () => {
    it('should contain the aliases step container', () => {
      expect(html).toContain('id="wizard-step-3"');
    });

    it('should contain the alias-editor section in step 3', () => {
      // alias-editor should be inside wizard-step-3, not wizard-step-2
      const step3Start = html.indexOf('id="wizard-step-3"');
      const step4Start = html.indexOf('id="wizard-step-4"');
      const step3Html = html.slice(step3Start, step4Start);
      expect(step3Html).toContain('alias-editor');
    });

    it('should NOT contain alias-editor in step 2', () => {
      const step2Start = html.indexOf('id="wizard-step-2"');
      const step3Start = html.indexOf('id="wizard-step-3"');
      const step2Html = html.slice(step2Start, step3Start);
      expect(step2Html).not.toContain('alias-editor');
    });
  });

  describe('Step 4 - Review', () => {
    it('should contain the review step container', () => {
      expect(html).toContain('id="wizard-step-4"');
    });

    it('should contain review summary elements', () => {
      expect(html).toContain('review-keys');
      expect(html).toContain('review-model');
    });

    it('should contain routing review section', () => {
      expect(html).toContain('review-routing');
    });

    it('should contain Setup Complete text', () => {
      expect(html).toContain('Setup Complete');
    });
  });

  describe('navigation', () => {
    it('should contain Next button', () => {
      expect(html).toContain('next-btn');
    });

    it('should contain Back button', () => {
      expect(html).toContain('back-btn');
    });

    it('should contain Finish button', () => {
      expect(html).toContain('finish-btn');
    });

    it('should contain the sidecar branding in footer', () => {
      expect(html).toContain('footer-brand');
    });
  });

  describe('IPC references', () => {
    it('should reference all required IPC channels', () => {
      expect(html).toContain('sidecar:validate-key');
      expect(html).toContain('sidecar:save-key');
      expect(html).toContain('sidecar:setup-done');
      expect(html).toContain('sidecar:save-config');
      expect(html).toContain('sidecar:get-config');
      expect(html).toContain('sidecar:get-api-keys');
    });
  });

  describe('routing state', () => {
    it('should initialize routingChoices object in script', () => {
      expect(html).toContain('routingChoices');
    });

    it('should pass MODEL_CHOICES data to script as JSON', () => {
      expect(html).toContain('modelChoicesData');
    });

    it('should pass PROVIDER_NAMES data to script as JSON', () => {
      expect(html).toContain('providerNamesData');
    });

    it('should handle route pill clicks', () => {
      expect(html).toContain('route-pill');
    });

    it('should pass aliasWrites to save-config (only touched aliases)', () => {
      // The finish handler should send only the touched alias writes
      expect(html).toContain('aliasWrites');
      // The old blanket card-write loop is gone
      expect(html).not.toContain('routingOverrides');
    });
  });

  describe('#61: direct-first canonicalization for auto-selected routes', () => {
    it('injects directProviders with the 4 direct-capable vendors', () => {
      expect(html).toContain('var directProviders =');
      const m = html.match(/var directProviders = (\[[^\]]*\]);/);
      expect(m).toBeTruthy();
      const directProviders = JSON.parse(m[1].replace(/'/g, '"'));
      expect(directProviders.sort()).toEqual(['anthropic', 'deepseek', 'google', 'openai'].sort());
      expect(directProviders).not.toContain('openrouter');
    });

    it('tracks genuine pill clicks via explicitRouteChoices', () => {
      expect(html).toContain('var explicitRouteChoices = {};');
    });

    it('defines the toBareIfDirect canonicalization helper', () => {
      expect(html).toContain('function toBareIfDirect(route)');
      expect(html).toContain("route.indexOf('openrouter/') !== 0");
    });

    it('route-pill click handler marks the alias as an explicit choice', () => {
      const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
      const clickIdx = script.indexOf("routingChoices[alias] = provider;");
      expect(clickIdx).toBeGreaterThan(-1);
      const nearby = script.slice(clickIdx, clickIdx + 200);
      expect(nearby).toContain('explicitRouteChoices[alias] = true;');
    });

    it('pickRouteFor canonicalizes auto-picks but returns explicit pill choices unchanged', () => {
      const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
      const pickIdx = script.indexOf('function pickRouteFor(mc)');
      const bodyEnd = script.indexOf('\n  }', pickIdx);
      const pickRouteForSrc = script.slice(pickIdx, bodyEnd + 4);
      expect(pickRouteForSrc).toContain('!explicitRouteChoices[mc.alias]');
      expect(pickRouteForSrc).toContain('toBareIfDirect(route)');
      // Auto-switch (updateRoutingPills) and the alias-route fallback
      // (updateAliasRoutes) must NOT flag a choice as explicit — only a
      // genuine pill click should.
      const autoSwitchIdx = script.indexOf('Auto-switch routing if selected');
      const autoSwitchBlock = script.slice(autoSwitchIdx, autoSwitchIdx + 300);
      expect(autoSwitchBlock).toContain('routingChoices[mc.alias] = available[0];'); // sanity: window covers the assignment
      expect(autoSwitchBlock).not.toContain('explicitRouteChoices');
      const fallbackIdx = script.indexOf('Pick first provider with a configured key');
      const fallbackBlock = script.slice(fallbackIdx, fallbackIdx + 500);
      expect(fallbackBlock).toContain('routingChoices[mc.alias] = provs[i];'); // sanity: window covers the assignment
      expect(fallbackBlock).not.toContain('explicitRouteChoices');
    });

    it('logic: auto-picked openrouter/<direct-vendor>/<model> canonicalizes to bare, gateway-only vendor and explicit choices pass through unchanged', () => {
      const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
      const directProvidersMatch = script.match(/var directProviders = (\[[^\]]*\]);/);
      const toBareMatch = script.match(/function toBareIfDirect\(route\) \{[\s\S]*?\n  \}/);
      const pickRouteForMatch = script.match(/function pickRouteFor\(mc\) \{[\s\S]*?\n  \}/);
      expect(directProvidersMatch).toBeTruthy();
      expect(toBareMatch).toBeTruthy();
      expect(pickRouteForMatch).toBeTruthy();

      // eslint-disable-next-line no-new-func
      const build = new Function(
        'directProviders', 'routingChoices', 'configuredKeys', 'explicitRouteChoices',
        'modelChoiceIds', 'modelOpenrouterIds',
        `${toBareMatch[0]}\n${pickRouteForMatch[0]}\nreturn pickRouteFor;`
      );

      const directProviders = JSON.parse(directProvidersMatch[1].replace(/'/g, '"'));

      // Case 1: no explicit pill click, no configured keys (falls back to
      // provs[0] === 'openrouter') — openrouter/google/x must canonicalize.
      const mcDirect = { alias: 'gemini', routes: { openrouter: 'openrouter/google/gemini-x', google: 'google/gemini-x' } };
      let pickRouteFor = build(directProviders, {}, {}, {}, {}, {});
      expect(pickRouteFor(mcDirect)).toBe('google/gemini-x');

      // Case 2: gateway-only vendor (qwen not in directProviders) stays unchanged.
      const mcGatewayOnly = { alias: 'qwen', routes: { openrouter: 'openrouter/qwen/qwen-x' } };
      pickRouteFor = build(directProviders, {}, {}, {}, {}, {});
      expect(pickRouteFor(mcGatewayOnly)).toBe('openrouter/qwen/qwen-x');

      // Case 3: explicit pill choice for a direct-capable vendor's OpenRouter
      // route is honored unchanged (user deliberately chose "via OpenRouter").
      const routingChoices = { gemini: 'openrouter' };
      const explicitRouteChoices = { gemini: true };
      pickRouteFor = build(directProviders, routingChoices, {}, explicitRouteChoices, {}, {});
      expect(pickRouteFor(mcDirect)).toBe('openrouter/google/gemini-x');
    });
  });

  describe('issue 138: Finish honours a drilled-down model', () => {
    // CONTROLLER RULING R3: extracts the REAL in-page pickRouteFor (not a
    // local reimplementation) via the same new Function harness the #61
    // suite above uses. Brittle to reindenting pickRouteFor's source.
    function extractPickRouteFor() {
      const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
      const directProvidersMatch = script.match(/var directProviders = (\[[^\]]*\]);/);
      const toBareMatch = script.match(/function toBareIfDirect\(route\) \{[\s\S]*?\n {2}\}/);
      const pickRouteForMatch = script.match(/function pickRouteFor\(mc\) \{[\s\S]*?\n {2}\}/);
      expect(directProvidersMatch).toBeTruthy();
      expect(toBareMatch).toBeTruthy();
      expect(pickRouteForMatch).toBeTruthy();
      const directProviders = JSON.parse(directProvidersMatch[1].replace(/'/g, '"'));
      // eslint-disable-next-line no-new-func
      const build = new Function(
        'directProviders', 'routingChoices', 'configuredKeys', 'explicitRouteChoices',
        'modelChoiceIds', 'modelOpenrouterIds',
        `${toBareMatch[0]}\n${pickRouteForMatch[0]}\nreturn pickRouteFor;`
      );
      return (opts = {}) => build(
        directProviders,
        opts.routingChoices || {}, opts.configuredKeys || {}, opts.explicitRouteChoices || {},
        opts.modelChoiceIds || {}, opts.modelOpenrouterIds || {}
      );
    }

    const mc = {
      alias: 'deepseek',
      routes: {
        openrouter: 'openrouter/deepseek/deepseek-v4-pro',
        deepseek: 'deepseek/deepseek-v4-pro'
      }
    };

    it('a chosen model id wins over the family flagship route', () => {
      const pickRouteFor = extractPickRouteFor()({
        modelChoiceIds: { deepseek: 'deepseek/deepseek-r1' }
      });
      expect(pickRouteFor(mc)).toBe('deepseek/deepseek-r1');
    });

    it('an explicit OpenRouter pill keeps the openrouter/ prefix on the chosen model', () => {
      const pickRouteFor = extractPickRouteFor()({
        routingChoices: { deepseek: 'openrouter' },
        explicitRouteChoices: { deepseek: true },
        modelChoiceIds: { deepseek: 'deepseek/deepseek-r1' },
        modelOpenrouterIds: { deepseek: 'openrouter/deepseek/deepseek-r1' }
      });
      expect(pickRouteFor(mc)).toBe('openrouter/deepseek/deepseek-r1');
    });

    it('a picked model without an explicit OpenRouter pill stays in its bare/direct form', () => {
      // Drilled down but no "via OpenRouter" pill click — must NOT force the
      // openrouter/ form even though modelOpenrouterIds has one on file.
      const pickRouteFor = extractPickRouteFor()({
        modelChoiceIds: { deepseek: 'deepseek/deepseek-r1' },
        modelOpenrouterIds: { deepseek: 'openrouter/deepseek/deepseek-r1' }
      });
      expect(pickRouteFor(mc)).toBe('deepseek/deepseek-r1');
    });

    it('the primary path (no drill-down pick) is unchanged', () => {
      const mcDirect = { alias: 'gemini', routes: { openrouter: 'openrouter/google/gemini-x', google: 'google/gemini-x' } };
      const pickRouteFor = extractPickRouteFor()();
      expect(pickRouteFor(mcDirect)).toBe('google/gemini-x');
    });

    it('wires a change handler on .model-pick that records the choice and its OpenRouter form', () => {
      const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
      const idx = script.indexOf(".closest('.model-pick')");
      expect(idx).toBeGreaterThan(-1);
      const nearby = script.slice(idx, idx + 400);
      expect(nearby).toContain('modelChoiceIds[alias] = sel.value;');
      expect(nearby).toContain("getAttribute('data-or')");
      expect(nearby).toContain('updateWritePreviews();');
    });

    it('both the Finish handler and updateWritePreviews call the same pickRouteFor', () => {
      const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
      const calls = script.match(/= pickRouteFor\(mc\);/g) || [];
      // Finish handler (~:425) and updateWritePreviews (~:554) — both must
      // resolve through the one function this suite just fixed.
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });

    // fix round 1, Finding 2: a DIVERGENT_VENDOR's picked id (curated-models.js
    // has no shared string form between anthropic's direct and OpenRouter
    // ids) must come back byte-for-byte, never routed through toBareIfDirect.
    it('a picked id for a DIVERGENT_VENDOR (anthropic) is returned verbatim, never canonicalized', () => {
      const mcAnthropic = {
        alias: 'opus',
        routes: { openrouter: 'openrouter/anthropic/claude-opus-5', anthropic: 'anthropic/claude-opus-5' }
      };
      const pickRouteFor = extractPickRouteFor()({
        // Real directProviders (extracted from the built HTML) includes
        // 'anthropic' -- toBareIfDirect WOULD strip this prefix if it ran.
        modelChoiceIds: { opus: 'openrouter/anthropic/claude-opus-5' }
      });
      expect(pickRouteFor(mcAnthropic)).toBe('openrouter/anthropic/claude-opus-5');
    });

    // fix round 1, Finding 3: a shortlist row with no OpenRouter twin writes
    // data-or="" -> the change handler stores null, not ''. pickRouteFor's
    // `modelOpenrouterIds[mc.alias] || picked` must degrade to the picked
    // id, not to an empty-string write.
    it('a picked model with no OpenRouter twin (data-or="") still returns the picked id under an active OpenRouter pill', () => {
      const pickRouteFor = extractPickRouteFor()({
        routingChoices: { deepseek: 'openrouter' },
        explicitRouteChoices: { deepseek: true },
        modelChoiceIds: { deepseek: 'deepseek/deepseek-v3.2' },
        modelOpenrouterIds: { deepseek: null } // what the change handler stores for data-or=""
      });
      expect(pickRouteFor(mc)).toBe('deepseek/deepseek-v3.2');
    });

    it('the change handler degrades a missing data-or to null (not empty string, per Finding 3)', () => {
      const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
      const idx = script.indexOf(".closest('.model-pick')");
      const nearby = script.slice(idx, idx + 400);
      expect(nearby).toContain("(opt && opt.getAttribute('data-or')) || null");
    });
  });

  describe('issue 138 fix round 1, Finding 1: a drilled-down pick on a non-selected card must not vanish', () => {
    // Extracts the REAL collectAliasWrites (+ its pickRouteFor/toBareIfDirect
    // dependencies) via the same new Function harness as extractPickRouteFor
    // above -- not a local reimplementation. Brittle to reindenting any of
    // the three extracted functions.
    function extractCollectAliasWrites() {
      const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
      const directProvidersMatch = script.match(/var directProviders = (\[[^\]]*\]);/);
      const toBareMatch = script.match(/function toBareIfDirect\(route\) \{[\s\S]*?\n {2}\}/);
      const pickRouteForMatch = script.match(/function pickRouteFor\(mc\) \{[\s\S]*?\n {2}\}/);
      const collectMatch = script.match(/function collectAliasWrites\([^)]*\) \{[\s\S]*?\n {2}\}/);
      expect(directProvidersMatch).toBeTruthy();
      expect(toBareMatch).toBeTruthy();
      expect(pickRouteForMatch).toBeTruthy();
      expect(collectMatch).toBeTruthy();
      const directProviders = JSON.parse(directProvidersMatch[1].replace(/'/g, '"'));
      // eslint-disable-next-line no-new-func
      const build = new Function(
        'directProviders', 'routingChoices', 'configuredKeys', 'explicitRouteChoices',
        'modelChoiceIds', 'modelOpenrouterIds', 'aliasEdits', 'modelChoicesData',
        `${toBareMatch[0]}\n${pickRouteForMatch[0]}\n${collectMatch[0]}\nreturn collectAliasWrites;`
      );
      return (opts = {}) => build(
        directProviders,
        opts.routingChoices || {}, opts.configuredKeys || {}, opts.explicitRouteChoices || {},
        opts.modelChoiceIds || {}, opts.modelOpenrouterIds || {},
        opts.aliasEdits || {}, opts.modelChoicesData || []
      );
    }

    const twoCardData = [
      { alias: 'gemini', routes: { openrouter: 'openrouter/google/gemini-x', google: 'google/gemini-x' } },
      { alias: 'deepseek', routes: { openrouter: 'openrouter/deepseek/deepseek-v4-pro', deepseek: 'deepseek/deepseek-v4-pro' } }
    ];

    it('writes a drilled-down alias even when a DIFFERENT card is the checked default', () => {
      const collectAliasWrites = extractCollectAliasWrites()({
        modelChoicesData: twoCardData,
        modelChoiceIds: { deepseek: 'deepseek/deepseek-r1' }
      });
      const writes = collectAliasWrites('gemini', false);
      expect(writes.gemini).toBe('google/gemini-x');       // selected alias: unchanged behavior
      expect(writes.deepseek).toBe('deepseek/deepseek-r1'); // Finding 1: must NOT vanish
    });

    it('a card the user never touched is not written at all', () => {
      const collectAliasWrites = extractCollectAliasWrites()({
        modelChoicesData: twoCardData,
        modelChoiceIds: {} // nobody drilled down
      });
      const writes = collectAliasWrites('gemini', false);
      expect(writes).toEqual({ gemini: 'google/gemini-x' });
      expect(writes.deepseek).toBeUndefined();
    });

    // fix round 2, ruling R6a: the precedence differs by whether the alias
    // is the SELECTED (checked) default or not. Only the selected alias
    // clobbers aliasEdits (pre-existing, unchanged -- see the pin test
    // below). Every OTHER alias in modelChoiceIds is written ONLY when
    // aliasEdits has no entry for it at all -- a Step-3 edit (including an
    // explicit deletion, aliasEdits[alias] === null) on a non-selected
    // alias is the later, more deliberate action and wins.
    it('R6a: a Step-3 edit on a NON-selected alias wins over a same-alias dropdown touch (round-1 had this backwards)', () => {
      const collectAliasWrites = extractCollectAliasWrites()({
        modelChoicesData: twoCardData,
        modelChoiceIds: { deepseek: 'deepseek/deepseek-r1' },
        aliasEdits: { deepseek: 'some-explicit-step3-edit', untouched: 'kept-value' }
      });
      const writes = collectAliasWrites('gemini', false); // gemini is selected, NOT deepseek
      expect(writes.deepseek).toBe('some-explicit-step3-edit'); // Step-3 edit wins for a non-selected alias
      expect(writes.untouched).toBe('kept-value');                // an edit for an alias nobody touched survives either way
    });

    it('R6a Finding 1 regression: a Step-3 DELETION of a non-selected alias survives a same-alias dropdown touch (the null must reach aliasWrites, not be resurrected)', () => {
      const collectAliasWrites = extractCollectAliasWrites()({
        modelChoicesData: twoCardData,
        modelChoiceIds: { deepseek: 'deepseek/deepseek-r1' }, // drilled down AFTER deleting, in either order
        aliasEdits: { deepseek: null } // explicit Step-3 deletion
      });
      const writes = collectAliasWrites('gemini', false); // gemini is the checked default, NOT deepseek
      expect(writes.deepseek).toBeNull(); // deletion survives -- must NOT come back as a route id
      expect(writes.gemini).toBe('google/gemini-x');
    });

    it('R6a: presence must be tested with hasOwnProperty, not `!== undefined` -- an inherited Object.prototype property name is not mistaken for a real aliasEdits entry', () => {
      // aliasEdits has no OWN 'toString' key, but plain-object property
      // access still resolves it via the prototype chain to a real
      // function -- so `aliasEdits.toString !== undefined` is TRUE even
      // though nothing was ever set. hasOwnProperty correctly says false,
      // so the drilled-down write for a same-named alias must proceed.
      const protoCardData = [
        { alias: 'toString', routes: { openrouter: 'openrouter/acme/toString-model', acme: 'acme/toString-model' } }
      ];
      expect(({}).toString !== undefined).toBe(true); // sanity: the footgun is real
      expect(Object.prototype.hasOwnProperty.call({}, 'toString')).toBe(false); // sanity: hasOwnProperty is not fooled
      const collectAliasWrites = extractCollectAliasWrites()({
        modelChoicesData: protoCardData,
        modelChoiceIds: { toString: 'acme/toString-model' },
        aliasEdits: {} // no OWN 'toString' key
      });
      const writes = collectAliasWrites(null, false); // 'toString' is not the selected alias
      expect(writes.toString).toBe('acme/toString-model');
    });

    it('R6a pin: the selected alias still clobbers a same-alias Step-3 edit -- unchanged, this is the one place clobbering is permitted', () => {
      const collectAliasWrites = extractCollectAliasWrites()({
        modelChoicesData: twoCardData,
        modelChoiceIds: {}, // no drill-down needed to prove the selected-alias branch alone
        aliasEdits: { deepseek: 'some-stale-step3-edit' }
      });
      const writes = collectAliasWrites('deepseek', false); // deepseek IS the checked default this time
      expect(writes.deepseek).toBe('deepseek/deepseek-v4-pro'); // selected-alias clobber, unchanged from before R6a
    });

    it('is not gated on the quick-pick radio: a custom (searched) default model still carries the drilled-down write', () => {
      const collectAliasWrites = extractCollectAliasWrites()({
        modelChoicesData: twoCardData,
        modelChoiceIds: { deepseek: 'deepseek/deepseek-r1' }
      });
      const writes = collectAliasWrites(null, true); // customDefaultModel path: isCustomDefault=true
      expect(writes.deepseek).toBe('deepseek/deepseek-r1');
      expect(writes.gemini).toBeUndefined(); // no quick-pick was selected, so no selected-alias write
    });
  });

  describe('Step 3 - Alias Editor', () => {
    it('should contain the alias-editor section', () => {
      expect(html).toContain('alias-editor');
    });

    it('should contain the alias search input', () => {
      expect(html).toContain('alias-search');
    });

    it('should contain alias groups as details elements', () => {
      expect(html).toContain('alias-group');
    });

    it('should contain the Add Custom Alias button', () => {
      expect(html).toContain('alias-add-btn');
    });

    it('should contain aliasEdits state in script', () => {
      expect(html).toContain('aliasEdits');
    });

    it('should contain alias-search handler reference', () => {
      expect(html).toContain('alias-search');
    });
  });

  describe('PROVIDERS export', () => {
    it('should export 5 providers', () => {
      expect(PROVIDERS).toHaveLength(5);
    });

    it('should have openrouter as recommended', () => {
      const or = PROVIDERS.find(p => p.id === 'openrouter');
      expect(or.recommended).toBe(true);
    });

    it('should have unique IDs', () => {
      const ids = PROVIDERS.map(p => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});

describe('buildSetupHTML (resolved picks)', () => {
  test('injects quickPicks as modelChoicesData and defaultAliases as static defaults', () => {
    const html = buildSetupHTML({ quickPicks: PICKS });
    expect(html).toContain('openrouter/google/gemini-9.9-flash');
    expect(html).toContain('var modelChoicesData =');
    expect(html).not.toContain('routingOverrides'); // blanket card writes are gone
    expect(html).toContain('aliasWrites');
  });
  test('defaults to pinned fallbacks when no picks are provided', () => {
    const html = buildSetupHTML();
    expect(html).toContain('openrouter/google/gemini-3.6-flash'); // Task-1 pinned id
  });
  test('Step-3 visit no longer stamps card aliases into aliasEdits', () => {
    const html = buildSetupHTML({ quickPicks: PICKS });
    expect(html).not.toContain('aliasEdits[alias] = routedModels[alias]');
  });
  test('init-loaded config deviations go to aliasDisplay, not aliasEdits', () => {
    const html = buildSetupHTML({ quickPicks: PICKS });
    expect(html).toContain('var aliasDisplay = {}');
    expect(html).toContain('aliasDisplay[k] = cfg.aliases[k]');
    expect(html).not.toContain('aliasEdits[k] = cfg.aliases[k]');
  });
  test('finish applies the quick-pick selection after the aliasEdits overlay', () => {
    const html = buildSetupHTML({ quickPicks: PICKS });
    const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
    const overlayIdx = script.indexOf('aliasWrites[k] = aliasEdits[k]');
    const selectionIdx = script.indexOf('aliasWrites[mc.alias] = routeId');
    expect(overlayIdx).toBeGreaterThan(-1);
    expect(selectionIdx).toBeGreaterThan(overlayIdx);
  });
});
