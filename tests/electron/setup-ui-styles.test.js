'use strict';
const { buildWizardCSS, __rawWizardCSS } = require('../../electron/setup-ui-styles');
const { TOKENS } = require('../../src/design/tokens');

describe('buildWizardCSS — token adoption', () => {
  let css, rules;
  beforeAll(() => { css = buildWizardCSS(); rules = __rawWizardCSS(); });

  test('prepends the shared token :root + @font-face block', () => {
    expect(css).toContain(':root');
    expect(css).toContain('@font-face');
    expect(css).toContain("font-family: 'Outfit'");
    expect(css).toContain("font-family: 'IBM Plex Mono'");
    // the token block carries the canonical clay accent
    expect(css).toContain(TOKENS.accent); // '#d97757'
  });

  test('injects ABSOLUTE file:// font URLs so fonts resolve in the data: URL context (BLOCKER FIX #2)', () => {
    // buildWizardCSS() must use tokenCss({ absoluteFontUrls: true }); a relative
    // ./fonts/ url in a data: URL has no base and silently falls back.
    expect(css).toMatch(/url\('file:\/\/[^']*Outfit-400\.ttf'\)/);
    expect(css).not.toContain("url('./fonts/");
  });

  test('the wizard RULES reference token vars, not raw hex', () => {
    expect(rules).toContain('var(--bg)');
    expect(rules).toContain('var(--accent)');
    expect(rules).toContain('var(--surface)');
    expect(rules).toContain('var(--border)');
    expect(rules).toContain('var(--text)');
    expect(rules).toContain('font-family: var(--font-sans)');
    expect(rules).toContain('font-family: var(--font-mono)');
  });

  test('no warm-brown / SF-Mono-only hardcodes survive in the wizard rules', () => {
    // the old plum/warm-brown ramp and ad-hoc hex are fully replaced.
    // NOTE: #c45c3f (spec --accent-600) lives only in the injected :root, never
    // in these rules; the old app hover hex #C4623F is what is forbidden here.
    for (const dead of ['#2D2B2A', '#3D3A38', '#E8E0D8', '#A09B96', '#7A756F',
                        '#5A5550', '#1E1C1B', '#352E2B', '#34312F', '#4A3328',
                        '#1F1D1C', '#D4D0CC', '#C4623F']) {
      expect(rules).not.toContain(dead);
    }
    // the only raw hex allowed in rules is #fff on accent fills (button/pill text)
    const hexes = (rules.match(/#[0-9a-fA-F]{3,6}/g) || []).map(h => h.toLowerCase());
    for (const h of hexes) { expect(['#fff', '#ffffff']).toContain(h); }
  });

  test('mono families come from the token var (no inline SF Mono stacks left)', () => {
    expect(rules).not.toContain("'SF Mono'");
    expect(rules).not.toContain('Menlo');
  });
});

describe('buildWizardCSS — kit component treatments', () => {
  let rules;
  beforeAll(() => { rules = require('../../electron/setup-ui-styles').__rawWizardCSS(); });

  test('defines the StatusDot pulse keyframes + a live-dot using the ok + ease-out tokens', () => {
    expect(rules).toContain('@keyframes amicusPulse');
    expect(rules).toContain('.live-dot');
    expect(rules).toContain('var(--ease-out)');
  });

  // Finding #7: assert against the WHOLE rules string, one independent matcher
  // per property — never an arbitrary byte-offset slice.
  test('provider-check renders as a filled status dot (radius 50% + ok token fill)', () => {
    // the base .provider-check rule is a circular chip
    expect(rules).toMatch(/\.provider-check\s*\{[^}]*border-radius:\s*50%/);
    // a separate selector fills it with the ok token once selected / non-empty
    expect(rules).toMatch(/\.provider-check:not\(:empty\)\s*\{[^}]*background:\s*var\(--ok\)/);
  });
});

describe('buildWizardCSS — free council picker (B35/#27 grouped rendering)', () => {
  let rules;
  beforeAll(() => { rules = require('../../electron/setup-ui-styles').__rawWizardCSS(); });

  test('results scroll area matches the Step-2 search-results height (~220px, up from the old 160px)', () => {
    expect(rules).toMatch(/\.council-results\s*\{[^}]*max-height:\s*220px/);
  });

  test('council-group reuses the alias-group collapsible <details> treatment (no parallel system)', () => {
    expect(rules).toMatch(/\.council-group\s+summary/);
    expect(rules).toContain('.council-group-count');
  });

  test('two-line row: friendly name primary, raw id mono secondary (search-row precedent)', () => {
    expect(rules).toMatch(/\.council-row-name\s*\{[^}]*color:\s*var\(--text\)/);
    expect(rules).toMatch(/\.council-row-id\s*\{[^}]*font-family:\s*var\(--font-mono\)/);
    expect(rules).toMatch(/\.council-row-id\s*\{[^}]*color:\s*var\(--text-muted\)/);
  });
});
