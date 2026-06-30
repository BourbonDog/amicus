'use strict';

/**
 * Issue #49 — theme the embedded OpenCode web UI to the clay/gold tokens.
 *
 * Before #49 the dom-ready insertCSS hook in main.js only HID OpenCode's
 * header/wordmark. This issue extends it to inject a token-driven theme so the
 * embedded chat surface matches the token-driven Amicus toolbar.
 *
 * Design: the theme block is built by a small, side-effect-free helper module
 * (electron/opencode-theme.js) so it is unit-testable WITHOUT booting Electron
 * (main.js starts Electron on require — never import it here; read it as text).
 * The helper reuses tokenCss({absoluteFontUrls:true}) — the same pattern as
 * toolbar.js / setup-ui-styles.js / load-failsafe.js — and PREFERS overriding
 * OpenCode's OWN :root CSS custom properties over brittle class selectors,
 * because OpenCode 1.17.11 DOM/class names can change.
 *
 * The live visual check against a running OpenCode session is a USER-SIDE
 * CDP/manual step and is NOT verifiable headless.
 */

const fs = require('fs');
const path = require('path');
const { buildOpencodeThemeCSS } = require('../../electron/opencode-theme');
const { tokenCss } = require('../../src/design/tokens');

const ELECTRON_DIR = path.join(__dirname, '..', '..', 'electron');
const MAIN_SRC = fs.readFileSync(path.join(ELECTRON_DIR, 'main.js'), 'utf8');

describe('Issue #49 — buildOpencodeThemeCSS()', () => {
  let css;
  beforeAll(() => { css = buildOpencodeThemeCSS(); });

  test('returns a non-empty CSS string', () => {
    expect(typeof css).toBe('string');
    expect(css.length).toBeGreaterThan(0);
  });

  test('still hides OpenCode header + wordmark (the original behavior)', () => {
    expect(css).toMatch(/#root\s*>\s*div\s*>\s*header/);
    expect(css).toMatch(/svg\[viewBox="0 0 234 42"\]/);
  });

  test('embeds the full token CSS (the same tokenCss output toolbar uses)', () => {
    // tokenCss supplies @font-face + the canonical :root tokens. The theme must
    // carry it inline (absolute font URLs) so the BrowserView resolves vars.
    const tokens = tokenCss({ absoluteFontUrls: true });
    // Spot-check load-bearing fragments rather than full-string equality, since
    // the theme wraps tokenCss with extra overrides around it.
    expect(css).toContain('--accent-500: #d97757');
    expect(css).toContain('--gold-400: #e8b24a');
    expect(css).toContain('--bg: #0a0a0a');
    expect(css).toContain('@font-face');
    expect(tokens).toContain('--accent-500: #d97757'); // sanity: source of truth
  });

  test('rewrites bundled font URLs to absolute file:// URLs (absoluteFontUrls)', () => {
    expect(css).toMatch(/url\('file:\/\/\/?.*Outfit-400\.ttf'\)/);
    expect(css).not.toMatch(/url\('\.\/fonts\//);
  });

  test('overrides OpenCode\'s OWN :root custom properties (token-driven, not brittle classes)', () => {
    // Map a clay/gold token onto an OpenCode :root var so the chat surface
    // inherits the brand without depending on OpenCode class names.
    const rootBlocks = css.match(/:root\s*\{[^}]*\}/g) || [];
    expect(rootBlocks.length).toBeGreaterThanOrEqual(1);
    const overrideBlock = rootBlocks.find((b) => /--sst-|--theme-|--ock-|--color-/.test(b));
    expect(overrideBlock).toBeDefined();
    // The override values must be token-driven (var(--...)), not hardcoded hex.
    expect(overrideBlock).toMatch(/var\(--accent/);
  });

  test('the override block maps brand surfaces/text to tokens via var(--...)', () => {
    expect(css).toMatch(/var\(--bg\)/);
    expect(css).toMatch(/var\(--text-1\)/);
    expect(css).toMatch(/var\(--accent-500\)|var\(--accent\)/);
  });
});

describe('Issue #49 — main.js wires the theme into the dom-ready insertCSS hook', () => {
  test('main.js imports buildOpencodeThemeCSS from ./opencode-theme', () => {
    expect(MAIN_SRC).toMatch(
      /require\(['"]\.\/opencode-theme['"]\)/
    );
    expect(MAIN_SRC).toMatch(/buildOpencodeThemeCSS/);
  });

  test('the insertCSS call is driven by buildOpencodeThemeCSS(), not a static hide-only literal', () => {
    // The dom-ready insertCSS must now inject the token theme.
    expect(MAIN_SRC).toMatch(/insertCSS\(\s*buildOpencodeThemeCSS\(\)\s*\)/);
  });

  test('main.js no longer hardcodes the hide-only CSS inline (moved into the helper)', () => {
    // The original inline two-selector literal should be gone from main.js
    // (it now lives in opencode-theme.js). Guard against regression to the
    // hide-only block.
    const inlineHideOnly =
      /insertCSS\(`\s*#root > div > header \{ display: none/;
    expect(MAIN_SRC).not.toMatch(inlineHideOnly);
  });
});
