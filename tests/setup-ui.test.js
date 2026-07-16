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
        `${toBareMatch[0]}\n${pickRouteForMatch[0]}\nreturn pickRouteFor;`
      );

      const directProviders = JSON.parse(directProvidersMatch[1].replace(/'/g, '"'));

      // Case 1: no explicit pill click, no configured keys (falls back to
      // provs[0] === 'openrouter') — openrouter/google/x must canonicalize.
      const mcDirect = { alias: 'gemini', routes: { openrouter: 'openrouter/google/gemini-x', google: 'google/gemini-x' } };
      let pickRouteFor = build(directProviders, {}, {}, {});
      expect(pickRouteFor(mcDirect)).toBe('google/gemini-x');

      // Case 2: gateway-only vendor (qwen not in directProviders) stays unchanged.
      const mcGatewayOnly = { alias: 'qwen', routes: { openrouter: 'openrouter/qwen/qwen-x' } };
      pickRouteFor = build(directProviders, {}, {}, {});
      expect(pickRouteFor(mcGatewayOnly)).toBe('openrouter/qwen/qwen-x');

      // Case 3: explicit pill choice for a direct-capable vendor's OpenRouter
      // route is honored unchanged (user deliberately chose "via OpenRouter").
      const routingChoices = { gemini: 'openrouter' };
      const explicitRouteChoices = { gemini: true };
      pickRouteFor = build(directProviders, routingChoices, {}, explicitRouteChoices);
      expect(pickRouteFor(mcDirect)).toBe('openrouter/google/gemini-x');
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
    expect(html).toContain('openrouter/google/gemini-3.5-flash'); // Task-1 pinned id
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
